import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import {
  shipPackage,
  waitForPackageTracking,
  getShippingDocument,
} from "@/lib/integrations/tiktokShop";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type OrderResult = {
  orderId: string;
  orderNo: string;
  ok: boolean;
  trackingNumber?: string | null;
  providerName?: string | null;
  error?: string;
};

/**
 * Bulk Atur Pengiriman — request pickup / drop-off untuk beberapa pesanan sekaligus.
 * POST /api/orders/fulfillment/pickup
 *
 * Body: {
 *   orderIds: string[],
 *   handover_method: "PICKUP" | "DROP_OFF",
 *   pickup_slot?: { start_time: number, end_time: number },
 *   seller_note?: string
 * }
 *
 * Order berstatus AWAITING_SHIPMENT → di-ship ke TikTok (request pickup/drop-off),
 * lalu resi & kurir di-poll sampai ter-assign. Order yang SUDAH AWAITING_COLLECTION
 * (ship sudah tercatat di TikTok, mis. tertinggal resi saat sync) → tidak di-ship
 * ulang; cukup ditarik ulang paketnya (GetPackageDetail) untuk mengisi resi yang
 * kosong. handover_method hanya wajib bila ada order yang perlu di-ship.
 *
 * Tiap order diproses SATU PER SATU (dipanggil serial untuk hindari rate limit TikTok).
 * Hasil per order dilaporkan terpisah — berhasil tetap disimpan meskipun ada yang gagal.
 */
export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  const orderIds: unknown = body?.orderIds;
  const handoverMethod = body?.handover_method as "PICKUP" | "DROP_OFF" | undefined;
  const pickupSlot = body?.pickup_slot as { start_time?: number; end_time?: number } | undefined;
  const sellerNote = typeof body?.seller_note === "string" ? body.seller_note.trim() : null;

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "Pilih minimal satu pesanan." }, { status: 400 });
  }
  if (orderIds.length > 50) {
    return NextResponse.json({ error: "Maksimal 50 pesanan per pengaturan." }, { status: 400 });
  }
  if (handoverMethod && !["PICKUP", "DROP_OFF"].includes(handoverMethod)) {
    return NextResponse.json({ error: "handover_method harus PICKUP atau DROP_OFF." }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: {
      id: { in: orderIds.map(String) },
      status: { in: ["AWAITING_SHIPMENT", "AWAITING_COLLECTION"] },
      account: { businessId: req.businessId },
    },
    include: {
      account: { select: { id: true, accessToken: true, shopCipher: true } },
      shipments: { select: { id: true, externalId: true } },
    },
  });

  if (orders.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada pesanan yang bisa diproses (semua harus berstatus AWAITING_SHIPMENT atau AWAITING_COLLECTION)." },
      { status: 400 }
    );
  }

  const needsShip = orders.some((o) => o.status === "AWAITING_SHIPMENT");
  if (needsShip && !handoverMethod) {
    return NextResponse.json(
      { error: "Ada pesanan yang perlu di-ship — handover_method wajib (PICKUP atau DROP_OFF)." },
      { status: 400 }
    );
  }

  const notFound = (orderIds as string[]).filter((id) => !orders.find((o) => o.id === id));

  const results: OrderResult[] = [];

  // Proses serial — hindari burst ke TikTok API.
  for (const order of orders) {
    const packageId = order.shipments.find((s) => s.externalId)?.externalId ?? null;

    if (!packageId) {
      results.push({
        orderId: order.id,
        orderNo: order.orderNo,
        ok: false,
        error: "Belum ada paket pengiriman. Sync order dari marketplace lalu coba lagi.",
      });
      continue;
    }
    if (!order.account.accessToken) {
      results.push({
        orderId: order.id,
        orderNo: order.orderNo,
        ok: false,
        error: "Akun belum punya access token.",
      });
      continue;
    }

    try {
      // Order sudah tercatat AWAITING_COLLECTION di TikTok → jangan di-ship ulang;
      // langsung tarik detail paket untuk mengisi resi yang masih kosong.
      if (order.status !== "AWAITING_COLLECTION") {
        await shipPackage(
          order.account.accessToken,
          order.account.shopCipher ?? undefined,
          packageId,
          {
            handoverMethod,
            ...(handoverMethod === "PICKUP" && pickupSlot
              ? {
                  pickupSlot: {
                    startTime: pickupSlot.start_time,
                    endTime: pickupSlot.end_time,
                  },
                }
              : {}),
          }
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        orderId: order.id,
        orderNo: order.orderNo,
        ok: false,
        error: msg,
      });
      continue;
    }

    // Poll tracking number (async assignment by TikTok).
    let trackingNumber: string | null = null;
    let providerName: string | null = null;

    try {
      const detail = await waitForPackageTracking(
        order.account.accessToken,
        order.account.shopCipher ?? undefined,
        packageId
      );
      trackingNumber = detail.trackingNumber;
      providerName = detail.providerName;
    } catch {
      // Polling gagal bukan fatal — tracking mungkin belum ready.
    }

    // Update local DB.
    await prisma.$transaction([
      prisma.shipment.updateMany({
        where: {
          accountId: order.accountId,
          orderId: order.id,
          externalId: packageId,
        },
        data: {
          trackingNo: trackingNumber,
          carrier: providerName,
          status: handoverMethod === "PICKUP" ? "AWAITING_COLLECTION" : "AWAITING_COLLECTION",
          shippedAt: new Date(),
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: {
          status: "AWAITING_COLLECTION",
          ...(sellerNote ? { sellerNote } : {}),
        },
      }),
    ]);

    // Best-effort ambil label resmi (TikTok perlu waktu proses).
    let labelReady = false;
    for (let attempt = 0; attempt < 2 && !labelReady; attempt++) {
      if (attempt > 0) await sleep(3000);
      try {
        const doc = await getShippingDocument(
          order.account.accessToken,
          order.account.shopCipher ?? undefined,
          packageId
        );
        if (doc.docUrl) {
          labelReady = true;
          trackingNumber = trackingNumber ?? doc.trackingNumber;
        }
      } catch {
        // Label belum siap — tidak fatal.
      }
    }

    results.push({
      orderId: order.id,
      orderNo: order.orderNo,
      ok: true,
      trackingNumber,
      providerName,
    });
  }

  // Tambahkan entry untuk order yang tidak ditemukan.
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
