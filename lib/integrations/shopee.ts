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

function snippet(raw: string): string {
  const t = raw.trim();
  return t.length > 300 ? `${t.slice(0, 300)}…` : t;
}

export function parseShopeeEnvelope(
  status: number,
  raw: string,
  apiPath: string
): ShopeeEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ShopeeApiError(
      `http_${status}`,
      `HTTP ${status} dari ${apiPath} — body bukan JSON: ${snippet(raw)}`,
      "-"
    );
  }
  const env = (Array.isArray(parsed) ? parsed[0] : parsed) as ShopeeEnvelope | null | undefined;
  if (!env || typeof env !== "object") {
    throw new ShopeeApiError(
      `http_${status}`,
      `HTTP ${status} dari ${apiPath} — bentuk respons tak dikenal: ${snippet(raw)}`,
      "-"
    );
  }
  if (status < 200 || status >= 300) {
    throw new ShopeeApiError(
      env.error ?? `http_${status}`,
      `${env.message ?? `HTTP ${status} dari ${apiPath}`} — body: ${snippet(raw)}`,
      env.request_id ?? "-"
    );
  }
  if (env.error) {
    throw new ShopeeApiError(env.error, env.message ?? "-", env.request_id ?? "-");
  }
  return env;
}

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
  const raw = await res.text();
  const data = parseShopeeEnvelope(res.status, raw, apiPath);
  return (data.response ?? {}) as Record<string, unknown>;
}

async function getShopApi(
  apiPath: string,
  accessToken: string,
  shopId: string | number,
  creds?: ShopeeCreds,
  query?: Record<string, string | number | string[] | number[]>
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
  for (const [k, v] of Object.entries(query ?? {})) {
    if (Array.isArray(v)) {
      // Dokumen Shopee: daftar dipisah koma (mis. item_id_list=1,2,3).
      if (v.length > 0) qs.set(k, v.map(String).join(","));
    } else {
      qs.set(k, String(v));
    }
  }
  const res = await fetch(`${SHOPEE_API_BASE}${apiPath}?${qs}`);
  const raw = await res.text();
  const data = parseShopeeEnvelope(res.status, raw, apiPath);
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
  const r = (data.response ?? (data as Record<string, unknown>)) as Record<string, unknown>;
  const accessToken = r.access_token as string | undefined;
  const refreshToken = r.refresh_token as string | undefined;
  if (!accessToken || !refreshToken) {
    // Body gagal sering jadi satu-satunya petunjuk (code dipakai ganda,
    // redirect_uri/partner tak cocok, dst) — token disensor dulu.
    const raw = JSON.stringify(data).replace(
      /"(access_token|refresh_token)"\s*:\s*"[^"]*"/g,
      '"$1":"***"'
    );
    throw new Error(
      `[Shopee] Token Shopee tak lengkap. http_${res.status} request_id=${data.request_id ?? "-"} body=${raw.slice(0, 500)}`
    );
  }
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
  const r = (data.response ?? (data as Record<string, unknown>)) as Record<string, unknown>;
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

// ===== A5 — guard API order: rate window + batch cap (dipakai ingest M8b) =====

export class ShopeeRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopeeRateLimitError";
  }
}

