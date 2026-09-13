import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import {
  mergeShippingDocuments,
  type LabelMergeItem,
} from "@/lib/services/label-merge.service";

/**
 * Cetak label gabungan + ringkasan produk lokal (Metode Cetak dari modal sukses).
 * POST /api/orders/fulfillment/shipping-label
 *
 * Body: { orderIds: string[], includePickingList?: boolean }
 *
 * Per order:
 *   - halaman label RESMI TikTok (GetPackageShippingDocument),
 *   - halaman "Ringkasan Produk" dari OrderItem/ProductVariant lokal,
 *   - opsional halaman "Picking List".
 *
 * Per-item error handling — order tanpa label tidak membatalkan yang lain.
 */
export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  const orderIds: unknown = body?.orderIds;
  const includePickingList = Boolean(body?.includePickingList);

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "Pilih minimal satu pesanan." }, { status: 400 });
  }
  if (orderIds.length > 100) {
    return NextResponse.json({ error: "Maksimal 100 pesanan per cetakan." }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds.map(String) } },
    select: {
      id: true,
      orderNo: true,
      sellerNote: true,
      account: { select: { accessToken: true, shopCipher: true } },
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

  const failed: Array<{ orderNo: string; reason: string }> = [];
  const items: LabelMergeItem[] = [];

  for (const order of orders) {
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
      includePickingList,
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

  const result = await mergeShippingDocuments(items);

  return NextResponse.json({
    ok: true,
    count: result.count,
    failed: [...failed, ...result.failed],
    pdfBase64: result.pdf ? Buffer.from(result.pdf).toString("base64") : "",
  });
});
