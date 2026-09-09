import crypto from "crypto";

const TIKTOK_API_BASE = "https://open-api.tiktokglobalshop.com";

const APP_KEY = process.env.TIKTOK_APP_KEY!;
const APP_SECRET = process.env.TIKTOK_APP_SECRET!;

function generateSign(
  apiPath: string,
  queryParams: Record<string, string | number>,
  body: Record<string, unknown> | null
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

  signString = `${APP_SECRET}${signString}${APP_SECRET}`;

  return crypto
    .createHmac("sha256", APP_SECRET)
    .update(signString)
    .digest("hex");
}

async function callApi(
  method: "GET" | "POST",
  apiPath: string,
  accessToken: string,
  queryParams: Record<string, string | number> = {},
  body: Record<string, unknown> | null = null,
  shopCipher?: string
): Promise<Record<string, unknown>> {
  const timestamp = Math.floor(Date.now() / 1000);

  const allQueryParams: Record<string, string | number> = {
    app_key: APP_KEY,
    timestamp,
    ...queryParams,
  };

  // Endpoint shop-scoped wajib membawa shop_cipher di query (code 106013 bila tanpa).
  // Inject SEBELUM sign supaya cipher tercakup dalam signature.
  if (shopCipher) {
    allQueryParams.shop_cipher = shopCipher;
  }

  const sign = generateSign(apiPath, allQueryParams, body);
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

  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    throw new Error(`[TikTok Shop] HTTP ${res.status} dari ${apiPath}`);
  }

  if (data && (data.code as number) !== 0) {
    const code = data.code as number;
    const message = (data.message as string) || "Unknown error";
    const requestId = (data.request_id as string) || "-";

    const TOKEN_ERRORS = [105001, 105002, 105003, 105004];
    if (TOKEN_ERRORS.includes(code)) {
      throw new Error(
        `[TikTok Shop] ⚠️ Auth error (${code}): ${message} | ${requestId}`
      );
    }
    throw new Error(
      `[TikTok Shop] API error (${code}): ${message} | ${requestId}`
    );
  }

  return data;
}

export async function getAuthorizedShops(accessToken: string) {
  const result = await callApi("GET", "/authorization/202309/shops", accessToken);
  const shops = (result.data as { shops?: Array<Record<string, string>> } | undefined)?.shops;
  return shops ?? [];
}
/**
 * getOrders — list order TikTok Shop (read-only verifikasi).
 * Path & param divalidasi dari SDK orderV202309Api (POST /order/202309/orders/search).
 * Kirim body kosong untuk return semua order; shop_cipher inject via callApi sebelum sign.
 */
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
    console.error("[TikTok Shop] Gagal ambil shipping document:", e instanceof Error ? e.message : e);
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

  // callApi melempar Error "[TikTok Shop] ..." bila gagal (pola sama fungsi lain).
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
    throw new Error(`[TikTok Shop] SKU "${channelSku}" tidak ditemukan.`);
  }

  const productId = product.id as string;
  const skus = (product.skus as Array<Record<string, unknown>>) || [];
  // Cocokkan via seller_sku ATAU sku.id (produk boleh punya seller_sku kosong).
  const matchingSku =
    skus.find((s) => s.seller_sku === channelSku) ||
    skus.find((s) => s.id === channelSku);

  if (!matchingSku) {
    throw new Error(`[TikTok Shop] SKU detail "${channelSku}" tidak cocok.`);
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
    throw new Error(`[TikTok Shop] SKU "${channelSku}" tidak ditemukan.`);
  }

  const productId = product.id as string;
  const skus = (product.skus as Array<Record<string, unknown>>) || [];
  const matchingSku =
    skus.find((s) => s.seller_sku === channelSku) ||
    skus.find((s) => s.id === channelSku);

  if (!matchingSku) {
    throw new Error(`[TikTok Shop] SKU detail "${channelSku}" tidak cocok.`);
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
