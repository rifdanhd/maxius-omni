import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { updateMappingPrice } from "@/lib/services/pricing.service";

// PATCH /api/products/pricing/[variantId]/marketplace/[channelId]
// Body: { price: number | null } — set/bersihkan harga override per toko.
//   price angka  → override harga tayang marketplace tsb.
//   price null   → hapus override, kembali ke harga default varian.
export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const params = ctx?.params ? await ctx.params : null;
  const variantId = params?.variantId;
  const channelId = params?.channelId;

  if (!variantId || !channelId) {
    return NextResponse.json(
      { error: "Variant id atau channel id hilang." },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { price?: unknown };
  if (body.price === undefined) {
    return NextResponse.json({ error: "Field price wajib diisi." }, { status: 400 });
  }

  // Pastikan mapping milik varian ini (jaga-jaga bila id tak valid).
  const mapping = await prisma.productMapping.findFirst({
    where: { id: channelId, variantId },
    select: { id: true },
  });
  if (!mapping) {
    return NextResponse.json(
      { error: "Mapping toko untuk varian ini tidak ditemukan." },
      { status: 404 }
    );
  }

  const result = await updateMappingPrice(
    channelId,
    body.price === null ? null : Number(body.price)
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason ?? "Gagal update harga override." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
});