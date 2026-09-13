import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { syncStockToMarketplaces } from "@/lib/services/sync.service";
import { enqueueSyncJobs } from "@/lib/services/sync-job.service";
import {
  buildDeductPlan,
  insufficientStockMessage,
  isDeduplicationFailure,
  type DeductPlanEntry,
} from "@/lib/services/stock-guard.policy";
import { effectiveStock } from "@/lib/services/stock-level.policy";

export {
  effectiveStock,
  resolveMinStock,
  isLowStock,
  stockLevel,
} from "@/lib/services/stock-level.policy";
export type { StockLevel } from "@/lib/services/stock-level.policy";

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
  // Barang masuk (restock fisik). Dipakai endpoint /api/inventory/stock-in.
  // Data lama yang tercatat MANUAL_ADJUSTMENT dibiarkan historis.
  STOCK_IN: "STOCK_IN",
  MANUAL_ADJUSTMENT: "MANUAL_ADJUSTMENT",
  SYNC_CORRECTION: "SYNC_CORRECTION",
  STOCK_OPNAME: "STOCK_OPNAME",
  INIT: "INIT",
  // Perubahan buffer cadangan (tidak menyentuh stok fisik maupun angka tayang
  // secara langsung — angka tayang berubah lewat push effectiveStock).
  // changeQty selalu 0, stockAfter = stok fisik saat perubahan.
  SAFETY_STOCK_CHANGE: "SAFETY_STOCK_CHANGE",
} as const;
export type StockReason = (typeof STOCK_REASONS)[keyof typeof STOCK_REASONS];

/** Status order TikTok yang membatalkan pemotongan (stok direstore). */
export const CANCEL_STATUSES = new Set<string>(["CANCELLED"]);

/** cancelReasonForStatus — status order batal → reason ledger restore (atau null). */
export function cancelReasonForStatus(status: string): StockReason | null {
  if (status === "CANCELLED") return STOCK_REASONS.ORDER_CANCELLED;
  return null;
}

/**
 * lowStockSql — render SQL dari isLowStock() (stock-level.policy) untuk
 * $queryRaw: tersedia <= COALESCE(minStock, threshold produk).
 * Alias tabel tidak bisa di-bind sebagai parameter → divalidasi whitelist
 * identifier sebelum diinterpolasi. Kalau definisi isLowStock berubah,
 * fragmen ini WAJIB ikut berubah.
 */
const SQL_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function lowStockSql(variantAlias = "pv", productAlias = "mp"): Prisma.Sql {
  if (!SQL_IDENT.test(variantAlias) || !SQL_IDENT.test(productAlias)) {
    throw new Error("lowStockSql: alias tabel tidak valid");
  }
  return Prisma.raw(
    `(${variantAlias}.stock - ${variantAlias}."safetyStock") <= ` +
      `COALESCE(${variantAlias}."minStock", ${productAlias}.threshold)`
  );
}

