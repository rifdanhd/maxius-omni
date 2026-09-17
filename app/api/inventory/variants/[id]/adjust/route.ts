import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { adjustStockManually } from "@/lib/services/central-stock.service";

// Sesuaikan Stok manual: tetapkan angka mutlak (newStock >= 0) utk satu varian
// sku_master. Dicatat di StockLedger reason MANUAL_ADJUSTMENT beserta user yang
// melakukannya, lalu stok baru di-push ke semua listing ter-mapping.
export const POST = withAuth(async (req, ctx) => {
  const variantId = ctx?.params ? (await ctx.params).id : null;
  if (!variantId) {
    return NextResponse.json({ error: "Variant id hilang." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const newStock = Number(body?.newStock);
  const note = typeof body?.note === "string" ? body.note : "";

  if (!Number.isFinite(newStock) || newStock < 0) {
    return NextResponse.json(
      { error: "newStock harus angka bulat >= 0." },
      { status: 400 }
    );
  }

  const variantBrand = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { masterProduct: { select: { businessId: true } } },
  });
  if (!variantBrand) {
    return NextResponse.json({ error: "Varian tidak ditemukan." }, { status: 404 });
  }
  try {
    assertSameBrand(variantBrand.masterProduct.businessId, req.businessId);
  } catch {
    return NextResponse.json({ error: "Varian tidak ditemukan." }, { status: 404 });
  }

  const result = await adjustStockManually({
    variantId,
    newStock: Math.floor(newStock),
    note: note || null,
    adjustedByUserId: req.user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Gagal." }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    changeQty: result.changeQty,
    stockAfter: result.stockAfter,
  });
});