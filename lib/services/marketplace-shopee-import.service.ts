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
 *  - channel SKU disimpan apa adanya yang dilihat seller (model_sku / item_sku)
 *    supaya item order dari Shopee langsung match. SKU kosong → fallback
 *    `itemId:modelId` (format yang dipahami resolveModel()).
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
import { prisma } from "@/lib/db/prisma";
import { getItemBaseInfo, getItemList, getModelList, itemBaseImage, readStockInfo } from "@/lib/integrations/shopee";
import { STOCK_REASONS } from "@/lib/services/central-stock.service";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";
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
type KnownChannel = { id: string; variantId: string | null; imported?: boolean };

type Descriptor = {
  channelSku: string;
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
        select: { id: true, channelSku: true, variantId: true },
      });
      const byChannelSku = new Map<string, KnownChannel>(
        known.map((m) => [m.channelSku, { id: m.id, variantId: m.variantId }])
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

        const batch = items.slice(0, limit - stats.itemsScanned);
        const infos = await withRefreshedToken(account, (token, shopId, creds) =>
          getItemBaseInfo(token, shopId, batch.map((i) => i.item_id), creds)
        );
        for (const info of infos) {
          await importOneItem({ account, businessId: params.businessId, info, byChannelSku, threshold: settings.lowStockDefaultThreshold, stats });
          stats.itemsScanned += 1;
        }

        if (batch.length < items.length) stats.hasMore = true;
        if (!hasNextPage || nextOffset <= offset) break;
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
  const { models, itemSku } = await withRefreshedToken(account, (token, shopId, creds) =>
    getModelList(token, shopId, itemId, creds)
  );

  const descriptors = buildDescriptors({ itemId, itemName, itemStatus, itemSku, info, models });
  if (descriptors.length === 0) return;

  const knownRefs: KnownChannel[] = [];
  for (const d of descriptors) {
    const hit = byChannelSku.get(d.channelSku);
    if (!hit) continue;
    if (hit.imported || hit.variantId) stats.existing += 1;
    else stats.orphan += 1;
    knownRefs.push(hit);
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
      await prisma.productMapping.updateMany({
        where: { id: ref.id },
        data: { platformProductId: String(itemId), platformStatusRaw: statusRaw, lastSyncedAt: now },
      });
    }
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const product = await tx.masterProduct.create({
        data: {
          name: itemName ?? pending[0].channelSku,
          businessId,
          importedFrom: `SHOPEE:${account.externalShopId ?? ""}`,
          threshold,
          imageUrl: image,
          ...(image
            ? {
                productImage: {
                  create: [{ id: crypto.randomUUID(), url: image, isCover: true, order: 0 }],
                },
              }
            : {}),
          productVariant: {
            create: pending.map((d) => ({
              sku: d.channelSku,
              name: pending.length > 1 ? d.channelSku : null,
              stock: d.stock,
            })),
          },
        },
        select: { productVariant: { select: { id: true, sku: true } } },
      });
      const variantIdBySku = new Map(product.productVariant.map((v) => [v.sku, v.id]));
      for (const d of pending) {
        const variantId = variantIdBySku.get(d.channelSku);
        if (!variantId) continue;
        await tx.productMapping.create({
          data: {
            id: crypto.randomUUID(),
            accountId: account.id,
            channelSku: d.channelSku,
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
        await tx.stockLedger.create({
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
    });
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
  stats.importedItems += 1;
  stats.importedVariants += pending.length;
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
  const realModels = models.filter((m) => Number(m.model_id) !== 0);
  const out: Descriptor[] = [];
  const used = new Set<string>();

  const add = (sku: string, stockRaw: unknown, status: string | null, modelId?: number) => {
    // Dua model dengan SKU identik dalam satu item → pakai bentuk
    // itemId:model_id (BUKAN index urutan) supaya resolveModel() & push stok
    // mengenai model yang benar.
    const channelSku = used.has(sku) ? `${itemId}:${modelId ?? out.length}` : sku;
    used.add(channelSku);
    const stock = readStockInfo(stockRaw);
    out.push({
      channelSku,
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
  const sole = models[0];
  const sku = trimmed(sole?.model_sku) ?? trimmed(itemSku) ?? trimmed(info.item_sku as string | undefined);
  add(sku ?? `${itemId}:0`, sole ?? info, null);
  return out;
}