/**
 * pushVariantStockToOthers — setelah stok varian berubah, dorong angka stok
 * baru (setelah buffer safety) ke listing yang ter-mapping ke varian ini.
 * excludeAccountId = akun asal pemicu (dilewati); null = dorong ke SEMUA listing
 * (penyesuaian manual global). Paralel (Promise.allSettled di
 * syncStockToMarketplaces), gagal di satu toko tidak membatalkan yang lain;
 * hasilnya dicatat di SyncLog utk retry.
 *
 * PHASE A: sebelum dispatch, catat 1 SyncJob PENDING per target (coalesce ke
 * nilai terbaru). SyncJob = state machine yang bisa di-query ulang untuk
 * retry backoff; SyncLog tetap append-only history. Enqueue tidak pernah
 * melempar — mutasi central sudah commit dan tidak boleh gagal karenanya.
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
  await enqueueSyncJobs(variantId, targets, newStock);
  await syncStockToMarketplaces(targets, newStock);
}

/**
 * deductStockForOrder — kurangi stok gudang bersama saat order masuk.
 *
 * - Hanya order yg sudah dibayar & menunggu dikirim (AWAITING_SHIPMENT) yg
 *   memotong stok; dipanggil dari webhook order status & sinkronisasi order.
 * - ANTI-OVERSELL (TUGAS 1): TIDAK lagi pola "baca stok → validasi → tulis"
 *   (rawan race: dua order bersamaan sama-sama lolos validasi). Pengurangan
 *   memakai SATU statement atomik per varian:
 *     UPDATE ProductVariant SET stock = stock - qty
 *     WHERE id = ? AND stock >= qty
 *   lalu cek count — count 0 = stok tidak cukup, TIDAK ADA baris berubah,
 *   seluruh transaksi di-throw (rollback semua varian) + SyncLog "skipped"
 *   supaya order DITINJAU MANUAL, bukan silent-fail.
 * - Idempotensi LEVEL DB: create StockLedger dijaga unique
 *   (reason, referenceId, variantId) — dua pemroses bersamaan utk order yang
 *   sama saling gugur (rollback), bukan double-deduct.
 * - Line item yang belum di-mapping (variantId null) otomatis dilewati:
 *   behaviour lama tetap — tidak error/crash.
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

  // Fast-path idempotensi (read-only) — kasus umum retry webhook terdeteksi
  // tanpa transaksi. Race window tetap ditutup unique index di bawah.
  const already = await prisma.stockLedger.findFirst({
    where: { reason: STOCK_REASONS.ORDER, referenceId: order.id },
    select: { id: true },
  });
  if (already) return { ok: true, already: true };

  if (order.items.length === 0) {
    // Tidak ada item ter-mapping → tidak ada yang dipotong; bukan error.
    return { ok: true, already: true, reason: "no mapped items" };
  }

  // Rencana pemotongan terurut variantId (konsisten) → bebas deadlock saat
  // dua order multi-varian saling mengunci baris yang sama.
  const plan = buildDeductPlan(
    order.items,
    `Order ${order.orderNo} (${order.status})`,
    order.accountId
  );

  const deductions: Array<{ variantId: string; changeQty: number; stockAfter: number }> = [];

  try {
    await prisma.$transaction(async (tx) => {
      for (const entry of plan) {
        const result = await atomicDeduct(tx, entry, order.id);
        if (!result) {
          // Count 0 = stok tidak cukup → lempar supaya SEMUA varian order ini
          // di-rollback (jangan setengah terpotong).
          const sku = await variantSku(tx, entry.variantId);
          throw new InsufficientStockError(
            insufficientStockMessage(sku, await currentStock(tx, entry.variantId), entry.qty)
          );
        }
        deductions.push(result);
      }
    });
  } catch (error) {
    // Duel idempotensi: proses lain lebih dulu memotong order yang sama →
    // anggap sudah diproses (kembalikan already, BUKAN error).
    if (isDeduplicationFailure(error)) return { ok: true, already: true };
    if (error instanceof InsufficientStockError) {
      // JANGAN silent-fail: jejak untuk peninjauan manual (caller juga
      // mencatat SyncLog-nya sendiri).
      try {
        await prisma.syncLog.create({
          data: {
            direction: "in",
            kind: "central_stock_deduct",
            status: "skipped",
            message: `order ${order.orderNo}: ${error.message}`,
            payload: JSON.stringify({ orderId: order.id, deductionsAttempted: plan }),
            accountId: order.accountId,
          },
        });
      } catch (logErr) {
        console.error("[CentralStock] gagal menulis SyncLog insufficient stock:", logErr);
      }
      return { ok: false, reason: error.message };
    }
    throw error;
  }

  // Push stok baru ke listing lain — jangan tunggu (tidak memblokir webhook),
  // dan kegagalan satu toko tidak menggagalkan keseluruhan.
  for (const d of deductions) {
    pushVariantStockToOthers(d.variantId, order.accountId).catch((err) =>
      console.error(`[CentralStock] push error varian ${d.variantId}:`, err)
    );
  }

  return { ok: true, already: false, deductions };
}

/** Error internal: stok tidak cukup — memicu rollback penuh transaksi. */
export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

/**
 * atomicDeduct — SATU statement atomik:
 * UPDATE ... SET stock = stock - qty WHERE id = ? AND stock >= qty
 * lalu tulis ledger dengan stockAfter yang dibaca SETELAH update sukses
 * (aman: dalam transaksi yang sama, baris sudah kita kunci via update).
 * Return null bila count = 0 (stok tidak cukup / varian hilang).
 */
async function atomicDeduct(
  tx: Prisma.TransactionClient,
  entry: DeductPlanEntry,
  orderId: string
): Promise<{ variantId: string; changeQty: number; stockAfter: number } | null> {
  const res = await tx.productVariant.updateMany({
    where: { id: entry.variantId, stock: { gte: entry.qty } },
    data: { stock: { decrement: entry.qty } },
  });
  if (res.count === 0) return null;
  const after = await tx.productVariant.findUniqueOrThrow({
    where: { id: entry.variantId },
    select: { stock: true },
  });
  await tx.stockLedger.create({
    data: {
      variantId: entry.variantId,
      changeQty: -entry.qty,
      reason: STOCK_REASONS.ORDER,
      // referenceId WAJIB terisi (order id) — bagian dari kunci idempotency
      // unique (reason, referenceId, variantId).
      referenceId: orderId,
      note: entry.note,
      stockAfter: after.stock,
      accountId: entry.accountId,
    },
  });
  return { variantId: entry.variantId, changeQty: -entry.qty, stockAfter: after.stock };
}

