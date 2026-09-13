import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import {
  saveProductCopyAsDraft,
  type CopyVariantInput,
} from "@/lib/services/product-copy.service";

// POST /api/product-copy/save
// Body: hasil preview yang sudah diedit user → buat MasterProduct baru berstatus draft.
export const POST = withAuth(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
    price?: unknown;
    imageUrl?: unknown;
    images?: unknown;
    sourceUrl?: unknown;
    category?: unknown;
    variants?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Body JSON tidak valid." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, error: "Nama produk wajib diisi." }, { status: 400 });
  }

  const price =
    typeof body.price === "number" && Number.isFinite(body.price) && body.price > 0
      ? Math.round(body.price)
      : null;

  let variants: CopyVariantInput[] | undefined;
  if (Array.isArray(body.variants)) {
    variants = body.variants
      .map((v): CopyVariantInput | null => {
        if (!v || typeof v !== "object") return null;
        const o = v as Record<string, unknown>;
        return {
          name: typeof o.name === "string" ? o.name : undefined,
          price:
            typeof o.price === "number" && Number.isFinite(o.price) && o.price > 0
              ? Math.round(o.price)
              : null,
          stock:
            typeof o.stock === "number" && Number.isFinite(o.stock) ? Math.round(o.stock) : null,
          sku: typeof o.sku === "string" ? o.sku : null,
        };
      })
      .filter((v): v is CopyVariantInput => v !== null);
  }

  const images = Array.isArray(body.images) ? body.images.map(String) : [];
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : null;
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : null;
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;
  const description = typeof body.description === "string" ? body.description : "";

  try {
    const { id } = await saveProductCopyAsDraft({
      name,
      description,
      price,
      variants,
      images,
      imageUrl,
      sourceUrl,
      category,
    });
    return NextResponse.json({ ok: true, productId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal menyimpan draft produk.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
});