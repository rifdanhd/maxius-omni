/**
 * POLICY murni untuk proteksi race condition stok (TUGAS 1 anti-oversell).
 *
 * Tanpa import prisma/next — fungsi pure agar unit-testable dan dipakai bersama
 * oleh central-stock.service (deduct/restore) & sales.service (recordSale).
 *
 * Prinsip keputusan (trade-off disengaja): AMAN > cepat. Pengurangan stok
 * memakai SATU statement atomik "UPDATE ... WHERE stock >= qty" lalu cek count
 * — bila 0, stok tidak cukup dan TIDAK ADA baris yang berubah. Ini menutup
 * race "baca stok → validasi → tulis" yang membuat dua order bersamaan sama-
 * sama lolos validasi sebelum salah satu sempat menulis (oversell).
 */

/** Satu baris rencana pemotongan untuk satu varian (qty > 0). */
export type DeductPlanEntry = {
  variantId: string;
  qty: number;
  note: string | null;
  accountId: string | null;
};

/**
 * Akumulasi qty per varian dari item order.
 * Satu varian bisa muncul di beberapa baris item — dijumlahkan dulu, lalu
 * URUTKAN berdasarkan variantId (ascending). Urutan konsisten ini mencegah
 * deadlock ketika dua order multi-varian mengunci baris yang sama dalam
 * urutan berbeda.
 */
export function buildDeductPlan(
  items: Array<{ variantId: string | null; qty: number }>,
  note: string | null,
  accountId: string | null
): DeductPlanEntry[] {
  const perVariant = new Map<string, number>();
  for (const item of items) {
    if (!item.variantId) continue;
    if (!Number.isFinite(item.qty) || item.qty <= 0) continue;
    perVariant.set(item.variantId, (perVariant.get(item.variantId) ?? 0) + item.qty);
  }
  return Array.from(perVariant.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([variantId, qty]) => ({ variantId, qty, note, accountId }));
}

/**
 * Cek idempotensi BERBASIS DB (level database, bukan baca-dulu-lalu-tulis):
 * satu order hanya boleh memotong stok sekali. Dipakai bersama unique index
 * StockLedger(reason, referenceId, variantId) — create() di dalam transaksi
 * akan GAGAL dengan error unique constraint kalau ada proses lain lebih dulu,
 * sehingga seluruh transaksi dibatalkan (rollback) dan stok tidak terpotong
 * dua kali. Ini menutup race antara dua retry webhook yang masuk hampir
 * bersamaan untuk order yang sama.
 */
export function isDeduplicationFailure(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (code === "P2002") return true; // Prisma unique constraint
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("UNIQUE constraint failed") || msg.includes("unique constraint");
}

/**
 * Pesan user-facing untuk stok tidak cukup — konsisten di semua jalur
 * (order sync, webhook, penjualan manual). Tidak pernah silent: caller
 * WAJIB mencatat order/tsb untuk ditinjau manual.
 */
export function insufficientStockMessage(sku: string, stock: number, qty: number): string {
  return `Stok tidak cukup untuk SKU "${sku}" (sisa ${stock}, butuh ${qty}) — order perlu ditinjau manual.`;
}