/** Nama SKU utk pesan error (best-effort — varian bisa saja sudah dihapus). */
async function variantSku(tx: Prisma.TransactionClient, variantId: string): Promise<string> {
  const v = await tx.productVariant.findUnique({ where: { id: variantId }, select: { sku: true } });
  return v?.sku ?? variantId;
}

async function currentStock(tx: Prisma.TransactionClient, variantId: string): Promise<number> {
  const v = await tx.productVariant.findUnique({ where: { id: variantId }, select: { stock: true } });
  return v?.stock ?? 0;
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

  try {
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
        // Unique (reason, referenceId, variantId) → restore ganda bersamaan
        // saling gugur (rollback), stok tidak bertambah dua kali.
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
  } catch (error) {
    if (isDeduplicationFailure(error)) return { ok: true, already: true };
    throw error;
  }

  // Push stok baru ke toko lain — jangan tunggu (tidak memblokir webhook).
  for (const r of restores) {
    pushVariantStockToOthers(r.variantId, order.accountId).catch((err) =>
      console.error(`[CentralStock] push error varian ${r.variantId}:`, err)
    );
  }

  return { ok: true, already: false, restores };
}

/**
 * adjustStockAbsoluteInTx — inti penyesuaian stok absolut (angka mutlak),
 * dijalankan DALAM transaksi milik pemanggil.
 *
 * Dipakai bersama oleh:
 * - adjustStockManually (API adjust manual) — transaksi dibuat di sini
 * - finalizeStockOpname (stok opname) — transaksi dibuat pemanggil supaya
 *   seluruh koreksi multi-varian all-or-nothing
 *
 * Stok dibaca DI DALAM transaksi (bukan sebelum) — sesudahnya update+ledger
 * atomik: angka stockAfter dijamin nyata, tidak ada jendela antara baca-tulis.
 * Unique ledger (reason, referenceId, variantId) menjadikan koreksi dgn
 * referenceId terisi idempoten (dua finalisasi opname bersamaan saling gugur).
 */
export async function adjustStockAbsoluteInTx(
  tx: Prisma.TransactionClient,
  params: {
    variantId: string;
    newStock: number;
    reason: StockReason;
    referenceId?: string | null;
    note?: string | null;
    userId?: string | null;
  }
): Promise<{ ok: boolean; reason?: string; changeQty?: number; stockAfter?: number }> {
  const newStock = Math.floor(params.newStock);
  if (!Number.isFinite(newStock) || newStock < 0) {
    return { ok: false, reason: "newStock harus angka bulat >= 0" };
  }

  const variant = await tx.productVariant.findUnique({
    where: { id: params.variantId },
    select: { id: true, stock: true, sku: true },
  });
  if (!variant) return { ok: false, reason: "variant not found" };

  const changeQty = newStock - variant.stock;
  if (changeQty === 0) {
    return { ok: true, changeQty: 0, stockAfter: variant.stock };
  }

  await tx.productVariant.update({
    where: { id: variant.id },
    data: { stock: newStock },
  });
  await tx.stockLedger.create({
    data: {
      variantId: variant.id,
      changeQty,
      reason: params.reason,
      referenceId: params.referenceId ?? null,
      note: params.note?.trim() || `Sesuaikan stok ${variant.sku}`,
      stockAfter: newStock,
      accountId: null,
      userId: params.userId ?? null,
    },
  });
  return { ok: true, changeQty, stockAfter: newStock };
}

export type AdjustStockManuallyParams = {
  variantId: string;
  note?: string | null;
  adjustedByUserId?: string | null;
  reason?: StockReason;
} & (
  | { newStock: number; increment?: never }
  | { increment: number; newStock?: never }
);

