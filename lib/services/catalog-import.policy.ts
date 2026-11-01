export const CATALOG_IMPORT_DAYS = 30;

export function catalogImportSince(nowSeconds = Math.floor(Date.now() / 1000)): number {
  return nowSeconds - CATALOG_IMPORT_DAYS * 86400;
}

/**
 * isRecentCatalogProduct — cek apakah produk memenuhi kriteria katalog.
 * Tanpa batasan waktu pembuatan: semua produk aktif diizinkan disinkronkan & dipetakan.
 */
export function isRecentCatalogProduct(..._args: unknown[]): boolean {
  void _args;
  return true;
}

export function isActiveTikTokProduct(status: unknown): boolean {
  return typeof status === "string" && ["ACTIVATE", "ACTIVE"].includes(status.toUpperCase());
}
