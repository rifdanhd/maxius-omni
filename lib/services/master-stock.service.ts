import { stockPushDisabledReason } from "@/lib/services/stock-push.policy";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { allocationQuantity, resolveAllocation } from "@/lib/services/stock-allocation.policy";
import type { MasterStockResult, MasterStockRow, MasterStockTab } from "@/lib/inventory/master-stock.types";

export const UNFULFILLED_ORDER_STATUSES = ["UNPAID", "ON_HOLD", "AWAITING_SHIPMENT", "PARTIALLY_SHIPPING"];
const ARCHIVED_STATUSES = ["INACTIVE", "ARCHIVED", "DELETED", "UNLIST", "BANNED", "SELLER_DELETE", "PLATFORM_DELETE", "SELLER_DEACTIVATED", "PLATFORM_DEACTIVATED", "FREEZE", "FROZEN", "SUSPENDED", "DRAFT", "DEACTIVATED"];

export async function getMasterStock(businessId: string, params: URLSearchParams): Promise<MasterStockResult> {
  const settings = await getCachedInventorySettings(businessId);
  const enabledPlatforms = [settings.syncPushShopee ? "SHOPEE" : "", settings.syncPushTiktok ? "TIKTOK_SHOP" : "", settings.syncPushTokopedia ? "TOKOPEDIA" : ""].filter(Boolean);
  const globalEnabled = process.env.STOCK_PUSH_ENABLED === "true" && settings.stockPushEnabled;
  const page = Math.max(1, Math.min(1_000_000, Math.floor(Number(params.get("page")) || 1)));
  const pageSize = Math.max(1, Math.min(200, Math.floor(Number(params.get("limit")) || 50)));
  const q = params.get("q")?.trim();
  const search = q ? `%${q.replace(/[\\%_]/g, (value) => `\\${value}`)}%` : null;
  const category = params.get("category");
  const platform = params.get("platform");
  const accountId = params.get("store");
  const warehouseId = params.get("warehouse");
  const showArchived = params.get("archives") === "true";
  const tab = params.get("tab") as MasterStockTab | null;
  const sorts: Record<string, Prisma.Sql> = {
    name: Prisma.sql`name ASC, sku ASC, id ASC`,
    sku: Prisma.sql`sku ASC, name ASC, id ASC`,
    stock_asc: Prisma.sql`stock ASC, name ASC, id ASC`,
    stock_desc: Prisma.sql`stock DESC, name ASC, id ASC`,
  };
  const order = sorts[params.get("sort") ?? "name"] ?? sorts.name;
  const archived = Prisma.sql`(pv."isArchived" OR NOT mp."isActive" OR upper(mp.status) IN (${Prisma.join(ARCHIVED_STATUSES)})
    OR (EXISTS (SELECT 1 FROM "ProductMapping" pm WHERE pm."variantId" = pv.id)
      AND NOT EXISTS (SELECT 1 FROM "ProductMapping" pm WHERE pm."variantId" = pv.id
        AND COALESCE(upper(pm."platformStatus"), 'ACTIVE') NOT IN (${Prisma.join(ARCHIVED_STATUSES)}))))`;
  const base = Prisma.sql`
    WITH pending AS (
      SELECT oi."variantId" AS id, SUM(oi.qty)::bigint AS qty
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      JOIN "PlatformAccount" a ON a.id = o."accountId"
      WHERE a."businessId" = ${businessId} AND NOT o."importOnly"
        AND o.status IN (${Prisma.join(UNFULFILLED_ORDER_STATUSES)})
        AND NOT EXISTS (SELECT 1 FROM "StockLedger" sl WHERE sl."referenceId" = o.id
          AND sl."variantId" = oi."variantId" AND sl.reason = 'ORDER')
      GROUP BY oi."variantId"
    ), latest_jobs AS (
      SELECT DISTINCT ON (j."variantId", j."accountId", j."channelSku") j."variantId", j."accountId", j."channelSku", j.status, j."retryCount"
      FROM "SyncJob" j JOIN "PlatformAccount" a ON a.id = j."accountId"
      WHERE a."businessId" = ${businessId}
      ORDER BY j."variantId", j."accountId", j."channelSku", j."updatedAt" DESC, j.id DESC
    ), base AS (
      SELECT pv.id, COALESCE((SELECT k."sellerSku" FROM "MasterSkuKey" k WHERE k."variantId" = pv.id AND k."businessId" = ${businessId} ORDER BY k."sellerSku" LIMIT 1), pv.sku) AS sku,
        mp.name, pv.stock, GREATEST(pv.stock - pv."safetyStock", 0) AS available,
        COALESCE(p.qty, 0) AS pending, COALESCE(pv."minStock", mp.threshold) AS minimum,
        ${archived} AS archived,
        EXISTS (SELECT 1 FROM "ProductMapping" pm JOIN "PlatformAccount" a ON a.id = pm."accountId"
          LEFT JOIN latest_jobs j ON j."variantId" = pm."variantId" AND j."accountId" = pm."accountId" AND j."channelSku" = pm."channelSku"
          WHERE pm."variantId" = pv.id AND a."businessId" = ${businessId}
            AND ${globalEnabled} AND a."stockPushEnabled" AND NOT a."isFrozen" AND a.platform IN (${Prisma.join(enabledPlatforms.length ? enabledPlatforms : ["__DISABLED__"])})
            AND COALESCE(CASE WHEN j.status = 'PENDING' AND j."retryCount" > 0 THEN pm."lastStockPushStatus" ELSE j.status END, pm."lastStockPushStatus") = 'FAILED')
          AND NOT EXISTS (SELECT 1 FROM "StockOutbox" e WHERE e."variantId" = pv.id AND e."businessId" = ${businessId} AND e.status = 'PENDING') AS failed,
        NOT EXISTS (SELECT 1 FROM "ProductMapping" pm JOIN "PlatformAccount" a ON a.id = pm."accountId"
          WHERE pm."variantId" = pv.id AND a."businessId" = ${businessId}) AS unmapped
      FROM "ProductVariant" pv JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
      LEFT JOIN pending p ON p.id = pv.id
      WHERE mp."businessId" = ${businessId}
      ${search ? Prisma.sql`AND (pv.sku ILIKE ${search} OR pv.name ILIKE ${search} OR mp.name ILIKE ${search}
        OR EXISTS (SELECT 1 FROM "ProductMapping" pm WHERE pm."variantId" = pv.id AND pm."sellerSku" ILIKE ${search})
        OR EXISTS (SELECT 1 FROM "MasterSkuKey" k WHERE k."variantId" = pv.id AND k."businessId" = ${businessId} AND k."sellerSku" ILIKE ${search}))` : Prisma.empty}
      ${category ? Prisma.sql`AND mp.category = ${category}` : Prisma.empty}
      ${platform || accountId ? Prisma.sql`AND EXISTS (SELECT 1 FROM "ProductMapping" pm
        JOIN "PlatformAccount" a ON a.id = pm."accountId" WHERE pm."variantId" = pv.id AND a."businessId" = ${businessId}
        ${platform ? Prisma.sql`AND a.platform = ${platform}` : Prisma.empty}
        ${accountId ? Prisma.sql`AND a.id = ${accountId}` : Prisma.empty})` : Prisma.empty}
      ${warehouseId ? Prisma.sql`AND EXISTS (SELECT 1 FROM "VariantWarehouseStock" ws JOIN "InventoryWarehouse" w ON w.id = ws."warehouseId"
        WHERE ws."variantId" = pv.id AND w.id = ${warehouseId} AND w."businessId" = ${businessId})` : Prisma.empty}
    ), visible AS (SELECT * FROM base ${showArchived ? Prisma.empty : Prisma.sql`WHERE NOT archived`})
  `;
  const tabFilter = tab === "empty" ? Prisma.sql`available = 0`
    : tab === "low" ? Prisma.sql`available > 0 AND available <= minimum`
      : tab === "failed" ? Prisma.sql`failed` : tab === "unmapped" ? Prisma.sql`unmapped`
        : tab === "oversells" ? Prisma.sql`pending > available` : Prisma.sql`true`;
  const [ids, aggregates, archivedRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; pending: bigint }>>(Prisma.sql`${base} SELECT id, pending FROM visible WHERE ${tabFilter}
      ORDER BY ${order} OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}`),
    prisma.$queryRaw<Array<{ all: bigint; empty: bigint; low: bigint; failed: bigint; unmapped: bigint; oversells: bigint; total: bigint }>>(Prisma.sql`${base}
      SELECT count(*) AS "all", count(*) FILTER (WHERE available = 0) AS empty,
        count(*) FILTER (WHERE available > 0 AND available <= minimum) AS low,
        count(*) FILTER (WHERE failed) AS failed, count(*) FILTER (WHERE unmapped) AS unmapped,
        count(*) FILTER (WHERE pending > available) AS oversells, count(*) FILTER (WHERE ${tabFilter}) AS total FROM visible`),
    prisma.$queryRaw<Array<{ all: bigint; empty: bigint }>>(Prisma.sql`${base}
      SELECT count(*) AS "all", count(*) FILTER (WHERE available = 0) AS empty FROM base WHERE archived`),
  ]);
  const now = new Date();
  const variants = ids.length ? await prisma.productVariant.findMany({
    where: { id: { in: ids.map((row) => row.id) }, masterProduct: { businessId } },
    include: {
      masterProduct: true,
      skuKeys: { where: { businessId }, orderBy: { sellerSku: "asc" } },
      warehouseStock: { where: { warehouse: { businessId } }, include: { warehouse: true } },
      productMapping: {
        where: { account: { businessId } },
        include: { account: { select: { id: true, label: true, platform: true, stockPushEnabled: true, isFrozen: true, stockAllocationMode: true, stockAllocationValue: true, stockBuffer: true } },
          promotionActivityItem: { where: { activity: { startsAt: { lte: now }, endsAt: { gte: now }, status: { notIn: ["DEACTIVATED", "EXPIRED", "ENDED", "CANCELLED"] } } }, select: { activityId: true } } },
      },
    },
  }) : [];
  const events = await prisma.stockOutbox.findMany({ where: { businessId, variantId: { in: ids.map((row) => row.id) }, status: "PENDING" }, select: { variantId: true } });
  const pendingEvents = new Set(events.map((event) => event.variantId));
  const jobs = ids.length ? await prisma.$queryRaw<Array<{ variantId: string; accountId: string; channelSku: string; status: string; retryCount: number; lastError: string | null }>>(Prisma.sql`
    SELECT DISTINCT ON (j."variantId", j."accountId", j."channelSku")
      j."variantId", j."accountId", j."channelSku", j.status, j."retryCount", j."lastError"
    FROM "SyncJob" j JOIN "PlatformAccount" a ON a.id = j."accountId"
    WHERE a."businessId" = ${businessId} AND j."variantId" IN (${Prisma.join(ids.map((row) => row.id))})
    ORDER BY j."variantId", j."accountId", j."channelSku", j."updatedAt" DESC, j.id DESC
  `) : [];
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  const rows: MasterStockRow[] = ids.flatMap((raw) => {
    const variant = byId.get(raw.id);
    if (!variant) return [];
    const available = Math.max(0, variant.stock - variant.safetyStock);
    const listings = variant.productMapping.map((mapping) => {
      const job = jobs.find((item) => item.variantId === variant.id && item.accountId === mapping.accountId && item.channelSku === mapping.channelSku);
      const allocation = resolveAllocation(mapping, mapping.account);
      const quantity = allocationQuantity(available, allocation, variant.productMapping.length);
      const blockedReason = stockPushDisabledReason(mapping.account, settings);
      const status = blockedReason ? "DISABLED" as const : pendingEvents.has(variant.id) || job?.status === "PROCESSING" || (job?.status === "PENDING" && job.retryCount === 0) ? "PENDING" as const
        : mapping.lastStockPushStatus === "FAILED" || job?.status === "FAILED" ? "FAILED" as const
          : mapping.lastStockPushStatus === "PENDING" || mapping.platformStock !== quantity
            ? "PENDING" as const : mapping.lastSyncedAt ? "SUCCESS" as const : "PENDING" as const;
      return { id: mapping.id, accountId: mapping.accountId, store: mapping.account.label, platform: mapping.account.platform,
        channelSku: mapping.channelSku, sellerSku: mapping.sellerSku, platformSkuId: mapping.platformSkuId,
        platformStock: mapping.platformStock, status, blockedReason, error: blockedReason ? null : mapping.lastStockPushError ?? job?.lastError ?? null,
        lastSyncedAt: mapping.lastSyncedAt?.toISOString() ?? null,
        allocation, quantity, inheritsAllocation: mapping.stockAllocationMode === null && mapping.stockAllocationValue === null && mapping.stockBuffer === null,
        defaultAllocation: resolveAllocation({}, mapping.account) };
    });
    return [{ id: variant.id, version: variant.version, sku: variant.skuKeys[0]?.sellerSku ?? variant.sku, name: variant.masterProduct.name,
      variantName: variant.name, imageUrl: variant.masterProduct.imageUrl, category: variant.masterProduct.category,
      stock: variant.stock, safetyStock: variant.safetyStock, available, pending: Number(raw.pending),
      minimum: variant.minStock ?? variant.masterProduct.threshold,
      ownArchived: variant.isArchived,
      archived: variant.isArchived || !variant.masterProduct.isActive || ARCHIVED_STATUSES.includes(variant.masterProduct.status.toUpperCase()) ||
        (variant.productMapping.length > 0 && variant.productMapping.every((mapping) => ARCHIVED_STATUSES.includes(mapping.platformStatus?.toUpperCase() ?? "ACTIVE"))),
      promoActive: new Set(variant.productMapping.flatMap((mapping) => mapping.promotionActivityItem.map((item) => item.activityId))).size,
      status: listings.some((listing) => listing.status === "FAILED") ? "FAILED" : listings.some((listing) => listing.status === "PENDING") ? "PENDING" : listings.some((listing) => listing.status === "DISABLED") ? "DISABLED" : "SUCCESS",
      allocationWarning: listings.reduce((sum, listing) => sum + listing.quantity, 0) > available,
      listings, warehouses: variant.warehouseStock.map((balance) => ({ id: balance.warehouseId, name: balance.warehouse.name, stock: balance.stock, safetyStock: balance.safetyStock })) }];
  });
  const [categories, stores, warehouses] = await Promise.all([
    prisma.masterProduct.findMany({ where: { businessId, category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    prisma.platformAccount.findMany({ where: { businessId }, select: { id: true, label: true, platform: true }, orderBy: { label: "asc" } }),
    prisma.inventoryWarehouse.findMany({ where: { businessId }, select: { id: true, name: true, isDefault: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  const counts = aggregates[0];
  return { rows, page, pageSize, total: Number(counts?.total ?? 0),
    counts: Object.fromEntries(["all", "empty", "low", "failed", "unmapped", "oversells"].map((key) => [key, Number(counts?.[key as MasterStockTab] ?? 0)])) as MasterStockResult["counts"],
    archivedCounts: { all: Number(archivedRows[0]?.all ?? 0), empty: Number(archivedRows[0]?.empty ?? 0) },
    filters: { categories: categories.flatMap((item) => item.category ? [item.category] : []), stores, warehouses } };
}
