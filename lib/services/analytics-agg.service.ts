/**
 * AGREGASI LEVEL DATABASE untuk analytics (TUGAS 2 — skala 180K+ order).
 *
 * Sebelumnya /api/analytics menarik SEMUA order + SEMUA item window 14 hari ke
 * memori Node lalu mengagregasi dengan loop JS berlapis (O(hari × order)) —
 * mahal di memori & CPU saat tabel tumbuh. Versi ini memindahkan agregasi ke
 * Postgres via query mentah yang ter-index:
 *
 *   - Per-hari: timestamp UTC disajikan sebagai tanggal Asia/Jakarta.
 *   - Status & toko: GROUP BY — hasil beberapa baris, bukan ribuan.
 *   - Produk teratas: agregasi per varian + ORDER BY qty DESC LIMIT 10.
 *
 * Definisi bisnis SAMA dengan versi lama (jangan mengubah angka):
 *   - GMV: semua order KECUALI status CANCELLED (UNPAID ikut dihitung).
 *   - Revenue per order: SUM(price * qty) dari item; fallback amount order bila
 *   order tidak punya item berharga.
 *   - Default 7 hari berakhir hari ini; pembanding sama panjang.
 *   - Batas hari = Asia/Jakarta (+07:00), rentang maksimal 90 hari.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { businessWhere } from "@/lib/services/business-scope.service";
import { dashboardPeriod, dashboardPreset, DAY_MS } from "@/lib/utils/dashboard-period";

export const WINDOW_DAYS = 7;

function dayLabel(ms: number): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(ms));
}

type DayRow = { day: string; orders: number; revenue: number; units: number; completedRevenue: number; completedOrders: number };
type StoreRow = { accountId: string; c: number; revenue: number; units: number };
type ProductRow = {
  variantId: string | null;
  channelSku: string | null;
  sku: string | null;
  name: string | null;
  qty: number;
  value: number;
};

const GMV_EXCLUDE = ["CANCELLED"];

/** COUNT/SUM via $queryRaw bisa kembali sebagai BigInt → normalkan. */
const num = (v: unknown): number => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0));

