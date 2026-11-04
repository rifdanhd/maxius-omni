/**
 * IMPORT LISTING SHOPEE → MASTER CATALOG.
 *
 * Masalah yang dijawab: syncShopeeListings HANYA meng-update ProductMapping
 * yang sudah ada, jadi akun Shopee yang baru connect selalu kosong di halaman
 * Produk Marketplace › Shopee. Modul ini menarik listing dari Shopee lalu
 * membuat entri katalog sehingga produk bisa dikelola & push stok dari Maxius.
 *
 * Prinsip (selaras orphan-sku.service):
 *  - SATU listing Shopee = SATU MasterProduct; varian = model Shopee
 *    (warna/size) karena stok dicatat per varian, bukan per item.
 *  - Listing baru memakai itemId:modelId untuk alamat API. Seller SKU disimpan
 *    terpisah dan dipakai mencocokkan SKU master dalam customer yang sama.
 *  - SKU yang sudah punya mapping TIDAK pernah dipoint ke master baru: mapping
 *    yang sudah tertaut varian lain hanya di-refresh field platform-nya, dan
 *    mapping orphan (variantId NULL) sengaja dibiarkan ke panel orphan supaya
 *    user yang memutuskan master mana yang dipakai.
 *  - Stok awal diambil dari Shopee bila API melaporkannya (stock_info_v2 /
 *    stock_info); tidak dilaporkan → 0 dan TIDAK dikarang jadi angka platform.
 *    Apapun nilainya SELALU dicatat StockLedger reason INIT supaya ada titik
 *    nol audit.
 *  - Partial progress: limit item per proses + flag hasMore, jadi sisanya
 *    bisa dilanjutkan tanpa menarik ulang listing yang sudah diproses.
 */
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getItemBaseInfo, getItemList, getModelList, itemBaseImage, readStockInfo } from "@/lib/integrations/shopee";
import { STOCK_REASONS } from "@/lib/services/central-stock.service";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";
import { findMasterSku, lockSellerSkus, queueSkuReview, registerSellerSku } from "@/lib/services/master-sku.service";
import {
  backfillMasterImages,
  loadShopeeAccount,
  withRefreshedToken,
} from "@/lib/services/marketplace-shopee.service";

const PAGE_SIZE = 50;
const MAX_PAGES = 200;
export const SHOPEE_IMPORT_DEFAULT_LIMIT = 100;
export const SHOPEE_IMPORT_MAX_LIMIT = 500;

type ShopeeAccount = NonNullable<Awaited<ReturnType<typeof loadShopeeAccount>>>;

/** Status mapping yang sudah kita tahu ada; `imported` = dibuat di proses ini. */
type KnownChannel = { id: string; variantId: string | null; imported?: boolean; platformProductId?: string | null; channelSku?: string };

type Descriptor = {
  channelSku: string;
  sellerSku: string | null;
  platformSkuId: string;
  stock: number;
  stockKnown: boolean;
  platformTitle: string;
  platformStatus: string | null;
};

export type ShopeeImportAccountResult = {
  accountId: string;
  label: string;
  /** Listing yang jadi MasterProduct baru. */
  importedItems: number;
  /** Varian (SKU) yang dibuat — > importedItems kalau item multi-varian. */
  importedVariants: number;
  /** SKU yang mapping-nya sudah ada → hanya di-refresh. */
  existing: number;
  /** Mapping ada tapi variantId NULL → waitlist panel orphan. */
  orphan: number;
  /** SKU bentrok (duplikat di toko yang sama) → dilewati. */
  duplicate: number;
  /** Varian baru yang stoknya 0 (belum ada angka dari Shopee). */
  zeroStock: number;
  itemsScanned: number;
  hasMore: boolean;
  error?: string;
};

function isPrismaUniqueError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    String((e as { code?: unknown }).code) === "P2002"
  );
}

function trimmed(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

export function normalizeShopeeImportLimit(limit: unknown): number {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n <= 0) return SHOPEE_IMPORT_DEFAULT_LIMIT;
  return Math.min(SHOPEE_IMPORT_MAX_LIMIT, n);
}

function normalizeName(name: string | null | undefined): string | null {
  const t = (name ?? "").trim().replace(/\s+/g, " ");
  return t || null;
}

/** Cari MasterProduct yang sudah ada dengan nama sama (case-insensitive) di business ini. */
async function findExistingMasterByName(
  tx: Prisma.TransactionClient,
  businessId: string,
  name: string | null | undefined
): Promise<string | null> {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const existing = await tx.masterProduct.findFirst({
    where: { businessId, name: { equals: normalized, mode: "insensitive" } },
    select: { id: true },
    take: 1,
  });
  return existing?.id ?? null;
}

