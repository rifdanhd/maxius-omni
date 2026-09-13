import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { listMismatchSyncJobs } from "@/lib/services/sync-mismatch.service";

// GET /api/sync-jobs?status=mismatch|FAILED|PENDING|SUCCESS|all&q=&limit=&cursor=
// Read-only: daftar SyncJob untuk Stock Mismatch View (PHASE B.1).
// Default status=mismatch → FAILED + PENDING yang sudah retry >= 1x.
export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const result = await listMismatchSyncJobs({
    status: url.searchParams.get("status"),
    q: url.searchParams.get("q"),
    limit: Number(url.searchParams.get("limit") ?? 50),
    cursor: url.searchParams.get("cursor"),
  });
  return NextResponse.json(result);
});
