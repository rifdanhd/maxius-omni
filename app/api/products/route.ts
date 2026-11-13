import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { businessWhere } from "@/lib/services/business-scope.service";
import { listProducts, type ProductListLevel, type ProductListSort, type ProductListTab } from "@/lib/services/product-list.service";
import { prisma } from "@/lib/db/prisma";
import crypto from "node:crypto";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown; description?: unknown; category?: unknown; imageUrl?: unknown;
    threshold?: unknown; variants?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Nama produk wajib diisi." }, { status: 400 });
  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (variants.length === 0) return NextResponse.json({ error: "Minimal satu varian wajib diisi." }, { status: 400 });
  const seen = new Set<string>();
  const parsed = variants.map((raw, index) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const sku = String(item.sku ?? "").trim();
    if (!sku) throw new Error(`SKU varian ke-${index + 1} wajib diisi.`);
    const key = sku.toLowerCase();
    if (seen.has(key)) throw new Error(`SKU "${sku}" duplikat.`);
    seen.add(key);
    const stock = Number(item.stock ?? 0);
    const price = item.price === null || item.price === undefined || item.price === "" ? null : Number(item.price);
    if (!Number.isInteger(stock) || stock < 0) throw new Error(`Stok varian "${sku}" harus bilangan bulat >= 0.`);
    if (price !== null && (!Number.isFinite(price) || price < 0)) throw new Error(`Harga varian "${sku}" tidak valid.`);
    return { sku, name: String(item.name ?? "").trim() || null, stock, price, safetyStock: Math.max(0, Math.trunc(Number(item.safetyStock ?? 0) || 0)) };
  });
  try {
    const settings = await getCachedInventorySettings(req.businessId);
    const imageUrl = body.imageUrl === undefined || body.imageUrl === null ? null : String(body.imageUrl).trim();
    if (imageUrl && !/^https?:\/\/.+/.test(imageUrl)) return NextResponse.json({ error: "URL gambar harus http/https." }, { status: 400 });
    const threshold = body.threshold === undefined || body.threshold === "" ? settings.lowStockDefaultThreshold : Number(body.threshold);
    if (!Number.isInteger(threshold) || threshold < 0) return NextResponse.json({ error: "Ambang stok tidak valid." }, { status: 400 });
    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.masterProduct.create({ data: {
        name, businessId: req.businessId, description: String(body.description ?? "").trim() || null,
        category: String(body.category ?? "").trim() || null, imageUrl: imageUrl || null, threshold,
        productVariant: { create: parsed },
      }, select: { id: true, name: true } });
      const createdVariants = await tx.productVariant.findMany({ where: { masterProductId: product.id }, select: { id: true, stock: true, sku: true } });
      if (createdVariants.some((v) => v.stock > 0)) await tx.stockLedger.createMany({ data: createdVariants.filter((v) => v.stock > 0).map((v) => ({ id: crypto.randomUUID(), variantId: v.id, changeQty: v.stock, stockAfter: v.stock, reason: "INIT", referenceId: product.id, note: "Stok awal produk master" })) });
      return product;
    });
    return NextResponse.json({ ok: true, product: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal membuat produk." }, { status: 400 });
  }
});

// GET /api/products
// - Tanpa ?page=      → dump penuh semua produk (mode lama, dipakai modal
//   Bundle & mapping TikTok yang butuh seluruh varian utk pencarian client).
// - Dengan ?page=     → server-side pagination + filter:
//   ?q=&tab=single|bundle&level=low|out&category=&platform=&store=
//   &sort=name_asc|name_desc|stock_desc|stock_asc|links_desc
//   &page=&pageSize=&includeInactive=true
//   Respon: { products, total, page, pageSize, counts, facets }.
const VALID_TABS: ProductListTab[] = ["single", "bundle"];
const VALID_LEVELS: ProductListLevel[] = ["low", "out"];
const VALID_SORTS: ProductListSort[] = [
  "name_asc", "name_desc", "stock_desc", "stock_asc", "links_desc",
];

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("includeInactive") === "true";

  if (!url.searchParams.has("page")) {
    // Default HANYA produk aktif (isActive) supaya halaman yang tidak peduli
    // visibilitas otomatis menyembunyikan yang nonaktif. ?includeInactive=true
    // untuk menampilkan semuanya (dipakai filter "Tampilkan nonaktif").
    const products = await prisma.masterProduct.findMany({
      where: {
        ...businessWhere.product(req.businessId),
        ...(includeInactive ? {} : { isActive: true, status: "active" }),
      },
      include: {
        productVariant: {
          where: includeInactive ? {} : { isArchived: false },
          include: {
            productMapping: {
              include: {
                account: { select: { id: true, platform: true, label: true } },
              },
              orderBy: { updatedAt: "desc" },
            },
          },
        },
        // Komposisi bundle (kosong utk produk single) — aditif, konsumen lama
        // yang hanya membaca variants/mappings tidak terpengaruh.
        bundleItem: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                stock: true,
                safetyStock: true,
                masterProduct: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });
    // Nama relasi di DB adalah productVariant/productMapping/bundleItem, tapi
    // kontrak API lama memakai variants/mappings/bundleItems. Kembalikan nama
    // lama supaya konsumen (halaman Produk, modal mapping TikTok) tidak patah.
    const payload = products.map(({ productVariant, bundleItem, ...product }) => ({
      ...product,
      variants: productVariant.map(({ productMapping, ...variant }) => ({
        ...variant,
        // Foto varian dari listing marketplace (bila ada) + foto master untuk
        // fallback; keduanya opsional sehingga konsumen lama tetap aman.
        imageUrl: productMapping.find((mapping) => mapping.imageUrl)?.imageUrl ?? null,
        masterImageUrl: product.imageUrl ?? null,
        mappings: productMapping,
      })),
      bundleItems: bundleItem,
      type: product.type === "bundle" || bundleItem.length > 0 ? "bundle" : "single",
    }));
    return NextResponse.json({ products: payload });
  }

  const page = Number(url.searchParams.get("page") ?? 1);
  const pageSize = Number(url.searchParams.get("pageSize") ?? 25);
  const tabParam = url.searchParams.get("tab") as ProductListTab | null;
  const levelParam = url.searchParams.get("level") as ProductListLevel | null;
  const sortParam = url.searchParams.get("sort") as ProductListSort | null;

  const result = await listProducts({
    businessId: req.businessId,
    includeInactive,
    q: url.searchParams.get("q") ?? undefined,
    tab: tabParam && VALID_TABS.includes(tabParam) ? tabParam : undefined,
    level: levelParam && VALID_LEVELS.includes(levelParam) ? levelParam : undefined,
    sort: sortParam && VALID_SORTS.includes(sortParam) ? sortParam : undefined,
    category: url.searchParams.get("category") ?? undefined,
    platform: url.searchParams.get("platform") ?? undefined,
    store: url.searchParams.get("store") ?? undefined,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 25,
  });
  return NextResponse.json(result);
});
