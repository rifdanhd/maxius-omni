import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { cached } from "@/lib/utils/ttl-cache";
import { effectiveStock, lowStockSql, resolveMinStock } from "@/lib/services/central-stock.service";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";

const CACHE_TTL_MS = 60_000;

type StockAlertRow = {
  variantId: string;
  variantSku: string;
  stock: number;
  safetyStock: number;
  productId: string;
  productName: string;
  threshold: number;
  minStock: number | null;
};

export type StockAlert = StockAlertRow & {
  effectiveStock: number;
  minStockResolved: number;
  severity: "low" | "out";
};

/**
 * GET /api/stock-alerts — daftar varian dengan stok "mepet".
 *
 * Definisi mepet = isLowStock() di stock-level.policy (SATU-SATUNYA definisi,
 * sama dengan halaman Stok Varian & ringkasan dashboard): tersedia
 * (effectiveStock) <= minimum (minStock per-varian bila di-set, else
 * threshold produk induk). Query via $queryRaw (fragmen lowStockSql) supaya
 * perbandingan arithmetic di DB — aman untuk puluhan ribu SKU.
 */
export const GET = withAuth(async () => {
  // Gate notifikasi stok menipis (Pengaturan Inventori). Channel EMAIL belum
  // ada di sistem (tidak ada provider) — bell in-app ini satu-satunya channel;
  // kalau dimatikan, endpoint tetap ada tapi tidak mengeluarkan alert.
  const settings = await getCachedInventorySettings();
  if (!settings.notifyLowStock) {
    return NextResponse.json({ count: 0, alerts: [] });
  }

  const data = await cached("stock-alerts", CACHE_TTL_MS, async () => {
    const rows = await prisma.$queryRaw<StockAlertRow[]>`
      SELECT
        pv.id            AS variantId,
        pv.sku           AS variantSku,
        pv.stock         AS stock,
        pv."safetyStock" AS safetyStock,
        mp.id            AS productId,
        mp.name          AS productName,
        mp.threshold     AS threshold,
        pv."minStock"    AS "minStock"
      FROM "ProductVariant" pv
      JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
      WHERE ${lowStockSql("pv", "mp")}
      ORDER BY (pv.stock - pv."safetyStock") ASC, mp.name ASC
    `;

    const alerts: StockAlert[] = rows.map((r) => {
      const eff = effectiveStock(r.stock, r.safetyStock);
      const minStockResolved = resolveMinStock(
        r.minStock === null ? null : Number(r.minStock),
        Number(r.threshold)
      );
      return { ...r, effectiveStock: eff, minStockResolved, severity: eff <= 0 ? "out" : "low" };
    });

    return { count: alerts.length, alerts };
  });

  return NextResponse.json(data);
});