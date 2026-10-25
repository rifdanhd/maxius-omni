import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { AllocationPolicy } from "@/lib/services/stock-allocation.policy";

export class InventoryConflict extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export type MasterStockChange = {
  variantId: string; expectedVersion: number; warehouseId: string;
  kind: "IN" | "OUT" | "COUNT" | "CORRECTION"; quantity: number;
  safetyStock?: number; reason: string; note?: string; requestId: string;
};

async function outbox(tx: Prisma.TransactionClient, businessId: string, variantId: string, eventKey: string) {
  await tx.stockOutbox.upsert({ where: { eventKey },
    create: { id: crypto.randomUUID(), businessId, variantId, eventKey }, update: {} });
}

export async function changeMasterStock(businessId: string, userId: string, changes: MasterStockChange[]) {
  if (new Set(changes.map((change) => change.variantId)).size !== changes.length) {
    throw new InventoryConflict("Satu SKU hanya boleh muncul sekali dalam perubahan massal.", 400);
  }
  return prisma.$transaction(async (tx) => {
    const results = [];
    for (const input of [...changes].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      await tx.$queryRaw`SELECT pv.id FROM "ProductVariant" pv JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
        WHERE pv.id = ${input.variantId} AND mp."businessId" = ${businessId} FOR UPDATE OF pv`;
      const variant = await tx.productVariant.findFirst({
        where: { id: input.variantId, masterProduct: { businessId } },
        select: { id: true, sku: true, stock: true, safetyStock: true, version: true },
      });
      if (!variant) throw new InventoryConflict("SKU tidak ditemukan.", 404);
      const referenceId = `master-stock:${input.requestId}`;
      const requestFingerprint = crypto.createHash("sha256").update(JSON.stringify({
        warehouseId: input.warehouseId, kind: input.kind, quantity: input.quantity, safetyStock: input.safetyStock ?? null,
        reason: input.reason.trim(), note: input.note?.trim() ?? "",
      })).digest("hex");
      const previous = await tx.stockLedger.findFirst({ where: { variantId: variant.id, referenceId } });
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint) throw new InventoryConflict("Nomor permintaan ini sudah dipakai untuk perubahan berbeda. Tutup dialog dan periksa stok terbaru sebelum membuat perubahan baru.");
        results.push({ id: variant.id, version: variant.version, already: true }); continue;
      }
      if (variant.version !== input.expectedVersion) {
        throw new InventoryConflict(`Stok ${variant.sku} sudah diubah pengguna atau pesanan lain. Muat ulang dan periksa angka terbaru.`);
      }
      const warehouse = await tx.inventoryWarehouse.findFirst({ where: { id: input.warehouseId, businessId } });
      if (!warehouse) throw new InventoryConflict("Gudang tidak ditemukan.", 404);
      const balance = await tx.variantWarehouseStock.upsert({
        where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
        create: { variantId: variant.id, warehouseId: warehouse.id }, update: {},
      });
      const stock = input.kind === "IN" ? balance.stock + input.quantity
        : input.kind === "OUT" ? balance.stock - input.quantity : input.quantity;
      if (!Number.isSafeInteger(stock) || stock < 0 || stock > 2_147_483_647 || variant.stock - balance.stock + stock > 2_147_483_647) {
        throw new InventoryConflict(`Perubahan ${variant.sku} membuat stok negatif atau melampaui batas. Di ${warehouse.name} tersedia ${balance.stock}.`, 400);
      }
      const nextReserved = input.safetyStock ?? balance.safetyStock;
      if (variant.safetyStock - balance.safetyStock + nextReserved > 2_147_483_647) {
        throw new InventoryConflict("Jumlah disisihkan melampaui batas.", 400);
      }
      await tx.variantWarehouseStock.update({ where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
        data: { stock, safetyStock: nextReserved } });
      const updated = await tx.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
      await tx.stockLedger.create({ data: { id: crypto.randomUUID(), variantId: variant.id, warehouseId: warehouse.id,
        reason: input.kind === "IN" ? "STOCK_IN" : input.kind === "OUT" ? "STOCK_OUT" : input.kind === "COUNT" ? "STOCK_OPNAME" : "MANUAL_ADJUSTMENT",
        referenceId, requestFingerprint, changeQty: stock - balance.stock, stockAfter: updated.stock, userId,
        note: `${input.reason.trim()}${input.note?.trim() ? ` — ${input.note.trim()}` : ""} · ${warehouse.name}` } });
      if (nextReserved !== balance.safetyStock) await tx.stockLedger.create({ data: { id: crypto.randomUUID(), variantId: variant.id,
        warehouseId: warehouse.id, reason: "SAFETY_STOCK_CHANGE", referenceId, requestFingerprint, changeQty: 0, stockAfter: updated.stock, userId,
        note: `${input.reason.trim()} · Cadangan ${balance.safetyStock} → ${nextReserved} · ${warehouse.name}` } });
      await outbox(tx, businessId, variant.id, referenceId + ":" + variant.id);
      results.push({ id: variant.id, stock: updated.stock, safetyStock: updated.safetyStock, version: updated.version, status: "PENDING" });
    }
    return results;
  }, { timeout: 60_000 });
}

