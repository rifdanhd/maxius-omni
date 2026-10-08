import { z } from "zod";

export const stockQuantity = z.number().int().min(0).max(2_147_483_647);
export const positiveQuantity = stockQuantity.min(1);
export const stockInSchema = z.object({ variantId: z.string().trim().min(1).max(200), qty: positiveQuantity, note: z.string().max(2000).optional() });
export const stockAdjustSchema = z.object({ newStock: stockQuantity, note: z.string().max(2000).optional() });
export const opnameCountsSchema = z.object({ counts: z.array(z.object({ variantId: z.string().min(1).max(200), countedStock: stockQuantity })).min(1).max(1000) });

const quantityKeys = new Set(["qty", "quantity", "stock", "newStock", "countedStock", "safetyStock", "increment", "minStock", "threshold", "lowStockDefaultThreshold", "newSellable"]);

export function validateApiJson(value: unknown, depth = 0): void {
  if (depth > 12) throw new InputError("JSON terlalu dalam.");
  if (typeof value === "string" && value.length > 100_000) throw new InputError("Teks terlalu panjang.");
  if (typeof value === "number" && !Number.isFinite(value)) throw new InputError("Angka tidak valid.");
  if (Array.isArray(value)) {
    if (value.length > 1000) throw new InputError("Terlalu banyak item.");
    value.forEach(v => validateApiJson(v, depth + 1));
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new InputError("Field tidak valid.");
      if (quantityKeys.has(key) && !(v === null && ["stock", "minStock", "countedStock"].includes(key))) {
        if (!stockQuantity.safeParse(v).success) throw new InputError(`${key} harus bilangan bulat >= 0.`);
      }
      validateApiJson(v, depth + 1);
    }
  }
}
export class InputError extends Error {}
