import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { businessWhere } from "@/lib/services/business-scope.service";
import { listProducts, type ProductListLevel, type ProductListSort, type ProductListTab } from "@/lib/services/product-list.service";
import { prisma } from "@/lib/db/prisma";

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
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        productVariant: {
          where: includeInactive ? {} : { isArchived: false },
          include: {
            productMapping: {
              include: {
                account: { select: { id: true, platform: true, label: true } },
              },
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