export async function importShopeeListings(params: {
  businessId: string;
  accountIds?: string[];
  limit?: number;
}): Promise<ShopeeImportAccountResult[]> {
  const limit = normalizeShopeeImportLimit(params.limit);
  const settings = await getCachedInventorySettings(params.businessId);

  const accounts = await prisma.platformAccount.findMany({
    where: {
      platform: "SHOPEE",
      businessId: params.businessId,
      ...(params.accountIds?.length ? { id: { in: params.accountIds } } : {}),
    },
    orderBy: { label: "asc" },
  });

  const results: ShopeeImportAccountResult[] = [];

  for (const summary of accounts) {
    const stats: ShopeeImportAccountResult = {
      accountId: summary.id,
      label: summary.label,
      importedItems: 0,
      importedVariants: 0,
      existing: 0,
      orphan: 0,
      duplicate: 0,
      zeroStock: 0,
      itemsScanned: 0,
      hasMore: false,
    };
    results.push(stats);

    if (!summary.accessToken || !summary.externalShopId) {
      stats.error = "Belum OAuth — hubungkan ulang lewat Settings › Accounts.";
      continue;
    }
    const account = await loadShopeeAccount(summary.id);
    if (!account) {
      stats.error = "Akun tidak ditemukan.";
      continue;
    }

    try {
      const known = await prisma.productMapping.findMany({
        where: { accountId: account.id },
        select: { id: true, channelSku: true, variantId: true, platformProductId: true },
      });
      const byChannelSku = new Map<string, KnownChannel>(
        known.map((m) => [m.channelSku, { id: m.id, variantId: m.variantId, platformProductId: m.platformProductId }])
      );

      let offset = 0;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (stats.itemsScanned >= limit) {
          stats.hasMore = true;
          break;
        }
        const { items, hasNextPage, nextOffset } = await withRefreshedToken(account, (token, shopId, creds) =>
          getItemList(token, shopId, { offset, pageSize: PAGE_SIZE }, creds)
        );
        if (items.length === 0) break;

        const batch = items;
        const infos = await withRefreshedToken(account, (token, shopId, creds) =>
          getItemBaseInfo(token, shopId, batch.map((i) => i.item_id), creds)
        );
        for (const info of infos) {
          if (stats.itemsScanned >= limit) { stats.hasMore = true; break; }
          await importOneItem({ account, businessId: params.businessId, info, byChannelSku, threshold: settings.lowStockDefaultThreshold, stats });
          stats.itemsScanned += 1;
        }

        if (batch.length < items.length) stats.hasMore = true;
        if (!hasNextPage) break;
        if (nextOffset <= offset || page === MAX_PAGES - 1) { stats.hasMore = true; break; }
        offset = nextOffset;
      }
    } catch (e) {
      stats.error = e instanceof Error ? e.message : String(e);
    }
  }

  return results;
}

