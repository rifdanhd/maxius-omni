import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import { getPackageTracking } from "@/lib/integrations/tiktokShop";
import { NON_FINAL_ORDER_STATUSES } from "@/lib/services/shipment-reconcile.service";

export type TrackingIngestResult = {
  orderId: string;
  orderNo: string;
  eventsReceived: number;
  eventsInserted: number;
  // Event yang tidak masuk: payload duplikat, field invalid, ATAU sudah ada di DB
  // (kena unique (shipmentId, eventTime, description)).
  skipped: number;
  // true bila order dilewati karena shipment-nya tidak bisa dipastikan target
  // attach-nya (multi-package & endpoint tracking per-order tidak memberi
  // atribusi per package) — LIHAT kebijakan attach di ingestOrderTrackingEvents.
  ambiguous: boolean;
  error: string | null;
};

export type TrackingIngestRunResult = {
  ordersScanned: number;
  ordersIngested: number;
  eventsInserted: number;
  ordersAmbiguous: number;
  errors: string[];
};

/**
 * ingestOrderTrackingEvents — tarik timeline tracking 1 order dari TikTok
 * (GET /fulfillment/202309/orders/{order_id}/tracking) dan simpan ke
 * ShipmentTrackingEvent secara IDEMPOTEN.
 *
 * KEBIJAKAN ATTACH (endpoint tracking TikTok bersifat PER-ORDER dan tidak
 * memberi atribusi event → package, jadi target shipment harus dipastikan
 * dulu — JANGAN pernah asal attach ke "shipment pertama"):
 *   1. Tepat 1 shipment dengan package_id (externalId terisi) → attach ke situ.
 *   2. Semua shipment tanpa package_id TAPI hanya 1 shipment → attach ke situ
 *      (aman: tidak ada kandidat lain).
 *   3. >1 shipment (dengan/atau campuran package_id) → SKIP. Multi-package
 *      dikirim terpisah; menempelkan timeline gabungan ke salah satu akan
 *      mencemari timeline package lain (risiko nyata: event "Delivered" muncul
 *      di package yang masih transit).
 *
 * Idempotensi: TikTok tidak memberi event id unik (TAHAP 0), jadi dedupe
 * memakai unique (shipmentId, eventTime, description) — re-run yang menarik
 * event lama yang sama tidak akan menduplikasi baris.
 *
 * Catatan unit waktu: update_time_millis TikTok = epoch MILIDETIK (beda dengan
 * API TikTok lain yang detik). Konversi dilakukan DI SINI, bukan di integrasi.
 */
export async function ingestOrderTrackingEvents(input: {
  accountId: string;
  accessToken: string;
  shopCipher: string;
  orderId: string;
  orderNo: string;
  externalOrderId: string;
}): Promise<TrackingIngestResult> {
  const base: TrackingIngestResult = {
    orderId: input.orderId,
    orderNo: input.orderNo,
    eventsReceived: 0,
    eventsInserted: 0,
    skipped: 0,
    ambiguous: false,
    error: null,
  };

  try {
    const { tracking } = await getPackageTracking(
      input.accessToken,
      input.shopCipher,
      input.externalOrderId
    );
    base.eventsReceived = tracking.length;

    // Tentukan target shipment sesuai kebijakan attach di docblock:
    // hanya aman bila order punya TEPAT 1 shipment. Multi-package (≥2 shipment,
    // apapun status package_id-nya) → skip, karena timeline per-order gabungan
    // tidak bisa diatribusikan ke satu package tanpa risiko salah tempel.
    const shipments = await prisma.shipment.findMany({
      where: { orderId: input.orderId, accountId: input.accountId },
      select: { id: true, externalId: true },
    });
    if (shipments.length !== 1) {
      // 0 shipment = belum dipack (dilewati diam-diam); ≥2 = ambiguous.
      base.ambiguous = shipments.length > 1;
      base.skipped += tracking.length;
      return base;
    }
    const shipment = shipments[0];

    const seen = new Set<string>();
    const rows: Array<{
      id: string;
      shipmentId: string;
      actionCode: number | null;
      description: string;
      eventTime: Date;
    }> = [];

    for (const ev of tracking) {
      const description = (ev.description ?? "").trim();
      const ms = ev.update_time_millis;
      // description & eventTime bagian dari kunci dedupe → keduanya wajib valid.
      if (!description || !Number.isFinite(ms) || ms <= 0) {
        base.skipped += 1;
        continue;
      }
      const eventTime = new Date(ms); // epoch MILIDETIK → Date
      const key = `${eventTime.toISOString()}|${description}`;
      if (seen.has(key)) {
        base.skipped += 1;
        continue;
      }
      seen.add(key);
      // action_code 0 = tidak tersedia dari API (integrasi default 0) → simpan null
      // agar kolom Int? tetap bersih; kalau TikTok nanti kirim non-numerik, ubah ke String.
      const code = Number(ev.action_code);
      rows.push({
        id: crypto.randomUUID(),
        shipmentId: shipment.id,
        actionCode: Number.isFinite(code) && code !== 0 ? code : null,
        description,
        eventTime,
      });
    }

    if (rows.length === 0) return base;

    // SQLite tidak mendukung createMany({ skipDuplicates }) → dedupe manual:
    // buang event yang (eventTime, description)-nya sudah ada di shipment ini.
    // Unique (shipmentId, eventTime, description) tetap jadi pengaman race condition.
    const existing = await prisma.shipmentTrackingEvent.findMany({
      where: {
        shipmentId: shipment.id,
        OR: rows.map((r) => ({ eventTime: r.eventTime, description: r.description })),
      },
      select: { eventTime: true, description: true },
    });
    const existingKeys = new Set(
      existing.map((e) => `${e.eventTime.toISOString()}|${e.description}`)
    );
    const fresh = rows.filter((r) => !existingKeys.has(`${r.eventTime.toISOString()}|${r.description}`));

    if (fresh.length === 0) return base;

    let inserted = 0;
    try {
      const res = await prisma.shipmentTrackingEvent.createMany({ data: fresh });
      inserted = res.count;
    } catch (e) {
      // P2002 = kehilangan balapan dengan writer lain; batch atomic → tidak ada
      // yang masuk. Aman dianggap "sudah ada", re-run berikutnya akan bersih.
      if ((e as { code?: string })?.code !== "P2002") throw e;
    }
    base.eventsInserted = inserted;
    base.skipped += rows.length - inserted; // duplikat yang sudah ada di DB

    if (inserted > 0) {
      await logTrackingIngest(
        input.accountId,
        "success",
        `Tracking +${inserted} event (dari ${tracking.length}) — order ${input.orderNo}.`,
        undefined,
        { externalOrderId: input.externalOrderId, inserted, received: tracking.length }
      );
    }

    return base;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    base.error = msg;
    await logTrackingIngest(
      input.accountId,
      "error",
      `Gagal ingest tracking order ${input.orderNo}.`,
      msg,
      { externalOrderId: input.externalOrderId }
    );
    return base;
  }
}

