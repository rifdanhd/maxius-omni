import crypto from "crypto";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { getOrderDetail, getOrderList, type ShopeeOrderSummary } from "@/lib/integrations/shopee";
import { encryptPii } from "@/lib/services/crypto.service";
import { withAccountPullLock } from "@/lib/services/account-pull-lock.service";
import {
  applyShopeeStockEffectsForStatus,
  canonicalShopeeStatus,
} from "@/lib/services/shopee-order-status.service";
import { resolveVariantId } from "@/lib/services/order-sync.service";
import { logOrphanSku } from "@/lib/services/sync-log.util";

type PrismaLike = typeof defaultPrisma;

function envInt(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Pembaca toleran utk payload Shopee (nama field bisa beda antar versi API).
function s(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function toDate(v: unknown): Date | null {
  const sec = n(v);
  if (!sec || sec <= 0) return null;
  const ms = sec * 1000;
  if (ms > new Date("2100-01-01T00:00:00Z").getTime()) return null;
  return new Date(ms);
}
function arr(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

async function logOrderSyncError(
  prisma: PrismaLike,
  accountId: string,
  message: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.syncLog.create({
      data: {
        direction: "in",
        kind: "order_sync",
        status: "error",
        errorMessage: message,
        payload: JSON.stringify(payload),
        accountId,
      },
    });
  } catch (e) {
    console.warn("[ShopeeOrderSync] gagal menulis SyncLog:", errMsg(e));
  }
}

/** Sinkronkan paket pengiriman Shopee (merge — payload null tidak menimpa data lama). */
async function syncShopeeShipments(
  db: { shipment: typeof defaultPrisma.shipment },
  orderId: string,
  accountId: string,
  packagesRaw: Array<Record<string, unknown>>
): Promise<void> {
  for (const pkg of packagesRaw) {
    const externalId = s(pkg.package_number);
    if (!externalId) continue;
    const existing = await db.shipment.findUnique({
      where: { accountId_orderId_externalId: { accountId, orderId, externalId } },
      select: { carrier: true, trackingNo: true, status: true, shippedAt: true },
    });
    const carrier = s(pkg.shipping_provider) ?? s(pkg.shipping_provider_name) ?? existing?.carrier ?? null;
    const trackingNo = s(pkg.tracking_number) ?? existing?.trackingNo ?? null;
    const status = s(pkg.logistics_status) ?? existing?.status ?? "PACKAGED";
    const shippedAt = existing?.shippedAt ?? null;
    await db.shipment.upsert({
      where: { accountId_orderId_externalId: { accountId, orderId, externalId } },
      create: { externalId, orderId, accountId, carrier, trackingNo, status, shippedAt },
      update: { carrier, trackingNo, status, shippedAt },
    });
  }
}

/**
 * createShopeeOrder — persist 1 order Shopee (order + items + mapping +
 * shipments) dari detail API. Murni penyimpanan: EFEK STOK diterapkan
 * pemanggil via applyShopeeStockEffectsForStatus (A1 — satu jalur utk
 * webhook & ingest). Return orderId, atau null bila field wajib hilang.
 */
export async function createShopeeOrder(
  prisma: PrismaLike,
  accountId: string,
  detail: Record<string, unknown>
): Promise<string | null> {
  const orderSn = s(detail.order_sn);
  if (!orderSn) return null;
  const rawStatus = s(detail.order_status) ?? "UNKNOWN";
  const status = canonicalShopeeStatus(rawStatus);

  const addr = obj(detail.shipping_address);
  const recipientName =
    s(addr?.name) ?? s(detail.recipient_name) ?? s(detail.buyer_username) ?? null;
  const recipientPhone = encryptPii(s(addr?.phone) ?? s(addr?.phone_number));
  const recipientAddress = encryptPii(
    [addr?.address, addr?.district, addr?.city, addr?.province]
      .map((x) => s(x))
      .filter(Boolean)
      .join(", ") || null
  );

  const lineItems = arr(detail.items).map((it) => {
    const itemId = n(it.item_id);
    const modelId = n(it.model_id);
    return {
      channelSku:
        s(it.sku) ??
        s(it.model_sku) ??
        (itemId !== null && modelId !== null ? `${itemId}:${modelId}` : ""),
      productId: itemId !== null ? String(itemId) : null,
      imageUrl: s(it.image) ?? s(it.image_url),
      productName: s(it.name) ?? s(it.item_name),
      skuName: s(it.model_name) ?? s(it.sku_name),
      qty: n(it.quantity) ?? n(it.qty) ?? 1,
      price: n(it.original_price) ?? n(it.price),
      variantId: null as string | null,
    };
  });

  for (const item of lineItems) {
    if (!item.channelSku) continue;
    item.variantId = await resolveVariantId(prisma, accountId, item.channelSku);
    if (!item.variantId) {
      await logOrphanSku(accountId, item.channelSku, item.qty);
    }
  }

  const amountFromItems = lineItems.reduce(
    (acc, it) => acc + (it.price ?? 0) * it.qty,
    0
  );
  const amount = n(detail.amount) ?? n(detail.total_amount) ?? (amountFromItems || null);

  const paymentMethod = s(detail.payment_method);
  const packagesRaw = arr(detail.packages);

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        id: crypto.randomUUID(),
        orderNo: orderSn,
        status,
        buyerName: s(detail.buyer_username) ?? recipientName,
        buyerEmail: s(detail.buyer_email),
        buyerNote: s(detail.buyer_message) ?? s(detail.note),
        paymentMethodName: paymentMethod,
        isCod: n(detail.is_cod) !== null ? Boolean(n(detail.is_cod)) : null,
        paymentJson: paymentMethod ? JSON.stringify({ payment_method: paymentMethod }) : null,
        recipientName,
        recipientPhone,
        recipientAddress,
        amount,
        currency: s(detail.currency),
        createTime: toDate(detail.create_time),
        paidTime: toDate(detail.payment_time),
        shippingDueTime: toDate(detail.shipping_due_time),
        accountId,
        items: {
          create: lineItems.map((item) => ({
            id: crypto.randomUUID(),
            channelSku: item.channelSku,
            productId: item.productId,
            imageUrl: item.imageUrl,
            productName: item.productName,
            skuName: item.skuName,
            qty: item.qty,
            price: item.price,
            variantId: item.variantId,
          })),
        },
      },
    });
    await tx.platformOrderMapping.create({
      data: {
        id: crypto.randomUUID(),
        externalOrderId: orderSn,
        rawStatus,
        orderId: created.id,
        accountId,
      },
    });
    await syncShopeeShipments(tx, created.id, accountId, packagesRaw);
    return created;
  });

  return order.id;
}

