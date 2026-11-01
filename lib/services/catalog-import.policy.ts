export const CATALOG_IMPORT_DAYS = 30;

export function catalogImportSince(nowSeconds = Math.floor(Date.now() / 1000)): number {
  return nowSeconds - CATALOG_IMPORT_DAYS * 86400;
}

export function isRecentCatalogProduct(createdAt: unknown, since: number, until: number): boolean {
  const created = Number(createdAt);
  return Number.isSafeInteger(created) && created >= since && created <= until;
}

export function isActiveTikTokProduct(status: unknown): boolean {
  return typeof status === "string" && ["ACTIVATE", "ACTIVE"].includes(status.toUpperCase());
}