async function importOneItem(params: {
  account: ShopeeAccount;
  businessId: string;
  info: Record<string, unknown>;
  byChannelSku: Map<string, KnownChannel>;
  threshold: number;
  stats: ShopeeImportAccountResult;
}) {
  const { account, businessId, info, byChannelSku, threshold, stats } = params;
  const itemId = Number(info.item_id);
  if (!Number.isFinite(itemId) || itemId <= 0) return;

  const itemName = trimmed(info.item_name as string | undefined);
  const itemStatus = trimmed(info.item_status as string | undefined);
  // Normalisasi status Shopee: UNLISTED/BANNED/REVIEWING dianggap non-aktif
  const normalizedItemStatus = itemStatus?.toUpperCase() ?? "";
  const isShopeeInactive = normalizedItemStatus === "UNLISTED" || normalizedItemStatus === "BANNED" || normalizedItemStatus === "REVIEWING";
  
  const { models, itemSku } = await withRefreshedToken(account, (token, shopId, creds) =>
    getModelList(token, shopId, itemId, creds)
  );

  const descriptors = buildDescriptors({ itemId, itemName, itemStatus, itemSku, info, models });
  // Set platformStatus berdasarkan status Shopee asli untuk arsipkan nanti
  for (const d of descriptors) {
    d.platformStatus = isShopeeInactive ? "UNLISTED" : (d.platformStatus ?? itemStatus);
  }
  if (descriptors.length === 0) return;

  const knownRefs: KnownChannel[] = [];
  for (const d of descriptors) {
    const legacy = d.sellerSku ? byChannelSku.get(d.sellerSku) : undefined;
    const hit = byChannelSku.get(d.channelSku) ?? (legacy && (legacy.platformProductId === String(itemId) || (!legacy.platformProductId && legacy.variantId === null)) ? legacy : undefined);
    if (!hit) continue;
    byChannelSku.set(d.channelSku, hit);
    // If Shopee product is inactive (UNLISTED/BANNED/REVIEWING), archive the variant
    const isInactive = isShopeeInactive && (d.platformStatus === "UNLISTED" || d.platformStatus === "BANNED" || d.platformStatus === "REVIEWING");
    if (hit.variantId && isInactive) {
      await prisma.productVariant.update({ where: { id: hit.variantId }, data: { isArchived: true } });
    }
    if (hit.id) await prisma.productMapping.updateMany({ where: { id: hit.id, accountId: account.id },
      data: { sellerSku: d.sellerSku, platformSkuId: d.platformSkuId, platformStatus: d.platformStatus } });
    if (hit.id && d.sellerSku) await prisma.$transaction((tx) => registerSellerSku(tx, { businessId, mappingId: hit.id, sellerSku: d.sellerSku! }));
    if (hit.imported || hit.variantId) stats.existing += 1;
    else stats.orphan += 1;
    knownRefs.push({ ...hit, channelSku: d.channelSku });
  }

  // Backfill gambar ke master yang sudah ada (hanya jika imageUrl masih kosong).
  const image = itemBaseImage(info);
  if (image) {
    const imageByVariant = new Map<string, string>();
    for (const ref of knownRefs) {
      if (ref.variantId) imageByVariant.set(ref.variantId, image);
    }
    await backfillMasterImages(imageByVariant);
  }

  const pending = descriptors.filter((d) => !byChannelSku.has(d.channelSku));
  const statusRaw = JSON.stringify(info).slice(0, 8000);
  const now = new Date();

  if (pending.length === 0) {
    for (const ref of knownRefs) {
      // Ambil platformStatus dari descriptor yang sesuai (status terakhir dari import)
      const matchingDesc = descriptors.find((d) => d.channelSku === ref.channelSku);
      const platformStatus = matchingDesc?.platformStatus ?? (isShopeeInactive ? "UNLISTED" : null);
      await prisma.productMapping.updateMany({
        where: { id: ref.id },
        data: { platformProductId: String(itemId), platformStatus, platformStatusRaw: statusRaw, lastSyncedAt: now },
      });
    }
    return;
  }

  if (itemStatus?.toUpperCase() !== "NORMAL") return;

  try {
    const delta = await prisma.$transaction(async (tx) => {
      await lockSellerSkus(tx, businessId, pending.flatMap((d) => d.sellerSku ? [d.sellerSku] : []));
      let productId: string | null = null;
      let initializedCount = 0;
      let reviewCount = 0;
      for (const d of pending) {
        const resolution = d.sellerSku ? await findMasterSku(tx, businessId, d.sellerSku) : null;
        let variantId = resolution?.variantId ?? null;
        let initialized = false;
        const duplicate = d.sellerSku && descriptors.filter((item) => item.sellerSku === d.sellerSku).length > 1;
        if (!resolution?.ambiguous && !duplicate && !variantId) {
          if (!productId) {
            const existingMasterId = await findExistingMasterByName(tx, businessId, itemName ?? d.sellerSku ?? d.channelSku);
            if (existingMasterId) {
              productId = existingMasterId;
            } else {
              const product = await tx.masterProduct.create({ data: { name: itemName ?? d.sellerSku ?? d.channelSku, businessId,
                importedFrom: `SHOPEE:${account.externalShopId ?? ""}`, threshold, imageUrl: image } });
              productId = product.id;
            }
          }
          const variant = await tx.productVariant.create({ data: { masterProductId: productId, sku: d.sellerSku ?? d.channelSku,
            name: pending.length > 1 ? d.sellerSku ?? d.channelSku : null, stock: d.stock } });
          variantId = variant.id;
          initialized = true;
          initializedCount++;
          if (d.sellerSku) await tx.masterSkuKey.upsert({ where: { businessId_sellerSku: { businessId, sellerSku: d.sellerSku } },
            create: { businessId, sellerSku: d.sellerSku, variantId }, update: { variantId } });
        }
        if (duplicate) variantId = null;
        const mapping = await tx.productMapping.create({
          data: {
            id: crypto.randomUUID(),
            accountId: account.id,
            channelSku: d.channelSku,
            sellerSku: d.sellerSku,
            platformSkuId: d.platformSkuId,
            variantId,
            platformProductId: String(itemId),
            platformTitle: d.platformTitle,
            platformStatus: d.platformStatus,
            platformStatusRaw: statusRaw,
            // Hanya diisi kalau Shopee benar-benar melaporkan stok — kalau
            // tidak, dibiarkan null supaya tidak terlihat sebagai "0 di Shopee".
            ...(d.stockKnown ? { platformStock: d.stock } : {}),
            lastSyncedAt: now,
            updatedAt: now,
          },
        });
        if (!variantId) {
          reviewCount++;
          await queueSkuReview(tx, { businessId, mappingId: mapping.id, sellerSku: d.sellerSku ?? d.channelSku,
            candidateIds: resolution?.candidates ?? [], reason: duplicate ? "SKU seller ganda pada varian listing yang sama." : "Beberapa SKU master memiliki SKU seller yang sama." });
          continue;
        }
        // If Shopee product is inactive, mark the variant as archived
        if (isShopeeInactive && (d.platformStatus === "UNLISTED" || d.platformStatus === "BANNED" || d.platformStatus === "REVIEWING")) {
          await tx.productVariant.update({ where: { id: variantId }, data: { isArchived: true } });
        }
        if (initialized) await tx.stockLedger.create({
          data: {
            id: crypto.randomUUID(),
            variantId,
            changeQty: d.stock,
            reason: STOCK_REASONS.INIT,
            note: `Stok awal import listing Shopee #${itemId}.`,
            stockAfter: d.stock,
          },
        });
      }
      return { items: productId ? 1 : 0, variants: initializedCount, reviews: reviewCount };
    });
    stats.importedItems += delta.items;
    stats.importedVariants += delta.variants;
    stats.orphan += delta.reviews;
    stats.existing += pending.length - delta.variants - delta.reviews;
  } catch (e) {
    // SKU bentrok dengan listing lain di toko yang sama → jangan dipaksa,
    // biarkan panel orphan yang memutuskan penempatannya.
    if (!isPrismaUniqueError(e)) throw e;
    stats.duplicate += pending.length;
    return;
  }

  for (const d of pending) {
    byChannelSku.set(d.channelSku, { id: "", variantId: null, imported: true });
  }
  stats.zeroStock += pending.filter((d) => d.stock === 0).length;
}

