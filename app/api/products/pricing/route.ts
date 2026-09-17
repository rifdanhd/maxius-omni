import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { listPricing, PricingSort } from "@/lib/services/pricing.service";

// GET /api/products/pricing?search=&sort=&store=&category=&priceMin=&priceMax=&page=&pageSize=
// Daftar produk+varian dengan harga default & harga per marketplace.
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const sp = req.nextUrl.searchParams;

  const sort = sp.get("sort") as PricingSort | null;
  const validSorts: PricingSort[] = [
    "name_asc", "name_desc", "sku_asc", "sku_desc",
    "price_asc", "price_desc", "updated_desc", "created_desc",
  ];

  const page = Number(sp.get("page") ?? 1);
  const pageSize = Number(sp.get("pageSize") ?? 20);

  const result = await listPricing({
    businessId: req.businessId,
    search: sp.get("search") ?? undefined,
    sort: sort && validSorts.includes(sort) ? sort : undefined,
    storeIds: sp.get("store")?.split(",").filter(Boolean) || undefined,
    category: sp.get("category") ?? undefined,
    priceMin: sp.get("priceMin") ? Number(sp.get("priceMin")) : undefined,
    priceMax: sp.get("priceMax") ? Number(sp.get("priceMax")) : undefined,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
  });

  return NextResponse.json(result);
});