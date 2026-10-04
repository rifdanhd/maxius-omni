import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { shipOrder, getTrackingNumber, type ShopeeShipOrderBody } from "@/lib/integrations/shopee";
import {
  loadShopeeAccount,
  withRefreshedToken,
} from "@/lib/services/marketplace-shopee.service";

type OrderResult = {
  orderId: string;
  orderNo: string;
  ok: boolean;
  trackingNumber?: string | null;
  providerName?: string | null;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bulk Atur Pengiriman (Shopee) — POST /api/orders/fulfillment/shopee-ship
 *
 * Body: {
 *   orderIds: string[],
 *   method: "PICKUP" | "DROPOFF",
 *   addressId?: number,      // wajib utk PICKUP
 *   pickupTimeId?: string,   // slot waktu penjemputan (bila tersedia)
 *   branchId?: number,       // wajib utk DROPOFF bila info_needed dropoff = branch_id
 *   slug?: string            // alternatif drop-off (slug drop point)
 * }
 *
 * Per order: POST /api/v2/logistics/ship_order → GET get_tracking_number
 * (best-effort) → perbarui Shipment + Order.status = AWAITING_COLLECTION.
 * Diproses serial (hindari burst rate limit), hasil per order dilaporkan
 * terpisah — sukses tetap tersimpan meski ada yang gagal.
 */
export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  const orderIds: unknown = body?.orderIds;
  const method = body?.method as "PICKUP" | "DROPOFF" | undefined;
  const addressId = body?.addressId === undefined ? undefined : Number(body.addressId);
  const pickupTimeId = typeof body?.pickupTimeId === "string" ? body.pickupTimeId : undefined;
  const branchId = body?.branchId === undefined ? undefined : Number(body.branchId);
  const slug = typeof body?.slug === "string" ? body.slug : undefined;

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "Pilih minimal satu pesanan." }, { status: 400 });
  }
  if (orderIds.length > 50) {
    return NextResponse.json({ error: "Maksimal 50 pesanan per pengaturan." }, { status: 400 });
  }
  if (method !== "PICKUP" && method !== "DROPOFF") {
    return NextResponse.json({ error: "method harus PICKUP atau DROPOFF." }, { status: 400 });
  }
  if (method === "PICKUP" && (!addressId || !Number.isFinite(addressId))) {
    return NextResponse.json({ error: "PICKUP butuh addressId (dari shipping-parameter)." }, { status: 400 });
  }
  if (method === "DROPOFF" && !branchId && !slug) {
    return NextResponse.json({ error: "DROPOFF butuh branchId atau slug (dari shipping-parameter)." }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: {
      id: { in: orderIds.map(String) },
      status: { in: ["AWAITING_SHIPMENT", "AWAITING_COLLECTION"] },
      account: { businessId: req.businessId },
    },
    include: {
      account: { select: { id: true, platform: true, label: true } },
      shipments: { select: { id: true, externalId: true, shippedAt: true, trackingNo: true } },
    },
  });

  if (orders.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada pesanan yang bisa diproses (semua harus berstatus AWAITING_SHIPMENT atau AWAITING_COLLECTION)." },
      { status: 400 }
    );
  }

  const notFound = (orderIds as string[]).filter((id) => !orders.find((o) => o.id === id));
  const results: OrderResult[] = [];

  for (const order of orders) {
    // Guard platform: hanya akun Shopee yang boleh memanggil API logistics Shopee.
    if (order.account.platform !== "SHOPEE") {
      results.push({
        orderId: order.id,
        orderNo: order.orderNo,
        ok: false,
        error: "Atur Pengiriman API ini hanya untuk order Shopee.",
      });
      continue;
    }

    try {
      const account = await loadShopeeAccount(order.accountId);
      if (!account) {
        throw new Error("Akun Shopee tidak ditemukan.");
      }

      // Order sudah pernah di-ship (AWAITING_COLLECTION) → jangan ship ulang;
      // cukup tarik resi yang mungkin belum tercatat.
      if (order.status === "AWAITING_SHIPMENT") {
        const shipBody: ShopeeShipOrderBody = { order_sn: order.orderNo };
        if (method === "PICKUP") {
          shipBody.pickup = {
            address_id: addressId as number,
            ...(pickupTimeId ? { pickup_time_id: pickupTimeId } : {}),
          };
        } else {
          shipBody.dropoff = {
            ...(branchId && Number.isFinite(branchId) ? { branch_id: branchId } : {}),
            ...(slug ? { slug } : {}),
          };
        }
        await withRefreshedToken(account, (token, shopId, creds) =>
          shipOrder(token, shopId, shipBody, creds)
        );
      }

      // Resi Shopee diterbitkan setelah arrange — best-effort (1 retry).
      let trackingNumber: string | null = null;
      for (let attempt = 0; attempt < 2 && !trackingNumber; attempt++) {
        if (attempt > 0) await sleep(2000);
        try {
          const t = await withRefreshedToken(account, (token, shopId, creds) =>
            getTrackingNumber(token, shopId, order.orderNo, creds)
          );
          trackingNumber = t.trackingNumber;
        } catch {
          // Resi belum siap — coba lagi / lanjut tanpa resi.
        }
      }

      // Perbarui lokal: semua baris Shipment order ini + status → Dikirim.
      const shipmentOps =
        order.shipments.length > 0
          ? order.shipments.map((s) =>
              prisma.shipment.update({
                where: { id: s.id },
                data: {
                  ...(trackingNumber && !s.trackingNo ? { trackingNo: trackingNumber } : {}),
                  shippedAt: s.shippedAt ?? new Date(),
                },
              })
            )
          : [
              prisma.shipment.create({
                data: {
                  orderId: order.id,
                  accountId: order.accountId,
                  status: "AWAITING_COLLECTION",
                  ...(trackingNumber ? { trackingNo: trackingNumber } : {}),
                  shippedAt: new Date(),
                },
              }),
            ];
      await prisma.$transaction([
        ...shipmentOps,
        prisma.order.update({
          where: { id: order.id },
          data: { status: "AWAITING_COLLECTION" },
        }),
      ]);

      results.push({
        orderId: order.id,
        orderNo: order.orderNo,
        ok: true,
        trackingNumber,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        orderId: order.id,
        orderNo: order.orderNo,
        ok: false,
        error: msg,
      });
    }
  }

  for (const id of notFound) {
    results.push({
      orderId: id,
      orderNo: id,
      ok: false,
      error: "Pesanan tidak ditemukan atau status bukan AWAITING_SHIPMENT/AWAITING_COLLECTION.",
    });
  }

  const successCount = results.filter((r) => r.ok).length;
  const failedCount = results.filter((r) => !r.ok).length;

  return NextResponse.json({
    ok: true,
    summary: { success: successCount, failed: failedCount, total: results.length },
    results,
  });
});
