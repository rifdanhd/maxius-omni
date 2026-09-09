import { prisma } from "@/lib/db/prisma";
import { syncStockToMarketplaces } from "@/lib/services/sync.service";

/**
 * Central stock (stok gudang bersama).
 *
 * Barang fisik direpresentasikan oleh ProductVariant (sku_master); listing di
 * tiap toko/platform dihubungkan lewat ProductMapping (sku_mapping) yang bisa
 * di-repoint (ubah variantId) kapan saja tanpa migrasi data. ProductVariant.
 * stock adalah satu-satunya sumber kebenaran stok — tidak ada stok paralel.
 * Setiap perubahan dicatat di StockLedger (audit trail).
 */

export const STOCK_REASONS = {
  ORDER: "ORDER",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  ORDER_REFUNDED: "ORDER_REFUNDED",
  SALE: "SALE",
  MANUAL_ADJUSTMENT: "MANUAL_ADJUSTMENT",
  SYNC_CORRECTION: "SYNC_CORRECTION",
  INIT: "INIT",
} as const;
export type StockReason = (typeof STOCK_REASONS)[keyof typeof STOCK_REASONS];

/** Status order TikTok yang membatalkan pemotongan (stok direstore). */
export const CANCEL_STATUSES = new Set<string>(["CANCELLED"]);

/** cancelReasonForStatus — status order batal → reason ledger restore (atau null). */
export function cancelReasonForStatus(status: string): StockReason | null {
  if (status === "CANCELLED") return STOCK_REASONS.ORDER_CANCELLED;
  return null;
}

/** effectiveStock — jumlah yang boleh tampil di marketplace setelah buffer. */
export function effectiveStock(stock: number, safetyStock: number): number {
  return Math.max(0, stock - safetyStock);
}

/**
 * pushVariantStockToOthers — setelah stok varian berubah, dorong angka stok
 * baru (setelah buffer safety) ke listing yang ter-mapping ke varian ini.
 * excludeAccountId = akun asal pemicu (dilewati); null = dorong ke SEMUA listing
 * (penyesuaian manual global). Paralel (Promise.allSettled di
 * syncStockToMarketplaces), gagal di satu toko tidak membatalkan yang lain;
 * hasilnya dicatat di SyncLog utk retry.
 */
export async function pushVariantStockToOthers(
  variantId: string,
  excludeAccountId: string | null
): Promise<void> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      stock: true,
      safetyStock: true,
      mappings: { select: { accountId: true, channelSku: true } },
    },
  });
  if (!variant) return;

  const targets = excludeAccountId
    ? variant.mappings.filter((m) => m.accountId !== excludeAccountId)
    : variant.mappings;
  if (targets.length === 0) return;

  const newStock = effectiveStock(variant.stock, variant.safetyStock);
  await syncStockToMarketplaces(targets, newStock);
}

/**
 * deductStockForOrder — kurangi stok gudang bersama saat order masuk.
 *
 * - Hanya order yg sudah dibayar & menunggu dikirim (AWAITING_SHIPMENT) yg
 *   memotong stok; dipanggil dari webhook order status & sinkronisasi order.
 * - Idempoten: kalau sudah ada baris StockLedger reason ORDER utk order ini,
 *   di-skip (menangani retry/out-of-order webhook & dua jalur masuk panggilan).
 * - Line item yang belum di-mapping (variantId null) otomatis dilewati:
 *   produk tsb berdiri sendiri, behaviour lama tetap — tidak error/crash.
 * - Setelah dipotong, stok baru di-push ke toko lain (fire-and-forget).
 */
