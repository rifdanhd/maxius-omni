import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { findOrphanSkus } from "@/lib/services/orphan-sku.service";

// GET /api/inventory/orphan-skus — daftar channel SKU marketplace yang muncul
// di order (non-CANCELLED) tapi belum ter-mapping ke varian stok pusat.
// Sumber data = OrderItem.variantId NULL (satu sumber kebenaran yang sama
// dengan panel "SKU Order Belum Ter-mapping" di halaman Mapping dan dengan
// backfill historis di POST/PATCH mappings).
// Read-only: sistem CUMA mendeteksi & menandai — keputusan mapping/buat master
// tetap manual via UI (tanpa auto-create).
export const GET = withAuth(async (req) => {
  try {
    const orphans = await findOrphanSkus(req.businessId);
    return NextResponse.json({
      orphans,
      totalQty: orphans.reduce((s, o) => s + o.qty, 0),
      count: orphans.length,
    });
  } catch (error) {
    console.error("Error listing orphan SKUs:", error);
    return NextResponse.json({ error: "Gagal memuat orphan SKU." }, { status: 500 });
  }
});