export type ShopeeSyncResult = {
  fetched: number;
  created: number;
  skipped: number;
  errors: string[];
};

/**
 * syncOrdersShopee — tarik order Shopee (M8b):
 *  - A3: dikunci per akun (anti double-pull)
 *  - A5: daftar ditarik ber-halaman dengan cap SHOPEE_ORDER_MAX_PAGES;
 *    error list/detail → SyncLog kind=order_sync (tidak senyap)
 *  - A4: order yang SUDAH ada → refresh status saja (progress-only);
 *    efek stok hanya pada transisi status (idempoten via ledger)
 *  - order baru → get_order_detail lalu create + efek stok (A1)
 */
export async function syncOrdersShopee(
  accountId: string,
  prisma: PrismaLike = defaultPrisma
): Promise<ShopeeSyncResult> {
  return withAccountPullLock(accountId, () => syncOrdersShopeeInner(accountId, prisma));
}

async function syncOrdersShopeeInner(
  accountId: string,
  prisma: PrismaLike
): Promise<ShopeeSyncResult> {
  const account = await prisma.platformAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Akun tidak ditemukan.");
  if (account.platform !== "SHOPEE") throw new Error("syncOrdersShopee hanya untuk akun Shopee.");
  if (!account.accessToken) throw new Error("Akun belum punya access token.");
  const shopId = account.externalShopId;
  if (!shopId) throw new Error("Akun belum punya external shop id.");

  const result: ShopeeSyncResult = { fetched: 0, created: 0, skipped: 0, errors: [] };
  const maxPages = envInt("SHOPEE_ORDER_MAX_PAGES", 10);
  const pageSize = 50;
  const syncDays = envInt("SHOPEE_ORDER_SYNC_DAYS", 30);
  const timeFrom = Math.floor(Date.now() / 1000) - syncDays * 86400;

  // A5 — tarik daftar ber-halaman (cap halaman; error → berhenti + SyncLog).
  const summaries: ShopeeOrderSummary[] = [];
  let offset = 0;
  let hasMore = true;
  for (let page = 1; page <= maxPages && hasMore; page++) {
    try {
      const r = await getOrderList(account.accessToken, shopId, {
        offset,
        pageSize,
        createTimeFrom: timeFrom,
      });
      summaries.push(...r.orders);
      hasMore = r.hasMore;
      offset = r.nextOffset;
      if (r.orders.length === 0) break;
    } catch (e) {
      const message = `get_order_list halaman ${page}: ${errMsg(e)}`;
      result.errors.push(message);
      await logOrderSyncError(prisma, accountId, message, { page, offset });
      break;
    }
  }
  result.fetched = summaries.length;

  // A4 — order yang sudah ada: refresh status saja (progress-only).
  const newSns: string[] = [];
  for (const sum of summaries) {
    const sn = s(sum.order_sn);
    if (!sn) continue;
    const rawStatus = s(sum.order_status);
    const existing = await prisma.platformOrderMapping.findUnique({
      where: { accountId_externalOrderId: { accountId, externalOrderId: sn } },
      select: {
        id: true,
        orderId: true,
        rawStatus: true,
        order: { select: { status: true } },
      },
    });
    if (!existing) {
      newSns.push(sn);
      continue;
    }
    result.skipped += 1;
    if (!rawStatus || rawStatus === existing.rawStatus) continue;

    const canonical = canonicalShopeeStatus(rawStatus);
    try {
      await prisma.$transaction([
        prisma.order.update({ where: { id: existing.orderId }, data: { status: canonical } }),
        prisma.platformOrderMapping.update({
          where: { id: existing.id },
          data: { rawStatus },
        }),
      ]);
      if (canonical !== existing.order.status) {
        // Transisi status → efek stok (A1, idempoten).
        const eff = await applyShopeeStockEffectsForStatus(existing.orderId, canonical);
        if (eff.effect !== "none" && eff.ok === false && eff.note) {
          result.errors.push(`${sn}: stok ${eff.effect} gagal (${eff.note})`);
        }
      }
    } catch (e) {
      result.errors.push(`${sn}: refresh status gagal (${errMsg(e)})`);
    }
  }

  // Order baru — detail lalu create + efek stok (A1).
  if (newSns.length > 0) {
    let details: Array<Record<string, unknown>> = [];
    try {
      details = await getOrderDetail(account.accessToken, shopId, newSns);
    } catch (e) {
      const message = `get_order_detail: ${errMsg(e)}`;
      result.errors.push(message);
      await logOrderSyncError(prisma, accountId, message, { orderSns: newSns });
    }
    const bySn = new Map<string, Record<string, unknown>>();
    for (const d of details) {
      const sn = s(d.order_sn);
      if (sn) bySn.set(sn, d);
    }
    for (const sn of newSns) {
      const detail = bySn.get(sn);
      if (!detail) {
        result.errors.push(`${sn}: detail tidak ada di respons Shopee`);
        continue;
      }
      try {
        const orderId = await createShopeeOrder(prisma, accountId, detail);
        if (!orderId) {
          result.errors.push(`${sn}: gagal disimpan (field wajib hilang)`);
          continue;
        }
        result.created += 1;
        const canonical = canonicalShopeeStatus(s(detail.order_status) ?? "UNKNOWN");
        const eff = await applyShopeeStockEffectsForStatus(orderId, canonical);
        if (eff.effect !== "none" && eff.ok === false && eff.note) {
          result.errors.push(`${sn}: stok ${eff.effect} gagal (${eff.note})`);
        }
      } catch (e) {
        result.errors.push(`${sn}: ${errMsg(e)}`);
      }
    }
  }

  return result;
}

/**
 * ingestShopeeOrderBySn — A2: auto-ingest dari webhook. Dipanggil push saat
 * mapping belum ada (order belum pernah di-sync manual). Tarik 1 detail →
 * create (tanpa efek stok — caller webhook yang menerapkan A1 setelah update
 * status). Return orderId, atau null bila gagal (jejak di SyncLog caller).
 */
export async function ingestShopeeOrderBySn(
  accountId: string,
  orderSn: string
): Promise<string | null> {
  const account = await defaultPrisma.platformAccount.findUnique({
    where: { id: accountId },
    select: { accessToken: true, externalShopId: true },
  });
  if (!account?.accessToken || !account.externalShopId) {
    throw new Error("auto-ingest butuh token toko — jalankan sinkronisasi order manual setelah OAuth.");
  }
  const [detail] = await getOrderDetail(account.accessToken, account.externalShopId, [orderSn]);
  if (!detail) throw new Error(`detail ${orderSn} tidak tersedia dari Shopee.`);
  return createShopeeOrder(defaultPrisma, accountId, detail);
}
