import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * PHASE C.2 — Winning Products / Omset Report (read-only, agregat on-the-fly).
 *
 * Sumber kebenaran tetap Order + OrderItem (tidak ada tabel agregat — lihat
 * keputusan performa di bawah). Agregasi GROUP BY di DB + TTL 60 dtk di route,
 * pola yang sama dengan analytics-agg (dirancang 180K+ order).
 *
 * Definisi omset (khusus laporan ini; /api/analytics TIDAK diubah):
 * - Order CANCELLED selalu dikecualikan (konsisten GMV).
 * - Catatan refund: MAXIUS saat ini tidak meng-ingest event refund/return dari
 *   marketplace (tidak ada webhook/poll untuk itu; reason ledger ORDER_REFUNDED
 *   terdefinisi tapi tidak pernah ditulis alur mana pun). Order yang di-refund
 *   setelah dikirim TIDAK terdeteksi dan tetap terhitung sebagai omset di sini.
 *   Klausa REFUNDED / RETURNED di bawah bersifat defensif/no-op terhadap status
 *   yang saat ini tidak pernah diproduksi — bukan mekanisme aktif. Rencana
 *   ingest refund tercatat sebagai backlog (prioritas rendah, 0 kejadian).
 * - Revenue per item = SUM(COALESCE(price,0) * qty); order tanpa item berharga
 *   fallback ke Order.amount (konvensi yang sama dengan analytics-agg).
 * - Batas hari = Asia/Jakarta (strftime '+7 hours', sama dengan analytics-agg).
 */

export const OMSET_EXCLUDE_STATUSES = ["CANCELLED", "REFUNDED", "RETURNED"];

const DAY_MS = 86_400_000;

function jakartaDayStartMs(d: Date): number {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return new Date(`${key}T00:00:00+07:00`).getTime();
}

/**
 * parseReportRange — "YYYY-MM-DD" (tanggal Jakarta) → [fromMs, toMsEksklusif).
 * Tanpa param → 30 hari terakhir. Input rusak → fallback yang sama (bukan throw).
 */
export function parseReportRange(
  from?: string | null,
  to?: string | null,
  nowMs: number = Date.now()
): { fromMs: number; toMs: number } {
  const fallbackTo = jakartaDayStartMs(new Date(nowMs)) + DAY_MS;
  const fallbackFrom = fallbackTo - 30 * DAY_MS;
  const parse = (s: string | null | undefined, fb: number): number => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return fb;
    const ms = new Date(`${s}T00:00:00+07:00`).getTime();
    return Number.isNaN(ms) ? fb : ms;
  };
  let fromMs = parse(from, fallbackFrom);
  let toMs = parse(to, fallbackTo) + DAY_MS;
  if (toMs <= fromMs) {
    fromMs = fallbackFrom;
    toMs = fallbackTo;
  }
  // Batasi 366 hari agar satu request tidak memindai histori tak terbatas.
  if (toMs - fromMs > 366 * DAY_MS) fromMs = toMs - 366 * DAY_MS;
  return { fromMs, toMs };
}

export type ReportFilters = {
  fromMs: number;
  toMs: number;
  platform?: string | null; // "SHOPEE" | "TIKTOK_SHOP" | null (semua)
  accountId?: string | null;
};

function accountFilter(f: ReportFilters) {
  if (f.accountId) return Prisma.sql`AND o."accountId" = ${f.accountId}`;
  if (f.platform) return Prisma.sql`AND pa.platform = ${f.platform}`;
  return Prisma.sql``;
}

const num = (v: unknown): number =>
  typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0);

export type WinningRow = {
  key: string;
  productId: string | null;
  productName: string;
  category: string | null;
  variantId: string | null;
  sku: string | null;
  variantName: string | null;
  qty: number;
  revenue: number;
  orders: number;
};

