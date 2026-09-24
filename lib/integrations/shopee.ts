import crypto from "crypto";

const SHOPEE_API_BASE =
  process.env.SHOPEE_API_BASE ?? "https://partner.shopeemobile.com";

// Format resmi Shop API v2 (semua tipe App): host auth + auth_type=seller.
// Legacy /api/v2/shop/auth_partner hanya untuk migrasi lama.
// Host sandbox: https://open.sandbox.test-stable.shopee.com/auth (via SHOPEE_AUTH_BASE).
const SHOPEE_AUTH_BASE =
  process.env.SHOPEE_AUTH_BASE ?? "https://open.shopee.com/auth";

// Kredensial app partner. Default = env (perilaku lama); isi dari
// AppCredential (clientId=partner_id, clientSecret=partner_key) begitu
// app ISV disetujui — tanpa refactor pemanggil (param opsional di ekor).
export type ShopeeCreds = { partnerId: string; partnerKey: string };

function envShopeeCreds(): ShopeeCreds {
  const partnerId = process.env.SHOPEE_PARTNER_ID ?? "";
  const partnerKey = process.env.SHOPEE_PARTNER_KEY ?? "";
  if (!partnerId || !partnerKey) {
    throw new Error(
      "[Shopee] SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY belum diisi di .env."
    );
  }
  return { partnerId, partnerKey };
}

export class ShopeeApiError extends Error {
  error: string;
  requestId: string;
  constructor(error: string, message: string, requestId: string) {
    super(`[Shopee] API error (${error}): ${message} | ${requestId}`);
    this.name = "ShopeeApiError";
    this.error = error;
    this.requestId = requestId;
  }
}

function signShopApi(
  apiPath: string,
  timestamp: number,
  accessToken: string,
  shopId: string | number,
  creds: ShopeeCreds
): string {
  const base = `${creds.partnerId}${apiPath}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", creds.partnerKey).update(base).digest("hex");
}

function signPublicApi(apiPath: string, timestamp: number, creds: ShopeeCreds): string {
  const base = `${creds.partnerId}${apiPath}${timestamp}`;
  return crypto.createHmac("sha256", creds.partnerKey).update(base).digest("hex");
}

type ShopeeEnvelope = {
  error?: string;
  message?: string;
  request_id?: string;
  response?: Record<string, unknown>;
};

async function postShopApi(
  apiPath: string,
  accessToken: string,
  shopId: string | number,
  body: Record<string, unknown>,
  creds?: ShopeeCreds
): Promise<Record<string, unknown>> {
  const c = creds ?? envShopeeCreds();
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopApi(apiPath, timestamp, accessToken, shopId, c);
  const qs = new URLSearchParams({
    partner_id: c.partnerId,
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(shopId),
    sign,
  });
  const res = await fetch(`${SHOPEE_API_BASE}${apiPath}?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as ShopeeEnvelope;
  if (!res.ok) {
    throw new ShopeeApiError(
      data.error ?? `http_${res.status}`,
      data.message ?? `HTTP ${res.status} dari ${apiPath}`,
      data.request_id ?? "-"
    );
  }
  if (data.error) {
    throw new ShopeeApiError(data.error, data.message ?? "-", data.request_id ?? "-");
  }
  return (data.response ?? {}) as Record<string, unknown>;
}

async function getShopApi(
  apiPath: string,
  accessToken: string,
  shopId: string | number,
  creds?: ShopeeCreds
): Promise<Record<string, unknown>> {
  const c = creds ?? envShopeeCreds();
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopApi(apiPath, timestamp, accessToken, shopId, c);
  const qs = new URLSearchParams({
    partner_id: c.partnerId,
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(shopId),
    sign,
  });
  const res = await fetch(`${SHOPEE_API_BASE}${apiPath}?${qs}`);
  const data = (await res.json().catch(() => ({}))) as ShopeeEnvelope;
  if (!res.ok || data.error) {
    throw new ShopeeApiError(
      data.error ?? `http_${res.status}`,
      data.message ?? `HTTP ${res.status} dari ${apiPath}`,
      data.request_id ?? "-"
    );
  }
  return (data.response ?? {}) as Record<string, unknown>;
}

