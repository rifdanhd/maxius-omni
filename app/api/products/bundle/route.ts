import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

export const BUNDLE_TYPE = "bundle" as const;
const SINGLE_TYPE = "single" as const;

/**
 * POST /api/products/bundle — buat produk bundle baru.
 * Body: { name: string, category?: string, imageUrl?: string,
 *         items: [{ variantId: string, qty: number }] }
 * - Komponen harus varian milik master SINGLE (tanpa bundle-bersarang).
 * - Bundle tidak punya varian jual sendiri; stok/komposisi dibaca dari items.
 */
export const POST = withAuth(async (req) => {
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    category?: unknown;
    imageUrl?: unknown;
    items?: unknown;
  };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Nama bundle wajib diisi." }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { error: "Bundle harus memuat minimal 1 varian komponen." },
      { status: 400 }
    );
  }

  const seen = new Set<string>();
  const items: Array<{ variantId: string; qty: number }> = [];
  for (const [i, raw] of body.items.entries()) {
    const variantId =
      raw && typeof raw === "object"
        ? String((raw as { variantId?: unknown }).variantId ?? "").trim()
        : "";
    const qty = raw && typeof raw === "object" ? (raw as { qty?: unknown }).qty : undefined;
    if (!variantId) {
      return NextResponse.json(
        { error: `Item ke-${i + 1}: variantId wajib diisi.` },
        { status: 400 }
      );
    }
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) {
      return NextResponse.json(
        { error: `Item ke-${i + 1}: qty harus bilangan bulat >= 1.` },
        { status: 400 }
      );
    }
    if (seen.has(variantId)) {
      return NextResponse.json(
        { error: `Varian "${variantId}" duplikat — gabungkan jadi satu item dengan qty total.` },
        { status: 400 }
      );
    }
    seen.add(variantId);
    items.push({ variantId, qty });
  }

  const variants = await prisma.productVariant.findMany({
    where: {
      id: { in: items.map((it) => it.variantId) },
      masterProduct: { businessId: req.businessId },
    },
    select: {
      id: true,
      sku: true,
      masterProduct: { select: { id: true, name: true, type: true } },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  for (const it of items) {
    const v = byId.get(it.variantId);
    if (!v) {
      return NextResponse.json(
        { error: `Varian "${it.variantId}" tidak ditemukan.` },
        { status: 400 }
      );
    }
    if (v.masterProduct.type !== SINGLE_TYPE) {
      return NextResponse.json(
        { error: `Varian "${v.sku}" milik produk bundle ("${v.masterProduct.name}") — bundle-bersarang belum didukung.` },
        { status: 400 }
      );
    }
  }

  const category =
    typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;
  const imageUrl =
    typeof body.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : null;
  if (imageUrl !== null && !/^https?:\/\/.+/.test(imageUrl)) {
    return NextResponse.json(
      { error: "imageUrl harus berupa URL yang valid (http/https)." },
      { status: 400 }
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const product = await tx.masterProduct.create({
      data: {
        name,
        businessId: req.businessId,
        ...(category ? { category } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        type: BUNDLE_TYPE,
      },
    });
    for (const it of items) {
      await tx.bundleItem.create({
        data: { bundleProductId: product.id, componentVariantId: it.variantId, qty: it.qty },
      });
    }
    return tx.masterProduct.findUniqueOrThrow({
      where: { id: product.id },
      include: {
        bundleItem: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                stock: true,
                masterProduct: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  });

  return NextResponse.json({ ok: true, product: created }, { status: 201 });
});