const dayBucket = Prisma.sql`to_char(o."createTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;

const asTs = (ms: number) => Prisma.sql`(${new Date(ms).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

function normalizeDayRow(r: DayRow): DayRow {
  return { day: r.day, orders: num(r.orders), revenue: num(r.revenue), units: num(r.units), completedRevenue: num(r.completedRevenue), completedOrders: num(r.completedOrders) };
}

export async function getAnalyticsAggregated(
  businessId: string,
  filters: { start?: string; end?: string; accountId?: string } = {},
) {
  const defaults = dashboardPreset(WINDOW_DAYS);
  const { currentStart, previousStart, rangeEnd, days } = dashboardPeriod(filters.start ?? defaults.start, filters.end ?? defaults.end);
  const accountFilter = filters.accountId ? Prisma.sql`AND pa.id = ${filters.accountId}` : Prisma.empty;
  const itemAccountFilter = filters.accountId ? Prisma.sql`AND pa2.id = ${filters.accountId}` : Prisma.empty;

  // Kolom revenue/units per hari (current & previous sekaligus, batas waktu di
  // WHERE supaya memakai index Order(createTime, status)).
  // CTE `revenue` difilter ke window yang sama via join Order — OrderItem
  // selalu milik order-nya, jadi ini tidak mengubah hasil, hanya memangkas
  // agregasi dari SEMUA item historis menjadi item dalam window saja.
  // Prisma DateTime tersimpan sebagai TIMESTAMP tanpa zona waktu dalam UTC.
  const dayRows = await prisma.$queryRaw<DayRow[]>(Prisma.sql`
    WITH revenue AS (
      SELECT oi."orderId" AS oid, SUM(COALESCE(oi.price, 0) * oi.qty) AS rev,
             SUM(oi.qty) AS units
      FROM "OrderItem" oi
      JOIN "Order" o2 ON o2.id = oi."orderId"
      JOIN "PlatformAccount" pa2 ON pa2.id = o2."accountId"
      WHERE o2."createTime" >= ${asTs(previousStart)} AND o2."createTime" < ${asTs(rangeEnd)}
        AND pa2."businessId" = ${businessId} ${itemAccountFilter}
      GROUP BY oi."orderId"
    )
    SELECT ${dayBucket} AS day,
           COUNT(DISTINCT o.id) AS orders,
           SUM(COALESCE(r.rev, o.amount, 0)) AS revenue,
           SUM(COALESCE(r.units, 0)) AS units,
           COALESCE(SUM(COALESCE(r.rev, o.amount, 0)) FILTER (WHERE o.status = 'COMPLETED'), 0) AS "completedRevenue",
           COUNT(DISTINCT o.id) FILTER (WHERE o.status = 'COMPLETED') AS "completedOrders"
    FROM "Order" o
    LEFT JOIN revenue r ON r.oid = o.id
    JOIN "PlatformAccount" pa ON pa.id = o."accountId"
    WHERE o."createTime" >= ${asTs(previousStart)}
      AND o."createTime" < ${asTs(rangeEnd)}
      AND pa."businessId" = ${businessId} ${accountFilter}
      AND o.status NOT IN (${Prisma.join(GMV_EXCLUDE)})
    GROUP BY day
    ORDER BY day
  `);

  const dayMap = new Map(
    dayRows.map((r) => {
      const n = normalizeDayRow(r);
      return [n.day, n] as const;
    })
  );
  const collect = (startMs: number) => {
    const buckets: DayRow[] = [];
    for (let i = 0; i < days; i++) {
      const t = startMs + i * DAY_MS;
      const jakartaKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(t));
      const row = dayMap.get(jakartaKey);
      buckets.push(row ?? { day: jakartaKey, orders: 0, revenue: 0, units: 0, completedRevenue: 0, completedOrders: 0 });
    }
    return buckets;
  };

  const currentBuckets = collect(currentStart);
  const previousBuckets = collect(previousStart);

  const sum = (rows: DayRow[]) =>
    rows.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenue,
        units: acc.units + r.units,
        count: acc.count + r.orders,
        completedRevenue: acc.completedRevenue + r.completedRevenue,
        completedOrders: acc.completedOrders + r.completedOrders,
      }),
      { revenue: 0, units: 0, count: 0, completedRevenue: 0, completedOrders: 0 }
    );

  // Toko teratas: GROUP BY accountId.
  const storeRows = await prisma.$queryRaw<StoreRow[]>(Prisma.sql`
    WITH revenue AS (
      SELECT oi."orderId" AS oid, SUM(COALESCE(oi.price, 0) * oi.qty) AS rev, SUM(oi.qty) AS units
      FROM "OrderItem" oi
      JOIN "Order" o2 ON o2.id = oi."orderId"
      JOIN "PlatformAccount" pa2 ON pa2.id = o2."accountId"
      WHERE o2."createTime" >= ${asTs(currentStart)} AND o2."createTime" < ${asTs(rangeEnd)}
        AND pa2."businessId" = ${businessId} ${itemAccountFilter}
      GROUP BY oi."orderId"
    )
    SELECT o."accountId", COUNT(DISTINCT o.id) AS c,
           SUM(COALESCE(r.rev, o.amount, 0)) AS revenue,
           COALESCE(SUM(COALESCE(r.units, 0)), 0) AS units
    FROM "Order" o
    LEFT JOIN revenue r ON r.oid = o.id
    JOIN "PlatformAccount" pa ON pa.id = o."accountId"
    WHERE o."createTime" >= ${asTs(currentStart)} AND o."createTime" < ${asTs(rangeEnd)}
      AND pa."businessId" = ${businessId} ${accountFilter}
      AND o.status NOT IN (${Prisma.join(GMV_EXCLUDE)})
    GROUP BY o."accountId"
    ORDER BY revenue DESC
    LIMIT 10
  `);

  // Produk teratas: agregasi per varian di DB, LIMIT 10.
  // GROUP BY (variantId, channelSku): item yang belum di-mapping ke varian
  // master (variantId NULL) tetap terpisah per channelSku, bukan menumpuk
  // jadi satu baris "unknown".
  const productRows = await prisma.$queryRaw<ProductRow[]>(Prisma.sql`
    SELECT oi."variantId" AS "variantId",
           oi."channelSku" AS "channelSku",
           MAX(v.sku) AS sku,
           MAX(mp.name) AS name,
           SUM(oi.qty) AS qty,
           SUM(COALESCE(oi.price, 0) * oi.qty) AS value
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    JOIN "PlatformAccount" pa ON pa.id = o."accountId"
    LEFT JOIN "ProductVariant" v ON v.id = oi."variantId"
    LEFT JOIN "MasterProduct" mp ON mp.id = v."masterProductId"
    WHERE o."createTime" >= ${asTs(currentStart)} AND o."createTime" < ${asTs(rangeEnd)}
      AND pa."businessId" = ${businessId} ${accountFilter}
      AND o.status NOT IN (${Prisma.join(GMV_EXCLUDE)})
    GROUP BY oi."variantId", oi."channelSku"
    ORDER BY qty DESC
    LIMIT 10
  `);

  const currentGMV = sum(currentBuckets);
  const previousGMV = sum(previousBuckets);
  const currentCompleted = { c: currentGMV.completedOrders, revenue: currentGMV.completedRevenue };
  const previousCompleted = { c: previousGMV.completedOrders, revenue: previousGMV.completedRevenue };

  const pct = (cur: number, prev: number): number | null =>
    prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / prev) * 100);

  const accounts =
    storeRows.length > 0
      ? await prisma.platformAccount.findMany({
          where: { id: { in: storeRows.map((s) => s.accountId) }, ...businessWhere.account(businessId) },
          select: { id: true, label: true, platform: true },
        })
      : [];
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  return {
    generatedAt: new Date().toISOString(),
    window: {
      current: { start: new Date(currentStart).toISOString(), end: new Date(currentStart + (days - 1) * DAY_MS).toISOString() },
      previous: { start: new Date(previousStart).toISOString(), end: new Date(previousStart + (days - 1) * DAY_MS).toISOString() },
    },
    metrics: {
      revenue: {
        current: currentGMV.revenue,
        previous: previousGMV.revenue,
        changePct: pct(currentGMV.revenue, previousGMV.revenue),
        orders: currentGMV.count,
      },
      units: {
        current: currentGMV.units,
        previous: previousGMV.units,
        changePct: pct(currentGMV.units, previousGMV.units),
      },
      completedRevenue: {
        current: currentCompleted.revenue,
        previous: previousCompleted.revenue,
        changePct: pct(currentCompleted.revenue, previousCompleted.revenue),
      },
      completedOrders: {
        current: currentCompleted.c,
        previous: previousCompleted.c,
        changePct: pct(currentCompleted.c, previousCompleted.c),
      },
    },
    chart: currentBuckets.map((b, i) => ({
      date: dayLabel(currentStart + i * DAY_MS),
      current: b.revenue > 0 ? b.revenue : null,
      previous: previousBuckets[i].revenue > 0 ? previousBuckets[i].revenue : null,
      units: { current: b.units, previous: previousBuckets[i].units },
      completedRevenue: { current: b.completedRevenue, previous: previousBuckets[i].completedRevenue },
      completedOrders: { current: b.completedOrders, previous: previousBuckets[i].completedOrders },
    })),
    topStores: storeRows
      .map((s) => ({
        id: s.accountId,
        label: accountMap.get(s.accountId)?.label ?? s.accountId,
        platform: accountMap.get(s.accountId)?.platform ?? "",
        value: num(s.revenue),
        units: num(s.units),
      }))
      .filter((s) => s.value > 0),
    topProducts: productRows
      .map((p) => ({
        // Key = identitas grup sebenarnya (kolom GROUP BY). channelSku NOT NULL
        // di schema, jadi key selalu unik & tidak pernah "unknown".
        key: `${p.variantId ?? ""}|${p.channelSku ?? ""}`,
        name: p.name ?? p.channelSku ?? p.variantId ?? "unknown",
        sku: p.sku,
        channelSku: p.channelSku,
        qty: num(p.qty),
        value: num(p.value),
      }))
      .filter((p) => p.qty > 0),
  };
}