export function buildAuthorizeUrl(state?: string, creds?: ShopeeCreds): string {
  const c = creds ?? envShopeeCreds();
  const redirect =
    process.env.SHOPEE_REDIRECT_URI ?? process.env.SHOPEE_REDIRECT_URL ?? "";
  if (!redirect) throw new Error("[Shopee] SHOPEE_REDIRECT_URI belum diisi di .env.");
  const url = new URL(SHOPEE_AUTH_BASE);
  url.searchParams.set("partner_id", c.partnerId);
  url.searchParams.set("auth_type", "seller");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export async function getAccessTokenByCode(
  code: string,
  shopId?: string | number,
  creds?: ShopeeCreds
): Promise<{
  accessToken: string;
  refreshToken: string;
  expireIn: number;
  shopIdList?: number[];
  merchantIdList?: number[];
}> {
  const c = creds ?? envShopeeCreds();
  const apiPath = "/api/v2/auth/token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signPublicApi(apiPath, timestamp, c);
  const qs = new URLSearchParams({
    partner_id: c.partnerId,
    timestamp: String(timestamp),
    sign,
  });
  const body: Record<string, unknown> = { code, partner_id: Number(c.partnerId) };
  if (shopId !== undefined && shopId !== null && String(shopId) !== "") {
    body.shop_id = Number(shopId);
  }
  const res = await fetch(`${SHOPEE_API_BASE}${apiPath}?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as ShopeeEnvelope;
  if (!res.ok || data.error) {
    throw new ShopeeApiError(
      data.error ?? `http_${res.status}`,
      data.message ?? "Gagal tukar code Shopee menjadi token.",
      data.request_id ?? "-"
    );
  }
  const r = (data.response ?? {}) as Record<string, unknown>;
  const accessToken = r.access_token as string | undefined;
  const refreshToken = r.refresh_token as string | undefined;
  if (!accessToken || !refreshToken) throw new Error("[Shopee] Token Shopee tak lengkap.");
  return {
    accessToken,
    refreshToken,
    expireIn: Number(r.expire_in ?? 14400),
    shopIdList: r.shop_id_list as number[] | undefined,
    merchantIdList: r.merchant_id_list as number[] | undefined,
  };
}

export async function refreshAccessToken(
  refreshToken: string,
  shopId: string | number,
  creds?: ShopeeCreds
): Promise<{ accessToken: string; refreshToken: string; expireIn: number }> {
  const c = creds ?? envShopeeCreds();
  const apiPath = "/api/v2/auth/access_token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signPublicApi(apiPath, timestamp, c);
  const qs = new URLSearchParams({
    partner_id: c.partnerId,
    timestamp: String(timestamp),
    sign,
  });
  const body = {
    partner_id: Number(c.partnerId),
    shop_id: Number(shopId),
    refresh_token: refreshToken,
  };
  const res = await fetch(`${SHOPEE_API_BASE}${apiPath}?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as ShopeeEnvelope;
  if (!res.ok || data.error) {
    throw new ShopeeApiError(
      data.error ?? `http_${res.status}`,
      data.message ?? "Gagal refresh token Shopee.",
      data.request_id ?? "-"
    );
  }
  const r = (data.response ?? {}) as Record<string, unknown>;
  const accessToken = r.access_token as string | undefined;
  const newRefresh = r.refresh_token as string | undefined;
  if (!accessToken || !newRefresh) throw new Error("[Shopee] Refresh token Shopee tak lengkap.");
  return { accessToken, refreshToken: newRefresh, expireIn: Number(r.expire_in ?? 14400) };
}

export async function getShopInfo(accessToken: string, shopId: string | number, creds?: ShopeeCreds) {
  const r = await getShopApi("/api/v2/shop/get_shop_info", accessToken, shopId, creds);
  return {
    shopId: String((r.shop_id as number | undefined) ?? shopId),
    shopName: (r.shop_name as string | undefined) ?? null,
    raw: r,
  };
}

export type ShopeeItemSummary = { item_id: number; item_status?: string };

export async function getItemList(
  accessToken: string,
  shopId: string | number,
  opts: { offset?: number; pageSize?: number; itemStatus?: string[] } = {},
  creds?: ShopeeCreds
): Promise<{ items: ShopeeItemSummary[]; totalCount: number; hasMore: boolean }> {
  const { offset = 0, pageSize = 50, itemStatus } = opts;
  const body: Record<string, unknown> = { offset, page_size: pageSize };
  if (itemStatus && itemStatus.length > 0) body.item_status = itemStatus;
  const r = await postShopApi("/api/v2/product/get_item_list", accessToken, shopId, body, creds);
  const items = (r.item as ShopeeItemSummary[] | undefined) ?? [];
  return {
    items,
    totalCount: Number(r.total_count ?? items.length),
    hasMore: Boolean(r.has_more),
  };
}

export async function getItemBaseInfo(
  accessToken: string,
  shopId: string | number,
  itemIds: number[],
  creds?: ShopeeCreds
): Promise<Array<Record<string, unknown>>> {
  if (itemIds.length === 0) return [];
  const r = await postShopApi("/api/v2/product/get_item_base_info", accessToken, shopId, {
    item_id_list: itemIds,
  }, creds);
  return (r.item_list as Array<Record<string, unknown>> | undefined) ?? [];
}

export type ShopeeModel = {
  model_id: number;
  model_sku?: string;
  model_status?: string;
};

export async function getModelList(
  accessToken: string,
  shopId: string | number,
  itemId: number,
  creds?: ShopeeCreds
): Promise<{ models: ShopeeModel[]; itemSku?: string }> {
  const r = await postShopApi("/api/v2/product/get_model_list", accessToken, shopId, {
    item_id: itemId,
  }, creds);
  const models = (r.model as ShopeeModel[] | undefined) ?? [];
  return { models, itemSku: r.item_sku as string | undefined };
}

export type ResolvedModel = { itemId: number; modelId: number };

function parseDirectId(channelSku: string): ResolvedModel | null {
  const m = channelSku.trim().match(/^(\d+)\s*[:#_/-]\s*(\d+)$/);
  if (!m) return null;
  return { itemId: Number(m[1]), modelId: Number(m[2]) };
}

export async function resolveModel(
  accessToken: string,
  shopId: string | number,
  channelSku: string,
  creds?: ShopeeCreds
): Promise<ResolvedModel> {
  const direct = parseDirectId(channelSku);
  if (direct) return direct;
  const wanted = channelSku.trim();
  let offset = 0;
  const pageSize = 50;
  for (let page = 0; page < 20; page++) {
    const { items, hasMore } = await getItemList(accessToken, shopId, { offset, pageSize }, creds);
    if (items.length === 0) break;
    const baseInfos = await getItemBaseInfo(
      accessToken,
      shopId,
      items.map((i) => i.item_id),
      creds
    );
    for (const info of baseInfos) {
      const itemId = Number(info.item_id);
      if ((info.item_sku as string | undefined) === wanted) {
        return { itemId, modelId: 0 };
      }
    }
    for (const item of items) {
      const { models } = await getModelList(accessToken, shopId, item.item_id, creds);
      const hit = models.find((m) => m.model_sku === wanted);
      if (hit) return { itemId: item.item_id, modelId: hit.model_id };
    }
    if (!hasMore) break;
    offset += pageSize;
  }
  throw new Error(
    `[Shopee] SKU "${channelSku}" tidak ditemukan di shop ${shopId}. ` +
      `Format cepat "item_id:model_id" (mis. "123456:789") atau samakan model_sku Shopee dengan channelSku mapping.`
  );
}

export async function resolveModelsBatch(
  accessToken: string,
  shopId: string | number,
  channelSkus: string[],
  creds?: ShopeeCreds
): Promise<{
  resolved: Map<string, ResolvedModel>;
  missing: string[];
}> {
  const resolved = new Map<string, ResolvedModel>();
  const needScan: string[] = [];
  for (const sku of channelSkus) {
    const direct = parseDirectId(sku);
    if (direct) resolved.set(sku, direct);
    else needScan.push(sku);
  }
  const missing: string[] = [];
  if (needScan.length > 0) {
    const wanted = new Set(needScan);
    let offset = 0;
    const pageSize = 50;
    for (let page = 0; page < 20 && wanted.size > 0; page++) {
      const { items, hasMore } = await getItemList(accessToken, shopId, { offset, pageSize }, creds);
      if (items.length === 0) break;
      const baseInfos = await getItemBaseInfo(
        accessToken,
        shopId,
        items.map((i) => i.item_id),
        creds
      );
      for (const info of baseInfos) {
        const sku = info.item_sku as string | undefined;
        if (sku && wanted.has(sku)) {
          resolved.set(sku, { itemId: Number(info.item_id), modelId: 0 });
          wanted.delete(sku);
        }
      }
      for (const item of items) {
        if (wanted.size === 0) break;
        const { models } = await getModelList(accessToken, shopId, item.item_id, creds);
        for (const m of models) {
          if (m.model_sku && wanted.has(m.model_sku)) {
            resolved.set(m.model_sku, { itemId: item.item_id, modelId: m.model_id });
            wanted.delete(m.model_sku);
          }
        }
      }
      if (!hasMore) break;
      offset += pageSize;
    }
    for (const sku of wanted) missing.push(sku);
  }
  return { resolved, missing };
}

export async function updateStock(
  accessToken: string,
  shopId: string | number,
  channelSku: string,
  newStock: number,
  creds?: ShopeeCreds
) {
  const { itemId, modelId } = await resolveModel(accessToken, shopId, channelSku, creds);
  return postShopApi("/api/v2/product/update_stock", accessToken, shopId, {
    item_id: itemId,
    stock_list: [{ model_id: modelId, seller_stock: [{ stock: Math.max(0, Math.floor(newStock)) }] }],
  }, creds);
}

export type ShopeeStockBatchItem = { channelSku: string; quantity: number };
export type ShopeeStockBatchResult = {
  ok: ShopeeStockBatchItem[];
  failed: Array<{ item: ShopeeStockBatchItem; error: unknown }>;
};

export async function updateStockBatch(
  accessToken: string,
  shopId: string | number,
  items: ShopeeStockBatchItem[],
  creds?: ShopeeCreds
): Promise<ShopeeStockBatchResult> {
  const result: ShopeeStockBatchResult = { ok: [], failed: [] };
  if (items.length === 0) return result;
  const { resolved, missing } = await resolveModelsBatch(
    accessToken,
    shopId,
    items.map((i) => i.channelSku),
    creds
  );
  const missingSet = new Set(missing);
  for (const item of items) {
    if (missingSet.has(item.channelSku)) {
      result.failed.push({
        item,
        error: `[Shopee] SKU "${item.channelSku}" tidak ditemukan di shop ${shopId}.`,
      });
    }
  }
  const byItem = new Map<number, Array<{ modelId: number; item: ShopeeStockBatchItem }>>();
  for (const item of items) {
    if (missingSet.has(item.channelSku)) continue;
    const hit = resolved.get(item.channelSku);
    if (!hit) {
      result.failed.push({ item, error: `[Shopee] SKU "${item.channelSku}" gagal di-resolve.` });
      continue;
    }
    const bucket = byItem.get(hit.itemId) ?? [];
    bucket.push({ modelId: hit.modelId, item });
    byItem.set(hit.itemId, bucket);
  }
  for (const [itemId, skus] of byItem) {
    try {
      await postShopApi("/api/v2/product/update_stock", accessToken, shopId, {
        item_id: itemId,
        stock_list: skus.map((s) => ({
          model_id: s.modelId,
          seller_stock: [{ stock: Math.max(0, Math.floor(s.item.quantity)) }],
        })),
      }, creds);
      result.ok.push(...skus.map((s) => s.item));
    } catch (err) {
      for (const s of skus) result.failed.push({ item: s.item, error: err });
    }
  }
  return result;
}

export async function updatePrice(
  accessToken: string,
  shopId: string | number,
  channelSku: string,
  newPrice: number,
  creds?: ShopeeCreds
) {
  const { itemId, modelId } = await resolveModel(accessToken, shopId, channelSku, creds);
  return postShopApi("/api/v2/product/update_price", accessToken, shopId, {
    item_id: itemId,
    price_list: [{ model_id: modelId, original_price: newPrice }],
  }, creds);
}

// Verifikasi push Shopee: HMAC-SHA256(partnerKey, requestUrl|rawBody).
// Format base string sesuai dokumen Push Mechanism resmi.
// creds opsional: webhook multi-credential mencoba tiap secret via
// listActiveShopeeSecrets() di route (satu per satu ke fungsi ini).
/**
 * getReturnList — daftar pengajuan retur/refund (module v2.returns).
 * Shopee TIDAK menyediakan push/webhook retur → sumber data = polling API ini.
 * Params: time range (create_time_ge/lt, epoch detik), page_no/page_size,
 * dan filter opsional (status, negosiasi, bukti, kompensasi).
 */
export async function getReturnList(
  accessToken: string,
  shopId: string | number,
  opts: {
    createTimeFrom?: number;
    createTimeTo?: number;
    pageNo?: number;
    pageSize?: number;
  } = {},
  creds?: ShopeeCreds
): Promise<{ returnList: Array<Record<string, unknown>>; more: boolean }> {
  const body: Record<string, unknown> = {
    pagination: {
      ...(opts.pageNo ? { offset: (opts.pageNo - 1) * (opts.pageSize ?? 100) } : {}),
      limit: opts.pageSize ?? 100,
    },
  };
  if (opts.createTimeFrom) body.create_time_ge = opts.createTimeFrom;
  if (opts.createTimeTo) body.create_time_lt = opts.createTimeTo;
  const result = await postShopApi(
    "/api/v2/returns/get_return_list",
    accessToken,
    shopId,
    body,
    creds
  );
  return {
    returnList: (result.return_list as Array<Record<string, unknown>> | undefined) ?? [],
    more: result.more === true,
  };
}

/**
 * getReturnDetail — detail 1 retur by return_sn (alasan, bukti foto/video,
 * item per model_id, status, SLA, negosiasi, reverse logistics).
 */
export async function getReturnDetail(
  accessToken: string,
  shopId: string | number,
  returnSn: string,
  creds?: ShopeeCreds
): Promise<Record<string, unknown>> {
  return postShopApi(
    "/api/v2/returns/get_return_detail",
    accessToken,
    shopId,
    { return_sn: returnSn },
    creds
  );
}

function pushAuthCandidates(authHeader: string): string[] {
  const raw = authHeader.trim();
  const out = new Set<string>();
  for (const v of [raw, raw.toLowerCase()]) {
    out.add(v);
    out.add(v.replace(/^sha256[=\s]+/i, ""));
  }
  return [...out];
}

function pushUrlVariants(url: string): string[] {
  const out = new Set<string>([url]);
  if (url.endsWith("/")) out.add(url.slice(0, -1));
  else out.add(`${url}/`);
  if (url.startsWith("https://")) out.add(`http://${url.slice("https://".length)}`);
  if (url.startsWith("http://")) out.add(`https://${url.slice("http://".length)}`);
  const noWww = url.replace(/^(https?:)\/\/www\./i, "$1//");
  if (noWww !== url) out.add(noWww);
  const withWww = url.replace(/^(https?:)\/\//i, "$1//www.");
  if (withWww !== url) out.add(withWww);
  return [...out];
}

/** Base string Shopee: `<callback_url>|<raw_body>` (opsional: raw body saja). */
export function verifyPushSignature(
  rawBody: string,
  authHeader: string | null,
  requestUrl?: string | string[],
  creds?: ShopeeCreds
): boolean {
  const key = creds?.partnerKey ?? process.env.SHOPEE_PARTNER_KEY ?? "";
  if (!key) return false;
  if (!authHeader) return false;

  const urls = requestUrl
    ? (Array.isArray(requestUrl) ? requestUrl : [requestUrl]).flatMap(pushUrlVariants)
    : [];
  const candidates: string[] = [rawBody];
  for (const u of urls) {
    candidates.push(`${u}|${rawBody}`);
  }

  const targets = pushAuthCandidates(authHeader);
  for (const target of targets) {
    for (const base of candidates) {
      const computed = crypto.createHmac("sha256", key).update(base).digest("hex");
      try {
        const a = Buffer.from(computed, "hex");
        const b = Buffer.from(target, "hex");
        if (a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)) return true;
      } catch {
        if (computed === target) return true;
      }
    }
  }
  return false;
}

/** URL callback utk signature — lengkapi http(s)/host dari header proxy (nginx). */
export function shopeePushUrlCandidates(req: {
  url: string;
  headers: Headers;
}): string[] {
  const out = new Set<string>();
  if (req.url) out.add(req.url);
  try {
    const u = new URL(req.url);
    out.add(u.origin + u.pathname);
  } catch {
    /* ignore */
  }
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host")?.trim();
  let path = "/api/webhooks/shopee";
  try {
    path = new URL(req.url).pathname || path;
  } catch {
    /* ignore */
  }
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    out.add(`${proto}://${host}${path}`);
    out.add(`https://${host}${path}`);
    out.add(`http://${host}${path}`);
  }
  return [...out];
}
