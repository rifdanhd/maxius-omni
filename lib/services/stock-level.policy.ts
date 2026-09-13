/**
 * stock-level.policy — SATU-SATUNYA definisi "stok menipis" di Maxius.
 *
 * File murni (tanpa import server/DB) supaya bisa dipakai di Server Component,
 * API route, MAUPUN Client Component tanpa menarik Prisma ke bundle browser.
 *
 * Definisi:
 * - Tersedia = effectiveStock(stock, safetyStock) = max(0, stock - safetyStock).
 * - Minimum efektif = minStock per-varian bila di-set, else threshold produk
 *   induk (MasterProduct.threshold).
 * - "Menipis" (isLowStock) = tersedia <= minimum (termasuk Habis = 0).
 * - stockLevel memecah lagi: out (0) | low (<= minimum) | ok.
 *
 * Render SQL dari definisi ini ada di central-stock.service.lowStockSql —
 * kalau definisi di sini berubah, sana WAJIB ikut berubah.
 */

export type StockLevel = "ok" | "low" | "out";

export function effectiveStock(stock: number, safetyStock: number): number {
  return Math.max(0, stock - safetyStock);
}

export function resolveMinStock(
  minStock: number | null | undefined,
  productThreshold: number
): number {
  return minStock ?? productThreshold;
}

export function isLowStock(
  stock: number,
  safetyStock: number,
  minStock: number | null | undefined,
  productThreshold: number
): boolean {
  return effectiveStock(stock, safetyStock) <= resolveMinStock(minStock, productThreshold);
}

export function stockLevel(
  stock: number,
  safetyStock: number,
  minStock: number | null | undefined,
  productThreshold: number
): StockLevel {
  const e = effectiveStock(stock, safetyStock);
  if (e <= 0) return "out";
  if (e <= resolveMinStock(minStock, productThreshold)) return "low";
  return "ok";
}
