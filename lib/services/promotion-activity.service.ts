import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import {
  getPromotionActivity,
  searchPromotionActivities,
} from "@/lib/integrations/tiktokShop";

type RemoteObject = Record<string, unknown>;

export type PromotionIngestResult = {
  accountId: string;
  activitiesDiscovered: number;
  activitiesConfirmed: number;
  itemsStored: number;
  errors: string[];
};

function asObject(value: unknown): RemoteObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RemoteObject)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseEpoch(value: unknown, unit: "seconds" | "milliseconds"): Date | null {
  const epoch = asNumber(value);
  if (!epoch || epoch <= 0) return null;
  const date = new Date(unit === "seconds" ? epoch * 1000 : epoch);
  return Number.isNaN(date.getTime()) ? null : date;
}

function itemKey(productId: string, skuId: string | null) {
  return `${productId}:${skuId ?? ""}`;
}

async function resolveMapping(accountId: string, productId: string, skuId: string | null) {
  if (skuId) {
    return prisma.productMapping.findUnique({
      where: { accountId_channelSku: { accountId, channelSku: skuId } },
      select: { id: true },
    });
  }

  const matches = await prisma.productMapping.findMany({
    where: { accountId, platformProductId: productId },
    select: { id: true },
    take: 2,
  });
  return matches.length === 1 ? matches[0] : null;
}

async function storeItem(
  activityId: string,
  accountId: string,
  product: RemoteObject,
  sku: RemoteObject | null
) {
  const productId = asString(product.id);
  if (!productId) return false;

  // KNOWN GAP: nested `skus[].id` untuk VARIATION berasal dari dokumentasi,
  // belum tervalidasi runtime karena sandbox belum memiliki fixture multi-varian.
  const skuId = sku ? asString(sku.id) : null;
  const source = sku ?? product;
  const price = asObject(source.activity_price) ?? asObject(product.activity_price);
  const mapping = await resolveMapping(accountId, productId, skuId);

  await prisma.promotionActivityItem.upsert({
    where: {
      activityId_externalItemKey: {
        activityId,
        externalItemKey: itemKey(productId, skuId),
      },
    },
    create: {
      id: crypto.randomUUID(),
      activityId,
      externalItemKey: itemKey(productId, skuId),
      platformProductId: productId,
      platformSkuId: skuId,
      productMappingId: mapping?.id,
      discount: asString(source.discount) ?? asString(product.discount),
      activityPriceAmount: asString(price?.amount),
      activityPriceCurrency: asString(price?.currency),
      quantityLimit: asNumber(source.quantity_limit) ?? asNumber(product.quantity_limit),
      quantityPerUser: asNumber(source.quantity_per_user) ?? asNumber(product.quantity_per_user),
      usedQuantity: asNumber(source.used_quantity) ?? asNumber(product.used_quantity),
      rawPayload: JSON.stringify(source),
    updatedAt: new Date(),
    },
    update: {
      platformSkuId: skuId,
      productMappingId: mapping?.id,
      discount: asString(source.discount) ?? asString(product.discount),
      activityPriceAmount: asString(price?.amount),
      activityPriceCurrency: asString(price?.currency),
      quantityLimit: asNumber(source.quantity_limit) ?? asNumber(product.quantity_limit),
      quantityPerUser: asNumber(source.quantity_per_user) ?? asNumber(product.quantity_per_user),
      usedQuantity: asNumber(source.used_quantity) ?? asNumber(product.used_quantity),
      rawPayload: JSON.stringify(source),
    updatedAt: new Date(),
    },
  });
  return true;
}

