import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { unsupportedPlatform } from "@/lib/utils/platform-guard";
import { getShippingDocument } from "@/lib/integrations/tiktokShop";
import { createShippingDocument, downloadShippingDocument, getShippingDocumentParameter, getShippingDocumentResult } from "@/lib/integrations/shopee";
import { loadShopeeAccount, withRefreshedToken } from "@/lib/services/marketplace-shopee.service";
import { downloadValidatedPdf } from "@/lib/security/validate-upload";

/**
 * Label pengiriman RESMI dari TikTok (GetPackageShippingDocument).
 * Hanya tersedia untuk paket TikTok Shipping yang sudah di-ship:
 *   - order belum di-ship → 404 (frontend menampilkan petunjuk pengaturan pengiriman)
 *   - order dikirim oleh seller (ship order AWB mandiri) → tidak tersedia
 *
 * Mengembalikan doc_url (PDF asli) + pdfBase64 (PDF asli tanpa penambahan konten) + tracking_number paket.
 */
export const GET = withAuth(
  async (req: AuthenticatedRequest, ctx?: { params: Promise<{ id?: string }> }) => {
    const { id } = (await ctx?.params) ?? {};
    if (!req.user.canViewFullPii) return NextResponse.json({ error: "Izin PII diperlukan untuk mencetak label." }, { status: 403 });

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        account: {
          select: { accessToken: true, shopCipher: true, businessId: true, platform: true },
        },
        shipments: {
          select: { externalId: true, trackingNo: true, status: true },
        },

      },
    });

    if (!order) {
      return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
    }
    try {
      assertSameBrand(order.account.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
    }

    // Guard platform: label resmi hanya TikTok — response 400 (bukan 404) agar
    // frontend membedakan "belum siap" vs "tidak berlaku", lalu fallback cetak lokal.
    if (order.account.platform === "SHOPEE") {
      const account = await loadShopeeAccount(order.accountId);
      const shipment = order.shipments.find((s) => s.externalId) ?? order.shipments[0];
      const packageNumber = shipment?.externalId?.trim() ? shipment.externalId.trim() : undefined;
      if (!account) return NextResponse.json({ error: "Akun Shopee tidak ditemukan." }, { status: 404 });
      try {
        const pdf = await withRefreshedToken(account, async (token, shopId, creds) => {
          let suggestedType: string | undefined = undefined;
          try {
            const parameter = await getShippingDocumentParameter(token, shopId, order.orderNo, packageNumber, creds);
            suggestedType = String(parameter.suggest_shipping_document_type ?? "").trim() || undefined;
          } catch (paramErr) {
            console.warn(`[label/shopee] getShippingDocumentParameter notice:`, paramErr);
          }

          try {
            await createShippingDocument(
              token,
              shopId,
              {
                order_sn: order.orderNo,
                ...(packageNumber ? { package_number: packageNumber } : {}),
                ...(shipment?.trackingNo ? { tracking_number: shipment.trackingNo } : {}),
                ...(suggestedType ? { shipping_document_type: suggestedType } : {}),
              },
              creds
            );
          } catch (createErr) {
            console.warn(`[label/shopee] createShippingDocument notice:`, createErr);
          }

          for (let attempt = 0; attempt < 20; attempt += 1) {
            const result = await getShippingDocumentResult(token, shopId, order.orderNo, packageNumber, creds);
            const entry = Array.isArray(result.result_list) ? (result.result_list[0] as Record<string, unknown>) : result;
            const status = String(entry.status ?? entry.document_status ?? "").toUpperCase();
            if (["READY", "SUCCESS", "COMPLETED"].includes(status)) {
              return downloadShippingDocument(token, shopId, order.orderNo, packageNumber, creds);
            }
            if (["FAILED", "ERROR"].includes(status)) {
              const failReason = entry.fail_message || entry.fail_error;
              throw new Error(`Shopee belum dapat membuat dokumen resi: ${failReason || "status FAILED"}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          throw new Error("Pembuatan dokumen resi Shopee masih diproses. Coba lagi beberapa saat.");
        });
        if (pdf[0] !== 0x25 || pdf[1] !== 0x50 || pdf[2] !== 0x44 || pdf[3] !== 0x46) {
          throw new Error("Format dokumen Shopee tidak valid.");
        }
        await prisma.piiAccessLog.create({
          data: {
            id: crypto.randomUUID(),
            userId: req.user.id,
            username: req.user.username,
            orderId: order.id,
            action: "READ_SHIPPING_LABEL",
          },
        });
        return NextResponse.json({
          docUrl: null,
          pdfBase64: Buffer.from(pdf).toString("base64"),
          trackingNumber: shipment?.trackingNo ?? order.shipments[0]?.trackingNo ?? null,
          packageId: packageNumber ?? order.orderNo,
          status: shipment?.status ?? order.shipments[0]?.status ?? null,
        });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Resi Shopee belum tersedia." }, { status: 422 });
      }
    }
    if (order.account.platform !== "TIKTOK_SHOP") {
      return unsupportedPlatform(order.account.platform);
    }

    if (!order.account.accessToken) {
      return NextResponse.json({ error: "Akun belum punya access token." }, { status: 400 });
    }

    const packageId = order.shipments.find((s) => s.externalId)?.externalId ?? null;
    if (!packageId) {
      return NextResponse.json(
        { error: "Belum ada paket pengiriman. Label resmi TikTok tersedia setelah paket di-ship." },
        { status: 404 }
      );
    }

    const { docUrl, trackingNumber } = await getShippingDocument(
      order.account.accessToken,
      order.account.shopCipher ?? undefined,
      packageId,
      "SHIPPING_LABEL",
      "PDF"
    );

    if (!docUrl) {
      return NextResponse.json(
        { error: "Label resmi TikTok belum tersedia untuk paket ini (order non-TikTok Shipping atau belum di-ship)." },
        { status: 404 }
      );
    }

    let pdfBase64: string | null = null;
    try {
      pdfBase64 = (await downloadValidatedPdf(docUrl)).toString("base64");
    } catch (e) {
      console.error("[Label] Gagal mengunduh label resmi:", e);
      return NextResponse.json({ error: "Dokumen label tidak valid atau tidak tersedia." }, { status: 502 });
    }

    await prisma.piiAccessLog.create({ data: { id: crypto.randomUUID(), userId: req.user.id, username: req.user.username, orderId: order.id, action: "READ_SHIPPING_LABEL" } });

    return NextResponse.json({
      docUrl: null,
      pdfBase64,
      trackingNumber,
      packageId,
      status: order.shipments[0]?.status ?? null,
    });
  }
);
