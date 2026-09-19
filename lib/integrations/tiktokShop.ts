import crypto from "crypto";

const TIKTOK_API_BASE = "https://open-api.tiktokglobalshop.com";

/**
 * Error API TikTok terstruktur — dipakai audit trail promotion WRITE untuk
 * menyimpan tiktokCode/tiktokMessage/requestId tanpa parsing string.
 * .message identik dengan format error lama supaya catch site lama tidak berubah.
 */
export class TikTokApiError extends Error {
  code: number;
  requestId: string;
  kind: "AUTH" | "SCOPE" | "API";
  constructor(kind: "AUTH" | "SCOPE" | "API", code: number, message: string, requestId: string) {
    super(
      kind === "AUTH"
        ? `[Tokopedia | Shop] ⚠️ Auth error (${code}): ${message} | ${requestId}`
        : `[Tokopedia | Shop] API error (${code}): ${message} | ${requestId}`
    );
    this.name = "TikTokApiError";
    this.kind = kind;
    this.code = code;
    this.requestId = requestId;
  }
}

const APP_KEY = process.env.TIKTOK_APP_KEY!;
const APP_SECRET = process.env.TIKTOK_APP_SECRET!;

// Kredensial app partner. Default = env (perilaku lama); isi dari
// AppCredential (clientId=app_key, clientSecret=app_secret) bila ada
// multi-app — tanpa refactor pemanggil (param opsional di ekor).
export type TiktokCreds = { appKey: string; appSecret: string };

function envTiktokCreds(): TiktokCreds {
  if (!APP_KEY || !APP_SECRET) throw new Error("[TikTok] TIKTOK_APP_KEY/SECRET belum diisi.");
  return { appKey: APP_KEY, appSecret: APP_SECRET };
}

function generateSign(
  apiPath: string,
  queryParams: Record<string, string | number>,
  body: Record<string, unknown> | null,
  creds?: TiktokCreds
): string {
  const EXCLUDED_KEYS = ["sign", "access_token"];

  const sortedParamString = Object.keys(queryParams)
    .filter((key) => !EXCLUDED_KEYS.includes(key))
    .sort()
    .map((key) => `${key}${queryParams[key]}`)
    .join("");

  let signString = `${apiPath}${sortedParamString}`;

  if (body && typeof body === "object" && Object.keys(body).length > 0) {
    signString += JSON.stringify(body);
  }

  const secret = creds?.appSecret ?? APP_SECRET;
  signString = `${secret}${signString}${secret}`;

  return crypto
    .createHmac("sha256", secret)
    .update(signString)
    .digest("hex");
}

