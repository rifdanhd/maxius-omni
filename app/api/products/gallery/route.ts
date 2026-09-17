import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { listGallery, GallerySort } from "@/lib/services/gallery.service";

// GET /api/products/gallery?search=&sort=&category=&status=&page=&pageSize=
// Galeri per produk master (kategori, jumlah varian, jumlah gambar, status kelengkapan).
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const sp = req.nextUrl.searchParams;
  const sort = sp.get("sort") as GallerySort | null;
  const validSorts: GallerySort[] = ["name_asc", "name_desc", "variants_desc", "images_desc"];
  const status = sp.get("status");
  const page = Number(sp.get("page") ?? 1);
  const pageSize = Number(sp.get("pageSize") ?? 20);

  const result = await listGallery({
    businessId: req.businessId,
    search: sp.get("search") ?? undefined,
    sort: sort && validSorts.includes(sort) ? sort : undefined,
    category: sp.get("category") ?? undefined,
    status:
      status === "complete" || status === "incomplete" || status === "none"
        ? status
        : undefined,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
  });

  return NextResponse.json(result);
});