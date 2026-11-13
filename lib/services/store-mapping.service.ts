import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { InventoryConflict } from "@/lib/services/master-stock-mutation.service";
import { lockSellerSkus, registerSellerSku } from "@/lib/services/master-sku.service";
import { UNFULFILLED_ORDER_STATUSES } from "@/lib/services/master-stock.service";
import { stockPushDisabledReason } from "@/lib/services/stock-push.policy";

export const storeMappingSchema = z.object({
  sellerSku: z.string().trim().max(200).nullable(),
  variantId: z.string().trim().min(1).max(200),
  acknowledge: z.literal(true),
  listings: z.array(z.object({
    id: z.string().min(1).max(200),
    variantId: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  }).strict()).min(1).max(250),
}).strict();

export async function connectStoreListings(businessId: string, userId: string, input: z.infer<typeof storeMappingSchema>) {
  const ids = input.listings.map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new InventoryConflict("Listing dipilih lebih dari sekali.", 400);
  const groupSku = input.sellerSku?.trim().toUpperCase() || null;
  if (!groupSku && ids.length !== 1) throw new InventoryConflict("Listing tanpa SKU penjual harus diperiksa satu per satu.", 400);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.productMapping.findMany({
      where: { id: { in: ids }, account: { businessId } },
      include: { account: { select: { isFrozen: true } } },
    });
    if (rows.length !== ids.length) throw new InventoryConflict("Listing tidak ditemukan dalam bisnis ini.", 404);
    const sellerSkus = [...new Set(rows.map((row) => row.sellerSku?.trim()).filter((sku): sku is string => Boolean(sku)))];
    await lockSellerSkus(tx, businessId, sellerSkus);
    const target = await tx.productVariant.findFirst({
      where: { id: input.variantId, isArchived: false, masterProduct: { businessId, isActive: true } },
    });
    if (!target) throw new InventoryConflict("Pilih varian pusat aktif dari bisnis ini.", 404);

    for (const row of rows) {
      const expected = input.listings.find((listing) => listing.id === row.id)!;
      if ((row.sellerSku?.trim().toUpperCase() || null) !== groupSku
        || row.variantId !== expected.variantId || row.updatedAt.toISOString() !== expected.updatedAt) {
        throw new InventoryConflict("Data listing berubah sejak preview. Muat ulang dan periksa pilihan kembali.");
      }
      if (row.account.isFrozen) throw new InventoryConflict("Ada toko yang dibekukan. Periksa koneksi toko terlebih dahulu.");
    }
    const moving = rows.filter((row) => row.variantId !== target.id);
    if (!moving.length) return { updated: 0 };
    const sourceIds = [...new Set(moving.map((row) => row.variantId).filter((id): id is string => Boolean(id)))];
    const activeOrders = await tx.orderItem.count({ where: {
      OR: [
        ...(sourceIds.length ? [{ variantId: { in: sourceIds } }] : []),
        ...moving.map((row) => ({ order: { accountId: row.accountId }, channelSku: row.channelSku })),
      ],
      order: { importOnly: false, status: { in: UNFULFILLED_ORDER_STATUSES }, account: { businessId } },
    } });
    if (activeOrders) throw new InventoryConflict("Varian sumber masih memiliki pesanan aktif. Selesaikan peninjauan pesanan sebelum memindahkan hubungan produknya.");
    const settings = await tx.inventorySetting.findUnique({ where: { businessId } });
    const affected = await tx.productMapping.findMany({ where: { variantId: { in: [...sourceIds, target.id] }, account: { businessId } },
      select: { account: { select: { platform: true, isFrozen: true, stockPushEnabled: true } } } });
    const canPush = settings && affected.some((row) => !stockPushDisabledReason(row.account, settings));
    const pendingJobs = await tx.syncJob.count({ where: {
      OR: moving.map((row) => ({ accountId: row.accountId, channelSku: row.channelSku })),
      status: { in: canPush ? ["PENDING", "PROCESSING", "FAILED"] : ["PROCESSING"] },
    } });
    const pendingOutbox = await tx.stockOutbox.count({ where: {
      businessId, variantId: { in: [...sourceIds, target.id] }, status: "PENDING",
    } });
    if (pendingJobs || (canPush && pendingOutbox)) throw new InventoryConflict("Masih ada antrean perubahan stok aktif terkait listing ini. Selesaikan antrean di Stok Mismatch sebelum mengubah hubungan.");

    for (const row of moving) {
      const updated = await tx.productMapping.updateMany({
        where: { id: row.id, variantId: row.variantId, updatedAt: row.updatedAt, account: { businessId } },
        data: { variantId: target.id, origin: "review" },
      });
      if (updated.count !== 1) throw new InventoryConflict("Hubungan produk sudah berubah. Muat ulang sebelum menyimpan.");
    }
    for (const row of rows) {
      if (row.sellerSku?.trim()) await registerSellerSku(tx, { businessId, mappingId: row.id, sellerSku: row.sellerSku.trim() });
    }
    const auditId = crypto.randomUUID();
    for (const accountId of new Set(moving.map((row) => row.accountId))) {
      await tx.syncLog.create({ data: {
        accountId, direction: "internal", kind: "mapping_review", status: "success",
        message: "Hubungan produk antar toko diperbarui; stok dan pesanan lama tidak diubah.",
        payload: JSON.stringify({ auditId, userId, sellerSku: groupSku, targetStock: target.stock,
          changes: moving.filter((row) => row.accountId === accountId).map((row) => ({
            id: row.id, accountId, channelSku: row.channelSku, from: row.variantId, to: target.id,
          })),
        }),
      } });
    }
    return { updated: moving.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}