function buildDescriptors(params: {
  itemId: number;
  itemName: string | null;
  itemStatus: string | null;
  itemSku: string | undefined;
  info: Record<string, unknown>;
  models: Array<{ model_id: number; model_sku?: string; model_status?: string }>;
}): Descriptor[] {
  const { itemId, itemName, itemStatus, itemSku, info, models } = params;
  // Filter out models with inactive status (SKU_NOT_FOUND, etc.)
  const activeModels = models.filter((m) => {
    const modelStatus = (m.model_status ?? "").toUpperCase();
    // Model dengan status kosong atau NORMAL dianggap aktif
    // Status lain (contoh: EXPIRED, DRAFT) dianggap non-aktif dan diabaikan
    return !modelStatus || modelStatus === "NORMAL";
  });
  if (models.length > 0 && activeModels.length === 0) return [];
  const realModels = activeModels.filter((m) => Number(m.model_id) !== 0);
  const out: Descriptor[] = [];

  const add = (sku: string, stockRaw: unknown, status: string | null, modelId?: number) => {
    const channelSku = `${itemId}:${modelId ?? 0}`;
    const stock = readStockInfo(stockRaw);
    out.push({
      channelSku,
      sellerSku: sku === `${itemId}:${modelId ?? 0}` ? null : sku,
      platformSkuId: String(modelId ?? 0),
      stock: stock ?? 0,
      stockKnown: stock !== null,
      platformTitle: itemName ? (out.length > 0 ? `${itemName} (${channelSku})` : itemName) : channelSku,
      platformStatus: trimmed(status) ?? itemStatus,
    });
  };

  if (realModels.length > 0) {
    for (const m of realModels) {
      add(trimmed(m.model_sku) ?? `${itemId}:${m.model_id}`, m, m.model_status ?? null, m.model_id);
    }
    return out;
  }

  // Single-variant: seller SKU-level didahulukan supaya match dengan isi order.
  const sole = activeModels[0];
  const sku = trimmed(sole?.model_sku) ?? trimmed(itemSku) ?? trimmed(info.item_sku as string | undefined);
  add(sku ?? `${itemId}:0`, sole ?? info, null);
  return out;
}
