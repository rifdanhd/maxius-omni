import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { enqueueOrderRuns } from "@/lib/services/order-run.service";
import { z } from "zod";

const syncRequestSchema = z.object({
  full: z.boolean().optional(),
  history: z.object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  }).optional(),
}).strict();

/**
 * POST /api/orders/sync — enqueue background run per akun (SyncRun).
 * TIDAK menarik order di dalam request: langsung balas {"background": true}
 * dan worker detached yang lanjut — user boleh berpindah menu (PRD poin 2).
 * Run aktif → dilewati ("masih berjalan"); run FAILED ber-cursor → resume.
 */
export const POST = withAuth(async (req) => {
  try {
    const parsed = syncRequestSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Rentang sinkronisasi tidak valid." }, { status: 400 });
    }
    const body = parsed.data;
    const history = body.history
      ? { from: new Date(body.history.from), to: new Date(body.history.to) }
      : undefined;
    if (history && (history.from.getTime() < 0 || history.from >= history.to || history.to.getTime() > Date.now())) {
      return NextResponse.json({ error: "Pilih rentang tanggal yang berurutan dan tidak melebihi hari ini." }, { status: 400 });
    }
    const results = await enqueueOrderRuns(req.businessId, { full: body.full, history });
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
