/**
 * [BENCH] TUGAS 2 — ukur implementasi analytics LAMA vs BARU pada skala sintetis.
 *
 * Menjalankan dua implementasi terhadap DB yang SAMA:
 * - LAMA: salinan verbatim logika /api/analytics sebelum diganti (tarik semua
 *   order + item window ke memori, loop JS berlapis).
 * - BARU: lib/services/analytics-agg.service.ts (agregasi di SQLite, ter-index).
 *
 * DB bench = salinan dev.db + suntikan sintetis hingga ±30.000 order dan
 * ±180.000 OrderItem (sesuai skala klaim client 180K+ unit). Timestamp di-skew
 * mendekati "sekarang" agar mayoritas data jatuh DI DALAM window analisis —
 * implementasi lama benar-benar menarik datanya, bukan kebetulan di luar window.
 * File bench DB dibuat & dihapus otomatis; dev.db tidak disentuh.
 *
 * Jalankan:  NODE_OPTIONS="--expose-gc" npx tsx --env-file=.env scripts/bench-analytics.mts
 */
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const benchDb = path.join(process.cwd(), "prisma", `bench-analytics-${Date.now()}.db`);
execSync(`cp prisma/dev.db "${benchDb}"`);
for (const suffix of ["-wal", "-shm"]) fs.rmSync(benchDb + suffix, { force: true });
process.on("exit", () => {
  fs.rmSync(benchDb, { force: true });
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(benchDb + suffix, { force: true });
});
process.env.DATABASE_URL = `file:${benchDb}`;

const { Prisma } = await import("@prisma/client");
const { prisma } = await import("@/lib/db/prisma");

// Sanity: migrasi index TUGAS 2 harus terpasang di DB bench.
const idx = await prisma.$queryRaw<{ name: string }[]>(
  Prisma.sql`SELECT name FROM sqlite_master WHERE type='index' AND name IN ('Order_createTime_status_idx', 'OrderItem_orderId_idx')`
);
if (idx.length < 2) throw new Error("Migrasi index Order/OrderItem belum terpasang di DB bench");

/* ─────────────── Seed sintetis (multi-row INSERT, ≤900 parameter/statement) ─────────────── */
const business = await prisma.business.create({ data: { name: "Bench Biz" } });
const accountIds: string[] = [];
for (const label of ["Bench A", "Bench B", "Bench C"]) {
  const acc = await prisma.platformAccount.create({
    data: { platform: "TIKTOK_SHOP", label, businessId: business.id },
  });
  accountIds.push(acc.id);
}
const master = await prisma.masterProduct.create({ data: { name: "Bench Product", businessId: business.id } });
const variantIds: string[] = [];
for (let i = 0; i < 40; i++) {
  const v = await prisma.productVariant.create({
    data: { sku: `BENCH-SKU-${i}`, stock: 1000, masterProductId: master.id },
  });
  variantIds.push(v.id);
}

const TOTAL_ORDERS = 30_000;
const ITEMS_PER_ORDER = 6; // ≈180.000 OrderItem
const now = Date.now();
const spreadMs = 45 * 86400000; // tersebar 45 hari, di-skew u² → ~56% jatuh dalam 14 hari terakhir

const statuses = ["COMPLETED", "AWAITING_SHIPMENT", "UNPAID", "CANCELLED", "SHIPPED"];
const seedStart = performance.now();
let orderRows: ReturnType<typeof buildOrderRow>[] = [];
let itemRows: ReturnType<typeof buildItemRow>[] = [];

function buildOrderRow(id: string, i: number, createTime: number, accountId: string, status: string, amount: number) {
  return Prisma.sql`(${id}, ${"B" + i}, ${status}, ${accountId}, ${createTime}, ${amount}, ${createTime}, ${createTime})`;
}
function buildItemRow(id: string, orderId: string, variantId: string, qty: number, price: number, channelSku: string) {
  return Prisma.sql`(${id}, ${qty}, ${price}, ${channelSku}, ${orderId}, ${variantId})`;
}

