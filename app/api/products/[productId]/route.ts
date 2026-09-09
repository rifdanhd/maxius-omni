import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

// PATCH /api/products/[productId]
// Body: { imageUrl: string | null } — set/ubah/hapus gambar produk master.
export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const productId = ctx?.params ? (await ctx.params).productId : null;
  if (!productId) {
    return NextResponse.json({ error: "Product id hilang." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { imageUrl?: unknown };
  if (body.imageUrl === undefined) {
    return NextResponse.json({ error: "Field imageUrl wajib diisi." }, { status: 400 });
  }

  const imageUrl = body.imageUrl === null ? null : String(body.imageUrl).trim();
  if (imageUrl !== null && !/^https?:\/\/.+/.test(imageUrl)) {
    return NextResponse.json(
      { error: "imageUrl harus berupa URL yang valid (http/https)." },
      { status: 400 }
    );
  }

  const product = await prisma.masterProduct.findUnique({ where: { id: productId } });
  if (!product) {
    return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  }

  await prisma.masterProduct.update({
    where: { id: productId },
    data: { imageUrl },
  });

  return NextResponse.json({ ok: true, imageUrl });
});