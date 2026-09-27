/**
 * register() — dipanggil Next.js sekali per server instance.
 * Referensi: node_modules/next/dist/docs/01-app/02-guides/instrumentation.md
 *
 * F2 M5c — auto-retry SyncJob: tick in-process tiap 30 detik memanggil
 * processDueSyncJobs() (backoff 1m/5m/15m, maks 3x). Menggantikan rencana
 * crontab node script — VPS cuma 1.9GB RAM. Idempoten: claim atomik di
 * sync-job.service (updateMany bersyarat) sehingga tick tumpang-tindih /
 * register ulang (dev HMR) aman.
 */
const TICK_MS = 30_000;

type TimerGlobal = { __maxiusSyncRetryTimer?: ReturnType<typeof setInterval> };

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Default hanya produksi (pm2 next start); dev opt-in via SYNC_RETRY_DEV,
  // kill-switch total via SYNC_RETRY_DISABLED (mis. saat debug push).
  if (process.env.SYNC_RETRY_DISABLED === "true") return;
  if (process.env.NODE_ENV !== "production" && process.env.SYNC_RETRY_DEV !== "true") return;

  const g = globalThis as TimerGlobal;
  if (g.__maxiusSyncRetryTimer) return; // register dipanggil ulang (dev HMR)

  const { processDueSyncJobs } = await import("./lib/services/sync-job.service");
  const timer = setInterval(() => {
    void processDueSyncJobs()
      .then((r) => {
        if (r.requeued > 0) {
          console.warn(`[SyncRetry] ${r.requeued} job PROCESSING yatim → diantre ulang`);
        }
        if (r.processed > 0) {
          console.log(
            `[SyncRetry] ${r.processed} job jatuh tempo → ok:${r.succeeded} antre-ulang:${r.pendingRetry} gagal:${r.failed}`
          );
        }
      })
      .catch((e) => console.error("[SyncRetry] tick gagal:", e instanceof Error ? e.message : e));
  }, TICK_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
  g.__maxiusSyncRetryTimer = timer;
  console.log(`[SyncRetry] auto-retry SyncJob aktif (tiap ${TICK_MS / 1000}dtk)`);
}