function envInt(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

/** Hitungan request order API per token dalam jendela geser (in-memory). */
const orderApiHits = new Map<string, number[]>();

function checkOrderRateWindow(accessToken: string): void {
  const max = envInt("SHOPEE_ORDER_RATE_MAX", 30);
  const windowMs = envInt("SHOPEE_ORDER_RATE_WINDOW_MS", 10_000);
  const now = Date.now();
  const hits = (orderApiHits.get(accessToken) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    orderApiHits.set(accessToken, hits);
    throw new ShopeeRateLimitError(
      `rate limit order API: ${max} request / ${windowMs}ms terlampaui — jeda lalu coba lagi.`
    );
  }
  hits.push(now);
  orderApiHits.set(accessToken, hits);
}

export type ShopeeOrderSummary = {
  order_sn: string;
  order_status: string;
  create_time?: number;
  update_time?: number;
};

/**
 * getOrderList — GET /api/v2/order/get_order_list (dokumen resmi v2):
 * query WAJIB time_range_field + time_from/time_to (maks rentang 15 hari),
 * paginasi cursor → respons `order_list` / `more` / `next_cursor`.
 * (Sebelumnya salah kirim POST body {pagination,time_range} → Shopee balas
 * error/kosong dan sync selalu 0 order.)
 * Guard A5: rate window per token.
 */
export type ShopeeOrderListPage = {
  orders: ShopeeOrderSummary[];
  hasMore: boolean;
  nextCursor: string;
};

export async function getOrderList(
  accessToken: string,
  shopId: string | number,
  opts: {
    createTimeFrom: number;
    createTimeTo: number;
    cursor?: string;
    pageSize?: number;
    timeRangeField?: "create_time" | "update_time";
    orderStatus?: string[];
  },
  creds?: ShopeeCreds
): Promise<ShopeeOrderListPage> {
  checkOrderRateWindow(accessToken);
  const {
    createTimeFrom,
    createTimeTo,
    cursor = "",
    pageSize = 50,
    timeRangeField = "create_time",
    orderStatus,
  } = opts;
  // Dokumen Shopee: time_from..time_to maks 15 hari — clamp defensif.
  const WINDOW_MAX_SEC = 15 * 86400;
  const timeTo = Math.min(createTimeTo, createTimeFrom + WINDOW_MAX_SEC);
  const r = await getShopApi("/api/v2/order/get_order_list", accessToken, shopId, creds, {
    time_range_field: timeRangeField,
    time_from: createTimeFrom,
    time_to: timeTo,
    page_size: pageSize,
    cursor,
    response_optional_fields: "order_status",
    ...(orderStatus && orderStatus.length > 0 ? { order_status: orderStatus } : {}),
  });
  const orders = (r.order_list as ShopeeOrderSummary[] | undefined) ?? [];
  return {
    orders,
    hasMore: r.more === true,
    nextCursor: typeof r.next_cursor === "string" ? r.next_cursor : "",
  };
}

/**
 * getOrderDetail — GET /api/v2/order/get_order_detail (dokumen resmi: query
 * order_sn_list dipisah koma + response_optional_fields). Guard A5: rate
 * window per token + otomatis pecah batch (SHOPEE_ORDER_DETAIL_BATCH,
 * default 50 order_sn per panggilan).
 */
export async function getOrderDetail(
  accessToken: string,
  shopId: string | number,
  orderSns: string[],
  creds?: ShopeeCreds
): Promise<Array<Record<string, unknown>>> {
  const sns = [...new Set(orderSns.filter(Boolean))];
  if (sns.length === 0) return [];
  const batchSize = envInt("SHOPEE_ORDER_DETAIL_BATCH", 50);
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < sns.length; i += batchSize) {
    checkOrderRateWindow(accessToken);
    const r = await getShopApi("/api/v2/order/get_order_detail", accessToken, shopId, creds, {
      order_sn_list: sns.slice(i, i + batchSize),
      // Field yang dibaca createShopeeOrder (wajib diminta — selain ini default).
      response_optional_fields:
        "buyer_username,note,recipient_address,item_list,pay_time,package_list,payment_method,total_amount",
    });
    out.push(...((r.order_list as Array<Record<string, unknown>> | undefined) ?? []));
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export type ShopeePickupTimeSlot = {
  pickupTimeId: string;
  date: number;
  timeText: string | null;
};

export type ShopeePickupAddress = {
  addressId: number;
  label: string;
  timeSlots: ShopeePickupTimeSlot[];
};

export type ShopeeShippingParameter = {
  /** Field yang diminta Shopee per mode (info_needed.pickup/dropoff/non_integrated). */
  infoNeeded: { pickup: string[]; dropoff: string[]; nonIntegrated: string[] };
  pickup: ShopeePickupAddress[];
  dropoffBranches: Array<{ branchId: number; label: string }>;
  dropoffSlugs: Array<{ slug: string; name: string }>;
};

/**
 * getShippingParameter — GET /api/v2/logistics/get_shipping_parameter.
 * Wajib dipanggil SEBELUM ship_order: menentukan mode yang didukung
 * (pickup/dropoff/non_integrated) + daftar alamat penjemputan, slot waktu,
 * dan cabang drop-off untuk order tsb.
 */
export async function getShippingParameter(
  accessToken: string,
  shopId: string | number,
  orderSn: string,
  creds?: ShopeeCreds
): Promise<ShopeeShippingParameter> {
  const r = await getShopApi("/api/v2/logistics/get_shipping_parameter", accessToken, shopId, creds, {
    order_sn: orderSn,
  });
  const info = (r.info_needed ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const pickupWrap = (r.pickup ?? null) as { address_list?: Array<Record<string, unknown>> } | null;
  const pickup: ShopeePickupAddress[] = (pickupWrap?.address_list ?? []).flatMap((a) => {
    const addressId = Number(a.address_id);
    if (!Number.isFinite(addressId)) return [];
    const parts = [a.address, a.district, a.town, a.city, a.state].filter(
      (x): x is string => typeof x === "string" && x.trim().length > 0
    );
    const slots = Array.isArray(a.time_slot_list)
      ? (a.time_slot_list as Array<Record<string, unknown>>)
          .flatMap((t) => {
            const pickupTimeId = str(t.pickup_time_id);
            if (!pickupTimeId) return [];
            return [{
              pickupTimeId,
              date: Number(t.date) || 0,
              timeText: str(t.time_text) || null,
            }];
          })
      : [];
    return [{ addressId, label: parts.join(", ") || `Alamat ${addressId}`, timeSlots: slots }];
  });

  const dropoffWrap = (r.dropoff ?? null) as {
    branch_list?: Array<Record<string, unknown>>;
    slug_list?: Array<Record<string, unknown>>;
  } | null;
  const dropoffBranches = (dropoffWrap?.branch_list ?? []).flatMap((b) => {
    const branchId = Number(b.branch_id);
    if (!Number.isFinite(branchId)) return [];
    const parts = [b.address, b.city, b.state].filter(
      (x): x is string => typeof x === "string" && x.trim().length > 0
    );
    return [{ branchId, label: parts.join(", ") || `Cabang ${branchId}` }];
  });
  const dropoffSlugs = (dropoffWrap?.slug_list ?? []).flatMap((s) => {
    const slug = str(s.slug);
    if (!slug) return [];
    return [{ slug, name: str(s.slug_name) || slug }];
  });

  return {
    infoNeeded: {
      pickup: arr(info.pickup),
      dropoff: arr(info.dropoff),
      nonIntegrated: arr(info.non_integrated),
    },
    pickup,
    dropoffBranches,
    dropoffSlugs,
  };
}

export type ShopeeShipOrderBody = {
  order_sn: string;
  pickup?: { address_id: number; pickup_time_id?: string };
  dropoff?: { branch_id?: number; slug?: string; sender_real_name?: string };
};

/**
 * shipOrder — POST /api/v2/logistics/ship_order (atur pengiriman).
 * Mode pickup: { order_sn, pickup: { address_id, pickup_time_id } }.
 * Mode dropoff: { order_sn, dropoff: { branch_id?, slug? } }.
 * Sukses = respons tanpa error (error "" = ok pada envelope Shopee).
 */
export async function shipOrder(
  accessToken: string,
  shopId: string | number,
  body: ShopeeShipOrderBody,
  creds?: ShopeeCreds
): Promise<Record<string, unknown>> {
  return postShopApi("/api/v2/logistics/ship_order", accessToken, shopId, body, creds);
}

export type ShopeeTrackingNumber = {
  trackingNumber: string | null;
  plpNumber: string | null;
  hint: string | null;
  pickupCode: string | null;
};

/**
 * getTrackingNumber — GET /api/v2/logistics/get_tracking_number.
 * Ditarik setelah ship_order: Shopee menerbitkan resi (booking) untuk order tsb.
 * Best-effort — resi kadang belum siap langsung setelah arrange.
 */
export async function getTrackingNumber(
  accessToken: string,
  shopId: string | number,
  orderSn: string,
  creds?: ShopeeCreds
): Promise<ShopeeTrackingNumber> {
  const r = await getShopApi("/api/v2/logistics/get_tracking_number", accessToken, shopId, creds, {
    order_sn: orderSn,
  });
  return {
    trackingNumber: str(r.tracking_number) || null,
    plpNumber: str(r.plp_number) || null,
    hint: str(r.hint) || null,
    pickupCode: str(r.pickup_code) || null,
  };
}

export async function getItemList(
  accessToken: string,
  shopId: string | number,
  opts: { offset?: number; pageSize?: number; itemStatus?: string[] } = {},
  creds?: ShopeeCreds
): Promise<{
  items: ShopeeItemSummary[];
  totalCount: number;
  hasMore: boolean;
  hasNextPage: boolean;
  nextOffset: number;
}> {
  const { offset = 0, pageSize = 50, itemStatus } = opts;
  // Default NORMAL: hanya listing aktif ditarik (UNLIST/BANNED/REVIEWING
  // tidak ikut — lihat backlog "item_status NORMAL"). Shopee butuh satu
  // panggilan per status bila ingin semua status.
  const status = itemStatus && itemStatus.length > 0 ? itemStatus : ["NORMAL"];
  const r = await getShopApi(
    "/api/v2/product/get_item_list",
    accessToken,
    shopId,
    creds,
    { offset, page_size: pageSize, item_status: status }
  );
  const items = (r.item as ShopeeItemSummary[] | undefined) ?? [];
  const hasNextPage =
    typeof r.has_next_page === "boolean"
      ? r.has_next_page
      : typeof r.has_more === "boolean"
        ? r.has_more
        : items.length >= pageSize;
  const nextOffset = typeof r.next_offset === "number" ? r.next_offset : offset + items.length;
  return {
    items,
    totalCount: Number(r.total_count ?? items.length),
    hasMore: hasNextPage,
    hasNextPage,
    nextOffset,
  };
}

export async function getItemBaseInfo(
  accessToken: string,
  shopId: string | number,
  itemIds: number[],
  creds?: ShopeeCreds
): Promise<Array<Record<string, unknown>>> {
  if (itemIds.length === 0) return [];
  const r = await getShopApi(
    "/api/v2/product/get_item_base_info",
    accessToken,
    shopId,
    creds,
    { item_id_list: itemIds }
  );
  return (r.item_list as Array<Record<string, unknown>> | undefined) ?? [];
}

/** Gambar utama item dari respons get_item_base_info (string[] / string / objek resmi Shopee). */
export function itemBaseImage(info: Record<string, unknown>): string | null {
  const img = info.image;
  if (typeof img === "string" && img.trim()) return img.trim();
  if (Array.isArray(img)) {
    for (const v of img) if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (img && typeof img === "object") {
    // Respons resmi get_item_base_info:
    //   image: { image_url_list: string[], image_id_list: string[] }
    // image_id_list = ID internal (bukan URL) → jangan dikembalikan.
    const urlList = (img as { image_url_list?: unknown }).image_url_list;
    if (Array.isArray(urlList)) {
      for (const v of urlList) {
        // Placeholder docs Shopee memakai "-" — bukan URL.
        if (typeof v === "string" && v.trim() && v.trim() !== "-") return v.trim();
      }
    }
  }
  const images = info.images;
  if (Array.isArray(images)) {
    for (const v of images) if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export type ShopeeModel = {
  model_id: number;
  model_sku?: string;
  model_status?: string;
};

/**
 * Stok dari get_model_list (atau base info utk item tanpa varian).
 * Respons kini memakai `stock_info_v2` — { summary_info.total_available_stock,
 * seller_stock[{location_id,stock}] }; `stock_info` lama (array per lokasi)
 * tetap dibaca utk respons lawas.
 * null = "tidak diketahui" (BERBEDA dari 0) — caller tidak boleh menulis stok.
 */
export function readStockInfo(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const v2 = r.stock_info_v2;
  if (v2 && typeof v2 === "object") {
    const o = v2 as Record<string, unknown>;
    const summary = o.summary_info;
    if (summary && typeof summary === "object") {
      const n = stockNumber((summary as Record<string, unknown>).total_available_stock);
      if (n !== null) return n;
    }
    if (Array.isArray(o.seller_stock)) {
      const total = sumStocks(o.seller_stock);
      if (total !== null) return total;
    }
  }

  const legacy = r.stock_info;
  if (Array.isArray(legacy)) {
    const total = sumStocks(legacy);
    if (total !== null) return total;
  }
  return null;
}

function stockNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.trunc(v));
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Math.max(0, Math.trunc(Number(v)));
  }
  return null;
}

function sumStocks(entries: unknown[]): number | null {
  let total = 0;
  let seen = false;
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const n = stockNumber((e as Record<string, unknown>).stock);
    if (n !== null) {
      total += n;
      seen = true;
    }
  }
  return seen ? total : null;
}

export async function getModelList(
  accessToken: string,
  shopId: string | number,
  itemId: number,
  creds?: ShopeeCreds
): Promise<{ models: ShopeeModel[]; itemSku?: string }> {
  const r = await getShopApi(
    "/api/v2/product/get_model_list",
    accessToken,
    shopId,
    creds,
    { item_id: itemId }
  );
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
  for (let page = 0; page < 200; page++) {
    const { items, hasNextPage, nextOffset } = await getItemList(accessToken, shopId, { offset, pageSize }, creds);
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
    if (!hasNextPage || nextOffset <= offset) break;
    offset = nextOffset;
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
    for (let page = 0; page < 200 && wanted.size > 0; page++) {
      const { items, hasNextPage, nextOffset } = await getItemList(accessToken, shopId, { offset, pageSize }, creds);
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
      if (!hasNextPage || nextOffset <= offset) break;
      offset = nextOffset;
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
export type ShopeeDiscount = {
  discount_id: number;
  discount_name?: string;
  status?: string; // upcoming | ongoing | expired
  start_time?: number;
  end_time?: number;
  source?: number;
};

/**
 * getDiscountList — daftar campaign diskon toko
 * (GET /api/v2/discount/get_discount_list, module v2.discount).
 * Params: discount_status (upcoming|ongoing|expired|all), page_no mulai 1,
 * page_size ≤ 100. Read-only — dipakai ingest promo ke halaman Promosi.
 */
export async function getDiscountList(
  accessToken: string,
  shopId: string | number,
  opts: { status: "upcoming" | "ongoing" | "expired" | "all"; pageNo?: number; pageSize?: number },
  creds?: ShopeeCreds
): Promise<{ discounts: ShopeeDiscount[]; more: boolean }> {
  const r = await getShopApi("/api/v2/discount/get_discount_list", accessToken, shopId, creds, {
    discount_status: opts.status,
    page_no: opts.pageNo ?? 1,
    page_size: Math.min(100, opts.pageSize ?? 100),
  });
  return {
    discounts: (r.discount_list as ShopeeDiscount[] | undefined) ?? [],
    more: Boolean(r.more),
  };
}

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
