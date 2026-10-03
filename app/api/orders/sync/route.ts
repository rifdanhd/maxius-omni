import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { enqueueOrderRuns } from "@/lib/services/order-run.service";

/**
 * POST /api/orders/sync — enqueue background run per akun (SyncRun).
 * TIDAK menarik order di dalam request: langsung balas {"background": true}
 * dan worker detached yang lanjut — user boleh berpindah menu (PRD poin 2).
 * Run aktif → dilewati ("masih berjalan"); run FAILED ber-cursor → resume.
 */
export const POST = withAuth(async (req) => {
  try {
    const results = await enqueueOrderRuns(req.businessId);
    const errors = results.filter((r) => r.error).map((r) => `${r.label}: ${r.error}`);
    const started = results.filter((r) => r.runId && !r.skipped).length;
    const stillRunning = results.filter((r) => r.skipped).length;
    return NextResponse.json({ background: true, started, stillRunning, errors, results });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
});
