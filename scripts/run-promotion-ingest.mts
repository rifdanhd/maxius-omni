/**
 * [OPS] Re-run ingest promotion activity secara manual — READ-ONLY terhadap
 * TikTok API (hanya Search Activities + Get Activity by ID), idempotent ke DB
 * (upsert by (accountId, externalActivityId) dan (activityId, externalItemKey)),
 * jadi aman dijalankan berulang kali.
 *
 * (a) Fungsi: memanggil ingestPromotionActivitiesForAccount untuk SEMUA akun
 *     TIKTOK_SHOP yang punya token + shop_cipher + scope seller.promotion.info,
 *     lalu mencetak: ringkasan per akun (discovered/confirmed/items/errors),
 *     isi tabel PromotionActivity (+jumlah item), dan 5 SyncLog
 *     promotion_activity_ingest terakhir.
 * (b) Kapan dipakai: untuk re-run ingest manual di luar siklus sync — misal
 *     setelah deploy fitur monitoring ini (backfill activity yang sudah ada
 *     di toko), setelah insiden/error API TikTok, atau untuk verifikasi hasil
 *     ingest setelah mengubah parser.
 * (c) Cara jalankan:
 *       npx tsx --env-file=.env scripts/run-promotion-ingest.mts
 *     Env yang dibutuhkan (di .env): DATABASE_URL + TIKTOK_APP_KEY +
 *     TIKTOK_APP_SECRET — access token akun dibaca dari DB (tabel
 *     PlatformAccount), bukan dari env.
 *
 * CATATAN SCOPE: ingest ini sengaja TIDAK membuat/mengubah/menonaktifkan
 * activity di TikTok (write scope belum disetujui). Membaca activity yang
 * SUDAH ADA saja (monitoring).
 */
import { prisma } from "@/lib/db/prisma";
import { ingestPromotionActivitiesForAccount } from "@/lib/services/promotion-activity.service";

const accounts = await prisma.platformAccount.findMany({
  where: { platform: "TIKTOK_SHOP" },
  select: { id: true, label: true, accessToken: true, shopCipher: true, scope: true },
});

console.log("=== AKUN TIKTOK_SHOP ===");
for (const a of accounts) {
  const hasScope = (a.scope ?? "").split(",").map((s) => s.trim()).includes("seller.promotion.info");
  console.log(
    `- ${a.label} (${a.id}) token:${a.accessToken ? "✓" : "✗"} cipher:${a.shopCipher ? "✓" : "✗"} scope.promo:${hasScope ? "✓" : "✗"}`
  );
}

const runnable = accounts.filter(
  (a) =>
    a.accessToken &&
    a.shopCipher &&
    (a.scope ?? "").split(",").map((s) => s.trim()).includes("seller.promotion.info")
);

console.log("\n=== INGEST (read-only) ===");
for (const a of runnable) {
  const r = await ingestPromotionActivitiesForAccount(a.id);
  console.log(
    `[${a.label}] discovered=${r.activitiesDiscovered} confirmed=${r.activitiesConfirmed} ` +
      `items=${r.itemsStored} errors=${r.errors.length}`
  );
  for (const e of r.errors) console.log(`  ! ${e}`);
}

console.log("\n=== PromotionActivity DI DB ===");
const activities = await prisma.promotionActivity.findMany({
  orderBy: [{ accountId: "asc" }, { startsAt: "desc" }],
  include: {
    account: { select: { label: true } },
    _count: { select: { items: true } },
  },
});
if (activities.length === 0) {
  console.log("(kosong — tidak ada activity yang masuk)");
}
for (const act of activities) {
  console.log(
    `${act.startsAt.toISOString().slice(0, 10)} s/d ${act.endsAt.toISOString().slice(0, 10)}` +
      ` | ${act.status} | ${act.activityType}/${act.productLevel}` +
      ` | ${act.title} | id=${act.externalActivityId}` +
      ` | items=${act._count.items} | account=${act.account.label}` +
      ` | confirmed=${act.lastConfirmedAt?.toISOString() ?? "-"}`
  );
}
console.log(`TOTAL: ${activities.length} activity`);

console.log("\n=== SyncLog promotion_activity_ingest (5 terakhir) ===");
const logs = await prisma.syncLog.findMany({
  where: { kind: "promotion_activity_ingest" },
  orderBy: { createdAt: "desc" },
  take: 5,
  select: { createdAt: true, status: true, message: true, errorMessage: true },
});
for (const l of logs) {
  console.log(`[${l.createdAt.toISOString()}] ${l.status} — ${l.message}`);
  if (l.errorMessage) console.log(`   err: ${l.errorMessage}`);
}

await prisma.$disconnect();
