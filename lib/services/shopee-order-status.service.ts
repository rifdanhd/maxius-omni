import {
  CANCEL_STATUSES,
  cancelReasonForStatus,
  deductStockForOrder,
  restoreStockForCanceledOrder,
} from "@/lib/services/central-stock.service";

/**
 * A1 (M8b) — kanonisasi status Shopee → status internal (set status yang
 * dipakai UI tabs & fitur lain). SATU peta ini dipakai oleh webhook DAN
 * ingest; rawStatus di PlatformOrderMapping tetap menyimpan status Shopee
 * asli (dedupe push & audit tetap pada bahasa Shopee).
 */
export const SHOPEE_STATUS_MAP: Record<string, string> = {
  UNPAID: "UNPAID",
  INVOICE_PENDING: "ON_HOLD",
  READY_TO_SHIP: "AWAITING_SHIPMENT",
  TO_SHIP: "AWAITING_SHIPMENT",
  SHIPPED: "IN_TRANSIT",
  TO_CONFIRM: "DELIVERED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
  // Retur selesai: barang kembali ke gudang → perlakukan sbg batal supaya
  // stok yang tadi dipotong ikut direstore.
  RETURNED: "CANCELLED",
};

export function canonicalShopeeStatus(rawStatus: string): string {
  return SHOPEE_STATUS_MAP[rawStatus] ?? rawStatus;
}

/**
 * Status kanonik yang berarti stok sudah "keluar" (terbayar/terjual) — wajib
 * memotong stok gudang. Idempoten via StockLedger (unique reason+reference).
 * UNPAID/ON_HOLD/tidak dikenal TIDAK memotong: pembayaran belum pasti.
 */
export const DEDUCT_CANONICAL_STATUSES = new Set([
  "AWAITING_SHIPMENT",
  "AWAITING_COLLECTION",
  "PARTIALLY_SHIPPING",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
]);

export type ShopeeStockEffect = {
  effect: "deduct" | "restore" | "none";
  ok?: boolean;
  already?: boolean;
  note?: string;
  /** jumlah varian yang tersentuh (deduksi/restore) — utk pesan SyncLog. */
  count?: number;
};

/**
 * A1 — aturan deduct/restore yang SAMA untuk webhook & ingest:
 *  - status batal (CANCELLED/REFUNDED) → restore sekali (no-op bila tak pernah dipotong)
 *  - status komit (AWAITING_SHIPMENT..COMPLETED) → deduct sekali
 *  - selainnya → tanpa efek stok
 * Panggil SETELAH Order.status di DB diperbarui (catatan ledger ikut benar).
 * Kedua operasi idempoten — dobel-fire webhook/sync tidak menggandakan mutasi.
 */
export async function applyShopeeStockEffectsForStatus(
  orderId: string,
  canonicalStatus: string
): Promise<ShopeeStockEffect> {
  if (CANCEL_STATUSES.has(canonicalStatus)) {
    const reason = cancelReasonForStatus(canonicalStatus);
    if (!reason) return { effect: "none", note: `tanpa reason ledger utk status ${canonicalStatus}` };
    const r = await restoreStockForCanceledOrder(orderId, reason);
    return {
      effect: "restore",
      ok: r.ok,
      already: r.already,
      note: r.reason,
      count: r.restores?.length,
    };
  }
  if (DEDUCT_CANONICAL_STATUSES.has(canonicalStatus)) {
    const r = await deductStockForOrder(orderId);
    return {
      effect: "deduct",
      ok: r.ok,
      already: r.already,
      note: r.reason,
      count: r.deductions?.length,
    };
  }
  return { effect: "none" };
}
