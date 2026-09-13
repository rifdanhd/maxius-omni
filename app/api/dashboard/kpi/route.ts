import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { cached } from "@/lib/utils/ttl-cache";
import { getDashboardKpi } from "@/lib/services/dashboard-kpi.service";

const CACHE_TTL_MS = 60_000;

// GET /api/dashboard/kpi — KPI operasional read-only (PHASE C.1):
// Central Stock, Stok Kritis, Stock Mismatch, Sync Error, Store Health.
// Melengkapi /api/analytics + /api/summary (tidak mengubah keduanya).
export const GET = withAuth(async () => {
  const data = await cached("dashboard-kpi", CACHE_TTL_MS, getDashboardKpi);
  return NextResponse.json(data);
});
