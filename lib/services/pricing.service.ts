import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { syncPriceToMarketplaces } from "@/lib/services/sync.service";
import { after } from "next/server";

/**
 * Kelola Harga.
 *
 * Model harga:
 * - ProductVariant.price = harga default varian (SKU induk). Null = belum di-set.
 * - ProductMapping.price  = override per toko/marketplace. Null = mengikuti
 *   harga default varian.
 * - Harga tayang efektif di satu marketplace = mapping.price ?? variant.price.
 *
 * Setiap update harga mencatat priceUpdatedAt, lalu memicu sinkronisasi
 * fire-and-forget ke marketplace yang harga efektifnya benar-benar berubah
 * (hasilnya dicatat di SyncLog kind "price_push" untuk retry/trace).
 */

export type PricingSort =
  | "name_asc"
  | "name_desc"
  | "sku_asc"
  | "sku_desc"
  | "price_asc"
  | "price_desc"
  | "updated_desc"
  | "created_desc";

export interface ListPricingParams {
  businessId: string;
  search?: string;
  sort?: PricingSort;
  storeIds?: string[];
  category?: string;
  priceMin?: number;
  priceMax?: number;
  page?: number;
  pageSize?: number;
}

export interface PricingRow {
  id: string;
  sku: string;
  defaultPrice: number | null;
  defaultPriceUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  product: { id: string; name: string; category: string | null; imageUrl: string | null } | null;
  markets: Array<{
    id: string;
    accountId: string;
    accountLabel: string;
    platform: string;
    channelSku: string;
    price: number | null;
    overridePrice: number | null;
    priceUpdatedAt: Date | null;
    syncStatus?: string;
  }>;
}

