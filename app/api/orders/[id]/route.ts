import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { decryptPii } from "@/lib/services/crypto.service";
import { maskName, maskPhone, maskAddress } from "@/lib/pii";

/**
 * Get order detail untuk modal. Struktur finansial & item disajikan utuh,
 * sedangkan PII pembeli: MASKED kecuali user.canViewFullPii (tampil penuh
 * dan akses dicatat ke PiiAccessLog — action READ_ORDER_DETAIL).
 */
export const GET = withAuth(
  async (req: AuthenticatedRequest, ctx?: { params: Promise<{ id?: string }> }) => {
    const { id } = (await ctx?.params) ?? {};

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          variant: {
            select: {
              sku: true,
              masterProduct: { select: { name: true } },
            },
          },
        },
      },
      account: { select: { id: true, platform: true, label: true } },
      shipments: true,
      orderMappings: { select: { externalOrderId: true, rawStatus: true } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  }

  const allowFull = req.user.canViewFullPii;

  // PII: decrypt di server, return sesuai hak akses. Yang tidak diizinkan hanya
  // menerima versi masked — nilai asli tidak pernah keluar dari server.
  const rawPhone = decryptPii(order.recipientPhone);
  const rawAddress = decryptPii(order.recipientAddress);

  const payload: Record<string, unknown> = {
    orderNo: order.orderNo,
    status: order.status,
    rawStatus: order.orderMappings[0]?.rawStatus ?? order.status,
    storeName: order.account?.label ?? "-",
    platform: order.account?.platform ?? null,
    orderDate: order.createTime,
    paidTime: order.paidTime,
    shippingDueTime: order.shippingDueTime,
    rtsSlaTime: order.rtsSlaTime,
    ttsSlaTime: order.ttsSlaTime,
    paymentMethodName: order.paymentMethodName,
    isCod: order.isCod,
    currency: order.currency,
    buyerNote: order.buyerNote,
    amount: order.amount,
    canViewFullPii: allowFull,
    buyer: {
      name: allowFull ? order.recipientName : maskName(order.recipientName ?? order.buyerName),
      email: order.buyerEmail,
      phone: allowFull ? rawPhone : maskPhone(rawPhone),
      address: allowFull ? rawAddress : maskAddress(rawAddress),
      nameMasked: !allowFull,
    },
    items: order.items.map((it) => ({
      id: it.id,
      imageUrl: it.imageUrl,
      productName:
        it.productName ?? it.variant?.masterProduct?.name ?? it.productId ?? "-",
      variantLabel: it.skuName ?? it.variant?.sku ?? `SKU ${it.channelSku}`,
      masterSku: it.variant?.sku ?? null,
      channelSku: it.channelSku,
      qty: it.qty,
      price: it.price,
      subTotal: it.price != null ? it.price * it.qty : null,
    })),
    shipments: order.shipments.map((s) => ({
      carrier: s.carrier,
      trackingNo: s.trackingNo,
      status: s.status,
      shippedAt: s.shippedAt,
    })),
    payment: order.paymentJson ? safeParsePayment(order.paymentJson) : null,
  };

  if (allowFull) {
    await prisma.piiAccessLog.create({
      data: {
        userId: req.user.id,
        username: req.user.username,
        orderId: order.id,
        orderNo: order.orderNo,
        action: "READ_ORDER_DETAIL",
        detail: "PII pembeli (nama/HP/alamat) ditampilkan penuh pada modal detail.",
      },
    });
  }

  return NextResponse.json(payload);
});

function safeParsePayment(json: string): Record<string, number | string | null> {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const result: Record<string, number | string | null> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number") result[k] = v;
      else if (typeof v === "string") {
        const n = Number(v);
        result[k] = Number.isFinite(n) ? n : v;
      } else result[k] = null;
    }
    return result;
  } catch {
    return {};
  }
}