import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

// GET /api/inventory/opname/variants?q=<teks>&all=1
// Daftar varian utk pemilih produk opname (nama produk/SKU). `all=1` → tanpa
// filter pencarian (UI batasi take).
export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const take = Math.min(100, Math.max(1, Number(url.searchParams.get("take") ?? 50) || 50));

  const variants = await prisma.productVariant.findMany({
    where: {
      masterProduct: { businessId: req.businessId },
      ...(q
        ? {
            OR: [
              { sku: { contains: q } },
              { name: { contains: q } },
              { masterProduct: { is: { name: { contains: q } } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      sku: true,
      name: true,
      stock: true,
      masterProduct: { select: { name: true } },
    },
    orderBy: [{ masterProduct: { name: "asc" } }, { sku: "asc" }],
    take,
  });
  return NextResponse.json({ variants });
});
