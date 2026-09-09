import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { cached } from "@/lib/utils/ttl-cache";
import { effectiveStock } from "@/lib/services/central-stock.service";

const CACHE_TTL_MS = 60_000;

type StockAlertRow = {
  variantId: string;
  variantSku: string;
  stock: number;
  safetyStock: number;
  productId: string;
  productName: string;
  threshold: number;
};

export type StockAlert = StockAlertRow & {
  effectiveStock: number;
  severity: "low" | "out";
};

/**
 * GET /api/stock-alerts — daftar varian dengan stok "mepet".
 *
 * Definisi mepet: stok efektif (stock - safetyStock) sudah ≤ threshold produk
 * induk (MasterProduct.threshold, default 20). Dipilih karena:
 *  - memakai logic effectiveStock() yang sudah ada di central-stock.service;
 *  - threshold sudah dipakai dashboard "Stok Menipis" → konsisten;
 *  - bukan persentase → tidak butuh konfigurasi baru & mudah dijelaskan.
 *
 * Query ditulis via $queryRaw sehingga perbandingan arithmetic dijalankan di
 * DB (bukan loop JS) — aman untuk puluhan ribu SKU. Hasil di-cache 60 detik.
 */
export const GET = withAuth(async () => {
  const data = await cached("stock-alerts", CACHE_TTL_MS, async () => {
    const rows = await prisma.$queryRaw<StockAlertRow[]>`
      SELECT
        pv.id            AS variantId,
        pv.sku           AS variantSku,
        pv.stock         AS stock,
        pv."safetyStock" AS safetyStock,
        mp.id            AS productId,
        mp.name          AS productName,
        mp.threshold     AS threshold
      FROM "ProductVariant" pv
      JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
      WHERE (pv.stock - pv."safetyStock") <= mp.threshold
      ORDER BY (pv.stock - pv."safetyStock") ASC, mp.name ASC
    `;

    const alerts: StockAlert[] = rows.map((r) => {
      const eff = effectiveStock(r.stock, r.safetyStock);
      return { ...r, effectiveStock: eff, severity: eff <= 0 ? "out" : "low" };
    });

    return { count: alerts.length, alerts };
  });

  return NextResponse.json(data);
});