async function storeConfirmedActivity(accountId: string, payload: RemoteObject) {
  const data = asObject(payload.data);
  const externalActivityId = asString(data?.activity_id);
  const title = asString(data?.title);
  const activityType = asString(data?.activity_type);
  const status = asString(data?.status);
  const productLevel = asString(data?.product_level);
  const startsAt = parseEpoch(data?.begin_time, "seconds");
  const endsAt = parseEpoch(data?.end_time, "seconds");

  if (!externalActivityId || !title || !activityType || !status || !productLevel || !startsAt || !endsAt) {
    throw new Error("Get Activity tidak memuat field activity wajib.");
  }

  // Get Activity tervalidasi memberi create_time/update_time dalam milidetik.
  const createdEpoch = asNumber(data?.create_time);
  const updatedEpoch = asNumber(data?.update_time);
  const activity = await prisma.promotionActivity.upsert({
    where: { accountId_externalActivityId: { accountId, externalActivityId } },
    create: {
      id: crypto.randomUUID(),
      accountId,
      externalActivityId,
      title,
      activityType,
      status,
      productLevel,
      durationType: asString(data?.duration_type),
      startsAt,
      endsAt,
      sourceCreatedAt: parseEpoch(createdEpoch, "milliseconds"),
      sourceUpdatedAt: parseEpoch(updatedEpoch, "milliseconds"),
      sourceCreatedEpoch: createdEpoch?.toString(),
      sourceCreatedUnit: createdEpoch === null ? null : "milliseconds",
      sourceUpdatedEpoch: updatedEpoch?.toString(),
      sourceUpdatedUnit: updatedEpoch === null ? null : "milliseconds",
      lastConfirmedAt: new Date(),
      rawPayload: JSON.stringify(data),
    updatedAt: new Date(),
    },
    update: {
      title,
      activityType,
      status,
      productLevel,
      durationType: asString(data?.duration_type),
      startsAt,
      endsAt,
      sourceCreatedAt: parseEpoch(createdEpoch, "milliseconds"),
      sourceUpdatedAt: parseEpoch(updatedEpoch, "milliseconds"),
      sourceCreatedEpoch: createdEpoch?.toString(),
      sourceCreatedUnit: createdEpoch === null ? null : "milliseconds",
      sourceUpdatedEpoch: updatedEpoch?.toString(),
      sourceUpdatedUnit: updatedEpoch === null ? null : "milliseconds",
      lastConfirmedAt: new Date(),
      rawPayload: JSON.stringify(data),
    updatedAt: new Date(),
    },
  });

  let itemsStored = 0;
  const products = Array.isArray(data?.products) ? data.products : [];
  for (const value of products) {
    const product = asObject(value);
    if (!product) continue;
    const skus = Array.isArray(product.skus) ? product.skus.map(asObject).filter(Boolean) : [];
    if (skus.length === 0) {
      itemsStored += (await storeItem(activity.id, accountId, product, null)) ? 1 : 0;
      continue;
    }
    for (const sku of skus) {
      itemsStored += (await storeItem(activity.id, accountId, product, sku)) ? 1 : 0;
    }
  }

  return { externalActivityId, itemsStored };
}

export async function ingestPromotionActivitiesForAccount(accountId: string): Promise<PromotionIngestResult> {
  const result: PromotionIngestResult = {
    accountId,
    activitiesDiscovered: 0,
    activitiesConfirmed: 0,
    itemsStored: 0,
    errors: [],
  };
  const account = await prisma.platformAccount.findUnique({
    where: { id: accountId },
    select: { accessToken: true, shopCipher: true, scope: true },
  });
  const scopes = account?.scope?.split(",").map((scope) => scope.trim()) ?? [];
  if (!account?.accessToken || !account.shopCipher || !scopes.includes("seller.promotion.info")) {
    result.errors.push("Akun belum memiliki token, shop_cipher, atau seller.promotion.info.");
    return result;
  }

  let pageToken: string | undefined;
  do {
    const search = await searchPromotionActivities(account.accessToken, account.shopCipher, {
      pageSize: 100,
      pageToken,
    });
    const searchData = asObject(search.data);
    const activities = Array.isArray(searchData?.activities) ? searchData.activities : [];
    result.activitiesDiscovered += activities.length;

    for (const value of activities) {
      const summary = asObject(value);
      // Search Activities memakai camelCase (`id`), Get Activity snake_case
      // (`activity_id`) — tervalidasi dari model SDK SearchPromotionActivities-
      // ResponseDataActivities (baseName `id`) vs Get runtime sebelumnya.
      const externalActivityId = asString(summary?.id) ?? asString(summary?.activity_id);
      if (!externalActivityId) continue;
      try {
        const detail = await getPromotionActivity(account.accessToken, account.shopCipher, externalActivityId);
        const stored = await storeConfirmedActivity(accountId, detail);
        result.activitiesConfirmed += 1;
        result.itemsStored += stored.itemsStored;
      } catch (error) {
        result.errors.push(`${externalActivityId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    pageToken = asString(searchData?.next_page_token) ?? undefined;
  } while (pageToken);

  await prisma.syncLog.create({
    data: {
      direction: "in",
      kind: "promotion_activity_ingest",
      status: result.errors.length ? "partial" : "success",
      message: `Promotion ingest ${result.activitiesConfirmed}/${result.activitiesDiscovered} activity, ${result.itemsStored} item.`,
      errorMessage: result.errors.length ? result.errors.slice(0, 5).join("; ") : null,
      payload: JSON.stringify(result),
      accountId,
    },
  });
  return result;
}
