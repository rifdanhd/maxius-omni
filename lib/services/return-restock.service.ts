import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import {
  STOCK_REASONS,
  pushVariantStockToOthers,
} from "@/lib/services/central-stock.service";

/**
 * return-restock.service — konfirmasi gudang INTERNAL (tanpa call API platform).
 *
 * Alur bisnis (keputusan owner): barang retur yang sudah diterima gudang
 * TIDAK otomatis menambah stok. Admin meninjau (barang rusak/salah varian
 * tidak boleh masuk stok jual), lalu menekan "Terima & Tambah Stok" per item.
 *
 * Idempotency: StockLedger reason RETURN_RESTOCK dengan referenceId =
 * ReturnItem.id + unique constraint (reason, referenceId, variantId) —
 * dua konfirmasi bersamaan saling gugur di level DB.
 */
export async function restockReturnItem(
  itemId: string,
  user: { id: string; username: string }
): Promise<{
  ok: boolean;
  already?: boolean;
  reason?: string;
  changeQty?: number;
  stockAfter?: number;
}> {
  const item = await prisma.returnItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      qty: true,
      variantId: true,
      restockedAt: true,
      returnRequest: {
        select: {
          id: true,
          externalReturnId: true,
          accountId: true,
          account: { select: { isFrozen: true } },
        },
      },
    },
  });
  if (!item) return { ok: false, reason: "item retur tidak ditemukan" };
  if (item.restockedAt) return { ok: true, already: true };
  if (!item.variantId) return { ok: false, reason: "SKU retur belum ter-mapping ke varian" };
  if (item.returnRequest.account.isFrozen) return { ok: false, reason: "akun platform dibekukan" };

  const variant = await prisma.productVariant.findUnique({
    where: { id: item.variantId },
    select: { id: true, stock: true, sku: true },
  });
  if (!variant) return { ok: false, reason: "varian tidak ditemukan" };

  const changeQty = item.qty;
  let stockAfter = 0;
  let ledgerId: string | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      const v = await tx.productVariant.update({
        where: { id: variant.id },
        data: { stock: { increment: changeQty } },
        select: { stock: true },
      });
      stockAfter = v.stock;
      const ledger = await tx.stockLedger.create({
        data: {
          id: crypto.randomUUID(),
          variantId: variant.id,
          changeQty,
          reason: STOCK_REASONS.RETURN_RESTOCK,
          referenceId: item.id,
          note: `Retur ${item.returnRequest.externalReturnId} diterima gudang (oleh ${user.username})`,
          stockAfter,
          accountId: item.returnRequest.accountId,
          userId: user.id,
        },
      });
      ledgerId = ledger.id;
      await tx.returnItem.update({
        where: { id: item.id },
        data: { restockedAt: new Date(), restockLedgerId: ledger.id },
      });
      await tx.returnAuditLog.create({
        data: {
          id: crypto.randomUUID(),
          accountId: item.returnRequest.accountId,
          updatedAt: new Date(),
          returnId: item.returnRequest.id,
          externalReturnId: item.returnRequest.externalReturnId,
          userId: user.id,
          username: user.username,
          action: "RESTOCK",
          resultStatus: "SUCCESS",
          payloadSent: JSON.stringify({ itemId: item.id, channelSkuQty: changeQty }),
        },
      });
    });
  } catch (error) {
    // Unique ledger gugur = sudah direstock proses lain → idempoten.
    if (
      typeof error === "object" &&
      error !== null &&
      String((error as { code?: string }).code) === "P2002"
    ) {
      return { ok: true, already: true };
    }
    throw error;
  }

  void ledgerId;
  // Dorong stok baru ke listing platform lain (non-blokir, pola restore order).
  pushVariantStockToOthers(variant.id, item.returnRequest.accountId).catch((err) =>
    console.error(`[ReturnRestock] push error varian ${variant.id}:`, err)
  );

  return { ok: true, already: false, changeQty, stockAfter };
}
