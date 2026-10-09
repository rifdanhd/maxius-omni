import { effectiveStock, stockLevel, type StockLevel } from "./stock-level.policy";

interface StockVariant {
  stock: number;
  safetyStock: number;
  minStock?: number | null;
}

export interface ProductStockInput {
  type?: string;
  threshold: number;
  variants: StockVariant[];
  bundleItems?: Array<{ qty: number; variant: StockVariant }>;
}

export function productStockSummary(product: ProductStockInput): {
  stock: number;
  availableStock: number;
  level: StockLevel;
} {
  if (product.type === "bundle") {
    const items = product.bundleItems ?? [];
    if (!items.length || items.some((item) => !Number.isInteger(item.qty) || item.qty <= 0)) {
      return { stock: 0, availableStock: 0, level: "out" };
    }
    const stock = Math.min(...items.map(({ qty, variant }) => Math.floor(Math.max(0, variant.stock) / qty)));
    const availableStock = Math.min(...items.map(({ qty, variant }) => Math.floor(effectiveStock(variant.stock, variant.safetyStock) / qty)));
    return { stock, availableStock, level: stockLevel(availableStock, 0, null, product.threshold) };
  }

  let level: StockLevel = product.variants.length ? "ok" : "out";
  let stock = 0;
  let availableStock = 0;
  for (const variant of product.variants) {
    stock += variant.stock;
    availableStock += effectiveStock(variant.stock, variant.safetyStock);
    const current = stockLevel(variant.stock, variant.safetyStock, variant.minStock, product.threshold);
    if (current === "out" || level === "out") level = "out";
    else if (current === "low" || level === "low") level = "low";
  }
  return { stock, availableStock, level };
}
