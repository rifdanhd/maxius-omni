export function stockReviewReason(quantity: number): string | null {
  if (!Number.isSafeInteger(quantity) || quantity < 0) return "Jumlah stok tidak valid";
  if ([9999, 88888, 99999].includes(quantity)) return "Angka stok awal berulang; perlu verifikasi fisik";
  if (quantity >= 9999) return "Jumlah stok tinggi; perlu verifikasi fisik";
  if (quantity >= 1000 && quantity % 1000 === 0) return "Angka stok ribuan bulat; perlu verifikasi fisik";
  return null;
}
