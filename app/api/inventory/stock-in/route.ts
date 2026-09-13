import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import {
  adjustStockManually,
  STOCK_REASONS,
} from "@/lib/services/central-stock.service";

// POST /api/inventory/stock-in — Barang Masuk (restock fisik).
// Body: { variantId, qty, note? } — qty = JUMLAH MASUK (delta positif),
// bukan angka mutlak. Ditulis via adjustStockManually() mode INCREMENT —
// SATU-SATUNYA jalur mutasi — dengan reason STOCK_IN eksplisit (bukan
// MANUAL_ADJUSTMENT generik). Increment atomik di DB (Temuan #2 PHASE A
// fix-up, Opsi B): read stok DI LUAR transaksi sudah DIHAPUS — dua admin
// yang input bersamaan tidak lagi saling menimpa (lost update).
// Setelah commit, stok baru di-push ke semua listing + SyncJob dicatat
// (via pushVariantStockToOthers — fire-and-forget, tidak memblokir respons).
export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  const variantId = typeof body?.variantId === "string" ? body.variantId : "";
  const qty = Number(body?.qty);
  const note = typeof body?.note === "string" ? body.note : "";

  if (!variantId) {
    return NextResponse.json({ error: "variantId wajib diisi." }, { status: 400 });
  }
  if (!Number.isFinite(qty) || Math.floor(qty) <= 0) {
    return NextResponse.json(
      { error: "qty harus bilangan bulat > 0 (jumlah barang masuk)." },
      { status: 400 }
    );
  }

  // Cek eksistensi untuk 404 yang tepat; nilai stok TIDAK dibaca untuk
  // dihitung di sini (aritmetik +qty terjadi atomik di dalam transaksi).
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, sku: true },
  });
  if (!variant) {
    return NextResponse.json({ error: "Varian tidak ditemukan." }, { status: 404 });
  }

  const result = await adjustStockManually({
    variantId: variant.id,
    increment: Math.floor(qty),
    note: note || `Barang masuk +${Math.floor(qty)} pcs (${variant.sku})`,
    adjustedByUserId: req.user.id,
    reason: STOCK_REASONS.STOCK_IN,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Gagal." }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    reason: STOCK_REASONS.STOCK_IN,
    changeQty: result.changeQty,
    stockAfter: result.stockAfter,
  });
});
