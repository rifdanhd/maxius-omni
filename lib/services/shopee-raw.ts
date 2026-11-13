import type { ShopeeModel } from "@/lib/integrations/shopee";

/**
 * Payload mentah item Shopee yang disimpan di ProductMapping.platformStatusRaw.
 *
 * `get_item_base_info` tidak memuat daftar model, sehingga atribut varian
 * (warna/ukuran) hilang. Daftar model dari `get_model_list` ikut disimpan di
 * key `model` supaya variantAttributesFromRaw bisa membacanya.
 */

const RAW_LIMIT = 8000;
const HEAVY_KEYS = new Set(["description", "attribute_list", "video_info", "image", "promotion_image", "size_chart"]);

export type ShopeeModelSnapshot = {
  model_id: number;
  model_sku?: string;
  model_name?: string;
  tier_index?: number[];
};

export function shopeeModelSnapshot(models: ShopeeModel[]): ShopeeModelSnapshot[] {
  return models.map((model) => ({
    model_id: model.model_id,
    ...(model.model_sku ? { model_sku: model.model_sku } : {}),
    ...(model.model_name ? { model_name: model.model_name } : {}),
    ...(Array.isArray(model.tier_index) && model.tier_index.length > 0 ? { tier_index: model.tier_index } : {}),
  }));
}

/**
 * Selalu JSON valid: bila kepanjangan, field berat dibuang lebih dulu
 * (bukan dipotong di tengah string seperti `.slice(0, 8000)`).
 */
export function shopeeRawWithModels(info: unknown, models: ShopeeModel[]): string {
  const base = info && typeof info === "object" ? (info as Record<string, unknown>) : {};
  const snapshot = shopeeModelSnapshot(models);
  const build = (payload: Record<string, unknown>) =>
    JSON.stringify(snapshot.length > 0 ? { ...payload, model: snapshot } : payload);

  const full = build(base);
  if (full.length <= RAW_LIMIT) return full;

  const reduced = build(Object.fromEntries(Object.entries(base).filter(([key]) => !HEAVY_KEYS.has(key))));
  if (reduced.length <= RAW_LIMIT) return reduced;

  return build({
    item_id: base.item_id,
    item_name: base.item_name,
    item_status: base.item_status,
    item_sku: base.item_sku,
  });
}
