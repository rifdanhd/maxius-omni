import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { updateImage, deleteImage } from "@/lib/services/gallery.service";

// PATCH /api/products/[productId]/images/[imageId]
//   Body: { isCover: true } set cover | { order: number } set urutan satu gambar
//         | { orderedIds: string[] } urutkan ulang seluruh galeri
// DELETE /api/products/[productId]/images/[imageId] — hapus gambar
export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const params = ctx?.params ? await ctx.params : null;
  const productId = params?.productId;
  const imageId = params?.imageId;
  if (!productId || !imageId) {
    return NextResponse.json({ error: "Product/image id hilang." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  let action:
    | { isCover?: boolean; order?: number; orderedIds?: string[] } | null = null;
  if (body.isCover === true) action = { isCover: true };
  else if (typeof body.order === "number") action = { order: body.order };
  else if (Array.isArray(body.orderedIds))
    action = { orderedIds: body.orderedIds.filter((x): x is string => typeof x === "string") };

  if (!action) {
    return NextResponse.json(
      { error: "Body harus memuat isCover, order, atau orderedIds." },
      { status: 400 }
    );
  }
  if (action.orderedIds && action.orderedIds.length === 0) {
    return NextResponse.json({ error: "orderedIds tidak boleh kosong." }, { status: 400 });
  }

  const result = await updateImage(productId, imageId, action);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Gagal update gambar." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(async (_req: NextRequest, ctx) => {
  const params = ctx?.params ? await ctx.params : null;
  const productId = params?.productId;
  const imageId = params?.imageId;
  if (!productId || !imageId) {
    return NextResponse.json({ error: "Product/image id hilang." }, { status: 400 });
  }

  const result = await deleteImage(productId, imageId);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Gagal hapus gambar." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});