import { prisma } from "@/lib/db/prisma";
import { logStockPush } from "@/lib/services/sync-log.util";
import { applyMarketplaceCover } from "@/lib/services/gallery.service";
import type { SyncPushItemResult } from "@/lib/services/sync.service";
import {
  assertAccountActive,
  resolveShopeeCreds,
} from "@/lib/services/app-credential.service";
import {
  ShopeeApiError,
  getItemBaseInfo,
  getItemList,
  getModelList,
  itemBaseImage,
  readStockInfo,
  refreshAccessToken,
  updatePrice as apiUpdatePrice,
  updateStockBatch as apiUpdateStockBatch,
  type ShopeeCreds,
} from "@/lib/integrations/shopee";

export const SHOPEE_ADAPTER_ERROR = "Shopee adapter belum diimplementasikan";

type PushParams = {
  accountId: string;
  accountLabel: string;
  channelSku: string;
  newStock: number;
};

export async function loadShopeeAccount(accountId: string) {
  return prisma.platformAccount.findUnique({
    where: { id: accountId },
    include: { appCredential: true },
  });
}

function credsOf(account: NonNullable<Awaited<ReturnType<typeof loadShopeeAccount>>>): ShopeeCreds {
  return resolveShopeeCreds(account.appCredential);
}

/** Dipakai juga oleh marketplace-shopee-import.service (pull listing → master). */
export async function withRefreshedToken<T>(
  account: NonNullable<Awaited<ReturnType<typeof loadShopeeAccount>>>,
  fn: (accessToken: string, shopId: string, creds: ShopeeCreds) => Promise<T>
): Promise<T> {
  assertAccountActive(account);
  const creds = credsOf(account);
  const shopId = account.externalShopId;
  if (!account.accessToken || !shopId) {
    throw new Error(
      `"${account.label}" belum punya access token / shop_id — hubungkan ulang via OAuth Shopee.`
    );
  }
  try {
    return await fn(account.accessToken, shopId, creds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const authLike = /error_auth|auth|token|expired|invalid/i.test(msg);
    if (!authLike || !account.refreshToken) throw e;
    const r = await refreshAccessToken(account.refreshToken, shopId, creds);
    await prisma.platformAccount.update({
      where: { id: account.id },
      data: {
        accessToken: r.accessToken,
        refreshToken: r.refreshToken,
        tokenExpiresAt: new Date(Date.now() + r.expireIn * 1000),
      },
    });
    return fn(r.accessToken, shopId, creds);
  }
}

export async function pushStockToShopee(params: PushParams): Promise<SyncPushItemResult> {
  const done = (
    success: boolean,
    skipped: boolean,
    error?: string
  ): SyncPushItemResult => ({
    accountId: params.accountId,
    channelSku: params.channelSku,
    success,
    skipped,
    ...(error ? { error } : {}),
  });
  const account = await loadShopeeAccount(params.accountId);
  if (!account || account.platform !== "SHOPEE") {
    const error = `Akun ${params.accountId} bukan akun Shopee.`;
    await logStockPush(params.accountId, params.channelSku, params.newStock, "skipped", error, error);
    return done(false, true, error);
  }
  if (!account.accessToken || !account.externalShopId) {
    const error =
      `"${account.label}" belum terhubung OAuth Shopee (token/shop_id kosong). ` +
      `Buka Tambahkan Marketplace → Shopee untuk menghubungkan toko.`;
    await logStockPush(account.id, params.channelSku, params.newStock, "skipped", error, error);
    return done(false, true, error);
  }
  try {
    const r = await withRefreshedToken(account, (token, shopId, creds) =>
      apiUpdateStockBatch(token, shopId, [
        { channelSku: params.channelSku, quantity: params.newStock },
      ], creds)
    );
    const failed = r.failed[0];
    if (failed) {
      const msg = failed.error instanceof Error ? failed.error.message : String(failed.error);
      await logStockPush(account.id, params.channelSku, params.newStock, "error",
        `SKU "${params.channelSku}" (${account.label}).`, msg);
      return done(false, false, msg);
    }
    await logStockPush(account.id, params.channelSku, params.newStock, "success",
      `Stok ${params.newStock} → SKU "${params.channelSku}" (${account.label}).`);
    return done(true, false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const authLike = err instanceof ShopeeApiError && /error_auth/i.test(err.error);
    await logStockPush(account.id, params.channelSku, params.newStock,
      authLike ? "skipped" : "error",
      `SKU "${params.channelSku}" (${account.label}).`, msg);
    return done(false, authLike, msg);
  }
}

export async function pushPriceToShopee(params: {
  accountId: string;
  accountLabel: string;
  channelSku: string;
  price: number;
}): Promise<void> {
  const message = (status: string, msg: string, err?: string) =>
    prisma.syncLog.create({
      data: {
        direction: "out",
        kind: "price_push",
        status,
        message: msg,
        errorMessage: err,
        payload: JSON.stringify({ channelSku: params.channelSku, price: params.price }),
        accountId: params.accountId,
      },
    }).catch((e) => console.warn("[Shopee] gagal menulis SyncLog (price):", e));
  const account = await loadShopeeAccount(params.accountId);
  if (!account || account.platform !== "SHOPEE") {
    await message("skipped", `Akun ${params.accountId} bukan akun Shopee.`);
    return;
  }
  if (!account.accessToken || !account.externalShopId) {
    await message("skipped", `"${account.label}" belum terhubung OAuth Shopee.`);
    return;
  }
  try {
    await withRefreshedToken(account, (token, shopId, creds) =>
      apiUpdatePrice(token, shopId, params.channelSku, params.price, creds)
    );
    await message("success", `Harga ${params.price} → SKU "${params.channelSku}" (${account.label}).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await message("error", `SKU "${params.channelSku}" (${account.label}).`, msg);
  }
}

export async function getShopeeAccounts(businessId: string) {
  return prisma.platformAccount.findMany({
    where: { platform: "SHOPEE", businessId },
    select: { id: true, label: true, externalShopId: true, updatedAt: true },
    orderBy: { label: "asc" },
  });
}

export type ShopeeListingRow = {
  key: string;
  accountId: string;
  accountLabel: string;
  variantId: string | null;
  platformProductId: string | null;
  platformTitle: string | null;
  status: string | null;
  channelSku: string | null;
  variantCount: number;
  stockTotal: number;
  imageUrl: string | null;
  lastSyncedAt: Date | null;
};

export async function listShopeeProducts(opts: {
  businessId: string;
  search?: string;
  accountIds?: string[];
  page?: number;
  pageSize?: number;
}): Promise<{ rows: ShopeeListingRow[]; total: number; page: number; pageSize: number }> {
  const { businessId, search, accountIds, page = 1, pageSize = 20 } = opts;
  const where: Record<string, unknown> = {
    account: {
      platform: "SHOPEE",
      businessId,
      ...(accountIds?.length ? { id: { in: accountIds } } : {}),
    },
    ...(search
      ? { OR: [{ channelSku: { contains: search } }, { platformTitle: { contains: search } }] }
      : {}),
  };
  const mappings = await prisma.productMapping.findMany({
    where: where as never,
    include: {
      account: { select: { id: true, label: true } },
      variant: { select: { id: true, stock: true, masterProduct: { select: { imageUrl: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Kelompokkan per (akun, item) — 1 produk Shopee bisa punya banyak
  // model/SKU; tampilkan 1 baris per produk (konsisten dengan Seller Center
  // & halaman TikTok), stok = akumulasi semua varian.
  type Group = {
    key: string;
    accountId: string;
    accountLabel: string;
    variantId: string | null;
    allMapped: boolean;
    platformProductId: string | null;
    platformTitle: string | null;
    status: string | null;
    channelSkus: string[];
    stockTotal: number;
    imageUrl: string | null;
    lastSyncedAt: Date | null;
  };
  const groups = new Map<string, Group>();
  for (const m of mappings) {
    const gk = `${m.account.id}|${m.platformProductId ?? m.channelSku}`;
    const stock = m.platformStock ?? m.variant?.stock ?? 0;
    const g = groups.get(gk);
    if (!g) {
      groups.set(gk, {
        key: gk,
        accountId: m.account.id,
        accountLabel: m.account.label,
        variantId: m.variantId,
        allMapped: m.variantId != null,
        platformProductId: m.platformProductId,
        platformTitle: m.platformTitle,
        status: m.platformStatus,
        channelSkus: [m.channelSku],
        stockTotal: stock,
        imageUrl: m.variant?.masterProduct?.imageUrl ?? null,
        lastSyncedAt: m.lastSyncedAt,
      });
      continue;
    }
    if (!g.imageUrl && m.variant?.masterProduct?.imageUrl) g.imageUrl = m.variant.masterProduct.imageUrl;
    if (!g.platformTitle && m.platformTitle) g.platformTitle = m.platformTitle;
    if (!g.status && m.platformStatus) g.status = m.platformStatus;
    if (m.variantId == null) g.allMapped = false;
    else if (!g.variantId) g.variantId = m.variantId;
    if (!g.channelSkus.includes(m.channelSku)) g.channelSkus.push(m.channelSku);
    g.stockTotal += stock;
    if (m.lastSyncedAt && (!g.lastSyncedAt || m.lastSyncedAt > g.lastSyncedAt)) {
      g.lastSyncedAt = m.lastSyncedAt;
    }
  }

  const all = [...groups.values()];
  const rows: ShopeeListingRow[] = all
    .slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
    .map((g) => ({
      key: g.key,
      accountId: g.accountId,
      accountLabel: g.accountLabel,
      variantId: g.allMapped ? g.variantId : null,
      platformProductId: g.platformProductId,
      platformTitle: g.platformTitle,
      status: g.status,
      channelSku: g.channelSkus.length === 1 ? g.channelSkus[0] : null,
      variantCount: g.channelSkus.length,
      stockTotal: g.stockTotal,
      imageUrl: g.imageUrl,
      lastSyncedAt: g.lastSyncedAt,
    }));
  return { rows, total: all.length, page, pageSize };
}

/**
 * backfillMasterImages — tulis gambar listing ke MasterProduct.imageUrl +
 * baris ProductImage (cover) HANYA untuk produk yang masih kosong
 * (tidak menimpa pilihan manual di Kelola Gambar). Dipakai import & sync
 * listing Shopee.
 */
export async function backfillMasterImages(imageByVariant: Map<string, string>): Promise<void> {
  if (imageByVariant.size === 0) return;
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: [...imageByVariant.keys()] } },
    select: { id: true, masterProductId: true },
  });
  const done = new Set<string>();
  for (const v of variants) {
    const image = imageByVariant.get(v.id);
    if (!image || done.has(v.masterProductId)) continue;
    done.add(v.masterProductId);
    await applyMarketplaceCover(v.masterProductId, image);
  }
}

export async function syncShopeeListings(businessId: string): Promise<
  Array<{ accountId: string; label: string; items: number; models: number; matched: number; error?: string }>
> {
  const accounts = await prisma.platformAccount.findMany({
    where: { platform: "SHOPEE", businessId },
    include: { appCredential: true },
  });
  const results: Array<{ accountId: string; label: string; items: number; models: number; matched: number; error?: string }> = [];
  for (const account of accounts) {
    if (!account.accessToken || !account.externalShopId) {
      results.push({ accountId: account.id, label: account.label, items: 0, models: 0, matched: 0, error: "Belum OAuth." });
      continue;
    }
    try {
      const existing = await prisma.productMapping.findMany({
        where: { accountId: account.id },
        select: { id: true, channelSku: true, variantId: true },
      });
      const byChannelSku = new Map(existing.map((m) => [m.channelSku, m.id]));
      const variantByChannelSku = new Map(
        existing.filter((m) => m.variantId != null).map((m) => [m.channelSku, m.variantId as string])
      );
      const imageByVariant = new Map<string, string>();
      let offset = 0;
      let itemCount = 0;
      let modelCount = 0;
      let matched = 0;
      for (let page = 0; page < 200; page++) {
        const { items, hasNextPage, nextOffset } = await withRefreshedToken(account, (token, shopId, creds) =>
          getItemList(token, shopId, { offset, pageSize: 50 }, creds)
        );
        if (items.length === 0) break;
        itemCount += items.length;
        const infos = await withRefreshedToken(account, (token, shopId, creds) =>
          getItemBaseInfo(token, shopId, items.map((i) => i.item_id), creds)
        );
        for (const info of infos) {
          const itemId = Number(info.item_id);
          const title = (info.item_name as string | undefined) ?? null;
          const status = (info.item_status as string | undefined) ?? null;
          const itemSku = info.item_sku as string | undefined;
          const { models } = await withRefreshedToken(account, (token, shopId, creds) =>
            getModelList(token, shopId, itemId, creds)
          );
          modelCount += models.length;
          const image = itemBaseImage(info);
          if (image) {
            const imageCandidates =
              models.length === 0
                ? [`${itemId}:0`, itemSku]
                : models.flatMap((mm) => [`${itemId}:${mm.model_id}`, mm.model_sku]);
            for (const c of imageCandidates) {
              if (!c) continue;
              const vid = variantByChannelSku.get(c) ?? variantByChannelSku.get(`${itemId}:${c}`);
              if (vid && !imageByVariant.has(vid)) imageByVariant.set(vid, image);
            }
          }
          const touch = async (
            candidates: Array<string | undefined>,
            extraTitle: string | null,
            extraStatus: string | null,
            stock?: number | null
          ) => {
            for (const c of candidates) {
              if (!c) continue;
              const id = byChannelSku.get(c) ?? byChannelSku.get(`${itemId}:${c}`);
              if (!id) continue;
              await prisma.productMapping.update({
                where: { id },
                data: {
                  platformProductId: String(itemId),
                  platformTitle: extraTitle,
                  platformStatus: extraStatus,
                  platformStatusRaw: JSON.stringify(info).slice(0, 8000),
                  // Refresh snapshot stok Shopee (tampilan "Stok" di halaman
                  // Produk) — parser stock_info_v2; null = tak diketahui →
                  // biarkan, JANGAN menulis 0.
                  ...(stock != null ? { platformStock: stock } : {}),
                  lastSyncedAt: new Date(),
                },
              });
              matched++;
              return true;
            }
            return false;
          };
          if (models.length === 0) {
            await touch([`${itemId}:0`, itemSku], title, status, readStockInfo(info));
          } else {
            for (const m of models) {
              await touch(
                [`${itemId}:${m.model_id}`, m.model_sku],
                title ? `${title} (${m.model_sku ?? m.model_id})` : (m.model_sku ?? null),
                m.model_status ?? status,
                readStockInfo(m)
              );
            }
          }
        }
        if (!hasNextPage || nextOffset <= offset) break;
        offset = nextOffset;
      }
      await backfillMasterImages(imageByVariant);
      results.push({ accountId: account.id, label: account.label, items: itemCount, models: modelCount, matched });
    } catch (e) {
      results.push({
        accountId: account.id,
        label: account.label,
        items: 0,
        models: 0,
        matched: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
