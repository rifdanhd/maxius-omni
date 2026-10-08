import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { mergeShippingDocuments } from "@/lib/services/label-merge.service";
import { NON_TIKTOK_LABEL_REASON } from "@/lib/utils/platform-guard";

/**
 * Cetak label gabungan (batch) untuk beberapa order sekaligus.
 *
 * TikTok TIDAK punya endpoint batch utk shipping document, jadi server mengambil
 * label tiap order (paralel) lalu menggabungkannya jadi 1 PDF multi-halaman.
 * Order tanpa label resmi (belum di-ship / tidak punya paket / docUrl kosong)
 * dilewati dan dilaporkan via `failed` — label yang berhasil tetap digabung.
 *
 * Response JSON: { ok, count, failed: [{orderNo, reason}], pdfBase64 }
 * pdfBase64 kosong bila tidak ada satu pun label yang berhasil.
 */
export const POST = withAuth(async (req) => {
  if (!req.user.canViewFullPii) return NextResponse.json({ error: "Izin PII diperlukan untuk mencetak label." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const orderIds: unknown = body?.orderIds;

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "Pilih minimal satu pesanan." }, { status: 400 });
  }
  if (orderIds.length > 100) {
    return NextResponse.json({ error: "Maksimal 100 pesanan per cetakan." }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds.map(String) }, account: { businessId: req.businessId } },
    select: {
      id: true,
      orderNo: true,
      account: { select: { accessToken: true, shopCipher: true, platform: true } },
      shipments: { select: { externalId: true } },
      items: {
        select: {
          productName: true,
          skuName: true,
          channelSku: true,
          qty: true,
          variant: {
            select: {
              sku: true,
              masterProduct: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const items: {
    orderNo: string;
    packageId: string | null;
    accessToken: string | null;
    shopCipher: string | null;
    platform: string;
    rows: { productName: string; variant: string; sellerSku: string; qty: number }[];
  }[] = [];
  const failed: Array<{ orderNo: string; reason: string }> = [];

  for (const order of orders) {
    // Guard platform: order Shopee dilewati per-item — token Shopee tidak
    // pernah dipakai ke TikTok API (label yang berhasil tetap digabung).
    if (order.account.platform !== "TIKTOK_SHOP") {
      failed.push({ orderNo: order.orderNo, reason: NON_TIKTOK_LABEL_REASON });
      continue;
    }
    const packageId = order.shipments.find((s) => s.externalId)?.externalId ?? null;
    if (!packageId) {
      failed.push({ orderNo: order.orderNo, reason: "belum ada paket pengiriman" });
      continue;
    }
    if (!order.account.accessToken) {
      failed.push({ orderNo: order.orderNo, reason: "akun belum punya access token" });
      continue;
    }
    items.push({
      orderNo: order.orderNo,
      packageId,
      accessToken: order.account.accessToken,
      shopCipher: order.account.shopCipher,
      platform: order.account.platform,
      rows: order.items.map((it) => ({
        productName: it.variant?.masterProduct?.name ?? it.productName ?? it.channelSku,
        variant: it.skuName ?? it.variant?.sku ?? `SKU ${it.channelSku}`,
        sellerSku: it.variant?.sku ?? it.channelSku,
        qty: it.qty,
      })),
    });
  }

  if (items.length === 0) {
    return NextResponse.json({ ok: true, count: 0, failed, pdfBase64: "" });
  }

  const result = await mergeShippingDocuments(
    items.map((it) => ({
      orderNo: it.orderNo,
      packageId: it.packageId as string,
      accessToken: it.accessToken as string,
      shopCipher: it.shopCipher,
      platform: it.platform,
      rows: it.rows,
    }))
  );

  return NextResponse.json({
    ok: true,
    count: result.count,
    failed: [...failed, ...result.failed],
    pdfBase64: result.pdf ? Buffer.from(result.pdf).toString("base64") : "",
  });
});
