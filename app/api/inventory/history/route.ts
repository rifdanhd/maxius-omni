import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { listInventoryHistory } from "@/lib/services/stock-history.service";

// GET /api/inventory/history
//   ?cursor=&limit=&from=YYYY-MM-DD&to=YYYY-MM-DD&q=<produk/SKU>&source=ledger|synclog
// Cursor pagination (keyset per-feed) sejak awal — pelajaran TUGAS 2.
export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const result = await listInventoryHistory({
    businessId: req.businessId,
    cursor: url.searchParams.get("cursor"),
    limit: Number(url.searchParams.get("limit") ?? 50),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    q: url.searchParams.get("q"),
    source: url.searchParams.get("source"),
  });
  return NextResponse.json(result);
});
