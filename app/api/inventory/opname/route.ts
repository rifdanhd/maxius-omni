import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import {
  createStockOpname,
  listStockOpnames,
} from "@/lib/services/stock-opname.service";

// GET /api/inventory/opname?status=PENDING|IN_PROGRESS|COMPLETED|CANCELLED
// Daftar opname (utk tab; badge jumlah dihitung via counts=1).
export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const wantsCounts = url.searchParams.get("counts") === "1";

  if (wantsCounts) {
    const grouped = await prisma.stockOpname.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const g of grouped) counts[g.status] = g._count._all;
    return NextResponse.json({ counts });
  }

  const opnames = await listStockOpnames({ status });
  return NextResponse.json({ opnames });
});

// POST /api/inventory/opname
// Buat opname baru + snapshot stok sistem saat itu. Body:
// { variantIds?: string[], all?: boolean, note?: string }
export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  const result = await createStockOpname({
    variantIds: Array.isArray(body?.variantIds) ? body.variantIds : undefined,
    all: body?.all === true,
    note: typeof body?.note === "string" ? body.note : null,
    userId: req.user.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Gagal." }, { status: 400 });
  }
  return NextResponse.json({ opname: result.opname }, { status: 201 });
});
