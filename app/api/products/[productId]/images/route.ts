import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import {
  listProductImages,
  addImages,
  normalizeImageInputs,
} from "@/lib/services/gallery.service";

// GET /api/products/[productId]/images — daftar gambar satu produk.
// POST /api/products/[productId]/images — tambah gambar baru.
//   Body: { url: string } | { images: [{ url: string }, ...] }
//   url bisa berupa http(s):// atau data:image/... (file lokal → base64).
export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const productId = ctx?.params ? (await ctx.params).productId : null;
  if (!productId) return NextResponse.json({ error: "Product id hilang." }, { status: 400 });

  const images = await listProductImages(productId);
  return NextResponse.json({ images });
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const productId = ctx?.params ? (await ctx.params).productId : null;
  if (!productId) return NextResponse.json({ error: "Product id hilang." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const entries = normalizeImageInputs(body);
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "Body harus memuat field url atau images (array url)." },
      { status: 400 }
    );
  }
  if (entries.some((e) => e.error)) {
    return NextResponse.json(
      { error: entries.find((e) => e.error)?.error ?? "URL tidak valid." },
      { status: 400 }
    );
  }

  const safe = entries as { url: string }[];
  const result = await addImages(productId, safe);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reasons[0]?.reason ?? "Gagal menambah gambar." },
      { status: 400 }
    );
  }
  return NextResponse.json(result);
});