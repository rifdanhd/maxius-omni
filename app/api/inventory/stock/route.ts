import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { effectiveStock, lowStockSql, resolveMinStock } from "@/lib/services/central-stock.service";

export type StockTab = "all" | "empty" | "low";

export type StockRow = {
  variantId: string;
  sku: string;
  variantName: string | null;
  productId: string;
  productName: string;
  stock: number;
  safetyStock: number;
  promoActive: number;
  orderedQty: number;
  available: number;
  incoming: number;
  minStock: number | null;
  minStockResolved: number;
  notifyEmail: boolean;
};

type RawRow = {
  variantId: string;
  sku: string;
  variantName: string | null;
  productId: string;
  productName: string;
  stock: number;
  safetyStock: number;
  promoActive: number;
  orderedQty: number;
  minStock: number | null;
  threshold: number;
  notifyEmail: number;
};

/**
 * Status order yang TIDAK dihitung sebagai "Pesanan" (demand belum potong):
 * - AWAITING_SHIPMENT ke atas = stok SUDAH dipotong deductStockForOrder
 *   (tercermin di Fisik) — dihitung lagi = double-count.
 * - CANCELLED = stok di-restore; COMPLETED/DELIVERED = keluar permanen.
 * "Pesanan" = qty order aktif yang belum memotong stok (unpaid/on-hold):
 * demand yang akan datang, belum tercermin di Fisik.
 */
const DEDUCTED_OR_TERMINAL = [
  "AWAITING_SHIPMENT",
  "AWAITING_COLLECTION",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
];

/**
 * Activity promosi dianggap AKTIF bila jendela waktunya mencakup sekarang dan
 * statusnya bukan terminal. Definisi tampilan saja (keputusan user) — TIDAK
 * mengurangi Tersedia karena skema tidak punya konsep reserve promosi.
 */
const PROMO_TERMINAL_STATUSES = ["DEACTIVATED", "EXPIRED", "ENDED", "CANCELLED"];

function parseCursor(cursor: string | null): {
  name: string;
  sku: string;
  id: string;
} | null {
  if (!cursor) return null;
  try {
    const p = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as { name?: unknown; sku?: unknown; id?: unknown };
    if (typeof p.name !== "string" || typeof p.sku !== "string" || typeof p.id !== "string") {
      return null;
    }
    return { name: p.name, sku: p.sku, id: p.id };
  } catch {
    return null;
  }
}

