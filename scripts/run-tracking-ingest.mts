/**
 * [OPS] Re-run ingest timeline tracking secara manual — idempotent
 * (event yang (eventTime, description)-nya sudah ada di DB otomatis dilewati,
 * jadi aman dijalankan berulang kali).
 *
 * (a) Fungsi: memanggil ingestTrackingForAccount untuk SEMUA akun TIKTOK_SHOP
 *     yang punya token, lalu mencetak: ringkasan per akun
 *     (scanned/ingested/inserted/ambiguous), isi tabel ShipmentTrackingEvent,
 *     dan 5 SyncLog tracking_ingest terakhir.
 * (b) Kapan dipakai: untuk re-run ingest manual di luar siklus sync order —
 *     misal setelah deploy fitur ini (backfill history order lama), setelah
 *     insiden/error API TikTok yang membuat event bolong, atau untuk verifikasi
 *     dedupe setelah mengubah parser.
 * (c) Cara jalankan:
 *       npx tsx --env-file=.env scripts/run-tracking-ingest.mts
 *     Env yang dibutuhkan (di .env): DATABASE_URL saja — access token akun
 *     dibaca dari DB (tabel PlatformAccount), bukan dari env.
 */
import { prisma } from "@/lib/db/prisma";
import { ingestTrackingForAccount } from "@/lib/services/shipment-tracking.service";

const accounts = await prisma.platformAccount.findMany({
  where: { platform: "TIKTOK_SHOP" },
  select: { id: true, label: true, accessToken: true, shopCipher: true },
});

console.log("=== AKUN TIKTOK_SHOP ===");
for (const a of accounts) {
  console.log(
    `- ${a.label} (${a.id}) token:${a.accessToken ? "✓" : "✗"} cipher:${a.shopCipher ? "✓" : "✗"}`
  );
}

const runnable = accounts.filter((a) => a.accessToken && a.shopCipher);

console.log("\n=== INGEST ===");
for (const a of runnable) {
  const r = await ingestTrackingForAccount(a.id);
  console.log(
    `[${a.label}] scanned=${r.ordersScanned} ingested=${r.ordersIngested} ` +
      `inserted=${r.eventsInserted} ambiguous=${r.ordersAmbiguous} errors=${r.errors.length}`
  );
  for (const e of r.errors) console.log(`  ! ${e}`);
}

console.log("\n=== ShipmentTrackingEvent DI DB ===");
const events = await prisma.shipmentTrackingEvent.findMany({
  orderBy: [{ shipmentId: "asc" }, { eventTime: "asc" }],
  include: {
    shipment: {
      select: {
        externalId: true,
        trackingNo: true,
        status: true,
        order: { select: { orderNo: true, status: true } },
      },
    },
  },
});
if (events.length === 0) {
  console.log("(kosong — tidak ada event yang masuk)");
}
for (const ev of events) {
  console.log(
    `${ev.eventTime.toISOString()} | code=${ev.actionCode ?? "-"} | ${ev.description}` +
      ` | order=${ev.shipment.order.orderNo} (${ev.shipment.order.status})` +
      ` | pkg=${ev.shipment.externalId ?? "-"} resi=${ev.shipment.trackingNo ?? "-"}`
  );
}
console.log(`TOTAL: ${events.length} event`);

console.log("\n=== SyncLog tracking_ingest (5 terakhir) ===");
const logs = await prisma.syncLog.findMany({
  where: { kind: "tracking_ingest" },
  orderBy: { createdAt: "desc" },
  take: 5,
  select: { createdAt: true, status: true, message: true, errorMessage: true, payload: true },
});
for (const l of logs) {
  console.log(`[${l.createdAt.toISOString()}] ${l.status} — ${l.message}`);
  if (l.errorMessage) console.log(`   err: ${l.errorMessage}`);
  if (l.payload) console.log(`   payload: ${l.payload}`);
}

await prisma.$disconnect();
