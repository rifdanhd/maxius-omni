import { prisma } from "@/lib/db/prisma";
import { syncShopeeListings } from "@/lib/services/marketplace-shopee.service";
import { syncTikTokMapping } from "@/lib/services/marketplace-tiktok.service";

/**
 * Backfill ProductMapping.imageUrl — mengisi foto listing yang masih kosong
 * supaya thumbnail varian punya sumber gambar.
 *
 * Dua tahap; keduanya hanya menyentuh baris yang imageUrl-nya masih NULL:
 * 1. Lokal: pakai OrderItem.imageUrl untuk (accountId, channelSku) yang sama —
 *    foto marketplace sudah tersimpan saat order di-sync, tanpa panggilan API.
 * 2. Marketplace: tarik ulang listing lewat sync yang sudah ada
 *    (Shopee per produk, TikTok per mapping) untuk SKU yang belum punya foto.
 *
 * Gambar yang sudah terisi tidak diubah oleh skrip ini.
 */

export type MappingImageBackfillPlatform = "SHOPEE" | "TIKTOK_SHOP";

export interface MappingImageBackfillOptions {
  platform?: MappingImageBackfillPlatform;
  /** Maksimal listing yang ditarik dari API marketplace per bisnis. Default 300. */
  limit?: number;
  /** Hanya tahap lokal (tanpa panggilan API). */
  localOnly?: boolean;
  /** Hitung saja, tidak menulis dan tidak memanggil API. */
  dryRun?: boolean;
}

export interface MappingImageBackfillReport {
  scanned: number;
  filledFromOrders: number;
  filledFromShopee: number;
  filledFromTiktok: number;
  failed: number;
  remaining: number;
  platformFetches: number;
  errors: string[];
}

type MissingMapping = {
  id: string;
  accountId: string;
  channelSku: string;
  platformProductId: string | null;
  account: { platform: string };
};

const DEFAULT_LIMIT = 300;

/** Shopee menyimpan channelSku sebagai `itemId:modelId`; product id dipakai sync. */
const shopeeProductId = (mapping: MissingMapping) => {
  const fromProduct = mapping.platformProductId?.trim();
  if (fromProduct && /^\d+$/.test(fromProduct)) return fromProduct;
  const fromChannel = mapping.channelSku.split(":")[0]?.trim();
  return fromChannel && /^\d+$/.test(fromChannel) ? fromChannel : null;
};

/** Foto listing dari riwayat order, per (akun, channelSku); tanpa query N+1. */
async function loadOrderImages(channelSkus: string[]) {
  const images = new Map<string, string>();
  for (let index = 0; index < channelSkus.length; index += 500) {
    const rows = await prisma.orderItem.findMany({
      where: { channelSku: { in: channelSkus.slice(index, index + 500) }, imageUrl: { not: null } },
      select: { channelSku: true, imageUrl: true, order: { select: { accountId: true } } },
      orderBy: { order: { createTime: "desc" } },
    });
    for (const row of rows) {
      if (!row.imageUrl) continue;
      const key = `${row.order.accountId}|${row.channelSku}`;
      if (!images.has(key)) images.set(key, row.imageUrl);
    }
  }
  return images;
}

