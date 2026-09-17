import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";

// GET /api/inventory/opname/[id] — detail opname + item (stok sistem snapshot,
// hasil hitung fisik, selisih dihitung di klien).

export const GET = withAuth(async (req, ctx) => {
  const id = ctx?.params ? (await ctx.params).id : null;
  if (!id) return NextResponse.json({ error: "Id hilang." }, { status: 400 });

  const opname = await prisma.stockOpname.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              name: true,
              stock: true,
              masterProduct: { select: { businessId: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      },
      user: { select: { id: true, username: true } },
    },
  });
  if (!opname) return NextResponse.json({ error: "Opname tidak ditemukan." }, { status: 404 });
  try {
    for (const item of opname.items) {
      assertSameBrand(item.variant.masterProduct.businessId, req.businessId);
    }
  } catch {
    return NextResponse.json({ error: "Opname tidak ditemukan." }, { status: 404 });
  }
  return NextResponse.json({ opname });
});
