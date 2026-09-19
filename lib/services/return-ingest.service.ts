import { prisma } from "@/lib/db/prisma";

/**
 * return-ingest.service — funnel tunggal ingest retur kedua platform.
 *
 * - TikTok  : webhook type 12 (return status change) & 64/65/67 (aftersales).
 * - Shopee  : polling get_return_list/get_return_detail (tidak ada push retur).
 *
 * Idempoten per (accountId, externalReturnId) via upsert. Status TIDAK
 * dimutasi mundur: bila platform mengirim status lama (retry/out-of-order),
 * statusChangedAt & isPlatformAutoApproved tidak ditimpa.
 */

export const RETURN_STATUSES = [
  "PENDING_SELLER",
  "APPROVED",
  "REJECTED",
  "PLATFORM_DECIDED",
  "IN_TRANSIT",
  "RECEIVED",
  "REFUNDED",
  "DISPUTED",
  "CANCELLED",
  "UNKNOWN",
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/**
 * mapTikTokReturnStatus — return_status webhook 12 / returns/search →
 * status ternormalisasi. Mapper defensif: nilai tak dikenal → UNKNOWN
 * (rawStatus tetap menyimpan string asli utk investigasi).
 * Enum lengkap TikTok ada di balik login Partner Center — nilai di bawah
 * terverifikasi dari doc publik webhook & Search Returns.
 */
export function mapTikTokReturnStatus(raw: string): ReturnStatus {
  switch (raw) {
    case "REFUND_OR_RETURN_REQUEST_REJECT":
      return "REJECTED";
    case "AWAITING_BUYER_SHIP":
      return "APPROVED";
    case "BUYER_SHIPPED_ITEM":
      return "IN_TRANSIT";
    case "REFUND_OR_RETURN_REQUEST_CLOSED":
    case "CLOSED":
      return "CANCELLED";
    default:
      return "UNKNOWN";
  }
}

/**
 * mapShopeeReturnStatus — ReturnStatus v2.returns → status ternormalisasi.
 * Sumber: open.shopee.com/developer-guide/227 (ReturnStatus).
 * JUDGING = Shopee Agent yang memutuskan → PLATFORM_DECIDED (+auto flag).
 */
export function mapShopeeReturnStatus(raw: string): ReturnStatus {
  switch (raw) {
    case "REQUESTED":
      return "PENDING_SELLER";
    case "ACCEPTED":
      return "APPROVED";
    case "JUDGING":
      return "PLATFORM_DECIDED";
    case "PROCESSING":
      return "IN_TRANSIT";
    case "SELLER_DISPUTE":
      return "DISPUTED";
    case "CANCELLED":
      return "CANCELLED";
    case "CLOSED":
      return "REFUNDED";
    default:
      return "UNKNOWN";
  }
}

/** Field SLA TikTok di dalam objek needed_action/sla (payload tak terdokumentasi publik). */
type TikTokSlaRaw = { needed_action?: { sla_due_time?: unknown }; sla_due_time?: unknown };

function tikTokSlaDueTime(raw: Record<string, unknown>): unknown {
  const sla = raw as TikTokSlaRaw;
  return sla.needed_action?.sla_due_time ?? sla.sla_due_time;
}

/** Resolve varian via ProductMapping akun ini; null = orphan. */
async function resolveVariantId(
  accountId: string,
  channelSku: string
): Promise<string | null> {
  if (!channelSku) return null;
  const mapping = await prisma.productMapping.findUnique({
    where: { accountId_channelSku: { accountId, channelSku } },
    select: { variantId: true },
  });
  return mapping?.variantId ?? null;
}

function toDate(epochSec: unknown): Date | null {
  const n = Number(epochSec);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n * 1000;
  if (ms > new Date("2100-01-01T00:00:00Z").getTime()) return null;
  return new Date(ms);
}

function jsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** Status yang boleh menimpa status lama (anti-rollback saat webhook retry). */
const STATUS_RANK: Record<string, number> = {
  PENDING_SELLER: 10,
  PLATFORM_DECIDED: 20,
  APPROVED: 30,
  REJECTED: 90,
  IN_TRANSIT: 40,
  RECEIVED: 50,
  REFUNDED: 80,
  DISPUTED: 60,
  CANCELLED: 90,
  UNKNOWN: 0,
};

function shouldReplaceStatus(prev: string, next: string): boolean {
  if (prev === next) return false;
  if (prev === "UNKNOWN") return true;
  return (STATUS_RANK[next] ?? 0) >= (STATUS_RANK[prev] ?? 0);
}

/**
 * upsertTikTokReturn — ingest payload webhook TikTok (type 12) atau
 * item returns/search. Struktur minimal yang dipakai: return_id,
 * order_id, return_status, refund info, item_list.
 */
export async function upsertTikTokReturn(
  accountId: string,
  raw: Record<string, unknown>
): Promise<string | null> {
  const externalReturnId = raw.return_id !== undefined ? String(raw.return_id) : "";
  if (!externalReturnId) return null;
  const externalOrderId =
    raw.order_id !== undefined && raw.order_id !== null ? String(raw.order_id) : null;
  const rawStatus = raw.return_status !== undefined ? String(raw.return_status) : "UNKNOWN";
  const status = mapTikTokReturnStatus(rawStatus);

  const order = externalOrderId
    ? await prisma.platformOrderMapping.findUnique({
        where: { accountId_externalOrderId: { accountId, externalOrderId } },
        select: { orderId: true },
      })
    : null;

  const items = normalizeTikTokItems(raw);
  const itemVariants = new Map<string, string | null>();
  for (const it of items) {
    itemVariants.set(it.channelSku, await resolveVariantId(accountId, it.channelSku));
  }

  const existing = await prisma.returnRequest.findUnique({
    where: { accountId_externalReturnId: { accountId, externalReturnId } },
    select: { id: true, status: true, isPlatformAutoApproved: true },
  });

  const statusChanged =
    !existing || shouldReplaceStatus(existing.status, status);

  const request = await prisma.returnRequest.upsert({
    where: { accountId_externalReturnId: { accountId, externalReturnId } },
    create: {
      accountId,
      externalReturnId,
      externalOrderId,
      orderId: order?.orderId ?? null,
      status,
      rawStatus,
      rawPayload: jsonOrNull(raw),
      type: (raw.return_type as string) ?? null,
      reason: (raw.reason as string) ?? null,
      reasonText: (raw.reason_text as string) ?? null,
      refundAmount: toNumber(raw.refund_amount ?? raw.refund_amount_value),
      currency: (raw.refund_currency as string) ?? null,
      buyerEvidence: jsonOrNull(extractTikTokEvidence(raw)),
      slaDueDate: toDate(tikTokSlaDueTime(raw)),
      isPlatformAutoApproved: raw.request_user === "PLATFORM",
      firstSeenAt: toDate(raw.create_time) ?? new Date(),
      lastSyncedAt: new Date(),
      statusChangedAt: statusChanged ? new Date() : null,
      items: {
        create: items.map((it) => ({
          externalSkuId: it.externalSkuId,
          channelSku: it.channelSku,
          productName: it.productName,
          skuName: it.skuName,
          imageUrl: it.imageUrl,
          qty: it.qty,
          price: it.price,
          variantId: itemVariants.get(it.channelSku) ?? null,
        })),
      },
    },
    update: {
      status: statusChanged ? status : existing!.status,
      rawStatus,
      rawPayload: jsonOrNull(raw),
      orderId: order?.orderId ?? undefined,
      refundAmount: toNumber(raw.refund_amount ?? raw.refund_amount_value) ?? undefined,
      buyerEvidence: jsonOrNull(extractTikTokEvidence(raw)) ?? undefined,
      slaDueDate: toDate(tikTokSlaDueTime(raw)) ?? undefined,
      isPlatformAutoApproved: existing!.isPlatformAutoApproved || raw.request_user === "PLATFORM",
      lastSyncedAt: new Date(),
      statusChangedAt: statusChanged ? new Date() : undefined,
    },
  });

  // Resolve/re-resolve varian item (mapping bisa baru dibuat setelah retur
  // masuk; item baru di-upsert terpisah agar tidak menimpa restock).
  for (const it of items) {
    const variantId = itemVariants.get(it.channelSku);
    if (!variantId) continue;
    await prisma.returnItem.updateMany({
      where: { returnId: request.id, channelSku: it.channelSku, variantId: null },
      data: { variantId },
    });
  }

  return request.id;
}

function toNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeTikTokItems(
  raw: Record<string, unknown>
): Array<{
  externalSkuId: string | null;
  channelSku: string;
  productName: string | null;
  skuName: string | null;
  imageUrl: string | null;
  qty: number;
  price: number | null;
}> {
  const list = (raw.item_list as Array<Record<string, unknown>> | undefined) ?? [];
  return list
    .map((li) => {
      const externalSkuId = li.sku_id !== undefined && li.sku_id !== null ? String(li.sku_id) : null;
      const channelSku = externalSkuId ?? (li.seller_sku as string) ?? "";
      return {
        externalSkuId,
        channelSku,
        productName: (li.product_name as string) ?? null,
        skuName: (li.sku_name as string) ?? null,
        imageUrl: (li.sku_image as string) ?? null,
        qty: Math.max(1, Math.trunc(Number(li.return_qty ?? li.qty ?? 1)) || 1),
        price: toNumber(li.sale_price ?? li.item_price),
      };
    })
    .filter((it) => it.channelSku);
}

function extractTikTokEvidence(raw: Record<string, unknown>): unknown {
  const direct = raw.evidence_list ?? raw.media_urls ?? raw.user_media_list;
  if (direct) return direct;
  return null;
}

/**
 * upsertShopeeReturn — ingest hasil get_return_list (ringkas) lalu
 * get_return_detail (lengkap) per return_sn.
 */
export async function upsertShopeeReturn(
  accountId: string,
  listRow: Record<string, unknown>,
  detail?: Record<string, unknown>
): Promise<string | null> {
  const externalReturnId =
    (listRow.return_sn as string) ?? (detail?.return_sn as string) ?? "";
  if (!externalReturnId) return null;
  const externalOrderId =
    (listRow.order_sn as string) ?? (detail?.order_sn as string) ?? null;
  const rawStatus = (detail?.status as string) ?? (listRow.status as string) ?? "UNKNOWN";
  const status = mapShopeeReturnStatus(rawStatus);

  const order = externalOrderId
    ? await prisma.platformOrderMapping.findUnique({
        where: { accountId_externalOrderId: { accountId, externalOrderId } },
        select: { orderId: true },
      })
    : null;

  const source = detail ?? listRow;
  const items = normalizeShopeeItems(source);
  const itemVariants = new Map<string, string | null>();
  for (const it of items) {
    itemVariants.set(it.channelSku, await resolveVariantId(accountId, it.channelSku));
  }

  const evidence = extractShopeeEvidence(source);
  const negotiation =
    jsonOrNull({
      negotiation: source.negotiation,
      seller_compensation: source.seller_compensation,
      seller_proof: source.seller_proof,
    }) ?? null;

  const existing = await prisma.returnRequest.findUnique({
    where: { accountId_externalReturnId: { accountId, externalReturnId } },
    select: { id: true, status: true, isPlatformAutoApproved: true },
  });

  const statusChanged = !existing || shouldReplaceStatus(existing.status, status);
  const request = await prisma.returnRequest.upsert({
    where: { accountId_externalReturnId: { accountId, externalReturnId } },
    create: {
      accountId,
      externalReturnId,
      externalOrderId,
      orderId: order?.orderId ?? null,
      status,
      rawStatus,
      rawPayload: jsonOrNull(source),
      type: Number(source.return_solution) === 1 ? "REFUND_ONLY" : "RETURN_REFUND",
      requestType: shopeeRequestType(source.return_refund_request_type),
      reason: (source.reason as string) ?? null,
      reasonText: (source.text_reason as string) ?? null,
      solution: (source.return_solution !== undefined ? String(source.return_solution) : null),
      refundAmount: toNumber(source.refund_amount),
      currency: (source.currency as string) ?? null,
      buyerEvidence: evidence,
      negotiation,
      isPlatformAutoApproved: rawStatus === "JUDGING",
      slaDueDate: toDate(source.due_date ?? source.return_seller_due_date),
      firstSeenAt: toDate(source.create_time) ?? new Date(),
      lastSyncedAt: new Date(),
      statusChangedAt: statusChanged ? new Date() : null,
      items: {
        create: items.map((it) => ({
          externalSkuId: it.externalSkuId,
          channelSku: it.channelSku,
          productName: it.productName,
          skuName: it.skuName,
          imageUrl: it.imageUrl,
          qty: it.qty,
          price: it.price,
          variantId: itemVariants.get(it.channelSku) ?? null,
        })),
      },
    },
    update: {
      status: statusChanged ? status : existing!.status,
      rawStatus,
      rawPayload: jsonOrNull(source),
      orderId: order?.orderId ?? undefined,
      refundAmount: toNumber(source.refund_amount) ?? undefined,
      buyerEvidence: evidence ?? undefined,
      negotiation: negotiation ?? undefined,
      isPlatformAutoApproved: existing!.isPlatformAutoApproved || rawStatus === "JUDGING",
      slaDueDate: toDate(source.due_date ?? source.return_seller_due_date) ?? undefined,
      lastSyncedAt: new Date(),
      statusChangedAt: statusChanged ? new Date() : undefined,
    },
  });

  for (const it of items) {
    const variantId = itemVariants.get(it.channelSku);
    if (!variantId) continue;
    await prisma.returnItem.updateMany({
      where: { returnId: request.id, channelSku: it.channelSku, variantId: null },
      data: { variantId },
    });
  }

  return request.id;
}

function shopeeRequestType(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  switch (Number(v)) {
    case 1:
      return "IN_TRANSIT";
    case 2:
      return "ON_THE_SPOT";
    default:
      return "NORMAL";
  }
}

function normalizeShopeeItems(
  source: Record<string, unknown>
): Array<{
  externalSkuId: string | null;
  channelSku: string;
  productName: string | null;
  skuName: string | null;
  imageUrl: string | null;
  qty: number;
  price: number | null;
}> {
  const list = (source.item as Array<Record<string, unknown>> | undefined) ?? [];
  return list
    .map((li) => {
      const externalSkuId =
        li.model_id !== undefined && li.model_id !== null ? String(li.model_id) : null;
      const channelSku = (li.variation_sku as string) || (li.item_sku as string) || externalSkuId || "";
      return {
        externalSkuId,
        channelSku,
        productName: (li.name as string) ?? null,
        skuName: (li.variation_sku as string) ?? null,
        imageUrl: (Array.isArray(li.images) && (li.images[0] as string)) || null,
        qty: Math.max(1, Math.trunc(Number(li.amount ?? 1)) || 1),
        price: toNumber(li.item_price),
      };
    })
    .filter((it) => it.channelSku);
}

function extractShopeeEvidence(source: Record<string, unknown>): string | null {
  const images = (source.image as string[] | undefined) ?? [];
  const videos =
    ((source.buyer_videos as Array<Record<string, unknown>> | undefined) ?? [])
      .map((v) => (v.video_url as string) ?? null)
      .filter(Boolean) ?? [];
  if (images.length === 0 && videos.length === 0) return null;
  return JSON.stringify({ images, videos });
}

/**
 * syncShopeeReturns — polling get_return_list utk SEMUA akun Shopee yang
 * punya token. Range default: 90 hari terakhir (retur jarang lebih tua dari
 * itu; list API mewajibkan time range). Detail diambil per return_sn.
 */
export async function syncShopeeReturnsForAccount(
  accountId: string
): Promise<{ fetched: number; upserted: number; errors: string[] }> {
  const account = await prisma.platformAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Akun tidak ditemukan.");
  if (account.platform !== "SHOPEE") throw new Error("Bukan akun Shopee.");
  if (!account.accessToken) throw new Error("Akun belum punya access token.");
  if (!account.externalShopId) throw new Error("Akun belum punya shop_id.");

  const { getReturnList, getReturnDetail } = await import("@/lib/integrations/shopee");

  const result = { fetched: 0, upserted: 0, errors: [] as string[] };
  const now = Math.floor(Date.now() / 1000);
  let pageNo = 1;
  for (;;) {
    const page = await getReturnList(account.accessToken, account.externalShopId, {
      createTimeFrom: now - 90 * 86400,
      createTimeTo: now,
      pageNo,
      pageSize: 100,
    });
    result.fetched += page.returnList.length;
    for (const row of page.returnList) {
      const returnSn = row.return_sn as string | undefined;
      if (!returnSn) continue;
      try {
        let detail: Record<string, unknown> | undefined;
        try {
          detail = await getReturnDetail(account.accessToken, account.externalShopId, returnSn);
        } catch (e) {
          result.errors.push(
            `${returnSn}: detail gagal (${e instanceof Error ? e.message : String(e)})`
          );
        }
        const id = await upsertShopeeReturn(accountId, row, detail);
        if (id) result.upserted += 1;
      } catch (e) {
        result.errors.push(`${returnSn}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!page.more || page.returnList.length === 0) break;
    pageNo += 1;
    if (pageNo > 10) break;
  }
  return result;
}
