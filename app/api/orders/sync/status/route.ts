import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { listOrderRuns } from "@/lib/services/order-run.service";

/**
 * GET /api/orders/sync/status — run terbaru utk brand ini (UI polling tiap
 * 4 dtk): status/phase/counter live. Dipakai halaman Pesanan untuk indikator
 * "Berjalan di latar belakang… + N ditarik".
 */
export const GET = withAuth(async (req) => {
  const runs = await listOrderRuns(req.businessId, 10);
  const active = runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
  return NextResponse.json({ active, runs });
});
