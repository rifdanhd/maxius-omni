import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { stockMovementSchema } from "@/lib/security/input";
import { recordManualStockMovement } from "@/lib/services/central-stock.service";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { withAuth } from "@/lib/utils/api";

export const POST = withAuth(async (req) => {
  const input = stockMovementSchema.parse(await req.json());
  const variant = await prisma.productVariant.findUnique({
    where: { id: input.variantId },
    select: { masterProduct: { select: { businessId: true } } },
  });
  if (!variant) {
    return NextResponse.json({ error: "Varian tidak ditemukan." }, { status: 404 });
  }
  try {
    assertSameBrand(variant.masterProduct.businessId, req.businessId);
  } catch {
    return NextResponse.json({ error: "Varian tidak ditemukan." }, { status: 404 });
  }

  const result = await recordManualStockMovement({
    variantId: input.variantId,
    direction: input.direction,
    qty: input.qty,
    reasonLabel: input.reason,
    note: input.note,
    requestId: input.requestId,
    userId: req.user.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Pergerakan stok gagal." }, { status: 400 });
  }
  return NextResponse.json(result);
});
