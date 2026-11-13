/**
 * Label atribut varian (mis. "Biru, 10 Buah") dari payload mentah marketplace
 * yang tersimpan di ProductMapping.platformStatusRaw.
 *
 * Banyak listing memakai seller SKU dan foto yang sama untuk semua varian
 * (terutama TikTok yang tidak mengunggah foto per varian), sehingga atribut
 * ini satu-satunya pembeda yang bisa ditampilkan ke pengguna.
 */

function joinValueNames(attrs: Array<Record<string, unknown>> | undefined): string | null {
  if (!Array.isArray(attrs) || attrs.length === 0) return null;
  const values = attrs
    .map((attr) => {
      if (typeof attr.value_name === "string" && attr.value_name.trim()) return attr.value_name.trim();
      if (typeof attr.custom_value === "string" && attr.custom_value.trim()) return attr.custom_value.trim();
      return "";
    })
    .filter(Boolean);
  return values.length > 0 ? values.join(", ") : null;
}

function tiktokAttributes(parsed: Record<string, unknown>, channelSku: string): string | null {
  const skus = parsed.skus as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(skus)) return null;
  const sku = skus.find((item) => String(item.id) === channelSku);
  if (!sku) return null;
  if (typeof sku.sku_name === "string" && sku.sku_name.trim()) return sku.sku_name.trim();
  return joinValueNames(sku.sales_attributes as Array<Record<string, unknown>> | undefined);
}

function shopeeAttributes(parsed: Record<string, unknown>, channelSku: string): string | null {
  const models = (parsed.model ?? parsed.model_list) as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(models)) return null;
  // channelSku Shopee berbentuk "<itemId>:<modelId>" (atau model id saja).
  const modelKey = channelSku.includes(":") ? channelSku.split(":").pop() ?? channelSku : channelSku;
  const model = models.find((item) =>
    String(item.model_id) === modelKey
    || String(item.model_sku) === channelSku
    || String(item.model_sku) === modelKey);
  if (!model) return null;
  if (typeof model.model_name === "string" && model.model_name.trim()) return model.model_name.trim();
  const tiers = parsed.tier_variation as Array<Record<string, unknown>> | undefined;
  const indexes = model.tier_index as number[] | undefined;
  if (!Array.isArray(tiers) || !Array.isArray(indexes)) return null;
  const values = indexes
    .map((index, tier) => {
      const options = tiers[tier]?.option_list as Array<Record<string, unknown>> | undefined;
      const option = options?.[index];
      return typeof option?.option === "string" ? option.option : "";
    })
    .filter(Boolean);
  return values.length > 0 ? values.join(", ") : null;
}

export function variantAttributesFromRaw(
  platform: string | null | undefined,
  raw: string | null | undefined,
  channelSku: string | null | undefined,
): string | null {
  if (!platform || !raw || !channelSku) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (platform === "TIKTOK_SHOP") return tiktokAttributes(parsed, channelSku);
  if (platform === "SHOPEE") return shopeeAttributes(parsed, channelSku);
  return null;
}
