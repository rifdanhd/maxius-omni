import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { setMasterProductImage } from "@/lib/services/gallery.service";

// PATCH /api/products/[productId] — edit sebagian produk master.
// Body (minimal satu field):
//   { imageUrl: string | null } — set/ubah/hapus gambar produk master.
//   { isActive: boolean } — nonaktifkan (soft delete, sembunyi dari list
//     default) / aktifkan kembali. TIDAK menghapus data apa pun: varian,
//     mapping, ledger, dan order tetap utuh.
export const PATCH = withAuth(async (req: AuthenticatedRequest, ctx) => {
  const productId = ctx?.params ? (await ctx.params).productId : null;
  if (!productId) {
    return NextResponse.json({ error: "Product id hilang." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    imageUrl?: unknown;
    isActive?: unknown; name?: unknown; description?: unknown; category?: unknown; threshold?: unknown; status?: unknown;
    variants?: unknown;
  };
  const data: { imageUrl?: string | null; isActive?: boolean; name?: string; description?: string | null; category?: string | null; threshold?: number; status?: string } = {};
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
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "Nama produk wajib diisi." }, { status: 400 });
    data.name = name;
  }
  if (body.description !== undefined) data.description = String(body.description ?? "").trim() || null;
  if (body.category !== undefined) data.category = String(body.category ?? "").trim() || null;
  if (body.threshold !== undefined) {
    const threshold = Number(body.threshold);
    if (!Number.isInteger(threshold) || threshold < 0) return NextResponse.json({ error: "Ambang stok tidak valid." }, { status: 400 });
    data.threshold = threshold;
  }
  if (body.status !== undefined) {
    const status = String(body.status).trim().toLowerCase();
    if (!["active", "draft"].includes(status)) return NextResponse.json({ error: "Status produk tidak valid." }, { status: 400 });
    data.status = status;
  }
  const variantUpdates = Array.isArray(body.variants) ? body.variants : [];
  if (Object.keys(data).length === 0) {
    if (variantUpdates.length === 0) return NextResponse.json(
      { error: "Minimal satu field produk wajib diisi." }, { status: 400 }
    );
  }

  const product = await prisma.masterProduct.findUnique({ where: { id: productId } });
  if (!product) {
    return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  }
  try {
    assertSameBrand(product.businessId, req.businessId);
  } catch {
    return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (data.imageUrl !== undefined) {
      await setMasterProductImage(tx, productId, data.imageUrl);
    }
    if (data.isActive !== undefined) {
      await tx.masterProduct.update({ where: { id: productId }, data: { isActive: data.isActive } });
    }
    const productFields = Object.fromEntries(Object.entries(data).filter(([key]) => key !== "imageUrl" && key !== "isActive" && data[key as keyof typeof data] !== undefined));
    if (Object.keys(productFields).length) await tx.masterProduct.update({ where: { id: productId }, data: productFields });
    for (const raw of variantUpdates) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as { id?: unknown; name?: unknown; price?: unknown };
      const id = String(item.id ?? "").trim();
      if (!id) continue;
      const variant = await tx.productVariant.findFirst({ where: { id, masterProductId: productId }, select: { id: true } });
      if (!variant) throw new Error("Varian produk tidak ditemukan.");
      const price = item.price === null || item.price === undefined || item.price === "" ? null : Number(item.price);
      if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error("Harga varian tidak valid.");
      await tx.productVariant.update({ where: { id }, data: { ...(item.name !== undefined ? { name: String(item.name ?? "").trim() || null } : {}), ...(item.price !== undefined ? { price, priceUpdatedAt: new Date() } : {}) } });
    }
    return tx.masterProduct.findUniqueOrThrow({
      where: { id: productId },
      select: { id: true, name: true, description: true, category: true, threshold: true, status: true, imageUrl: true, isActive: true },
    });
  });

  return NextResponse.json({ ok: true, ...updated });
});