function encodeCursor(row: RawRow): string {
  return Buffer.from(
    JSON.stringify({ name: row.productName, sku: row.sku, id: row.variantId }),
    "utf8"
  ).toString("base64url");
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * GET /api/inventory/stock?tab=all|empty|low&q=&limit=&cursor=
 *
 * - Tersedia SELALU via effectiveStock(); tab Habis/Menipis memakai
 *   isLowStock()/lowStockSql() dari definisi tunggal stock-level.policy.
 * - Minimum per varian = minStock ?? threshold produk induk (konsisten dgn
 *   /api/stock-alerts).
 * - Badge counts dihitung fresh TANPA cache & TANPA filter pencarian (total
 *   per tab, akurat real-time); rows mengikuti q + paginasi keyset.
 * - Akan datang = 0 jujur (tidak ada konsep restock terjadwal di skema).
 */
export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const tab = (url.searchParams.get("tab") ?? "all") as StockTab;
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "50") || 50, 1),
    200
  );
  const cursor = parseCursor(url.searchParams.get("cursor"));
  const nowIso = new Date().toISOString();

  const search = q ? `%${escapeLike(q)}%` : null;

  const keyset = cursor
    ? Prisma.sql`AND (mp.name, pv.sku, pv.id) > (${cursor.name}, ${cursor.sku}, ${cursor.id})`
    : Prisma.empty;

  const searchFilter = search
    ? Prisma.sql`AND (pv.sku LIKE ${search} ESCAPE '\\' OR pv.name LIKE ${search} ESCAPE '\\' OR mp.name LIKE ${search} ESCAPE '\\')`
    : Prisma.empty;

  const tabFilter =
    tab === "empty"
      ? Prisma.sql`AND (pv.stock - pv."safetyStock") <= 0`
      : tab === "low"
        ? Prisma.sql`AND (pv.stock - pv."safetyStock") > 0 AND ${lowStockSql("pv", "mp")}`
        : Prisma.empty;

  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      pv.id            AS variantId,
      pv.sku           AS sku,
      pv.name          AS variantName,
      mp.id            AS productId,
      mp.name          AS productName,
      pv.stock         AS stock,
      pv."safetyStock" AS safetyStock,
      COALESCE(pr."promoActive", 0) AS "promoActive",
      COALESCE(ord."orderedQty", 0) AS "orderedQty",
      pv."minStock"    AS "minStock",
      mp.threshold     AS threshold,
      pv."notifyEmail" AS "notifyEmail"
    FROM "ProductVariant" pv
    JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
    LEFT JOIN (
      SELECT pm."variantId" AS vid, COUNT(DISTINCT pa.id) AS "promoActive"
      FROM "ProductMapping" pm
      JOIN "PromotionActivityItem" pai ON pai."productMappingId" = pm.id
      JOIN "PromotionActivity" pa ON pa.id = pai."activityId"
      WHERE pa.status NOT IN (${Prisma.join(PROMO_TERMINAL_STATUSES)})
        AND pa."startsAt" <= ${nowIso}
        AND pa."endsAt" >= ${nowIso}
      GROUP BY pm."variantId"
    ) pr ON pr.vid = pv.id
    LEFT JOIN (
      SELECT oi."variantId" AS vid, SUM(oi.qty) AS "orderedQty"
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE oi."variantId" IS NOT NULL
        AND o.status NOT IN (${Prisma.join(DEDUCTED_OR_TERMINAL)})
      GROUP BY oi."variantId"
    ) ord ON ord.vid = pv.id
    WHERE 1 = 1
    ${searchFilter}
    ${tabFilter}
    ${keyset}
    ORDER BY mp.name ASC, pv.sku ASC, pv.id ASC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const counts = await prisma.$queryRaw<
    Array<{ all: number; empty: number; low: number; oversells: number }>
  >`
    SELECT
      COUNT(*) AS "all",
      SUM(CASE WHEN (pv.stock - pv."safetyStock") <= 0 THEN 1 ELSE 0 END) AS "empty",
      SUM(CASE WHEN (pv.stock - pv."safetyStock") > 0 AND ${lowStockSql("pv", "mp")}
        THEN 1 ELSE 0 END) AS "low",
      (SELECT COUNT(*) FROM "SyncLog"
        WHERE kind = 'central_stock_deduct' AND "handledAt" IS NULL) AS "oversells"
    FROM "ProductVariant" pv
    JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
  `;

  const c = counts[0] ?? { all: 0, empty: 0, low: 0, oversells: 0 };

  const data: StockRow[] = page.map((r) => ({
    variantId: r.variantId,
    sku: r.sku,
    variantName: r.variantName,
    productId: r.productId,
    productName: r.productName,
    stock: Number(r.stock),
    safetyStock: Number(r.safetyStock),
    promoActive: Number(r.promoActive),
    orderedQty: Number(r.orderedQty),
    available: effectiveStock(Number(r.stock), Number(r.safetyStock)),
    incoming: 0,
    minStock: r.minStock === null ? null : Number(r.minStock),
    minStockResolved: resolveMinStock(
      r.minStock === null ? null : Number(r.minStock),
      Number(r.threshold)
    ),
    notifyEmail: Number(r.notifyEmail) === 1,
  }));

  return NextResponse.json({
    rows: data,
    nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
    counts: {
      all: Number(c.all),
      empty: Number(c.empty),
      low: Number(c.low),
      oversells: Number(c.oversells),
    },
  });
});
