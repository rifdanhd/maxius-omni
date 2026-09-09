import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

// Daftar varian stok pusat utk dropdown di UI mapping (grup per produk).
export const GET = withAuth(async () => {
  const variants = await prisma.productVariant.findMany({
    select: {
      id: true,
      sku: true,
      stock: true,
      safetyStock: true,
      masterProduct: { select: { id: true, name: true } },
    },
    orderBy: { masterProduct: { name: "asc" } },
  });
  return NextResponse.json({ variants });
});