export async function retryMasterStock(businessId: string, variantIds: string[], listingId?: string) {
  return prisma.$transaction(async (tx) => {
    const variants = await tx.productVariant.findMany({ where: { id: { in: variantIds }, masterProduct: { businessId } },
      include: { productMapping: { where: { account: { businessId }, ...(listingId ? { id: listingId } : {}) } } } });
    if (variants.length !== new Set(variantIds).size) throw new InventoryConflict("SKU tidak ditemukan.", 404);
    let count = 0;
    for (const variant of variants) for (const mapping of variant.productMapping) {
      const identity = { variantId: variant.id, accountId: mapping.accountId, channelSku: mapping.channelSku, status: "PENDING" };
      const available = Math.max(0, variant.stock - variant.safetyStock);
      await tx.syncJob.upsert({ where: { variantId_accountId_channelSku_status: identity },
        create: { ...identity, newSellable: available }, update: { newSellable: available, retryCount: 0, nextRetryAt: null, lastError: null } });
      await tx.productMapping.update({ where: { id: mapping.id }, data: { lastStockPushStatus: "PENDING", lastStockPushError: null } });
      count++;
    }
    if (listingId && count === 0) throw new InventoryConflict("Listing tidak ditemukan.", 404);
    return count;
  });
}

export async function setStockAllocation(businessId: string, input: AllocationPolicy & { listingId?: string; accountId?: string }) {
  return prisma.$transaction(async (tx) => {
    const mappings = await tx.productMapping.findMany({ where: {
      ...(input.listingId ? { id: input.listingId } : { accountId: input.accountId }),
      account: { businessId }, variant: { masterProduct: { businessId } },
    }, select: { id: true, variantId: true, accountId: true } });
    if (input.listingId && mappings.length !== 1) throw new InventoryConflict("Listing tidak ditemukan.", 404);
    const values = { stockAllocationMode: input.mode, stockAllocationValue: input.value, stockBuffer: input.buffer };
    if (input.listingId) await tx.productMapping.update({ where: { id: input.listingId }, data: values });
    else {
      const account = await tx.platformAccount.updateMany({ where: { id: input.accountId, businessId }, data: values });
      if (account.count !== 1) throw new InventoryConflict("Toko tidak ditemukan.", 404);
    }
    for (const variantId of [...new Set(mappings.flatMap((mapping) => mapping.variantId ? [mapping.variantId] : []))]) {
      await outbox(tx, businessId, variantId, `allocation:${crypto.randomUUID()}`);
    }
    return mappings.length;
  }, { timeout: 60_000 });
}

export async function inheritStockAllocation(businessId: string, listingId: string) {
  return prisma.$transaction(async (tx) => {
    const mapping = await tx.productMapping.findFirst({ where: { id: listingId, account: { businessId }, variant: { masterProduct: { businessId } } } });
    if (!mapping?.variantId) throw new InventoryConflict("Listing tidak ditemukan.", 404);
    await tx.productMapping.update({ where: { id: mapping.id }, data: { stockAllocationMode: null, stockAllocationValue: null, stockBuffer: null } });
    await outbox(tx, businessId, mapping.variantId, `allocation:${crypto.randomUUID()}`);
  });
}
