import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

export const GET = withAuth(async (req) => {
  // Default HANYA produk aktif (isActive) supaya halaman yang tidak peduli
  // visibilitas otomatis menyembunyikan yang nonaktif. ?includeInactive=true
  // untuk menampilkan semuanya (dipakai filter "Tampilkan nonaktif").
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const products = await prisma.masterProduct.findMany({
    where: includeInactive ? undefined : { isActive: true },
    include: {
      productVariant: {
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
              masterProduct: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ products });
});
