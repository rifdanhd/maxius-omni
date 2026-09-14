import { prisma } from "@/lib/db/prisma";
import {
  effectiveStock,
  lowStockSql,
} from "@/lib/services/central-stock.service";
import { countMismatchSyncJobs } from "@/lib/services/sync-mismatch.service";

/**
 * PHASE C.1 — Dashboard KPI (read-only, agregat on-the-fly).
 *
 * Melengkapi /api/analytics + /api/summary yang sudah ada (tidak diubah):
 *   analytics : omset, order, units, toko & produk teratas (7d vs 7d lalu)
 *   summary   : pesanan baru, siap kirim, stok menipis (count), oversell
 *   kpi (ini): Central Stock, Stok Kritis (+5 terendah), Stock Mismatch
 *              (reuse predikat PHASE B), Sync Error 7d, Store Health per akun.
 *
 * Store Health HANYA fakta DB (PRD §21 minta rating/cancellation marketplace,
 * tapi data itu tidak tersedia di DB dan PRD melarang mengarang): status
 * token/cipher, aktivitas terakhir, error & mismatch per akun.
 *
 * Performa: agregat COUNT/GROUP BY di DB + TTL 60 dtk di route (pola yang sama
 * dengan analytics-agg yang dirancang untuk 180K+ order). Tanpa tabel cache.
 */

const KPI_WINDOW_DAYS = 7;

export type KpiLowStockRow = {
  variantId: string;
  sku: string;
  variantName: string | null;
  productName: string;
  stock: number;
  safetyStock: number;
  sellable: number;
  severity: "low" | "out";
};

export type KpiStoreHealth = {
  accountId: string;
  label: string;
  platform: string;
  hasToken: boolean;
  hasCipher: boolean;
  lastOrderAt: Date | null;
  lastSyncAt: Date | null;
  errors7d: number;
  mismatch: number;
  /** Marker SyncLog kind=orphan_sku yang belum ditangani (SKU order
   *  belum ter-mapping ke varian — ditindaklanjuti via halaman Mapping). */
  orphanSkus: number;
};

export type DashboardKpi = {
  centralStock: { variantCount: number; totalUnits: number; totalSellable: number };
  lowStock: { count: number; top: KpiLowStockRow[] };
  mismatch: { total: number; failed: number; pendingRetry: number };
  syncErrors: { count7d: number; byKind: Array<{ kind: string; count: number }> };
  storeHealth: KpiStoreHealth[];
};

const num = (v: unknown): number =>
  typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0);

export async function getDashboardKpi(): Promise<DashboardKpi> {
  const since = new Date(Date.now() - KPI_WINDOW_DAYS * 86_400_000);

  const [central, lowCount, lowTop, mismatch, syncErrGroups, accounts] = await Promise.all([
    prisma.$queryRaw<Array<{ c: bigint; units: bigint | null; sellable: bigint | null }>>`
      SELECT COUNT(*) AS c,
             COALESCE(SUM(pv.stock), 0) AS units,
             COALESCE(SUM(GREATEST(pv.stock - pv."safetyStock", 0)), 0) AS sellable
      FROM "ProductVariant" pv
    `,
    prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) AS c
      FROM "ProductVariant" pv
      JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
      WHERE ${lowStockSql("pv", "mp")}
    `,
    prisma.$queryRaw<
      Array<{
        variantId: string;
        sku: string;
        variantName: string | null;
        productName: string;
        stock: number;
        safetyStock: number;
      }>
    >`
      SELECT pv.id AS variantId, pv.sku AS sku, pv.name AS variantName,
             mp.name AS productName, pv.stock AS stock, pv."safetyStock" AS safetyStock
      FROM "ProductVariant" pv
      JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
      WHERE ${lowStockSql("pv", "mp")}
      ORDER BY (pv.stock - pv."safetyStock") ASC
      LIMIT 5
    `,
    countMismatchSyncJobs(),
    prisma.syncLog.groupBy({
      by: ["kind"],
      where: { status: "error", createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.platformAccount.findMany({
      select: { id: true, label: true, platform: true, accessToken: true, shopCipher: true },
      orderBy: { label: "asc" },
    }),
  ]);

  // Kesehatan per akun: aktivitas terakhir + error 7d + mismatch (akun sedikit,
  // query kecil per akun paralel — bukan N+1 atas ribuan baris).
  const health: KpiStoreHealth[] = await Promise.all(
    accounts.map(async (a) => {
      const [lastOrder, lastSync, errors7d, failedJobs, retryJobs, orphanSkus] = await Promise.all([
        prisma.order.aggregate({ where: { accountId: a.id }, _max: { createTime: true } }),
        prisma.syncLog.aggregate({ where: { accountId: a.id }, _max: { createdAt: true } }),
        prisma.syncLog.count({ where: { accountId: a.id, status: "error", createdAt: { gte: since } } }),
        prisma.syncJob.count({ where: { accountId: a.id, status: "FAILED" } }),
        prisma.syncJob.count({ where: { accountId: a.id, status: "PENDING", retryCount: { gte: 1 } } }),
        prisma.syncLog.count({ where: { accountId: a.id, kind: "orphan_sku", handledAt: null } }),
      ]);
      return {
        accountId: a.id,
        label: a.label,
        platform: a.platform,
        hasToken: !!a.accessToken,
        hasCipher: !!a.shopCipher,
        lastOrderAt: lastOrder._max.createTime,
        lastSyncAt: lastSync._max.createdAt,
        errors7d,
        mismatch: failedJobs + retryJobs,
        orphanSkus,
      };
    })
  );

  const byKind = syncErrGroups
    .map((g) => ({ kind: g.kind, count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  return {
    centralStock: {
      variantCount: num(central[0]?.c),
      totalUnits: num(central[0]?.units),
      totalSellable: num(central[0]?.sellable),
    },
    lowStock: {
      count: num(lowCount[0]?.c),
      top: lowTop.map((r) => {
        const sellable = effectiveStock(Number(r.stock), Number(r.safetyStock));
        return {
          variantId: r.variantId,
          sku: r.sku,
          variantName: r.variantName,
          productName: r.productName,
          stock: Number(r.stock),
          safetyStock: Number(r.safetyStock),
          sellable,
          severity: (sellable <= 0 ? "out" : "low") as "low" | "out",
        };
      }),
    },
    mismatch,
    syncErrors: {
      count7d: byKind.reduce((s, g) => s + g.count, 0),
      byKind,
    },
    storeHealth: health,
  };
}