export async function listPricing(
  params: ListPricingParams
): Promise<{ rows: PricingRow[]; total: number; page: number; pageSize: number; categories: string[] }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.ProductVariantWhereInput = {
    isArchived: false,
    masterProduct: {
      businessId: params.businessId,
      isActive: true, status: "active",
      ...(params.category?.trim() ? { category: params.category.trim() } : {}),
    },
  };

  const search = params.search?.trim();
  if (search) {
    where.OR = [
      { sku: { contains: search } },
      { masterProduct: { name: { contains: search } } },
      { productMapping: { some: { channelSku: { contains: search } } } },
    ];
  }
  if (params.storeIds && params.storeIds.length > 0) {
    where.productMapping = { some: { accountId: { in: params.storeIds } } };
  }
  if (params.priceMin !== undefined || params.priceMax !== undefined) {
    where.price = {
      ...(params.priceMin !== undefined ? { gte: params.priceMin } : {}),
      ...(params.priceMax !== undefined ? { lte: params.priceMax } : {}),
    };
  }

  const orders: Record<PricingSort, Prisma.ProductVariantOrderByWithRelationInput> = {
    name_asc: { masterProduct: { name: "asc" } }, name_desc: { masterProduct: { name: "desc" } },
    sku_asc: { sku: "asc" }, sku_desc: { sku: "desc" }, price_asc: { price: { sort: "asc", nulls: "last" } }, price_desc: { price: { sort: "desc", nulls: "last" } }, updated_desc: { updatedAt: "desc" }, created_desc: { createdAt: "desc" },
  };
  const [total, categoryRows] = await Promise.all([
    prisma.productVariant.count({ where }),
    prisma.masterProduct.findMany({ where: { businessId: params.businessId, category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
  ]);
  const variants = await prisma.productVariant.findMany({
    where,
    orderBy: [orders[params.sort ?? "name_asc"], { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
    include: {
      masterProduct: { select: { id: true, name: true, category: true, imageUrl: true } },
      productMapping: {
        include: { account: { select: { id: true, label: true, platform: true } } },
      },
    },
  });

  const accountIds = [...new Set(variants.flatMap((variant) => variant.productMapping.map((mapping) => mapping.accountId)))];
  const logs = accountIds.length ? await prisma.syncLog.findMany({ where: { accountId: { in: accountIds }, kind: "price_push" }, select: { accountId: true, payload: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 500 }) : [];
  const delivery = (accountId: string, sku: string, price: number | null, updated: Date | null) => {
    for (const log of logs) {
      if (log.accountId !== accountId || !updated || log.createdAt < updated) continue;
      try { const payload = JSON.parse(log.payload ?? "{}"); if (payload.channelSku === sku && payload.price === price) return log.status; } catch { continue; }
    }
    return "unknown";
  };
  const rows: PricingRow[] = variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    defaultPrice: v.price,
    defaultPriceUpdatedAt: v.priceUpdatedAt,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    product: v.masterProduct,
    markets: v.productMapping.map((m) => ({
      id: m.id,
      accountId: m.accountId,
      accountLabel: m.account.label,
      platform: m.account.platform,
      channelSku: m.channelSku,
      price: m.price ?? v.price,
      overridePrice: m.price,
      priceUpdatedAt: m.priceUpdatedAt,
      syncStatus: delivery(m.accountId, m.channelSku, m.price ?? v.price, m.price === null ? [m.priceUpdatedAt, v.priceUpdatedAt].filter((date): date is Date => !!date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null : m.priceUpdatedAt),
    })),
  }));

  return { rows, total, page, pageSize, categories: categoryRows.flatMap((row) => row.category ? [row.category] : []) };
}

const effectiveMarketPrice = (override: number | null, defaultPrice: number | null) =>
  override ?? defaultPrice;

/**
 * updateVariantDefaultPrice — set harga default varian.
 * Sync ke marketplace yang TIDAK punya override (harga efektifnya ikut berubah).
 */
export async function updateVariantDefaultPrice(
  variantId: string,
  price: number,
  businessId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!Number.isSafeInteger(price) || price < 0) {
    return { ok: false, reason: "Harga harus angka >= 0." };
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
     include: {
       masterProduct: { select: { businessId: true, isActive: true, status: true } },
       productMapping: { select: { id: true, accountId: true, channelSku: true, price: true } },
     },
   });
   if (!variant || variant.masterProduct.businessId !== businessId) {
    return { ok: false, reason: "Varian tidak ditemukan." };
  }
  if (variant.isArchived || !variant.masterProduct.isActive || variant.masterProduct.status !== "active") return { ok: false, reason: "Produk tidak aktif atau masih draf. Aktifkan melalui Produk Master sebelum mengirim harga." };

  const newPrice = Math.round(price * 100) / 100;
  await prisma.productVariant.update({
    where: { id: variantId },
    data: { price: newPrice, priceUpdatedAt: new Date() },
  });

  // Hanya marketplace tanpa override yang harga efektifnya berubah.
  const targets = variant.productMapping
    .filter((m) => m.price === null)
    .map((m) => ({ accountId: m.accountId, channelSku: m.channelSku }));

  if (targets.length > 0) {
    after(() => syncPriceToMarketplaces(targets, newPrice).catch((err) =>
      console.error(`[Pricing] sync default price varian ${variantId} gagal:`, err)
    ));
  }

  return { ok: true };
}

/**
 * updateMappingPrice — set / bersihkan harga override satu toko.
 * `price` null = hapus override (kembali ke harga default varian).
 */
export async function updateMappingPrice(
  mappingId: string,
  price: number | null,
  businessId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (price !== null && (!Number.isSafeInteger(price) || price < 0)) {
    return { ok: false, reason: "Harga harus angka >= 0." };
  }

  const mapping = await prisma.productMapping.findUnique({
    where: { id: mappingId },
    include: {
      account: { select: { businessId: true } },
      variant: {
        select: {
          id: true,
          isArchived: true,
          price: true,
          masterProduct: { select: { businessId: true, isActive: true, status: true } },
        },
      },
    },
  });
  if (!mapping || mapping.account.businessId !== businessId) {
    return { ok: false, reason: "Mapping toko tidak ditemukan." };
  }
  if (!mapping.variant) {
    return {
      ok: false,
      reason: "Mapping belum terhubung ke varian — hubungkan varian dulu sebelum set/hapus harga override.",
    };
  }
  if (mapping.variant.masterProduct.businessId !== businessId) {
    return { ok: false, reason: "Mapping toko tidak ditemukan." };
  }
  if (mapping.variant.isArchived || !mapping.variant.masterProduct.isActive || mapping.variant.masterProduct.status !== "active") return { ok: false, reason: "Produk tidak aktif atau masih draf. Aktifkan melalui Produk Master sebelum mengirim harga." };

  const newPrice = price === null ? null : Math.round(price * 100) / 100;
  const effectiveAfter = effectiveMarketPrice(newPrice, mapping.variant.price);
  const effectiveBefore = effectiveMarketPrice(mapping.price, mapping.variant.price);
  if (newPrice === null && effectiveAfter === null) return { ok: false, reason: "Isi harga utama sebelum menghapus harga khusus." };

  await prisma.productMapping.update({
    where: { id: mappingId },
    data: { price: newPrice, priceUpdatedAt: new Date() },
  });

  if (effectiveAfter !== null && effectiveAfter !== effectiveBefore) {
    after(() => syncPriceToMarketplaces(
      [{ accountId: mapping.accountId, channelSku: mapping.channelSku }],
      effectiveAfter
    ).catch((err) =>
      console.error(`[Pricing] sync override mapping ${mappingId} gagal:`, err)
    ));
  }

  return { ok: true };
}

export interface BulkPriceRow {
  row: number;
  sku: string;
  price: number | null;
  store: string | null;
  channelSku: string | null;
}

export interface BulkPriceResult {
  ok: boolean;
  updated: number;
  skipped: number;
  failed: Array<{ row: number; message: string }>;
}

/**
 * processBulkPrice — terapkan hasil parsing CSV ke database.
 * - Baris dengan store kosong        → update harga default varian (by SKU induk).
 * - Baris dengan store diisi         → update override mapping varian@toko
 *   (store = label toko, opsional channel_sku utk verifikasi mapping).
 */
export async function processBulkPrice(
  rows: BulkPriceRow[],
  businessId: string
): Promise<BulkPriceResult> {
  const result: BulkPriceResult = { ok: true, updated: 0, skipped: 0, failed: [] };

  for (const r of rows) {
    if (!r.sku) {
      result.failed.push({ row: r.row, message: "SKU kosong." });
      continue;
    }

    try {
      if (r.store) {
        // Override per toko — cari mapping varian oleh toko tsb.
        const variants = await prisma.productVariant.findMany({
          where: { sku: r.sku, isArchived: false, masterProduct: { businessId, isActive: true, status: "active" } }, take: 2,
           include: {
             productMapping: {
               include: { account: { select: { id: true, label: true } } },
             },
           },
         });
         const variant = variants.length === 1 ? variants[0] : null;
         if (!variant) {
           result.failed.push({ row: r.row, message: `SKU "${r.sku}" tidak ditemukan atau memiliki beberapa kandidat. Pilih produk melalui tabel harga.` });
           continue;
         }
         const store = r.store.trim().toLowerCase();
         const matches = variant.productMapping.filter(
           (m) =>
             m.account.label.trim().toLowerCase() === store &&
            (!r.channelSku || m.channelSku === r.channelSku.trim())
        );
        const mapping = matches.length === 1 ? matches[0] : null;
        if (!mapping) {
          result.failed.push({
            row: r.row,
            message: `Varian "${r.sku}" tidak terhubung ke toko "${r.store}".`,
          });
          continue;
        }
        const upd = await updateMappingPrice(mapping.id, r.price, businessId);
        if (!upd.ok) {
          result.failed.push({ row: r.row, message: upd.reason ?? "Gagal update override." });
          continue;
        }
        result.updated += 1;
      } else {
        if (r.price === null) {
          result.failed.push({
            row: r.row,
            message: `Baris tanpa toko harus mengisi kolom harga (SKU "${r.sku}").`,
          });
          continue;
        }
        const variants = await prisma.productVariant.findMany({
          where: { sku: r.sku, isArchived: false, masterProduct: { businessId, isActive: true, status: "active" } }, take: 2,
        });
        const variant = variants.length === 1 ? variants[0] : null;
        if (!variant) {
          result.failed.push({ row: r.row, message: `SKU "${r.sku}" tidak ditemukan atau ambigu. Pilih produk melalui tabel harga.` });
          continue;
        }
        const upd = await updateVariantDefaultPrice(variant.id, r.price, businessId);
        if (!upd.ok) {
          result.failed.push({ row: r.row, message: upd.reason ?? "Gagal update harga default." });
          continue;
        }
        result.updated += 1;
      }
    } catch (e) {
      result.failed.push({
        row: r.row,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (result.failed.length > 0) result.ok = false;
  return result;
}
