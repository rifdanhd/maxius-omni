export function selectedShopeeShop(shopId: string | null | undefined, authorizedShopIds?: number[]): string {
  const selected = shopId?.trim();
  if (!selected || !/^\d+$/.test(selected) || !Number.isSafeInteger(Number(selected)) || Number(selected) <= 0) {
    throw new Error("Pilih satu toko Shopee secara eksplisit.");
  }
  const normalized = String(Number(selected));
  if (authorizedShopIds?.length && !authorizedShopIds.some((id) => String(id) === normalized)) {
    throw new Error("Toko pilihan tidak ada dalam otorisasi Shopee.");
  }
  return normalized;
}
