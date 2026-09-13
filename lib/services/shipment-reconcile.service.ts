import { prisma } from "@/lib/db/prisma";
import { getPackageDetail } from "@/lib/integrations/tiktokShop";

// Status order non-final — shipment yang masih relevan untuk di-backfill resi
// (dipakai juga oleh ingest timeline tracking, shipment-tracking.service.ts).
export const NON_FINAL_ORDER_STATUSES = [
  "AWAITING_SHIPMENT",
  "AWAITING_COLLECTION",
  "PARTIALLY_SHIPPING",
  "IN_TRANSIT",
  "ON_HOLD",
];

// Map package_status → order status. Update hanya "ke depan" (order masih
// AWAITING_SHIPMENT → naikkan), tidak pernah menurunkan status final.
const ORDER_STATUS_FROM_PACKAGE: Record<string, string> = {
  PROCESSING: "AWAITING_COLLECTION",
  FULFILLING: "IN_TRANSIT",
  COMPLETED: "DELIVERED",
};

export type ReconcileResult = {
  scanned: number;
  updated: number;
  noTracking: number;
  errors: string[];
};

/**
 * reconcileShipmentTracking — backfill resi & kurir untuk shipment yang masih
 * kosong (trackingNo null/'') dengan menarik GetPackageDetail dari TikTok.
 *
 * TikTok meng-assign resi secara ASYNC setelah shipping label terbit; order yang
 * di-sync sebelum resi muncul akan tertinggal tanpa data. Service ini menutup
 * celah tersebut. Dipanggil manual via endpoint reconcile ATAU otomatis di
 * akhir syncOrdersTikTok.
 *
 * @param accountId opsional — bila diberikan hanya shipment akun tsb di-scan.
 */
export async function reconcileShipmentTracking(
  accountId?: string
): Promise<ReconcileResult> {
  const shipments = await prisma.shipment.findMany({
    where: {
      ...(accountId ? { accountId } : { account: { platform: "TIKTOK_SHOP" } }),
      externalId: { not: null },
      OR: [{ trackingNo: null }, { trackingNo: "" }],
      order: { status: { in: NON_FINAL_ORDER_STATUSES } },
    },
    include: {
      account: { select: { accessToken: true, shopCipher: true } },
      order: { select: { id: true, status: true } },
    },
  });

  const result: ReconcileResult = { scanned: shipments.length, updated: 0, noTracking: 0, errors: [] };

  for (const s of shipments) {
    if (!s.externalId || !s.account.accessToken || !s.account.shopCipher) continue;

    try {
      const detail = await getPackageDetail(
        s.account.accessToken,
        s.account.shopCipher,
        s.externalId
      );

      if (!detail.trackingNumber) {
        result.noTracking += 1;
        continue;
      }

      await prisma.$transaction([
        prisma.shipment.updateMany({
          where: { id: s.id },
          data: {
            trackingNo: detail.trackingNumber,
            carrier: detail.providerName,
            status: detail.status ?? s.status,
            shippedAt: s.shippedAt ?? new Date(),
          },
        }),
        // Naikkan status order hanya bila package sudah maju & order masih
        // tertahan di AWAITING_SHIPMENT. Never downgrade.
        ...(detail.status && s.order.status === "AWAITING_SHIPMENT" && ORDER_STATUS_FROM_PACKAGE[detail.status]
          ? [
              prisma.order.update({
                where: { id: s.order.id },
                data: { status: ORDER_STATUS_FROM_PACKAGE[detail.status] },
              }),
            ]
          : []),
      ]);

      result.updated += 1;
    } catch (e) {
      result.errors.push(`${s.externalId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}