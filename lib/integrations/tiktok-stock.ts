import { TikTokApiError, type TiktokCreds } from "./tiktokShop";
import { safeStockPushMessage } from "@/lib/services/stock-push-error";
export type StockBatchItem = { channelSku: string; quantity: number; productId?: string; skuId?: string; sellerSku?: string };
export type StockBatchResult = { ok: StockBatchItem[]; failed: Array<{ item: StockBatchItem; error: unknown }> };
type Api = (method: "GET" | "POST" | "PUT", path: string, token: string, query: Record<string, string | number>, body: Record<string, unknown> | null, cipher?: string, creds?: TiktokCreds) => Promise<Record<string, unknown>>;
type Sku = { id?: string; seller_sku?: string; warehouse_inventory?: Array<{ warehouse_id?: string }> };
type Hit = { productId: string; skuId: string; warehouses: string[] };

export async function resolveTikTokStockItems(api: Api, token: string, items: StockBatchItem[], cipher?: string, creds?: TiktokCreds) {
  const candidates = new Map<string, Map<string, Hit>>();
  const mismatched = new Set<string>();
  const add = (productId: string, sku: Sku) => {
    if (!sku.id || !productId) return;
    for (const item of items) {
      const match = item.skuId ? item.skuId === sku.id : item.channelSku === sku.id || (item.sellerSku ?? item.channelSku) === sku.seller_sku;
      if (!match) continue;
      if ((item.productId && item.productId !== productId) || (item.sellerSku && sku.seller_sku && item.sellerSku !== sku.seller_sku)) {
        if (item.skuId === sku.id || item.channelSku === sku.id) mismatched.add(item.channelSku);
        continue;
      }
      const key = productId + ":" + sku.id;
      const bucket = candidates.get(item.channelSku) ?? new Map<string, Hit>();
      const warehouses = [...new Set((sku.warehouse_inventory ?? []).flatMap((warehouse) => warehouse.warehouse_id ? [warehouse.warehouse_id] : []))];
      bucket.set(key, { productId, skuId: sku.id, warehouses: warehouses.length ? warehouses : bucket.get(key)?.warehouses ?? [] });
      candidates.set(item.channelSku, bucket);
    }
  };
  const inventory = async (body: Record<string, unknown>) => {
    const response = await api("POST", "/product/202309/inventory/search", token, {}, body, cipher, creds);
    const rows = (response.data as { inventory?: Array<{ product_id?: string; skus?: Sku[] }> } | undefined)?.inventory;
    if (!Array.isArray(rows)) throw new Error("[TikTok] Respons Inventory Search tidak lengkap; identitas SKU belum terverifikasi.");
    for (const row of rows) for (const sku of row.skus ?? []) add(row.product_id ?? "", sku);
  };
  const ids = [...new Set(items.flatMap((item) => item.skuId ? [item.skuId] : /^\d+$/.test(item.channelSku) ? [item.channelSku] : []))];
  for (let offset = 0; offset < ids.length; offset += 600) await inventory({ sku_ids: ids.slice(offset, offset + 600) });
  const productIds = [...new Set(items.flatMap((item) => item.productId ? [item.productId] : []))];
  for (let offset = 0; offset < productIds.length; offset += 100) await inventory({ product_ids: productIds.slice(offset, offset + 100) });
  const sellers = [...new Set(items.filter((item) => !item.skuId && !candidates.has(item.channelSku)).map((item) => item.sellerSku ?? item.channelSku))];
  for (let offset = 0; offset < sellers.length; offset += 10) {
    let pageToken: string | undefined; const seen = new Set<string>();
    do {
      const response = await api("POST", "/product/202502/products/search", token, { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) }, { seller_skus: sellers.slice(offset, offset + 10) }, cipher, creds);
      const data = response.data as { products?: Array<{ id?: string; skus?: Sku[] }>; next_page_token?: string } | undefined;
      if (!Array.isArray(data?.products)) throw new Error("[TikTok] Respons Search Products tidak lengkap.");
      for (const product of data.products) for (const sku of product.skus ?? []) add(product.id ?? "", sku);
      pageToken = data.next_page_token || undefined;
      if (pageToken && (seen.has(pageToken) || seen.size >= 100)) throw new Error("[TikTok] Pagination belum tuntas; keunikan SKU tidak dapat dipastikan.");
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
  }
  const missingWarehouse = [...new Set([...candidates.values()].flatMap((bucket) => [...bucket.values()].filter((hit) => !hit.warehouses.length).map((hit) => hit.productId)))];
  for (let offset = 0; offset < missingWarehouse.length; offset += 100) await inventory({ product_ids: missingWarehouse.slice(offset, offset + 100) });
  const resolved = new Map<string, Hit>(); const failed: StockBatchResult["failed"] = [];
  for (const item of items) {
    const matches = [...(candidates.get(item.channelSku)?.values() ?? [])];
    if (matches.length !== 1 || mismatched.has(item.channelSku)) failed.push({ item, error: new Error(`[TikTok] ${mismatched.has(item.channelSku) ? "SKU_MISMATCH" : matches.length ? "SKU_AMBIGUOUS" : "SKU_NOT_FOUND"}: "${item.channelSku}"; diperiksa melalui inventory/search dan seller_skus. Tinjau SKU ID, product ID, dan seller SKU pada mapping toko.`) });
    else resolved.set(item.channelSku, matches[0]);
  }
  return { resolved, failed };
}

