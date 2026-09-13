import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

// PATCH /api/products/[productId] — edit sebagian produk master.
// Body (minimal satu field):
//   { imageUrl: string | null } — set/ubah/hapus gambar produk master.
//   { isActive: boolean } — nonaktifkan (soft delete, sembunyi dari list
//     default) / aktifkan kembali. TIDAK menghapus data apa pun: varian,
//     mapping, ledger, dan order tetap utuh.
export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const productId = ctx?.params ? (await ctx.params).productId : null;
  if (!productId) {
    return NextResponse.json({ error: "Product id hilang." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    imageUrl?: unknown;
    isActive?: unknown;
  };
  const data: { imageUrl?: string | null; isActive?: boolean } = {};
  if (body.imageUrl !== undefined) {
    const imageUrl = body.imageUrl === null ? null : String(body.imageUrl).trim();
    if (imageUrl !== null && !/^https?:\/\/.+/.test(imageUrl)) {
      return NextResponse.json(
        { error: "imageUrl harus berupa URL yang valid (http/https)." },
        { status: 400 }
      );
    }
    data.imageUrl = imageUrl;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json(
        { error: "isActive harus boolean." },
        { status: 400 }
      );
    }
    data.isActive = body.isActive;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Field imageUrl atau isActive wajib diisi." },
      { status: 400 }
    );
  }

  const product = await prisma.masterProduct.findUnique({ where: { id: productId } });
  if (!product) {
    return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  }

  const updated = await prisma.masterProduct.update({
    where: { id: productId },
    data,
    select: { id: true, imageUrl: true, isActive: true },
  });

  return NextResponse.json({ ok: true, ...updated });
});
