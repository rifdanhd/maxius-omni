import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { unsupportedPlatform } from "@/lib/utils/platform-guard";
import { getShippingDocument } from "@/lib/integrations/tiktokShop";

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
      const res = await fetch(docUrl, { headers: { "User-Agent": "maxius-platform/1.0.0" } });
      if (res.ok) {
        const rawBytes = new Uint8Array(await res.arrayBuffer());
        pdfBase64 = Buffer.from(rawBytes).toString("base64");
      }
    } catch (e) {
      console.error("[Label] Gagal mengunduh label resmi:", e);
    }

    return NextResponse.json({
      docUrl,
      pdfBase64,
      trackingNumber,
      packageId,
      status: order.shipments[0]?.status ?? null,
    });
  }
);