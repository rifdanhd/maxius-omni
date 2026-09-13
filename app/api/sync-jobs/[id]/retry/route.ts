import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { retrySingleSyncJob, SyncJobRetryError } from "@/lib/services/sync-job.service";

// POST /api/sync-jobs/:id/retry — retry manual 1 SyncJob spesifik (PHASE B.2).
// Memakai ulang mekanisme retry resmi (retrySingleSyncJob → runPushAttempt yang
// sama dengan processDueSyncJobs): BUKAN job baru, BUKAN logika duplikat.
// Guard: 404 job hilang; 422 SUCCESS/tidak eligible; 409 sedang diproses
// (claim atomik → spam-klik bersamaan hanya 1 yang jalan).
export const POST = withAuth(async (_req, ctx) => {
  const id = ctx?.params ? (await ctx.params).id : null;
  if (!id) return NextResponse.json({ error: "Id hilang." }, { status: 400 });

  try {
    const job = await retrySingleSyncJob(id);
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof SyncJobRetryError) {
      const status = err.code === "NOT_FOUND" ? 404 : err.code === "CONFLICT" ? 409 : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error("[SyncJob] retry manual gagal:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Gagal me-retry job." }, { status: 500 });
  }
});