/**
 * getWinning — produk/varian paling laku: ORDER BY qty DESC.
 * groupBy "variant" (default, 1 baris per variantId+channelSku) atau "product"
 * (1 baris per MasterProduct; item tak ter-mapping masuk bucket channelSku).
 */
export async function getWinning(
  filters: ReportFilters,
  groupBy: "variant" | "product" = "variant",
  limit: number = 20
): Promise<WinningRow[]> {
  const lim = Math.min(100, Math.max(1, Math.floor(limit) || 20));
  const acct = accountFilter(filters);

  if (groupBy === "product") {
    const rows = await prisma.$queryRaw<
      Array<{
        productId: string | null;
        productName: string | null;
        category: string | null;
        qty: bigint;
        revenue: number | null;
        orders: bigint;
      }>
    >(Prisma.sql`
      SELECT mp.id AS productId, MAX(mp.name) AS productName, MAX(mp.category) AS category,
             SUM(oi.qty) AS qty,
             SUM(COALESCE(oi.price, 0) * oi.qty) AS revenue,
             COUNT(DISTINCT o.id) AS orders
      FROM OrderItem oi
      JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN PlatformAccount pa ON pa.id = o."accountId"
      LEFT JOIN ProductVariant v ON v.id = oi."variantId"
      LEFT JOIN MasterProduct mp ON mp.id = v."masterProductId"
      WHERE o."createTime" >= ${filters.fromMs} AND o."createTime" < ${filters.toMs}
        AND o.status NOT IN (${Prisma.join(OMSET_EXCLUDE_STATUSES)})
        ${acct}
      GROUP BY mp.id
      ORDER BY qty DESC
      LIMIT ${lim}
    `);
    return rows.map((r, i) => ({
      key: r.productId ?? `unknown-${i}`,
      productId: r.productId,
      productName: r.productName ?? "(Produk tak ter-mapping)",
      category: r.category,
      variantId: null,
      sku: null,
      variantName: null,
      qty: num(r.qty),
      revenue: num(r.revenue),
      orders: num(r.orders),
    }));
  }

  const rows = await prisma.$queryRaw<
    Array<{
      variantId: string | null;
      channelSku: string;
      sku: string | null;
      variantName: string | null;
      productId: string | null;
      productName: string | null;
      category: string | null;
      qty: bigint;
      revenue: number | null;
      orders: bigint;
    }>
  >(Prisma.sql`
    SELECT oi."variantId" AS variantId, oi."channelSku" AS channelSku,
           MAX(v.sku) AS sku, MAX(v.name) AS variantName,
           MAX(mp.id) AS productId, MAX(mp.name) AS productName,
           MAX(mp.category) AS category,
           SUM(oi.qty) AS qty,
           SUM(COALESCE(oi.price, 0) * oi.qty) AS revenue,
           COUNT(DISTINCT o.id) AS orders
    FROM OrderItem oi
    JOIN "Order" o ON o.id = oi."orderId"
    LEFT JOIN PlatformAccount pa ON pa.id = o."accountId"
    LEFT JOIN ProductVariant v ON v.id = oi."variantId"
    LEFT JOIN MasterProduct mp ON mp.id = v."masterProductId"
    WHERE o."createTime" >= ${filters.fromMs} AND o."createTime" < ${filters.toMs}
      AND o.status NOT IN (${Prisma.join(OMSET_EXCLUDE_STATUSES)})
      ${acct}
    GROUP BY oi."variantId", oi."channelSku"
    ORDER BY qty DESC
    LIMIT ${lim}
  `);
  return rows.map((r) => ({
    key: `${r.variantId ?? "unmapped"}:${r.channelSku}`,
    productId: r.productId,
    productName: r.productName ?? "(Produk tak ter-mapping)",
    category: r.category,
    variantId: r.variantId,
    sku: r.sku ?? r.channelSku,
    variantName: r.variantName,
    qty: num(r.qty),
    revenue: num(r.revenue),
    orders: num(r.orders),
  }));
}

