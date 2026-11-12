import { getOrderDetail as getShopeeOrderDetail } from "@/lib/integrations/shopee";
import { getOrderDetail as getTikTokOrderDetail } from "@/lib/integrations/tiktokShop";
import { prisma } from "@/lib/db/prisma";
import { ingestTikTokOrdersPage, type OrderRaw } from "@/lib/services/order-sync.service";
import { applyShopeeStockEffectsForStatus, canonicalShopeeStatus } from "@/lib/services/shopee-order-status.service";
import { syncShopeeShipments } from "@/lib/services/shopee-order-sync.service";

export type OrderRefreshForShippingResult = {
  orderId: string;
  platform: string;
  status: string;
  hasPackage: boolean;
  trackingNo: string | null;
  ready: boolean;
};

export async function refreshOrderForShipping(
  orderId: string,
  businessId: string
): Promise<OrderRefreshForShippingResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      account: {
        select: {
          businessId: true,
          platform: true,
          accessToken: true,
          shopCipher: true,
          externalShopId: true,
        },
      },
      orderMappings: { select: { externalOrderId: true }, take: 1 },
    },
  });

  if (!order || order.account.businessId !== businessId) throw new Error("Pesanan tidak ditemukan.");
  if (!order.account.accessToken) throw new Error("Akun marketplace belum punya access token.");

  const externalOrderId = order.orderMappings[0]?.externalOrderId ?? order.orderNo;
  if (!externalOrderId) throw new Error("Order belum memiliki ID marketplace.");

  if (order.account.platform === "TIKTOK_SHOP") {
    if (!order.account.shopCipher) throw new Error("Akun TikTok belum punya shop_cipher.");
    const detail = await getTikTokOrderDetail(order.account.accessToken, externalOrderId, order.account.shopCipher);
    if (!detail) throw new Error("Detail order belum tersedia dari TikTok Shop.");
    await ingestTikTokOrdersPage(prisma, order.accountId, [detail as OrderRaw], {
      fetched: 1,
      created: 0,
      skipped: 0,
      errors: [],
      reconciled: 0,
      reconcileScan: 0,
      trackingEvents: 0,
    });
  } else if (order.account.platform === "SHOPEE") {
    if (!order.account.externalShopId) throw new Error("Akun Shopee belum punya shop ID.");
    const [detail] = await getShopeeOrderDetail(order.account.accessToken, order.account.externalShopId, [externalOrderId]);
    if (!detail) throw new Error("Detail order belum tersedia dari Shopee.");

    const rawStatus = typeof detail.order_status === "string" ? detail.order_status : "UNKNOWN";
    const status = canonicalShopeeStatus(rawStatus);
    const packages = Array.isArray(detail.package_list)
      ? (detail.package_list as Array<Record<string, unknown>>)
      : [];
    const current = await prisma.order.findUnique({ where: { id: order.id }, select: { status: true } });
    await prisma.$transaction([
      prisma.order.update({ where: { id: order.id }, data: { status } }),
      prisma.platformOrderMapping.updateMany({
        where: { accountId: order.accountId, externalOrderId },
        data: { rawStatus },
      }),
    ]);
    await syncShopeeShipments(prisma, order.id, order.accountId, packages);
    if (current && current.status !== status) await applyShopeeStockEffectsForStatus(order.id, status);
  } else {
    throw new Error(`Marketplace ${order.account.platform} belum didukung.`);
  }

  const fresh = await prisma.order.findUnique({
    where: { id: order.id },
    select: { status: true, shipments: { select: { externalId: true, trackingNo: true } } },
  });
  if (!fresh) throw new Error("Pesanan hilang setelah refresh.");

  const hasPackage = fresh.shipments.some((shipment) => Boolean(shipment.externalId));
  return {
    orderId: order.id,
    platform: order.account.platform,
    status: fresh.status,
    hasPackage,
    trackingNo: fresh.shipments.find((shipment) => shipment.trackingNo)?.trackingNo ?? null,
    ready: fresh.status === "AWAITING_SHIPMENT" && (order.account.platform === "SHOPEE" || hasPackage),
  };
}