async function callApi(
  method: "GET" | "POST" | "PUT",
  apiPath: string,
  accessToken: string,
  queryParams: Record<string, string | number> = {},
  body: Record<string, unknown> | null = null,
  shopCipher?: string,
  creds?: TiktokCreds
): Promise<Record<string, unknown>> {
  const timestamp = Math.floor(Date.now() / 1000);

  const allQueryParams: Record<string, string | number> = {
    app_key: creds?.appKey ?? APP_KEY,
    timestamp,
    ...queryParams,
  };

  // Endpoint shop-scoped wajib membawa shop_cipher di query (code 106013 bila tanpa).
  // Inject SEBELUM sign supaya cipher tercakup dalam signature.
  if (shopCipher) {
    allQueryParams.shop_cipher = shopCipher;
  }

  const sign = generateSign(apiPath, allQueryParams, body, creds);
  allQueryParams.sign = sign;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(allQueryParams)) {
    qs.set(k, String(v));
  }

  const url = `${TIKTOK_API_BASE}${apiPath}?${qs.toString()}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-tts-access-token": accessToken,
      "User-Agent": "maxius-platform/1.0.0",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Body bisa non-JSON (HTML error page dsb.) — parse aman supaya HTTP error
  // tetap membawa pesan terstruktur TikTok, bukan SyntaxError yang membingungkan.
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }

  if (!res.ok) {
    // HTTP non-2xx TETAP sering membawa code/message/request_id TikTok di body
    // (mis. 400 = validasi payload attach). Sebelumnya error ini dilempar
    // generik sehingga audit kehilangan tiktokCode & pesan penyebab.
    const code = typeof data.code === "number" ? data.code : res.status;
    const message =
      (typeof data.message === "string" && data.message) ||
      `HTTP ${res.status} dari ${apiPath}`;
    const requestId = (data.request_id as string) || "-";

    const TOKEN_ERRORS = [105001, 105002, 105003, 105004];
    const SCOPE_ERRORS = [105005];
    if (TOKEN_ERRORS.includes(code)) {
      throw new TikTokApiError("AUTH", code, message, requestId);
    }
    if (SCOPE_ERRORS.includes(code)) {
      throw new TikTokApiError("SCOPE", code, message, requestId);
    }
    throw new TikTokApiError("API", code, message, requestId);
  }

  if (data && (data.code as number) !== 0) {
    const code = data.code as number;
    const message = (data.message as string) || "Unknown error";
    const requestId = (data.request_id as string) || "-";

    const TOKEN_ERRORS = [105001, 105002, 105003, 105004];
    const SCOPE_ERRORS = [105005];
    if (TOKEN_ERRORS.includes(code)) {
      throw new TikTokApiError("AUTH", code, message, requestId);
    }
    if (SCOPE_ERRORS.includes(code)) {
      throw new TikTokApiError("SCOPE", code, message, requestId);
    }
    throw new TikTokApiError("API", code, message, requestId);
  }

  return data;
}

export async function getAuthorizedShops(accessToken: string, creds?: TiktokCreds) {
  const result = await callApi("GET", "/authorization/202309/shops", accessToken, {}, null, undefined, creds);
  const shops = (result.data as { shops?: Array<Record<string, string>> } | undefined)?.shops;
  return shops ?? [];
}

// Refresh access token (berlaku default 7 hari, WAJIB refresh sebelum expired).
// Response memakai epoch absolut (access_token_expire_in), sama seperti get token.
export async function refreshAccessToken(refreshToken: string, creds?: TiktokCreds): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}> {
  const c = creds ?? envTiktokCreds();
  const url = new URL("https://auth.tiktok-shops.com/api/v2/token/refresh");
  url.searchParams.set("app_key", c.appKey);
  url.searchParams.set("app_secret", c.appSecret);
  url.searchParams.set("refresh_token", refreshToken);
  url.searchParams.set("grant_type", "refresh_token");
  const res = await fetch(url.toString());
  const data = (await res.json().catch(() => null)) as {
    code?: number;
    message?: string;
    data?: {
      access_token?: string;
      access_token_expire_in?: number;
      refresh_token?: string;
    };
  } | null;
  if (!res.ok || !data || data.code !== 0) {
    throw new TikTokApiError(
      "AUTH",
      data?.code ?? res.status,
      data?.message ?? `HTTP ${res.status} saat refresh token TikTok.`,
      "-",
    );
  }
  const d = data.data ?? {};
  if (!d.access_token || !d.refresh_token) {
    throw new TikTokApiError("AUTH", data.code ?? -1, "Refresh token TikTok tak lengkap.", "-");
  }
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    expiresAt: d.access_token_expire_in
      ? new Date(d.access_token_expire_in * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}

export async function searchPromotionActivities(
  accessToken: string,
  shopCipher: string,
  opts: { pageSize?: number; pageToken?: string } = {}
) {
  const body: Record<string, unknown> = { page_size: opts.pageSize ?? 100 };
  if (opts.pageToken) body.page_token = opts.pageToken;

  return callApi(
    "POST",
    "/promotion/202309/activities/search",
    accessToken,
    {},
    body,
    shopCipher
  );
}

export async function getPromotionActivity(
  accessToken: string,
  shopCipher: string,
  activityId: string
) {
  return callApi(
    "GET",
    `/promotion/202309/activities/${encodeURIComponent(activityId)}`,
    accessToken,
    {},
    null,
    shopCipher
  );
}

/* --------------------- Promotion WRITE (fitur create activity) ---------------------
 * HANYA dipakai oleh endpoint yang sudah melewati guardrail (preview harga,
 * validasi diskon, overlap check, konfirmasi eksplisit) di
 * lib/services/promotion-write.service.ts — jangan dipanggil langsung dari UI.
 * Payload wire snake_case; discount % DIRECT_DISCOUNT diset per-produk saat
 * ATTACH (PUT products), bukan di create — sesuai model SDK V202309.
 */

export type TikTokPromotionCreateInput = {
  activityType: string; // "DIRECT_DISCOUNT"
  title: string; // unik antar activity, maks 50 char (enforce di service)
  productLevel: string; // "PRODUCT" (iterasi 1)
  beginTime: number; // epoch DETIK, wajib masa depan
  endTime: number; // epoch DETIK, > beginTime
  durationType?: string; // default NORMAL
};

/** POST /promotion/202309/activities — create activity (BELUM termasuk produk). */
export async function createPromotionActivity(
  accessToken: string,
  shopCipher: string,
  input: TikTokPromotionCreateInput
): Promise<{ activityId: string | null; status: string | null }> {
  const body: Record<string, unknown> = {
    activity_type: input.activityType,
    title: input.title,
    product_level: input.productLevel,
    begin_time: input.beginTime,
    end_time: input.endTime,
  };
  if (input.durationType) body.duration_type = input.durationType;

  const result = await callApi("POST", "/promotion/202309/activities", accessToken, {}, body, shopCipher);
  const data = result.data as { activity_id?: string; status?: string } | undefined;
  return { activityId: data?.activity_id ?? null, status: data?.status ?? null };
}

export type TikTokPromotionProductInput = {
  id: string; // TikTok product ID
  discount: string; // persen diskon, mis. "10"
  quantityLimit?: number; // [1,99] atau -1 (unlimited)
  quantityPerUser?: number;
};

/**
 * PUT /promotion/202309/activities/{id}/products — attach/update produk.
 * Maks 300 SKU per call (di-enforce TikTok) — batching ditangani service layer.
 * PRODUCT level: skus WAJIB []; discount wajib utk DIRECT_DISCOUNT.
 */
export async function updatePromotionActivityProducts(
  accessToken: string,
  shopCipher: string,
  activityId: string,
  products: TikTokPromotionProductInput[]
): Promise<{ totalCount: number | null }> {
  // Tervalidasi runtime sandbox (error 36009004 "ActivityId is a required field"):
  // activity_id WAJIB ada di BODY (selain di path) — sesuai model SDK
  // UpdatePromotionActivityProductsRequestBody.activityId.
  const body = {
    activity_id: activityId,
    products: products.map((p) => ({
      id: p.id,
      discount: p.discount,
      skus: [],
      // Tervalidasi runtime sandbox (error 36009004): quantity_limit DAN
      // quantity_per_user WAJIB utk DIRECT_DISCOUNT attach — default -1
      // (unlimited) sesuai plan §4.4.
      quantity_limit: p.quantityLimit ?? -1,
      quantity_per_user: p.quantityPerUser ?? -1,
    })),
  };
  const result = await callApi(
    "PUT",
    `/promotion/202309/activities/${encodeURIComponent(activityId)}/products`,
    accessToken,
    {},
    body,
    shopCipher
  );
  const data = result.data as { total_count?: number } | undefined;
  return { totalCount: data?.total_count ?? null };
}

/** POST /promotion/202309/activities/{id}/deactivate — nonaktifkan activity. */
export async function deactivatePromotionActivity(
  accessToken: string,
  shopCipher: string,
  activityId: string
): Promise<void> {
  await callApi(
    "POST",
    `/promotion/202309/activities/${encodeURIComponent(activityId)}/deactivate`,
    accessToken,
    {},
    null,
    shopCipher
  );
}
/**
 * getOrders — list order TikTok Shop (read-only verifikasi).
 * Path & param divalidasi dari SDK orderV202309Api (POST /order/202309/orders/search).
 * Kirim body kosong untuk return semua order; shop_cipher inject via callApi sebelum sign.
 */
/**
 * searchReturns — daftar retur/refund buyer (Return & Refund API 202309).
 * POST /return/202309/returns/search — butuh scope seller.return_refund.basic.
 * Filter: return_id (satu), order_id_list, return_status list, create_time range.
 * Response: data.returns[] + next_page_token (paging kursor).
 */
export async function searchReturns(
  accessToken: string,
  shopCipher?: string,
  opts: {
    returnId?: string;
    orderIdList?: string[];
    returnStatus?: string[];
    createTimeFrom?: number;
    createTimeTo?: number;
    pageSize?: number;
    pageToken?: string;
  } = {}
) {
  const body: Record<string, unknown> = {};
  if (opts.returnId) body.return_id = opts.returnId;
  if (opts.orderIdList?.length) body.order_id_list = opts.orderIdList;
  if (opts.returnStatus?.length) body.return_status = opts.returnStatus;
  if (opts.createTimeFrom) body.create_time_from = opts.createTimeFrom;
  if (opts.createTimeTo) body.create_time_to = opts.createTimeTo;
  if (opts.pageToken) body.page_token = opts.pageToken;
  const result = await callApi(
    "POST",
    "/return/202309/returns/search",
    accessToken,
    { page_size: opts.pageSize ?? 20 },
    Object.keys(body).length > 0 ? body : null,
    shopCipher
  );
  const data = result.data as
    | { returns?: Array<Record<string, unknown>>; next_page_token?: string }
    | undefined;
  return {
    returns: data?.returns ?? [],
    nextPageToken: data?.next_page_token ?? null,
  };
}

export async function getOrders(
  accessToken: string,
  shopCipher?: string,
  opts: { pageSize?: number; orderStatus?: string } = {}
) {
  const { pageSize = 20, orderStatus } = opts;
  // Catatan penting (106001/sign invalid): bila body kosong `{}`, generateSign melewati
  // body TAPI fetch mengirim `"{}"` -> signature mismatch -> HTTP 401.
  // Karena itu kirim body null (tanpa body) saat tidak ada filter, dan hanya sertakan
  // filter non-kosong agar request body selaras dengan signature.
  const body: Record<string, unknown> | null = orderStatus ? { order_status: orderStatus } : null;
  const result = await callApi(
    "POST",
    "/order/202309/orders/search",
    accessToken,
    { page_size: pageSize },
    body,
    shopCipher
  );
  const data = result.data as
    | { orders?: Array<Record<string, unknown>>; next_page_token?: string }
    | undefined;
  return {
    orders: data?.orders ?? [],
    nextPageToken: data?.next_page_token ?? null,
  };
}

/**
 * getProduct — cari 1 produk TikTok via channelSku.
 * channelSku bisa berupa `seller_sku` ATAU `sku.id` ATAU `product.id`,
 * karena banyak produk (mis. RIKI) punya seller_sku kosong.
 */
export async function getProduct(
  accessToken: string,
  channelSku: string,
  shopCipher?: string
) {
  const apiPath = "/product/202309/products/search";
  const attempts: Array<Record<string, unknown>> = [
    { seller_skus: [channelSku] },
    { sku_ids: [channelSku] },
    { product_ids: [channelSku] },
  ];
  for (const body of attempts) {
    const result = await callApi("POST", apiPath, accessToken, { page_size: 1 }, body, shopCipher);
    const data = result.data as Record<string, unknown> | undefined;
    const products = data?.products as Record<string, unknown>[] | undefined;
    if (products && products.length > 0) return products[0];
  }
  return null;
}

/**
 * getProductCategory — ambil nama kategori produk via category_chains (leaf).
 * Order API TikTok TIDAK mengirim kategori line item; produk yang menyediakannya.
 * Dipakai best-effort untuk label (gagal → null, cetakan tetap jalan).
 */
export async function getProductCategory(
  accessToken: string,
  channelSku: string,
  shopCipher?: string
): Promise<string | null> {
  try {
    const product = await getProduct(accessToken, channelSku, shopCipher);
    const chains = (product?.category_chains as Array<Record<string, unknown>> | undefined) ?? [];
    const leaf = chains[chains.length - 1];
    const name = leaf?.name as string | undefined;
    return name?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * getShippingDocument — label pengiriman RESMI TikTok Shop.
 * GET /fulfillment/202309/packages/{package_id}/shipping_documents
 * Hanya berlaku untuk order "TikTok Shipping" (shipping_type=TIKTOK) yang sudah
 * di-ship. Mengembalikan URL dokumen (valid 24 jam) + nomor resi.
 *
 * documentType: SHIPPING_LABEL_PICTURE (PNG) | SHIPPING_LABEL (PDF) | PACKING_SLIP ...
 * documentFormat: PDF (default) | ZPL (BR/MX) — tidak berlaku utk SHIPPING_LABEL_PICTURE.
 * Dipaksa PDF saat penggabungan label batch (satu file utk dicetak sekaligus).
 */
export async function getShippingDocument(
  accessToken: string,
  shopCipher: string | undefined,
  packageId: string,
  documentType: string = "SHIPPING_LABEL",
  documentFormat?: string
): Promise<{ docUrl: string | null; trackingNumber: string | null }> {
  try {
    const result = await callApi(
      "GET",
      `/fulfillment/202309/packages/${encodeURIComponent(packageId)}/shipping_documents`,
      accessToken,
      {
        document_type: documentType,
        document_size: "A6",
        ...(documentFormat ? { document_format: documentFormat } : {}),
      },
      null,
      shopCipher
    );
    const data = result.data as
      | { doc_url?: string; tracking_number?: string }
      | undefined;
    return {
      docUrl: data?.doc_url ?? null,
      trackingNumber: data?.tracking_number ?? null,
    };
  } catch (e) {
    console.error("[Tokopedia | Shop] Gagal ambil shipping document:", e instanceof Error ? e.message : e);
    return { docUrl: null, trackingNumber: null };
  }
}

/**
 * getPackageDetail — detail paket TikTok (tracking, provider, status).
 * GET /fulfillment/202309/packages/{package_id}
 * Dipakai untuk polling setelah ship: TikTok meng-assign resi/kurir secara
 * ASYNC, response ShipPackage tidak memuat tracking number.
 */
export async function getPackageDetail(
  accessToken: string,
  shopCipher: string | undefined,
  packageId: string
): Promise<{
  trackingNumber: string | null;
  providerName: string | null;
  providerId: string | null;
  status: string | null;
}> {
  const result = await callApi(
    "GET",
    `/fulfillment/202309/packages/${encodeURIComponent(packageId)}`,
    accessToken,
    {},
    null,
    shopCipher
  );
  const d = (result.data ?? {}) as Record<string, unknown>;
  return {
    trackingNumber: (d.tracking_number as string | undefined) ?? null,
    providerName: (d.shipping_provider_name as string | undefined) ?? null,
    providerId: (d.shipping_provider_id as string | undefined) ?? null,
    status: (d.package_status as string | undefined) ?? null,
  };
}

/**
 * getPackageTracking — riwayat tracking logistik (timeline) per ORDER.
 * GET /fulfillment/202309/orders/{order_id}/tracking (scope seller.logistics)
 *
 * Response terverifikasi (sandbox, TAHAP 0): data.tracking[] berisi event
 * { action_code: number, description: string, update_time_millis: number }.
 * Timestamp dari TikTok DALAM MILIDETIK (beda dgn API TikTok lain yg detik).
 * Raw response dikembalikan apa adanya — parsing/mapping ke bentuk internal
 * dilakukan di service ingest (shipment-tracking.service.ts), bukan di sini.
 */
export async function getPackageTracking(
  accessToken: string,
  shopCipher: string | undefined,
  orderId: string
): Promise<{
  tracking: Array<{ action_code: number; description: string; update_time_millis: number }>;
}> {
  const result = await callApi(
    "GET",
    `/fulfillment/202309/orders/${encodeURIComponent(orderId)}/tracking`,
    accessToken,
    {},
    null,
    shopCipher
  );
  const data = (result.data ?? {}) as Record<string, unknown>;
  const tracking = (data.tracking as
    | Array<{ action_code?: number; description?: string; update_time_millis?: number }>
    | undefined);
  return {
    tracking: Array.isArray(tracking)
      ? tracking.map((e) => ({
          action_code: Number(e.action_code ?? 0),
          description: String(e.description ?? ""),
          update_time_millis: Number(e.update_time_millis ?? 0),
        }))
      : [],
  };
}

/**
 * getPackageHandoverTimeSlots — opsi penjemputan/penyerahan paket.
 * GET /fulfillment/202309/packages/{package_id}/handover_time_slots
 *
 * Menjawab mode handover yang tersedia (pickup/drop off/van collection) plus
 * slot waktu penjemputan yang bisa dipilih kurir. Hasil ini dipakai modal
 * "Atur Pengiriman" utk menampilkan tombol Request Pickup vs Drop Off dan
 * daftar slot jadwal pickup (hanya vsync ke /ship saat handover_method=PICKUP).
 */
export async function getPackageHandoverTimeSlots(
  accessToken: string,
  shopCipher: string | undefined,
  packageId: string
): Promise<{
  canPickup: boolean;
  canDropOff: boolean;
  canVanCollection: boolean;
  dropOffPointUrl: string | null;
  pickupSlots: Array<{ startTime: number; endTime: number; available: boolean }> | null;
}> {
  const result = await callApi(
    "GET",
    `/fulfillment/202309/packages/${encodeURIComponent(packageId)}/handover_time_slots`,
    accessToken,
    {},
    null,
    shopCipher
  );
  const d = (result.data ?? {}) as Record<string, unknown>;
  const slots = (d.pickup_slots as
    | Array<{ start_time?: number; end_time?: number; avaliable?: boolean }>
    | undefined);
  return {
    canPickup: (d.can_pickup as boolean | undefined) ?? false,
    canDropOff: (d.can_drop_off as boolean | undefined) ?? false,
    canVanCollection: (d.can_van_collection as boolean | undefined) ?? false,
    dropOffPointUrl: (d.drop_off_point_url as string | undefined) ?? null,
    pickupSlots: Array.isArray(slots)
      ? slots.map((s) => ({
          startTime: Number(s.start_time ?? 0),
          endTime: Number(s.end_time ?? 0),
          available: Boolean(s.avaliable),
        }))
      : null,
  };
}

/**
 * shipPackage — kirim paket TikTok Shop.
 * POST /fulfillment/202309/packages/{package_id}/ship
 *
 * Dua mode (sesuai shipping_type order):
 * - TikTok Shipping: `handoverMethod` ("PICKUP" | "DROP_OFF") + opsional
 *   `pickupSlot` (epoch seconds). TikTok meng-assign resi & kurir secara async
 *   setelah sukses → gunakan waitForPackageTracking() untuk polling.
 * - Seller Shipping: `selfShipment` = { shippingProviderId, trackingNumber }
 *   (merchant sudah punya resi dari kuriinya sendiri).
 */
export async function shipPackage(
  accessToken: string,
  shopCipher: string | undefined,
  packageId: string,
  options: {
    handoverMethod?: "PICKUP" | "DROP_OFF";
    pickupSlot?: { startTime?: number; endTime?: number };
    selfShipment?: { shippingProviderId?: string; trackingNumber?: string };
  } = {}
): Promise<{ requestId?: string }> {
  const body: Record<string, unknown> = {};
  if (options.handoverMethod) body.handover_method = options.handoverMethod;
  if (options.pickupSlot && (options.pickupSlot.startTime || options.pickupSlot.endTime)) {
    body.pickup_slot = {
      ...(options.pickupSlot.startTime ? { start_time: options.pickupSlot.startTime } : {}),
      ...(options.pickupSlot.endTime ? { end_time: options.pickupSlot.endTime } : {}),
    };
  }
  if (options.selfShipment) {
    body.self_shipment = {
      ...(options.selfShipment.shippingProviderId ? { shipping_provider_id: options.selfShipment.shippingProviderId } : {}),
      ...(options.selfShipment.trackingNumber ? { tracking_number: options.selfShipment.trackingNumber } : {}),
    };
  }

  // callApi melempar Error "[Tokopedia | Shop] ..." bila gagal (pola sama fungsi lain).
  const result = await callApi(
    "POST",
    `/fulfillment/202309/packages/${encodeURIComponent(packageId)}/ship`,
    accessToken,
    {},
    body,
    shopCipher
  );
  return { requestId: (result.request_id as string | undefined) ?? undefined };
}

/** sleep — helper kecil utk delay antar retry (ms). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * waitForPackageTracking — poll GetPackageDetail sampai tracking number muncul
 * (TikTok Shipping assign resi async). Default: hingga 4 percobaan, jeda 3 detik.
 */
export async function waitForPackageTracking(
  accessToken: string,
  shopCipher: string | undefined,
  packageId: string,
  opts: { attempts?: number; delayMs?: number } = {}
): Promise<{
  trackingNumber: string | null;
  providerName: string | null;
  providerId: string | null;
  status: string | null;
}> {
  const { attempts = 4, delayMs = 3000 } = opts;
  let last = await getPackageDetail(accessToken, shopCipher, packageId);
  for (let i = 1; i < attempts && !last.trackingNumber; i++) {
    await sleep(delayMs);
    last = await getPackageDetail(accessToken, shopCipher, packageId);
  }
  return last;
}

export async function updateStock(
  accessToken: string,
  channelSku: string,
  newStock: number,
  shopCipher?: string
) {
  const product = await getProduct(accessToken, channelSku, shopCipher);
  if (!product) {
    throw new Error(`[Tokopedia | Shop] SKU "${channelSku}" tidak ditemukan.`);
  }

  const productId = product.id as string;
  const skus = (product.skus as Array<Record<string, unknown>>) || [];
  // Cocokkan via seller_sku ATAU sku.id (produk boleh punya seller_sku kosong).
  const matchingSku =
    skus.find((s) => s.seller_sku === channelSku) ||
    skus.find((s) => s.id === channelSku);

  if (!matchingSku) {
    throw new Error(`[Tokopedia | Shop] SKU detail "${channelSku}" tidak cocok.`);
  }

  const skuId = matchingSku.id as string;
  const apiPath = `/product/202309/products/${productId}/inventory/update`;

  const body = {
    skus: [
      {
        id: skuId,
        inventory: [{ warehouse_id: "", quantity: newStock }],
      },
    ],
  };

  return callApi("POST", apiPath, accessToken, {}, body, shopCipher);

}

/**
 * updateStockBatch — update stok BANYAK SKU sekaligus (TUGAS 3, anti rate-limit).
 *
 * Sebelumnya tiap SKU = getProduct (hingga 3 call search) + 1 call update;
 * di volume tinggi ini boros call & mudah kena rate limit. Versi batch:
 *   1. SATU call search dengan seller_skus[] (paginated s.d. habis),
 *   2. kelompokkan SKU per product_id (update endpoint bekerja per produk,
 *      body-nya memang array skus[] — didukung API),
 *   3. SATU call /inventory/update per produk berisi semua SKU-nya.
 *
 * SKU yang tidak ketemu di search dilaporkan di `failed` (bukan melempar),
 * supaya batch lain tetap jalan.
 */
export type StockBatchItem = { channelSku: string; quantity: number };
export type StockBatchResult = {
  ok: StockBatchItem[];
  // error disimpan sebagai objek asli (mis. TikTokApiError) — pemanggil
  // (queue push stok) butuh tipenya utk membedakan rate-limit vs permanen.
  failed: Array<{ item: StockBatchItem; error: unknown }>;
};

export async function updateStockBatch(
  accessToken: string,
  items: StockBatchItem[],
  shopCipher?: string
): Promise<StockBatchResult> {
  const result: StockBatchResult = { ok: [], failed: [] };
  if (items.length === 0) return result;

  // 1. Cari produk untuk semua SKU sekaligus (seller_skus[] di-search endpoint).
  // Map hasil: seller_sku → { productId, skuId } (skuId = ID internal TikTok
  // yang dibutuhkan endpoint update, bukan seller_sku).
  const wanted = new Set(items.map((i) => i.channelSku));
  const resolved = new Map<string, { productId: string; skuId: string }>();
  let pageToken: string | null = null;
  do {
    const search = await searchProducts(accessToken, shopCipher, {
      pageSize: 100,
      sellerSkus: [...wanted],
      pageToken: pageToken ?? undefined,
    });
    for (const product of search.products) {
      const productId = product.id as string;
      const skus = (product.skus as Array<Record<string, unknown>>) || [];
      for (const s of skus) {
        const skuId = s.id as string;
        const sellerSku = s.seller_sku as string | undefined;
        if (!skuId) continue;
        // channelSku di mapping bisa berupa seller_sku ATAU sku id (fallback
        // getProduct lama menerima keduanya — sandbox nyata membuktikan keduanya
        // muncul dan TIDAK selalu sama). Cocokkan dua-duanya.
        for (const w of wanted) {
          if (w === sellerSku || w === skuId) resolved.set(w, { productId, skuId });
        }
      }
    }
    pageToken = search.nextPageToken;
  } while (pageToken);

  // 2. Kelompokkan per produk (update endpoint bekerja per product_id,
  //    body-nya array skus[] — beberapa SKU satu produk = satu call).
  const skusByProduct = new Map<string, Array<{ id: string; item: StockBatchItem }>>();
  for (const item of items) {
    const hit = resolved.get(item.channelSku);
    if (!hit) {
      result.failed.push({ item, error: `SKU "${item.channelSku}" tidak ditemukan di TikTok Shop.` });
      continue;
    }
    const bucket = skusByProduct.get(hit.productId) ?? [];
    bucket.push({ id: hit.skuId, item });
    skusByProduct.set(hit.productId, bucket);
  }

  // 3. Satu call update per produk, berisi semua SKU-nya.
  //    warehouse_id WAJIB id gudang riil (E2E sandbox: "" → 400 code
  //    36009004 "must be convertible to Int64" — updateStock lama juga kena).
  //    Resolve via inventory/search per produk; fallback "" tetap dikirim agar
  //    error API terlihat jelas di SyncLog, bukan silent.
  const warehouseCache = new Map<string, string>();
  for (const [productId, skus] of skusByProduct) {
    let warehouseId = warehouseCache.get(productId);
    if (warehouseId === undefined) {
      try {
        const whs = await getProductWarehouses(accessToken, shopCipher, productId);
        warehouseId = whs[0] ?? "";
      } catch {
        warehouseId = "";
      }
      warehouseCache.set(productId, warehouseId);
    }
    const apiPath = `/product/202309/products/${productId}/inventory/update`;
    const body = {
      skus: skus.map((s) => ({
        id: s.id,
        inventory: [{ warehouse_id: warehouseId, quantity: s.item.quantity }],
      })),
    };
    try {
      await callApi("POST", apiPath, accessToken, {}, body, shopCipher);
      result.ok.push(...skus.map((s) => s.item));
    } catch (err) {
      for (const s of skus) result.failed.push({ item: s.item, error: err });
    }
  }

  return result;
}

/**
 * updatePrice — ubah harga tayang SKU TikTok Shop.
 * POST /product/202309/products/{product_id}/prices/update
 *
 * Mirip updateStock: cari product via channelSku (seller_sku / sku.id /
 * product.id), cocokkan SKU-nya, lalu update `price.amount` (IDR).
 * `amount` wajib string di payload TikTok.
 */
export async function updatePrice(
  accessToken: string,
  channelSku: string,
  newPrice: number,
  shopCipher?: string
) {
  const product = await getProduct(accessToken, channelSku, shopCipher);
  if (!product) {
    throw new Error(`[Tokopedia | Shop] SKU "${channelSku}" tidak ditemukan.`);
  }

  const productId = product.id as string;
  const skus = (product.skus as Array<Record<string, unknown>>) || [];
  const matchingSku =
    skus.find((s) => s.seller_sku === channelSku) ||
    skus.find((s) => s.id === channelSku);

  if (!matchingSku) {
    throw new Error(`[Tokopedia | Shop] SKU detail "${channelSku}" tidak cocok.`);
  }

  const skuId = matchingSku.id as string;
  const apiPath = `/product/202309/products/${productId}/prices/update`;

  const body = {
    skus: [
      {
        id: skuId,
        price: { amount: String(newPrice), currency: "IDR" },
      },
    ],
  };

  return callApi("POST", apiPath, accessToken, {}, body, shopCipher);
}

/**
 * searchProducts — daftar produk TikTok Shop (pagination).
 * POST /product/202309/products/search
 *
 * Query: `page_size` (s.d. 100) + `page_token` (dari response next_page_token).
 * Body opsional: `status` (ALL/DRAFT/PENDING/FAILED/ACTIVATE/SELLER_DEACTIVATED/
 * PLATFORM_DEACTIVATED/FREEZE/DELETED/SCHEDULED), `seller_skus`, dll.
 * data.products[].status = status asli listing (ACTIVE/ACTIVATE, dll).
 */
export async function searchProducts(
  accessToken: string,
  shopCipher: string | undefined,
  opts: {
    pageSize?: number;
    status?: string;
    sellerSkus?: string[];
    pageToken?: string;
  } = {}
): Promise<{
  products: Array<Record<string, unknown>>;
  totalCount: number;
  nextPageToken: string | null;
}> {
  const { pageSize = 100, status, sellerSkus, pageToken } = opts;
  const query: Record<string, string | number> = { page_size: pageSize };
  if (pageToken) query.page_token = pageToken;

  const body: Record<string, unknown> = {};
  if (status) body.status = status;
  if (sellerSkus && sellerSkus.length > 0) body.seller_skus = sellerSkus;

  const hasBody = Object.keys(body).length > 0;
  const result = await callApi(
    "POST",
    "/product/202309/products/search",
    accessToken,
    query,
    hasBody ? body : null,
    shopCipher
  );
  const data = result.data as
    | { products?: Array<Record<string, unknown>>; total_count?: number; next_page_token?: string }
    | undefined;
  return {
    products: data?.products ?? [],
    totalCount: data?.total_count ?? 0,
    nextPageToken: data?.next_page_token ?? null,
  };
}

/**
 * updateProductStatus — aktifkan / nonaktifkan listing TikTok Shop.
 * POST /product/202309/products/activate | deactivate — body { product_ids: [...] }.
 */
export async function updateProductStatus(
  accessToken: string,
  shopCipher: string | undefined,
  productId: string,
  active: boolean
): Promise<{ requestId?: string }> {
  const apiPath = active
    ? "/product/202309/products/activate"
    : "/product/202309/products/deactivate";
  const result = await callApi(
    "POST",
    apiPath,
    accessToken,
    {},
    { product_ids: [productId] },
    shopCipher
  );
  return { requestId: (result.request_id as string | undefined) ?? undefined };
}

/**
 * productMainImage — ambil gambar utama produk untuk thumbnail listing.
 * best-effort dari payload produk. Bentuk field berbeda antar endpoint:
 * search mewariskan `main_image`/`images` (string atau {url}), sedangkan
 * detail produk memakai `main_images` (array {urls[], thumb_urls[], uri}).
 */
export function productMainImage(product: Record<string, unknown>): string | null {
  const mainImages = product.main_images;
  if (Array.isArray(mainImages)) {
    for (const img of mainImages) {
      if (typeof img === "string" && img) return img;
      const urls = (img as { urls?: unknown })?.urls;
      if (Array.isArray(urls) && typeof urls[0] === "string" && urls[0]) return urls[0];
      const thumbs = (img as { thumb_urls?: unknown })?.thumb_urls;
      if (Array.isArray(thumbs) && typeof thumbs[0] === "string" && thumbs[0]) return thumbs[0];
      const url = (img as { url?: unknown })?.url;
      if (typeof url === "string" && url) return url;
    }
  }
  const images = product.main_image ?? product.sku_images ?? product.images ?? [];
  if (typeof images === "string") return images || null;
  if (!Array.isArray(images)) {
    const url = (images as { url?: unknown })?.url;
    return typeof url === "string" && url ? url : null;
  }
  for (const img of images) {
    if (typeof img === "string" && img) return img;
    const url = (img as { url?: unknown })?.url;
    if (typeof url === "string" && url) return url;
  }
  return null;
}

/**
 * productSkuStock — total stok tersedia sebuah SKU TikTok Shop
 * (sum `quantity` atas semua entry inventory / warehouse).
 */
export function productSkuStock(sku: Record<string, unknown>): number {
  const inventory = sku.inventory;
  if (!Array.isArray(inventory)) return 0;
  return inventory.reduce(
    (sum, entry) => sum + (Number((entry as { quantity?: unknown })?.quantity) || 0),
    0
  );
}

/**
 * getProductDetail — detail lengkap produk TikTok Shop (utk form edit).
 * GET /product/202309/products/{product_id}
 * Response: objek produk langsung di `data` (bukan data.product).
 */
export async function getProductDetail(
  accessToken: string,
  shopCipher: string | undefined,
  productId: string
): Promise<Record<string, unknown>> {
  const result = await callApi(
    "GET",
    `/product/202309/products/${encodeURIComponent(productId)}`,
    accessToken,
    {},
    null,
    shopCipher
  );
  const data = result.data as Record<string, unknown> | undefined;
  return (data?.product as Record<string, unknown> | undefined) ?? data ?? {};
}

/**
 * getCategories — daftar kategori TikTok Shop (search by keyword).
 * GET /product/202309/categories?keyword=...
 * Mengembalikan rantai kategori (parent → leaf) yang cocok dgn keyword.
 */
export async function getCategories(
  accessToken: string,
  shopCipher: string | undefined,
  keyword?: string,
  listingPlatform?: string
): Promise<Array<Record<string, unknown>>> {
  const query: Record<string, string> = {};
  if (keyword && keyword.trim()) query.keyword = keyword.trim();
  if (listingPlatform) query.listing_platform = listingPlatform;
  const result = await callApi("GET", "/product/202309/categories", accessToken, query, null, shopCipher);
  const data = result.data as { categories?: Array<Record<string, unknown>> } | undefined;
  return data?.categories ?? [];
}

/**
 * getCategoryAttributes — skema atribut (wajib & opsional) utk sebuah kategori.
 * GET /product/202309/categories/{category_id}/attributes
 * Atribut bertipe PRODUCT_PROPERTY (deskripsi) & SALES_PROPERTY (varian);
 * `is_required` mungkin datang sbg is_requried (typo API resmi).
 */
export async function getCategoryAttributes(
  accessToken: string,
  shopCipher: string | undefined,
  categoryId: string,
  locale = "id-ID"
): Promise<Array<Record<string, unknown>>> {
  const result = await callApi(
    "GET",
    `/product/202309/categories/${encodeURIComponent(categoryId)}/attributes`,
    accessToken,
    { locale },
    null,
    shopCipher
  );
  const data = result.data as { attributes?: Array<Record<string, unknown>> } | undefined;
  return data?.attributes ?? [];
}

/**
 * getCategoryRules — persyaratan tambahan kategori (sertifikasi, COD, dimensi).
 * GET /product/202309/categories/{category_id}/rules
 * product_certifications → daftar id sertifikat (Halal/BPOM dll) + required.
 */
export async function getCategoryRules(
  accessToken: string,
  shopCipher: string | undefined,
  categoryId: string
): Promise<Record<string, unknown>> {
  const result = await callApi(
    "GET",
    `/product/202309/categories/${encodeURIComponent(categoryId)}/rules`,
    accessToken,
    {},
    null,
    shopCipher
  );
  return (result.data as Record<string, unknown> | undefined) ?? {};
}

/**
 * callApiMultipart — POST multipart ke TikTok Shop (upload gambar/file).
 * Body bukan JSON sehingga signature dihitung tanpa body; `data` dibawa sbg Blob.
 */
async function callApiMultipart(
  apiPath: string,
  accessToken: string,
  form: FormData,
  creds?: TiktokCreds
): Promise<Record<string, unknown>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const queryParams: Record<string, string | number> = { app_key: creds?.appKey ?? APP_KEY, timestamp };
  // Sertakan shop_cipher bila path menuntut (bawaan pemanggil via param).
  const sign = generateSign(apiPath, queryParams, null, creds);
  queryParams.sign = sign;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(queryParams)) qs.set(k, String(v));

  const res = await fetch(`${TIKTOK_API_BASE}${apiPath}?${qs.toString()}`, {
    method: "POST",
    headers: { "x-tts-access-token": accessToken, "User-Agent": "maxius-platform/1.0.0" },
    body: form,
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`[Tokopedia | Shop] HTTP ${res.status} dari ${apiPath}`);

  if (data && (data.code as number) !== 0) {
    const code = data.code as number;
    const message = (data.message as string) || "Unknown error";
    const requestId = (data.request_id as string) || "-";
    const TOKEN_ERRORS = [105001, 105002, 105003, 105004];
    if (TOKEN_ERRORS.includes(code)) {
      throw new Error(`[Tokopedia | Shop] ⚠️ Auth error (${code}): ${message} | ${requestId}`);
    }
    throw new Error(`[Tokopedia | Shop] API error (${code}): ${message} | ${requestId}`);
  }
  return data;
}

/**
 * uploadProductImage — upload gambar ke TikTok Shop.
 * POST /product/202309/images/upload (multipart, use_case=MAIN_IMAGE).
 * Semua gambar produk TIKTOK WAJIB lewat API ini (URL asing ditolak).
 */
export async function uploadProductImage(
  accessToken: string,
  buffer: Buffer,
  useCase = "MAIN_IMAGE",
  fileName = "image.jpg"
): Promise<{ uri: string; url: string | null }> {
  const form = new FormData();
  form.append("data", new Blob([buffer as unknown as BlobPart]), fileName);
  form.append("use_case", useCase);
  const result = await callApiMultipart("/product/202309/images/upload", accessToken, form);
  const data = result.data as { uri?: string; url?: string } | undefined;
  const uri = data?.uri;
  if (!uri) throw new Error("[Tokopedia | Shop] Upload gambar tak mengembalikan uri.");
  return { uri, url: data?.url ?? null };
}

/**
 * uploadProductFile — upload dokumen non-gambar (sertifikasi, dll).
 * POST /product/202309/files/upload (multipart) — balas file_id + url + format.
 */
export async function uploadProductFile(
  accessToken: string,
  buffer: Buffer,
  fileName: string
): Promise<{ id: string; name: string; url: string | null; format: string | null }> {
  const form = new FormData();
  form.append("data", new Blob([buffer as unknown as BlobPart]), fileName);
  form.append("name", fileName);
  const result = await callApiMultipart("/product/202309/files/upload", accessToken, form);
  const data = result.data as { id?: string; name?: string; url?: string; format?: string } | undefined;
  const id = data?.id;
  if (!id) throw new Error("[Tokopedia | Shop] Upload file tak mengembalikan id.");
  return { id, name: data?.name ?? fileName, url: data?.url ?? null, format: data?.format ?? null };
}

/**
 * editProduct — update produk TikTok Shop (orchestrasi di service edit).
 * PUT /product/202309/products/{product_id} — save_mode LISTING (langsung audit).
 */
export async function editProduct(
  accessToken: string,
  shopCipher: string | undefined,
  productId: string,
  payload: Record<string, unknown>
): Promise<{ productId: string; auditStatus?: string }> {
  const result = await callApi(
    "PUT",
    `/product/202309/products/${encodeURIComponent(productId)}`,
    accessToken,
    {},
    payload,
    shopCipher
  );
  const data = result.data as
    | { product_id?: string; audit?: { status?: string } }
    | undefined;
  return {
    productId: (data?.product_id as string) ?? productId,
    auditStatus: data?.audit?.status,
  };
}

/**
 * getProductWarehouses — daftar warehouse_id yg kena produk tsb.
 * POST /product/202309/inventory/search (body product_ids) → warehouse_inventory.
 * Dipakai Edit Product utk menyertakan warehouse_id pada masing-masing sku.
 */
export async function getProductWarehouses(
  accessToken: string,
  shopCipher: string | undefined,
  productId: string
): Promise<string[]> {
  const result = await callApi(
    "POST",
    "/product/202309/inventory/search",
    accessToken,
    {},
    { product_ids: [productId] },
    shopCipher
  );
  const inventory = (result.data as
    | {
        inventory?: Array<{
          skus?: Array<{
            warehouse_inventory?: Array<{ warehouse_id?: string }>;
          }>;
        }>;
      }
    | undefined)?.inventory;
  const ids = new Set<string>();
  for (const inv of inventory ?? []) {
    for (const sku of inv.skus ?? []) {
      for (const wh of sku.warehouse_inventory ?? []) {
        if (wh.warehouse_id) ids.add(wh.warehouse_id);
      }
    }
  }
  return Array.from(ids);
}