export type OmsetBucket = { bucket: string; orders: number; revenue: number; units: number };
export type OmsetSlice = {
  id: string;
  label: string;
  platform?: string;
  orders: number;
  revenue: number;
  units: number;
};

export type OmsetReport = {
  range: { fromMs: number; toMs: number };
  total: { orders: number; revenue: number; units: number };
  buckets: OmsetBucket[];
  byPlatform: OmsetSlice[];
  byAccount: OmsetSlice[];
  byCategory: OmsetSlice[];
};

/**
 * getOmset — total + deret waktu + drilldown Platform → Account → Kategori.
 * granularity: "day" (bucket tanggal Jakarta) | "week" (%Y-%W) | "month" (%Y-%m).
 */
export async function getOmset(
  filters: ReportFilters,
  granularity: "day" | "week" | "month" = "day"
): Promise<OmsetReport> {
  const acct = accountFilter(filters);
  const bucketExpr =
    granularity === "month"
      ? Prisma.sql`strftime('%Y-%m', o."createTime" / 1000, 'unixepoch', '+7 hours')`
      : granularity === "week"
        ? Prisma.sql`strftime('%Y-%W', o."createTime" / 1000, 'unixepoch', '+7 hours')`
        : Prisma.sql`strftime('%Y-%m-%d', o."createTime" / 1000, 'unixepoch', '+7 hours')`;

  const [buckets, byPlatform, byAccount, byCategory] = await Promise.all([
    prisma.$queryRaw<Array<{ bucket: string; orders: bigint; revenue: number | null; units: bigint | null }>>(Prisma.sql`
      WITH revenue AS (
        SELECT oi."orderId" AS oid, SUM(COALESCE(oi.price, 0) * oi.qty) AS rev,
               SUM(oi.qty) AS units
        FROM OrderItem oi
        JOIN "Order" o2 ON o2.id = oi."orderId"
        WHERE o2."createTime" >= ${filters.fromMs} AND o2."createTime" < ${filters.toMs}
        GROUP BY oi."orderId"
      )
      SELECT ${bucketExpr} AS bucket,
             COUNT(DISTINCT o.id) AS orders,
             SUM(COALESCE(r.rev, o.amount, 0)) AS revenue,
             SUM(COALESCE(r.units, 0)) AS units
      FROM "Order" o
      LEFT JOIN revenue r ON r.oid = o.id
      LEFT JOIN PlatformAccount pa ON pa.id = o."accountId"
      WHERE o."createTime" >= ${filters.fromMs} AND o."createTime" < ${filters.toMs}
        AND o.status NOT IN (${Prisma.join(OMSET_EXCLUDE_STATUSES)})
        ${acct}
      GROUP BY bucket
      ORDER BY bucket
    `),
    prisma.$queryRaw<Array<{ platform: string; orders: bigint; revenue: number | null; units: bigint | null }>>(Prisma.sql`
      WITH revenue AS (
        SELECT oi."orderId" AS oid, SUM(COALESCE(oi.price, 0) * oi.qty) AS rev,
               SUM(oi.qty) AS units
        FROM OrderItem oi
        JOIN "Order" o2 ON o2.id = oi."orderId"
        WHERE o2."createTime" >= ${filters.fromMs} AND o2."createTime" < ${filters.toMs}
        GROUP BY oi."orderId"
      )
      SELECT pa.platform AS platform,
             COUNT(DISTINCT o.id) AS orders,
             SUM(COALESCE(r.rev, o.amount, 0)) AS revenue,
             SUM(COALESCE(r.units, 0)) AS units
      FROM "Order" o
      LEFT JOIN revenue r ON r.oid = o.id
      LEFT JOIN PlatformAccount pa ON pa.id = o."accountId"
      WHERE o."createTime" >= ${filters.fromMs} AND o."createTime" < ${filters.toMs}
        AND o.status NOT IN (${Prisma.join(OMSET_EXCLUDE_STATUSES)})
        ${acct}
      GROUP BY pa.platform
      ORDER BY revenue DESC
    `),
    prisma.$queryRaw<Array<{ accountId: string; orders: bigint; revenue: number | null; units: bigint | null }>>(Prisma.sql`
      WITH revenue AS (
        SELECT oi."orderId" AS oid, SUM(COALESCE(oi.price, 0) * oi.qty) AS rev,
               SUM(oi.qty) AS units
        FROM OrderItem oi
        JOIN "Order" o2 ON o2.id = oi."orderId"
        WHERE o2."createTime" >= ${filters.fromMs} AND o2."createTime" < ${filters.toMs}
        GROUP BY oi."orderId"
      )
      SELECT o."accountId" AS accountId,
             COUNT(DISTINCT o.id) AS orders,
             SUM(COALESCE(r.rev, o.amount, 0)) AS revenue,
             SUM(COALESCE(r.units, 0)) AS units
      FROM "Order" o
      LEFT JOIN revenue r ON r.oid = o.id
      LEFT JOIN PlatformAccount pa ON pa.id = o."accountId"
      WHERE o."createTime" >= ${filters.fromMs} AND o."createTime" < ${filters.toMs}
        AND o.status NOT IN (${Prisma.join(OMSET_EXCLUDE_STATUSES)})
        ${acct}
      GROUP BY o."accountId"
      ORDER BY revenue DESC
    `),
    prisma.$queryRaw<Array<{ category: string | null; orders: bigint; revenue: number | null; units: bigint | null }>>(Prisma.sql`
      SELECT mp.category AS category,
             COUNT(DISTINCT o.id) AS orders,
             SUM(COALESCE(oi.price, 0) * oi.qty) AS revenue,
             SUM(oi.qty) AS units
      FROM OrderItem oi
      JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN PlatformAccount pa ON pa.id = o."accountId"
      LEFT JOIN ProductVariant v ON v.id = oi."variantId"
      LEFT JOIN MasterProduct mp ON mp.id = v."masterProductId"
      WHERE o."createTime" >= ${filters.fromMs} AND o."createTime" < ${filters.toMs}
        AND o.status NOT IN (${Prisma.join(OMSET_EXCLUDE_STATUSES)})
        ${acct}
      GROUP BY mp.category
      ORDER BY revenue DESC
    `),
  ]);

  const accounts =
    byAccount.length > 0
      ? await prisma.platformAccount.findMany({
          where: { id: { in: byAccount.map((r) => r.accountId) } },
          select: { id: true, label: true, platform: true },
        })
      : [];
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const bucketRows = buckets.map((b) => ({
    bucket: b.bucket,
    orders: num(b.orders),
    revenue: num(b.revenue),
    units: num(b.units),
  }));
  const total = bucketRows.reduce(
    (s, b) => ({ orders: s.orders + b.orders, revenue: s.revenue + b.revenue, units: s.units + b.units }),
    { orders: 0, revenue: 0, units: 0 }
  );

  return {
    range: { fromMs: filters.fromMs, toMs: filters.toMs },
    total,
    buckets: bucketRows,
    byPlatform: byPlatform.map((r) => ({
      id: r.platform ?? "unknown",
      label: r.platform ?? "(Tanpa platform)",
      platform: r.platform ?? undefined,
      orders: num(r.orders),
      revenue: num(r.revenue),
      units: num(r.units),
    })),
    byAccount: byAccount.map((r) => ({
      id: r.accountId,
      label: accountMap.get(r.accountId)?.label ?? r.accountId,
      platform: accountMap.get(r.accountId)?.platform,
      orders: num(r.orders),
      revenue: num(r.revenue),
      units: num(r.units),
    })),
    byCategory: byCategory.map((r) => ({
      id: r.category ?? "__none__",
      label: r.category ?? "(Tanpa Kategori)",
      orders: num(r.orders),
      revenue: num(r.revenue),
      units: num(r.units),
    })),
  };
}
