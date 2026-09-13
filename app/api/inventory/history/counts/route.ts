import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { getInventoryHistoryCounts } from "@/lib/services/stock-history.service";

// GET /api/inventory/history/counts — agregasi jumlah per jenis event
// (DB-level groupBy/count — tidak menarik baris ke memori).
export const GET = withAuth(async () => {
  const counts = await getInventoryHistoryCounts();
  return NextResponse.json({ counts });
});