export async function deductStockForOrder(orderId: string): Promise<{
  ok: boolean;
  already?: boolean;
  reason?: string;
  deductions?: Array<{ variantId: string; changeQty: number; stockAfter: number }>;
}> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      accountId: true,
      items: {
        where: { variantId: { not: null } },
        select: { variantId: true, qty: true },
      },
    },
  });
  if (!order) return { ok: false, reason: "order not found" };

  // Idempotensi: satu order hanya boleh memotong stok SEKALI.
  const already = await prisma.stockLedger.findFirst({
    where: { reason: STOCK_REASONS.ORDER, referenceId: order.id },
    select: { id: true },
  });
  if (already) return { ok: true, already: true };

  if (order.items.length === 0) {
    // Tidak ada item ter-mapping → tidak ada yang dipotong; bukan error.
    return { ok: true, already: true, reason: "no mapped items" };
  }

  // Akumulasi qty per varian (satu varian bisa muncul di beberapa baris item).
  const perVariant = new Map<string, number>();
  for (const item of order.items) {
    if (!item.variantId) continue;
    perVariant.set(item.variantId, (perVariant.get(item.variantId) ?? 0) + item.qty);
  }

  const deductions: Array<{ variantId: string; changeQty: number; stockAfter: number }> = [];

  await prisma.$transaction(async (tx) => {
    for (const [variantId, qty] of perVariant) {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { stock: true, sku: true, masterProduct: { select: { name: true } } },
      });
      if (!variant) continue;

      const stockAfter = variant.stock - qty;
      await tx.productVariant.update({
        where: { id: variantId },
        data: { stock: { decrement: qty } },
      });
      await tx.stockLedger.create({
        data: {
          variantId,
          changeQty: -qty,
          reason: STOCK_REASONS.ORDER,
          referenceId: order.id,
          note: `Order ${order.orderNo} (${order.status})`,
          stockAfter,
          accountId: order.accountId,
        },
      });
      deductions.push({ variantId, changeQty: -qty, stockAfter });
    }
  });

  // Push stok baru ke listing lain — jangan tunggu (tidak memblokir webhook),
  // dan kegagalan satu toko tidak menggagalkan keseluruhan.
  for (const d of deductions) {
    pushVariantStockToOthers(d.variantId, order.accountId).catch((err) =>
      console.error(`[CentralStock] push error varian ${d.variantId}:`, err)
    );
  }

  return { ok: true, already: false, deductions };
}

/**
 * restoreStockForCanceledOrder — kembalikan stok gudang yang tadi dipotong
 * untuk order yang batal/direfund. Dipanggil dari webhook & sinkronisasi order
 * saat status order masuk ke set pembatalan.
 *
 * - Idempoten: hanya jalan SEKALI per order — kalau sudah ada entry
 *   reason ORDER_CANCELLED/ORDER_REFUNDED utk order ini, di-skip.
 * - Aman: kalau order TIDAK PERNAH memotong stok (entry reason ORDER tidak
 *   ada — mis. order batal sebelum AWAITING_SHIPMENT), tidak ada yang
 *   di-restore dan tidak menambah stok.
 * - Restore memakai jumlah persis dari entry pemotongan per varian, jadi
 *   mengembalikan nilai yang tepat walau order di-edit di tengah jalan.
 */
