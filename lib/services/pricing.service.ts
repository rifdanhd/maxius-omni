import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { syncPriceToMarketplaces } from "@/lib/services/sync.service";

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
  }>;
}

export async function listPricing(
  params: ListPricingParams = {}
): Promise<{ rows: PricingRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.ProductVariantWhereInput = {};

  const search = params.search?.trim();
  if (search) {
    where.OR = [
      { sku: { contains: search } },
      { masterProduct: { name: { contains: search } } },
      { mappings: { some: { channelSku: { contains: search } } } },
    ];
  }
  if (params.category?.trim()) {
    where.masterProduct = { category: params.category.trim() };
  }
  if (params.storeIds && params.storeIds.length > 0) {
    where.mappings = { some: { accountId: { in: params.storeIds } } };
  }
  if (params.priceMin !== undefined || params.priceMax !== undefined) {
    where.price = {
      ...(params.priceMin !== undefined ? { gte: params.priceMin } : {}),
      ...(params.priceMax !== undefined ? { lte: params.priceMax } : {}),
    };
  }

  const variants = await prisma.productVariant.findMany({
    where,
    include: {
      masterProduct: { select: { id: true, name: true, category: true, imageUrl: true } },
      mappings: {
        include: { account: { select: { id: true, label: true, platform: true } } },
      },
    },
  });

  const rows: PricingRow[] = variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    defaultPrice: v.price,
    defaultPriceUpdatedAt: v.priceUpdatedAt,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    product: v.masterProduct,
    markets: v.mappings.map((m) => ({
      id: m.id,
      accountId: m.account.id,
      accountLabel: m.account.label,
      platform: m.account.platform,
      channelSku: m.channelSku,
      price: m.price ?? v.price,
      overridePrice: m.price,
      priceUpdatedAt: m.priceUpdatedAt,
    })),
  }));

  const sort = params.sort ?? "name_asc";
  const localeCompare = (a: string, b: string) => a.localeCompare(b, "id");
  rows.sort((a, b) => {
    switch (sort) {
      case "name_desc":
        return localeCompare(b.product?.name ?? "", a.product?.name ?? "");
      case "sku_asc":
        return localeCompare(a.sku, b.sku);
      case "sku_desc":
        return localeCompare(b.sku, a.sku);
      case "price_asc": {
        const ap = a.defaultPrice ?? Infinity;
        const bp = b.defaultPrice ?? Infinity;
        return ap - bp || localeCompare(a.product?.name ?? "", b.product?.name ?? "");
      }
      case "price_desc": {
        const ap = a.defaultPrice ?? -1;
        const bp = b.defaultPrice ?? -1;
        return bp - ap || localeCompare(a.product?.name ?? "", b.product?.name ?? "");
      }
      case "updated_desc":
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      case "created_desc":
        return b.createdAt.getTime() - a.createdAt.getTime();
      default:
        return localeCompare(a.product?.name ?? "", b.product?.name ?? "");
    }
  });

  const total = rows.length;
  const sliced = rows.slice((page - 1) * pageSize, page * pageSize);

  return { rows: sliced, total, page, pageSize };
}

const effectiveMarketPrice = (override: number | null, defaultPrice: number | null) =>
  override ?? defaultPrice;

/**
 * updateVariantDefaultPrice — set harga default varian.
 * Sync ke marketplace yang TIDAK punya override (harga efektifnya ikut berubah).
 */
export async function updateVariantDefaultPrice(
  variantId: string,
  price: number
): Promise<{ ok: boolean; reason?: string }> {
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, reason: "Harga harus angka >= 0." };
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { mappings: { select: { id: true, accountId: true, channelSku: true, price: true } } },
  });
  if (!variant) return { ok: false, reason: "Varian tidak ditemukan." };

  const newPrice = Math.round(price * 100) / 100;
  await prisma.productVariant.update({
    where: { id: variantId },
    data: { price: newPrice, priceUpdatedAt: new Date() },
  });

  // Hanya marketplace tanpa override yang harga efektifnya berubah.
  const targets = variant.mappings
    .filter((m) => m.price === null)
    .map((m) => ({ accountId: m.accountId, channelSku: m.channelSku }));

  if (targets.length > 0) {
    syncPriceToMarketplaces(targets, newPrice).catch((err) =>
      console.error(`[Pricing] sync default price varian ${variantId} gagal:`, err)
    );
  }

  return { ok: true };
}

/**
 * updateMappingPrice — set / bersihkan harga override satu toko.
 * `price` null = hapus override (kembali ke harga default varian).
 */
export async function updateMappingPrice(
  mappingId: string,
  price: number | null
): Promise<{ ok: boolean; reason?: string }> {
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return { ok: false, reason: "Harga harus angka >= 0." };
  }

  const mapping = await prisma.productMapping.findUnique({
    where: { id: mappingId },
    include: { variant: { select: { id: true, price: true } } },
  });
  if (!mapping) return { ok: false, reason: "Mapping toko tidak ditemukan." };

  const newPrice = price === null ? null : Math.round(price * 100) / 100;
  const effectiveAfter = effectiveMarketPrice(newPrice, mapping.variant.price);
  const effectiveBefore = effectiveMarketPrice(mapping.price, mapping.variant.price);

  await prisma.productMapping.update({
    where: { id: mappingId },
    data: { price: newPrice, priceUpdatedAt: new Date() },
  });

  if (effectiveAfter !== null && effectiveAfter !== effectiveBefore) {
    syncPriceToMarketplaces(
      [{ accountId: mapping.accountId, channelSku: mapping.channelSku }],
      effectiveAfter
    ).catch((err) =>
      console.error(`[Pricing] sync override mapping ${mappingId} gagal:`, err)
    );
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
export async function processBulkPrice(rows: BulkPriceRow[]): Promise<BulkPriceResult> {
  const result: BulkPriceResult = { ok: true, updated: 0, skipped: 0, failed: [] };

  for (const r of rows) {
    if (!r.sku) {
      result.failed.push({ row: r.row, message: "SKU kosong." });
      continue;
    }

    try {
      if (r.store) {
        // Override per toko — cari mapping varian oleh toko tsb.
        const variant = await prisma.productVariant.findFirst({
          where: { sku: r.sku },
          include: {
            mappings: {
              include: { account: { select: { id: true, label: true } } },
            },
          },
        });
        if (!variant) {
          result.failed.push({ row: r.row, message: `SKU "${r.sku}" tidak ditemukan.` });
          continue;
        }
        const store = r.store.trim().toLowerCase();
        const mapping = variant.mappings.find(
          (m) =>
            m.account.label.trim().toLowerCase() === store ||
            (r.channelSku && m.channelSku.trim().toLowerCase() === r.channelSku!.trim().toLowerCase())
        );
        if (!mapping) {
          result.failed.push({
            row: r.row,
            message: `Varian "${r.sku}" tidak terhubung ke toko "${r.store}".`,
          });
          continue;
        }
        const upd = await updateMappingPrice(mapping.id, r.price);
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
        const variant = await prisma.productVariant.findFirst({ where: { sku: r.sku } });
        if (!variant) {
          result.failed.push({ row: r.row, message: `SKU "${r.sku}" tidak ditemukan.` });
          continue;
        }
        const upd = await updateVariantDefaultPrice(variant.id, r.price);
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