/**
 * adjustStockManually — penyesuaian stok manual oleh admin (koreksi selisih,
 * stok opname, dll). Dua mode EKSKLUSIF (discriminated union — TypeScript
 * menolak kedua kunci sekaligus, jadi tidak ada ambiguitas):
 *
 * - Mode ABSOLUT ({ newStock }): menetapkan angka mutlak, bukan delta.
 *   Selisih (newStock − stok saat ini) dicatat di StockLedger beserta siapa
 *   yang melakukan (userId) & catatan. changeQty = 0 tidak menulis baris
 *   ledger (tidak ada perubahan nyata). Dipakai penyesuaian manual UI &
 *   skenario opname/ledger lama — PERILAKU MODE INI TIDAK BERUBAH.
 * - Mode INCREMENT ({ increment }): tambah stok relatif +qty secara ATOMIK
 *   (SATU statement `stock = stock + qty` + ledger dalam satu transaksi —
 *   pola yang sama dengan restoreStockForCanceledOrder, TANPA read-then-write
 *   di luar transaksi). Dipakai endpoint /api/inventory/stock-in agar dua
 *   admin yang input bersamaan tidak saling menimpa (Temuan #2 PHASE A
 *   fix-up, Opsi B). Satu pemanggilan = tepat SATU baris ledger.
 *
 * - reason opsional: "MANUAL_ADJUSTMENT" (default, koreksi) atau "STOCK_IN"
 *   (barang masuk via /api/inventory/stock-in). Jalur mutasi TETAP SATU
 *   fungsi ini — hanya label audit yang beda.
 * - Stok baru di-push ke SEMUA listing yang ter-mapping (bukan mengecualikan
 *   akun), karena ini perubahan stok fisik global.
 */
export async function adjustStockManually(
  params: AdjustStockManuallyParams
): Promise<{
  ok: boolean;
  reason?: string;
  changeQty?: number;
  stockAfter?: number;
}> {
  const ledgerReason =
    params.reason === STOCK_REASONS.STOCK_IN
      ? STOCK_REASONS.STOCK_IN
      : STOCK_REASONS.MANUAL_ADJUSTMENT;

  if (params.increment !== undefined) {
    return adjustStockIncrement({ ...params, increment: params.increment }, ledgerReason);
  }

  const result = await prisma.$transaction((tx) =>
    adjustStockAbsoluteInTx(tx, {
      variantId: params.variantId,
      newStock: params.newStock,
      reason: ledgerReason,
      referenceId: null,
      note: params.note ?? null,
      userId: params.adjustedByUserId ?? null,
    })
  );

  // Penyesuaian manual = perubahan fisik global → push ke semua listing.
  if (result.ok && (result.changeQty ?? 0) !== 0) {
    pushVariantStockToOthers(params.variantId, null).catch((err) =>
      console.error(`[CentralStock] push error varian ${params.variantId}:`, err)
    );
  }
  return result;
}

/**
 * adjustStockIncrement — inti mode INCREMENT (Opsi B Temuan #2).
 *
 * Atomik penuh: UPDATE increment SATU statement, lalu baca stockAfter
 * SETELAH update dalam transaksi yang sama (bukan sebelum) + tulis SATU
 * baris ledger. Tidak ada jendela baca-tulis antar-request: N increment
 * bersamaan selalu terakumulasi semua (stock = stock + q1 + ... + qN).
 */
async function adjustStockIncrement(
  params: {
    variantId: string;
    increment: number;
    note?: string | null;
    adjustedByUserId?: string | null;
  },
  ledgerReason: StockReason
): Promise<{ ok: boolean; reason?: string; changeQty?: number; stockAfter?: number }> {
  const qty = Math.floor(params.increment);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, reason: "increment harus bilangan bulat > 0 (jumlah barang masuk)" };
  }

  let stockAfter: number;
  try {
    stockAfter = await prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: params.variantId },
        data: { stock: { increment: qty } },
      });
      const after = await tx.productVariant.findUniqueOrThrow({
        where: { id: params.variantId },
        select: { stock: true, sku: true },
      });
      await tx.stockLedger.create({
        data: {
          variantId: params.variantId,
          changeQty: qty,
          reason: ledgerReason,
          referenceId: null,
          note: params.note?.trim() || `Barang masuk +${qty} pcs (${after.sku})`,
          stockAfter: after.stock,
          accountId: null,
          userId: params.adjustedByUserId ?? null,
        },
      });
      return after.stock;
    });
  } catch {
    return { ok: false, reason: "variant not found" };
  }

  // Perubahan fisik global → push ke semua listing (selalu changeQty > 0).
  pushVariantStockToOthers(params.variantId, null).catch((err) =>
    console.error(`[CentralStock] push error varian ${params.variantId}:`, err)
  );
  return { ok: true, changeQty: qty, stockAfter };
}