/**
 * ingestTrackingForAccount — ingest timeline tracking untuk SEMUA order
 * non-final milik satu akun TikTok Shop. Dipanggil endpoint tracking-sync
 * (manual) dan bisa di-hook di akhir syncOrdersTikTok.
 *
 * SEQUENTIAL (bukan Promise.all) — sengaja, untuk patuh rate limit API TikTok.
 * Volume tetap terkendali karena hanya order non-final yang di-ingest; kalau
 * nanti tumbuh besar, pindahkan ke queue/batch terjadwal.
 */
export async function ingestTrackingForAccount(
  accountId: string
): Promise<TrackingIngestRunResult> {
  const acc = await prisma.platformAccount.findUnique({
    where: { id: accountId },
    select: { label: true, accessToken: true, shopCipher: true },
  });
  if (!acc?.accessToken || !acc.shopCipher) {
    return {
      ordersScanned: 0,
      ordersIngested: 0,
      eventsInserted: 0,
      ordersAmbiguous: 0,
      errors: [`Akun "${acc?.label ?? accountId}" belum punya access token / shop_cipher.`],
    };
  }

  const orders = await prisma.order.findMany({
    where: {
      accountId,
      status: { in: NON_FINAL_ORDER_STATUSES },
      orderMappings: { some: {} },
      shipments: { some: {} }, // tanpa shipment tidak ada tempat menempel event
    },
    select: {
      id: true,
      orderNo: true,
      orderMappings: { select: { externalOrderId: true }, take: 1 },
    },
  });

  const result: TrackingIngestRunResult = {
    ordersScanned: orders.length,
    ordersIngested: 0,
    eventsInserted: 0,
    ordersAmbiguous: 0,
    errors: [],
  };

  for (const o of orders) {
    const externalOrderId = o.orderMappings[0]?.externalOrderId;
    if (!externalOrderId) continue;
    const r = await ingestOrderTrackingEvents({
      accountId,
      accessToken: acc.accessToken,
      shopCipher: acc.shopCipher,
      orderId: o.id,
      orderNo: o.orderNo,
      externalOrderId,
    });
    result.eventsInserted += r.eventsInserted;
    result.ordersAmbiguous += r.ambiguous ? 1 : 0;
    if (r.eventsInserted > 0) result.ordersIngested += 1;
    if (r.error) result.errors.push(`${o.orderNo || externalOrderId}: ${r.error}`);
  }

  // Ringkasan sekali per akun — biar SyncLog tidak banjir per-order untuk run bersih.
  await logTrackingIngest(
    accountId,
    result.errors.length ? "partial" : "success",
    `Tracking ingest ${result.ordersIngested}/${result.ordersScanned} order, +${result.eventsInserted} event, ${result.ordersAmbiguous} ambiguous dilewati (${acc.label}).`,
    result.errors.length ? result.errors.slice(0, 5).join("; ") : undefined,
    {
      ordersScanned: result.ordersScanned,
      ordersIngested: result.ordersIngested,
      eventsInserted: result.eventsInserted,
      ordersAmbiguous: result.ordersAmbiguous,
    }
  );

  return result;
}

/**
 * logTrackingIngest — catat hasil ingest ke SyncLog (direction "in",
 * kind "tracking_ingest") untuk traceability & debug dedupe.
 */
async function logTrackingIngest(
  accountId: string,
  status: string,
  message: string,
  errorMessage?: string,
  payload?: Record<string, unknown>
) {
  try {
    await prisma.syncLog.create({
      data: {
        direction: "in",
        kind: "tracking_ingest",
        status,
        message,
        errorMessage,
        payload: payload ? JSON.stringify(payload) : null,
        accountId,
      },
    });
  } catch (e) {
    console.warn(
      "[TrackingIngest] gagal menulis SyncLog:",
      e instanceof Error ? e.message : e
    );
  }
}