export async function sendTikTokStockBatch(api: Api, token: string, items: StockBatchItem[], cipher?: string, creds?: TiktokCreds): Promise<StockBatchResult> {
  const result: StockBatchResult = { ok: [], failed: [] };
  const valid = items.filter((item) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > 99999) { result.failed.push({ item, error: new Error("[TikTok] Quantity harus bilangan bulat 0–99.999; stok pusat tidak diubah.") }); return false; }
    return true;
  });
  if (!valid.length) return result;
  const resolution = await resolveTikTokStockItems(api, token, valid, cipher, creds);
  result.failed.push(...resolution.failed);
  const groups = new Map<string, Array<{ item: StockBatchItem; hit: Hit }>>();
  for (const item of valid) {
    const hit = resolution.resolved.get(item.channelSku); if (!hit) continue;
    if (hit.warehouses.length !== 1) { result.failed.push({ item, error: new Error("[TikTok] SKU membutuhkan satu gudang marketplace terverifikasi; beberapa gudang memerlukan alokasi eksplisit sebelum push.") }); continue; }
    const bucket = groups.get(hit.productId) ?? []; bucket.push({ item, hit }); groups.set(hit.productId, bucket);
  }
  for (const [productId, group] of groups) {
    const targets = group.filter(({ hit, item }) => {
      if (group.filter((entry) => entry.hit.skuId === hit.skuId).length > 1) { result.failed.push({ item, error: new Error("[TikTok] Dua mapping menarget SKU ID yang sama; push ditolak agar tidak menimpa stok yang salah.") }); return false; }
      return true;
    });
    if (!targets.length) continue;
    try {
      const response = await api("POST", `/product/202309/products/${encodeURIComponent(productId)}/inventory/update`, token, {}, {
        skus: targets.map(({ hit, item }) => ({ id: hit.skuId, inventory: [{ warehouse_id: hit.warehouses[0], quantity: item.quantity }] })),
      }, cipher, creds);
      const data = response.data as { errors?: Array<{ code?: number; message?: string; detail?: { sku_id?: string; extra_errors?: Array<{ code?: number; message?: string }> } }> } | undefined;
      if (!data || (data.errors !== undefined && !Array.isArray(data.errors))) throw new Error("[TikTok] Respons update inventory tidak lengkap; keberhasilan belum dapat dipastikan.");
      const unknownError = data.errors?.some((error) => error.detail?.sku_id && !targets.some(({ hit }) => hit.skuId === error.detail!.sku_id));
      for (const { hit, item } of targets) {
        const errors = data.errors?.filter((error) => unknownError || !error.detail?.sku_id || error.detail.sku_id === hit.skuId) ?? [];
        if (errors.length) {
          const code = errors[0].code ?? -1;
          result.failed.push({ item, error: new TikTokApiError([105001,105002,105003,105004].includes(code) ? "AUTH" : code === 105005 ? "SCOPE" : "API", code,
            safeStockPushMessage(`API_REJECTED: ${errors.map((error) => [error.message, ...(error.detail?.extra_errors ?? []).map((extra) => extra.message)].filter(Boolean).join("; ")).join("; ")}`, [token, creds?.appSecret]), String(response.request_id ?? "-")) });
        }
        else result.ok.push(item);
      }
    } catch (error) { for (const { item } of targets) result.failed.push({ item, error }); }
  }
  return result;
}