async function flush() {
  if (orderRows.length > 0) {
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO "Order" (id, orderNo, status, accountId, createTime, amount, createdAt, updatedAt) VALUES ${Prisma.join(orderRows)}`
    );
    orderRows = [];
  }
  if (itemRows.length > 0) {
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO OrderItem (id, qty, price, channelSku, orderId, variantId) VALUES ${Prisma.join(itemRows)}`
    );
    itemRows = [];
  }
}

for (let i = 0; i < TOTAL_ORDERS; i++) {
  const u = Math.random();
  const createTime = now - Math.floor(u * u * spreadMs);
  const status = statuses[Math.floor(Math.random() * statuses.length)];
  const accountId = accountIds[i % accountIds.length];
  const amount = Math.floor(Math.random() * 500_000) + 10_000;
  const orderId = crypto.randomUUID();
  orderRows.push(buildOrderRow(orderId, i, createTime, accountId, status, amount));
  for (let j = 0; j < ITEMS_PER_ORDER; j++) {
    const variantIdx = (i + j) % variantIds.length;
    const qty = Math.floor(Math.random() * 3) + 1;
    const price = Math.floor(Math.random() * 150_000) + 5_000;
    itemRows.push(buildItemRow(crypto.randomUUID(), orderId, variantIds[variantIdx], qty, price, "SKU" + variantIdx));
  }
  if (orderRows.length >= 100) await flush(); // 100×8 = 800 param, item 600×6 = 3600 → item di-flush juga
}
await flush();

const seedMs = performance.now() - seedStart;
const counts = await prisma.$queryRaw<[{ o: bigint; i: bigint; inWindow: bigint }]>(
  Prisma.sql`SELECT (SELECT COUNT(*) FROM "Order") AS o, (SELECT COUNT(*) FROM OrderItem) AS i,
    (SELECT COUNT(*) FROM "Order" WHERE createTime >= ${now - 14 * 86400000}) AS inWindow`
);
console.log(
  `Seed selesai ${(seedMs / 1000).toFixed(1)}s — order=${counts[0].o}, item=${counts[0].i}, order dalam window 14 hari=${counts[0].inWindow}`
);

/* ─────────────── Implementasi LAMA (verbatim logika lama /api/analytics) ─────────────── */
const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
const TZ = "Asia/Jakarta";
const GMV_EXCLUDE = ["CANCELLED"];

function startOfDayUTC(date: Date): Date {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return new Date(`${key}T00:00:00+07:00`);
}