export async function restoreStockForCanceledOrder(
  orderId: string,
  reason: StockReason
): Promise<{
  ok: boolean;
  already?: boolean;
  reason?: string;
  restores?: Array<{ variantId: string; changeQty: number; stockAfter: number }>;
}> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNo: true, status: true, accountId: true },
  });
  if (!order) return { ok: false, reason: "order not found" };

  // Idempotensi: satu order hanya boleh di-restore SEKALI.
  const already = await prisma.stockLedger.findFirst({
    where: {
      reason: { in: [STOCK_REASONS.ORDER_CANCELLED, STOCK_REASONS.ORDER_REFUNDED] },
      referenceId: order.id,
    },
    select: { id: true },
  });
  if (already) return { ok: true, already: true };

  // Perhatikan: ada calon mismatch — varian bisa saja di-unmapping setelah
  // pemotongan. Ambil entry pemotongan sebagai sumber jumlah yang sah.
  const deductions = await prisma.stockLedger.findMany({
    where: { reason: STOCK_REASONS.ORDER, referenceId: order.id },
    select: { id: true, variantId: true, changeQty: true },
    orderBy: { createdAt: "asc" },
  });
  if (deductions.length === 0) {
    // Tidak pernah memotong stok → tidak perlu direstore (bukan error).
    return { ok: true, already: true, reason: "no deduction" };
  }

  const restores: Array<{ variantId: string; changeQty: number; stockAfter: number }> = [];

  await prisma.$transaction(async (tx) => {
    for (const d of deductions) {
      const variant = await tx.productVariant.findUnique({
        where: { id: d.variantId },
        select: { id: true, stock: true, sku: true, masterProduct: { select: { name: true } } },
      });
      if (!variant) continue;

      const changeQty = Math.abs(d.changeQty);
      const stockAfter = variant.stock + changeQty;
      await tx.productVariant.update({
        where: { id: d.variantId },
        data: { stock: { increment: changeQty } },
      });
      await tx.stockLedger.create({
        data: {
          variantId: d.variantId,
          changeQty,
          reason,
          referenceId: order.id,
          note: `Restore order ${order.orderNo} (status ${order.status}, dibatalkan)`,
          stockAfter,
          accountId: order.accountId,
        },
      });
      restores.push({ variantId: d.variantId, changeQty, stockAfter });
    }
  });

  // Push stok baru ke toko lain — jangan tunggu (tidak memblokir webhook).
  for (const r of restores) {
    pushVariantStockToOthers(r.variantId, order.accountId).catch((err) =>
      console.error(`[CentralStock] push error varian ${r.variantId}:`, err)
    );
  }

  return { ok: true, already: false, restores };
}

/**
 * adjustStockManually — penyesuaian stok manual oleh admin (stock opname,
 * koreksi selisih, dll). Menetapkan angka mutlak (newStock), bukan delta.
 *
 * - Selisih (newStock − stok_efektif saat ini) dicatat di StockLedger dengan
 *   reason MANUAL_ADJUSTMENT beserta siapa yang melakukan (userId) & catatan.
 *   changeQty = 0 tidak menulis baris ledger (tidak ada perubahan nyata).
 * - Stok baru di-push ke SEMUA listing yang ter-mapping (bukan mengecualikan
 *   akun), karena ini perubahan stok fisik global.
 */
export async function adjustStockManually(params: {
  variantId: string;
  newStock: number;
  note?: string | null;
  adjustedByUserId?: string | null;
}): Promise<{
  ok: boolean;
  reason?: string;
  changeQty?: number;
  stockAfter?: number;
}> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: params.variantId },
    select: { id: true, stock: true, sku: true, masterProduct: { select: { name: true } } },
  });
  if (!variant) return { ok: false, reason: "variant not found" };

  const newStock = Math.floor(params.newStock);
  if (!Number.isFinite(newStock) || newStock < 0) {
    return { ok: false, reason: "newStock harus angka bulat >= 0" };
  }

  const changeQty = newStock - variant.stock;
  const stockAfter = newStock;

  if (changeQty !== 0) {
    await prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { stock: newStock },
      });
      await tx.stockLedger.create({
        data: {
          variantId: variant.id,
          changeQty,
          reason: STOCK_REASONS.MANUAL_ADJUSTMENT,
          referenceId: null,
          note: params.note?.trim() || `Sesuaikan stok ${variant.sku}`,
          stockAfter,
          accountId: null,
          userId: params.adjustedByUserId ?? null,
        },
      });
    });

    // Penyesuaian manual = perubahan fisik global → push ke semua listing.
    pushVariantStockToOthers(variant.id, null).catch((err) =>
      console.error(`[CentralStock] push error varian ${variant.id}:`, err)
    );
  }

  return { ok: true, changeQty, stockAfter };
}