import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import {
  cancelStockOpname,
  finalizeStockOpname,
  recordOpnameCounts,
} from "@/lib/services/stock-opname.service";

// PATCH /api/inventory/opname/[id] — simpan hasil hitung fisik (bertahap).
// Body: { counts: [{ variantId, countedStock }] }
export const PATCH = withAuth(async (req, ctx) => {
  const id = ctx?.params ? (await ctx.params).id : null;
  if (!id) return NextResponse.json({ error: "Id hilang." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const result = await recordOpnameCounts({
    opnameId: id,
    counts: Array.isArray(body?.counts) ? body.counts : [],
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Gagal." }, { status: 400 });
  }
  return NextResponse.json({ opname: result.opname });
});

// POST /api/inventory/opname/[id] — aksi status.
// Body: { action: "finalize" } → koreksi selisih via jalur central-stock.
//       { action: "cancel" }   → batal (stok tidak tersentuh).
export const POST = withAuth(async (req, ctx) => {
  const id = ctx?.params ? (await ctx.params).id : null;
  if (!id) return NextResponse.json({ error: "Id hilang." }, { status: 400 });

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === "finalize") {
    const result = await finalizeStockOpname({ opnameId: id, userId: req.user.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason ?? "Gagal." }, { status: 400 });
    }
    return NextResponse.json(result);
  }

  if (action === "cancel") {
    const result = await cancelStockOpname({ opnameId: id, userId: req.user.id });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason ?? "Gagal." }, { status: 400 });
    }
    return NextResponse.json({ opname: result.opname });
  }

  return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
});
