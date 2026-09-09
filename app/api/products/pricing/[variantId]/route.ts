import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { updateVariantDefaultPrice } from "@/lib/services/pricing.service";

// PATCH /api/products/pricing/[variantId]
// Body: { price: number } — set harga default varian (SKU induk).
export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const variantId = ctx?.params ? (await ctx.params).variantId : null;
  if (!variantId) {
    return NextResponse.json({ error: "Variant id hilang." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { price?: unknown };
  if (body.price === undefined) {
    return NextResponse.json({ error: "Field price wajib diisi." }, { status: 400 });
  }

  const result = await updateVariantDefaultPrice(variantId, Number(body.price));
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason ?? "Gagal update harga." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
});