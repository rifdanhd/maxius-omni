export type StockPushSettings = { stockPushEnabled: boolean; stockBaselineReady: boolean; syncPushShopee: boolean; syncPushTiktok: boolean; syncPushTokopedia: boolean };
export function stockPushDisabledReason(account: { platform: string; isFrozen?: boolean; stockPushEnabled?: boolean }, settings: StockPushSettings): string | null {
  if (process.env.STOCK_PUSH_ENABLED !== "true") return "Push stok dinonaktifkan global; STOCK_PUSH_ENABLED belum bernilai true.";
  if (!settings.stockBaselineReady) return "Baseline stok belum dikonfirmasi; isi stok awal dan aktifkan konfirmasi baseline terlebih dahulu.";
  if (account.isFrozen) return "Toko dibekukan; push stok tidak diizinkan.";
  if (account.stockPushEnabled === false) return "Push stok dinonaktifkan untuk toko ini.";
  if (!settings.stockPushEnabled) return "Push stok dinonaktifkan pada pengaturan brand.";
  const enabled = account.platform === "SHOPEE" ? settings.syncPushShopee : account.platform === "TIKTOK_SHOP" ? settings.syncPushTiktok : account.platform === "TOKOPEDIA" ? settings.syncPushTokopedia : true;
  return enabled ? null : `Push stok ${account.platform} dinonaktifkan pada pengaturan brand.`;
}
