import { prisma } from "@/lib/db/prisma";
import { logStockPush } from "@/lib/services/sync-log.util";
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

async function loadShopeeAccount(accountId: string) {
  return prisma.platformAccount.findUnique({
    where: { id: accountId },
    include: { appCredential: true },
  });
}

function credsOf(account: NonNullable<Awaited<ReturnType<typeof loadShopeeAccount>>>): ShopeeCreds {
  return resolveShopeeCreds(account.appCredential);
}

async function withRefreshedToken<T>(
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
  variantId: string;
  platformProductId: string | null;
  platformTitle: string | null;
  status: string | null;
  channelSku: string | null;
  stockTotal: number;
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
  const [total, mappings] = await Promise.all([
    prisma.productMapping.count({ where: where as never }),
    prisma.productMapping.findMany({
      where: where as never,
      include: { account: { select: { id: true, label: true } }, variant: { select: { stock: true } } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const rows: ShopeeListingRow[] = mappings.map((m) => ({
    key: m.id,
    accountId: m.account.id,
    accountLabel: m.account.label,
    variantId: m.variantId,
    platformProductId: m.platformProductId,
    platformTitle: m.platformTitle,
    status: m.platformStatus,
    channelSku: m.channelSku,
    stockTotal: m.platformStock ?? m.variant.stock,
    lastSyncedAt: m.lastSyncedAt,
  }));
  return { rows, total, page, pageSize };
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
        select: { id: true, channelSku: true },
      });
      const byChannelSku = new Map(existing.map((m) => [m.channelSku, m.id]));
      let offset = 0;
      let itemCount = 0;
      let modelCount = 0;
      let matched = 0;
      for (let page = 0; page < 20; page++) {
        const { items, hasMore } = await withRefreshedToken(account, (token, shopId, creds) =>
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
          const touch = async (candidates: Array<string | undefined>, extraTitle: string | null, extraStatus: string | null) => {
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
                  lastSyncedAt: new Date(),
                },
              });
              matched++;
              return true;
            }
            return false;
          };
          if (models.length === 0) {
            await touch([`${itemId}:0`, itemSku], title, status);
          } else {
            for (const m of models) {
              await touch(
                [`${itemId}:${m.model_id}`, m.model_sku],
                title ? `${title} (${m.model_sku ?? m.model_id})` : (m.model_sku ?? null),
                m.model_status ?? status
              );
            }
          }
        }
        if (!hasMore) break;
        offset += 50;
      }
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