async function analyticsOld() {
  const midnightToday = startOfDayUTC(new Date());
  const currentDays: number[] = [];
  const previousDays: number[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) currentDays.push(midnightToday.getTime() - i * DAY_MS);
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) previousDays.push(midnightToday.getTime() - (WINDOW_DAYS + i) * DAY_MS);
  const rangeStart = previousDays[0];
  const rangeEnd = midnightToday.getTime() + DAY_MS;

  const orders = await prisma.order.findMany({
    where: { createTime: { gte: new Date(rangeStart), lt: new Date(rangeEnd) }, status: { notIn: GMV_EXCLUDE } },
    select: { id: true, createTime: true, accountId: true, status: true, amount: true },
  });
  const items =
    orders.length > 0
      ? await prisma.orderItem.findMany({
          where: { orderId: { in: orders.map((o) => o.id) } },
          select: { orderId: true, qty: true, price: true, variantId: true, channelSku: true },
        })
      : [];
  const revenueOf = new Map<string, number>();
  const unitsOf = new Map<string, number>();
  for (const it of items) {
    revenueOf.set(it.orderId, (revenueOf.get(it.orderId) ?? 0) + (it.price ?? 0) * it.qty);
    unitsOf.set(it.orderId, (unitsOf.get(it.orderId) ?? 0) + it.qty);
  }
  const inDay = (o: (typeof orders)[number], t: number) =>
    o.createTime !== null && o.createTime.getTime() >= t && o.createTime.getTime() < t + DAY_MS;
  const sumSeries = (days: number[]) => {
    let revenue = 0, units = 0, count = 0;
    for (const day of days) {
      for (const o of orders) {
        if (!inDay(o, day)) continue;
        revenue += revenueOf.get(o.id) ?? o.amount ?? 0;
        units += unitsOf.get(o.id) ?? 0;
        count += 1;
      }
    }
    return { revenue, units, count };
  };
  const gmv = sumSeries(currentDays);
  const currentOrderIds = new Set(currentDays.flatMap((day) => orders.filter((o) => inDay(o, day)).map((o) => o.id)));
  const productAgg = new Map<string, { qty: number; value: number }>();
  for (const it of items) {
    if (!currentOrderIds.has(it.orderId)) continue;
    const key = (it.variantId ?? it.channelSku) || "unknown";
    const agg = productAgg.get(key) ?? { qty: 0, value: 0 };
    agg.qty += it.qty;
    agg.value += (it.price ?? 0) * it.qty;
    productAgg.set(key, agg);
  }
  const topProducts = [...productAgg.entries()]
    .map(([key, agg]) => ({ key, qty: agg.qty, value: agg.value }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);
  return { gmv, topProducts: topProducts.length, ordersFetched: orders.length, itemsFetched: items.length };
}

/* ─────────────── Implementasi BARU ─────────────── */
const { getAnalyticsAggregated } = await import("@/lib/services/analytics-agg.service");

/* ─────────────── Benchmark ─────────────── */
await analyticsOld(); // warm-up (JIT + buffer cache)
await getAnalyticsAggregated("business-default");

const N = 5;
const oldTimes: number[] = [];
const newTimes: number[] = [];
let oldMem = 0;
let newMem = 0;
let lastOld = { ordersFetched: 0, itemsFetched: 0, gmvRevenue: 0 };
let lastNewRevenue = 0;
for (let i = 0; i < N; i++) {
  global.gc?.();
  const m0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const rOld = await analyticsOld();
  const t1 = performance.now();
  global.gc?.();
  const m1 = process.memoryUsage().heapUsed;
  oldTimes.push(t1 - t0);
  oldMem = Math.max(oldMem, m1 - m0);
  lastOld = { ordersFetched: rOld.ordersFetched, itemsFetched: rOld.itemsFetched, gmvRevenue: Math.round(rOld.gmv.revenue) };

  global.gc?.();
  const m2 = process.memoryUsage().heapUsed;
  const t2 = performance.now();
  const rNew = await getAnalyticsAggregated("business-default");
  const t3 = performance.now();
  global.gc?.();
  const m3 = process.memoryUsage().heapUsed;
  newTimes.push(t3 - t2);
  newMem = Math.max(newMem, m3 - m2);
  lastNewRevenue = Math.round(rNew.metrics.revenue.current);
}
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`\n=== HASIL (rata-rata ${N} run, setelah warm-up) ===`);
console.log(
  `LAMA (in-memory JS): ${avg(oldTimes).toFixed(0)} ms/run — ditarik ke memori ${lastOld.ordersFetched} order + ${lastOld.itemsFetched} item, heap +${(oldMem / 1048576).toFixed(1)} MB`
);
console.log(`BARU (agregasi DB)  : ${avg(newTimes).toFixed(0)} ms/run — baris ke memori ≈ 40 (7+7 hari + 10 toko + 10 produk), heap +${(newMem / 1048576).toFixed(1)} MB`);
console.log(`Speedup: ${(avg(oldTimes) / avg(newTimes)).toFixed(1)}×`);
console.log(`(verifikasi angka — old GMV=${lastOld.gmvRevenue}, new revenue=${lastNewRevenue})`);

await prisma.$disconnect();