export async function backfillMappingImages(
  businessId: string,
  options: MappingImageBackfillOptions = {}
): Promise<MappingImageBackfillReport> {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const baseWhere = {
    account: { businessId, ...(options.platform ? { platform: options.platform } : {}) },
  };
  const select = {
    id: true,
    accountId: true,
    channelSku: true,
    platformProductId: true,
    account: { select: { platform: true } },
  } as const;

  const missing = await prisma.productMapping.findMany({ where: { ...baseWhere, imageUrl: null }, select });
  const report: MappingImageBackfillReport = {
    scanned: missing.length,
    filledFromOrders: 0,
    filledFromShopee: 0,
    filledFromTiktok: 0,
    failed: 0,
    remaining: missing.length,
    platformFetches: 0,
    errors: [],
  };
  if (missing.length === 0) return report;

  // ---------- Tahap 1: foto listing dari riwayat order (tanpa API) ----------
  const orderImages = await loadOrderImages([...new Set(missing.map((mapping) => mapping.channelSku))]);
  const key = (mapping: MissingMapping) => `${mapping.accountId}|${mapping.channelSku}`;
  const fromOrders = missing.filter((mapping) => orderImages.has(key(mapping)));
  if (!options.dryRun && fromOrders.length > 0) {
    await prisma.$transaction(
      fromOrders.map((mapping) =>
        prisma.productMapping.updateMany({
          where: { id: mapping.id, imageUrl: null },
          data: { imageUrl: orderImages.get(key(mapping))! },
        })
      )
    );
  }
  report.filledFromOrders = fromOrders.length;

  // ---------- Tahap 2: tarik dari marketplace untuk yang masih kosong ----------
  const stillMissing = options.dryRun
    ? missing.filter((mapping) => !orderImages.has(key(mapping)))
    : await prisma.productMapping.findMany({ where: { ...baseWhere, imageUrl: null }, select });

  if (!options.localOnly && !options.dryRun && stillMissing.length > 0) {
    const targets = stillMissing.slice(0, limit);
    const shopeeByAccount = new Map<string, Set<string>>();
    const tiktokTargets: MissingMapping[] = [];
    for (const mapping of targets) {
      if (mapping.account.platform === "SHOPEE") {
        const productId = shopeeProductId(mapping);
        if (!productId) continue;
        const productIds = shopeeByAccount.get(mapping.accountId) ?? new Set<string>();
        productIds.add(productId);
        shopeeByAccount.set(mapping.accountId, productIds);
      } else if (mapping.account.platform === "TIKTOK_SHOP") {
        tiktokTargets.push(mapping);
      }
    }

    for (const [accountId, productIds] of shopeeByAccount) {
      try {
        const ids = [...productIds];
        // Sync Shopee menulis ulang imageUrl semua mapping produk tsb; simpan
        // gambar yang sudah ada supaya backfill tidak mengubah data lama.
        const preserved = await prisma.productMapping.findMany({
          where: {
            accountId,
            imageUrl: { not: null },
            OR: [{ platformProductId: { in: ids } }, ...ids.map((id) => ({ channelSku: { startsWith: `${id}:` } }))],
          },
          select: { id: true, imageUrl: true },
        });
        const results = await syncShopeeListings(businessId, accountId, {
          products: ids.map((productId) => ({ accountId, productId })),
        });
        if (preserved.length > 0) {
          const saved = new Map(preserved.map((row) => [row.id, row.imageUrl!]));
          const current = await prisma.productMapping.findMany({
            where: { id: { in: preserved.map((row) => row.id) } },
            select: { id: true, imageUrl: true },
          });
          const affected = current.filter((row) => row.imageUrl !== saved.get(row.id));
          if (affected.length > 0) {
            await prisma.$transaction(
              affected.map((row) => prisma.productMapping.update({ where: { id: row.id }, data: { imageUrl: saved.get(row.id) ?? null } }))
            );
          }
        }
        const error = results.find((result) => result.error)?.error;
        if (error) {
          report.failed += 1;
          report.errors.push(`Shopee ${accountId}: ${error}`);
        }
        report.platformFetches += productIds.size;
      } catch (error) {
        report.failed += 1;
        report.errors.push(`Shopee ${accountId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const mapping of tiktokTargets) {
      try {
        const result = await syncTikTokMapping(mapping.id, businessId);
        if (!result.ok) {
          report.failed += 1;
          if (result.reason) report.errors.push(`TikTok ${mapping.channelSku}: ${result.reason}`);
        }
        report.platformFetches += 1;
      } catch (error) {
        report.failed += 1;
        report.errors.push(`TikTok ${mapping.channelSku}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const filled = await prisma.productMapping.findMany({
      where: { id: { in: targets.map((mapping) => mapping.id) }, imageUrl: { not: null } },
      select: { account: { select: { platform: true } } },
    });
    report.filledFromShopee = filled.filter((row) => row.account.platform === "SHOPEE").length;
    report.filledFromTiktok = filled.filter((row) => row.account.platform === "TIKTOK_SHOP").length;
  }

  report.remaining = options.dryRun
    ? stillMissing.length
    : await prisma.productMapping.count({ where: { ...baseWhere, imageUrl: null } });
  return report;
}
