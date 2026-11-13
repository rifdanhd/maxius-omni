import { prisma } from "@/lib/db/prisma";
import { getProduct } from "@/lib/integrations/tiktokShop";
import { registerSellerSku } from "@/lib/services/master-sku.service";
import { withRefreshedTiktokToken } from "@/lib/services/tiktok-token.service";

/**
 * Backfill ProductMapping.sellerSku untuk listing TikTok yang masih NULL.
 *
 * Penyebab umum kosong:
 *  - mapping dibuat manual dari panel "Belum Terhubung" (hanya SKU channel /
 *    sku_id yang diketahui),
 *  - mapping lama dibuat sebelum kolom sellerSku diisi sync,
 *  - payload hasil search TikTok tidak menyertakan `skus` (bug lama menulis
 *    null dan menghapus SKU penjual yang sudah ada — sudah diperbaiki).
 *
 * Tahap 1 (default): baca `platformStatusRaw` yang sudah tersimpan — tidak ada
 * panggilan API. Tahap 2 (`remote`): panggil getProduct untuk SKU yang masih
 * tidak terbaca. Hanya baris sellerSku NULL yang disentuh.
 */

export interface SellerSkuBackfillOptions {
  /** Maksimal mapping diproses per bisnis. Default: semua. */
  limit?: number;
  /** Tarik produk dari API TikTok bila payload lokal tidak memuat seller_sku. */
  remote?: boolean;
  /** Hitung saja, tidak menulis. */
  dryRun?: boolean;
}

export interface SellerSkuBackfillReport {
  scanned: number;
  filledFromPayload: number;
  filledFromRemote: number;
  failed: number;
  remaining: number;
  errors: string[];
}

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";

function skuRows(payload: unknown): Json[] {
  const root = asRecord(payload);
  if (!root) return [];
  const data = asRecord(root.data);
  for (const list of [root.skus, data?.skus]) {
    if (Array.isArray(list)) return list.map(asRecord).filter((row): row is Json => row !== null);
  }
  return [];
}

const skuIdOf = (sku: Json) => text(sku.id) || text(sku.sku_id);
const sellerSkuOf = (sku: Json) => text(sku.seller_sku) || text(sku.sellerSku) || "";

/**
 * Ambil seller_sku dari payload produk TikTok. Prioritas: platformSkuId
 * (sku.id hasil sync), lalu kesamaan dengan channelSku (sku.id / seller_sku),
 * terakhir produk dengan satu SKU saja.
 */
export function sellerSkuFromPayload(
  payload: unknown,
  channelSku: string,
  platformSkuId: string | null
): string | null {
  const skus = skuRows(payload);
  if (skus.length === 0) return null;

  if (platformSkuId) {
    const hit = skus.find((sku) => skuIdOf(sku) === platformSkuId);
    if (hit && sellerSkuOf(hit)) return sellerSkuOf(hit);
  }

  const byChannel = skus.find(
    (sku) => skuIdOf(sku) === channelSku || sellerSkuOf(sku) === channelSku
  );
  if (byChannel && sellerSkuOf(byChannel)) return sellerSkuOf(byChannel);

  if (skus.length === 1 && sellerSkuOf(skus[0])) return sellerSkuOf(skus[0]);
  return null;
}

function parseRaw(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type MissingMapping = {
  id: string;
  channelSku: string;
  platformSkuId: string | null;
  platformProductId: string | null;
  platformStatusRaw: string | null;
  variantId: string | null;
  account: {
    id: string;
    label: string;
    accessToken: string | null;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
    shopCipher: string | null;
  };
};

export async function backfillSellerSkus(
  businessId: string,
  options: SellerSkuBackfillOptions = {}
): Promise<SellerSkuBackfillReport> {
  const where = {
    sellerSku: null,
    account: { businessId, platform: "TIKTOK_SHOP" as const },
  };
  const select = {
    id: true,
    channelSku: true,
    platformSkuId: true,
    platformProductId: true,
    platformStatusRaw: true,
    variantId: true,
    account: {
      select: {
        id: true,
        label: true,
        accessToken: true,
        refreshToken: true,
        tokenExpiresAt: true,
        shopCipher: true,
      },
    },
  } as const;

  const missing = (await prisma.productMapping.findMany({
    where,
    select,
    ...(options.limit ? { take: Math.max(1, options.limit) } : {}),
    orderBy: { updatedAt: "desc" },
  })) as MissingMapping[];

  const report: SellerSkuBackfillReport = {
    scanned: missing.length,
    filledFromPayload: 0,
    filledFromRemote: 0,
    failed: 0,
    remaining: 0,
    errors: [],
  };

  const save = async (mapping: MissingMapping, sellerSku: string) => {
    if (options.dryRun) return;
    await prisma.$transaction(async (tx) => {
      await tx.productMapping.updateMany({
        where: { id: mapping.id, sellerSku: null },
        data: { sellerSku },
      });
      // Hanya mapping yang sudah punya varian: registerSellerSku membuat
      // antrean tinjauan untuk SKU tanpa acuan stok, dan baris-baris itu sudah
      // masuk antrean lewat jalur lain.
      if (mapping.variantId) {
        await registerSellerSku(tx, { businessId, mappingId: mapping.id, sellerSku });
      }
    });
  };

  for (const mapping of missing) {
    const local = sellerSkuFromPayload(
      parseRaw(mapping.platformStatusRaw),
      mapping.channelSku,
      mapping.platformSkuId
    );
    if (local) {
      await save(mapping, local);
      report.filledFromPayload += 1;
      continue;
    }

    if (!options.remote) continue;
    if (options.dryRun) {
      report.filledFromRemote += 1;
      continue;
    }
    if (!mapping.account.accessToken) {
      report.errors.push(`TikTok ${mapping.channelSku}: akun belum punya access token`);
      report.failed += 1;
      continue;
    }

    try {
      const product = await withRefreshedTiktokToken(mapping.account, (token, creds) =>
        getProduct(token, mapping.channelSku, mapping.account.shopCipher ?? undefined, creds)
      );
      const remote = product
        ? sellerSkuFromPayload(product, mapping.channelSku, mapping.platformSkuId)
        : null;
      if (remote) {
        await save(mapping, remote);
        report.filledFromRemote += 1;
      }
    } catch (error) {
      report.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      if (report.errors.length < 20) report.errors.push(`TikTok ${mapping.channelSku}: ${message}`);
    }
  }

  report.remaining = await prisma.productMapping.count({ where });
  return report;
}
