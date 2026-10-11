export type MappingStatus = "connected" | "unlinked" | "failed";

export type ShopeeListingRow = {
  key: string;
  accountId: string;
  accountLabel: string;
  variantId: string | null;
  platformProductId: string | null;
  platformTitle: string | null;
  status: string | null;
  channelSku: string | null;
  variantCount: number;
  stockTotal: number;
  imageUrl: string | null;
  lastSyncedAt: string | null;
  mappingStatus?: MappingStatus;
};

export function productTitle(row: ShopeeListingRow) {
  return (row.platformTitle ?? row.channelSku ?? "Tanpa nama produk").replace(/(?:\s*\(\s*\))+\s*$/, "").trim() || "Tanpa nama produk";
}

export function storeName(label: string) {
  return label.trim() && !/^(?:\d+|shopee\s*\(?\d+\)?)$/i.test(label.trim()) ? label : "Nama toko belum diatur";
}

export function mappingStatus(row: ShopeeListingRow): MappingStatus {
  return row.mappingStatus ?? (row.variantId ? "connected" : "unlinked");
}

export const mappingLabels: Record<MappingStatus, string> = {
  connected: "Terhubung", unlinked: "Belum terhubung", failed: "Gagal sinkron",
};

export function fmtNumber(value: number) {
  return value.toLocaleString("id-ID");
}

export function fmtDate(iso?: string | null) {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return "Belum pernah";
  return new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    NORMAL: "Aktif", ACTIVE: "Aktif", ACTIVATE: "Aktif", UNLISTED: "Tidak ditayangkan",
    SELLER_DEACTIVATED: "Dinonaktifkan penjual", PLATFORM_DEACTIVATED: "Dinonaktifkan marketplace",
    FREEZE: "Dibekukan", DRAFT: "Draf", PENDING: "Menunggu peninjauan", DELETED: "Dihapus",
  };
  return status ? labels[status.toUpperCase()] ?? status : "Status belum tersedia";
}

export function mappingHref(row: ShopeeListingRow) {
  const params = new URLSearchParams({ accountId: row.accountId });
  if (row.channelSku) params.set("channelSku", row.channelSku);
  return `/products/mapping?${params}`;
}
