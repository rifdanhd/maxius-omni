import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { businessWhere } from "@/lib/services/business-scope.service";

export const GET = withAuth(async (req) => {
  // Default HANYA produk aktif (isActive) supaya halaman yang tidak peduli
  // visibilitas otomatis menyembunyikan yang nonaktif. ?includeInactive=true
  // untuk menampilkan semuanya (dipakai filter "Tampilkan nonaktif").
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const products = await prisma.masterProduct.findMany({
    where: {
      ...businessWhere.product(req.businessId),
      ...(includeInactive ? {} : { isActive: true }),
    },
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
  }));
  return NextResponse.json({ products: payload });
});
