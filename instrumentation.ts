/**
 * register() — dipanggil Next.js sekali per server instance.
 * Referensi: node_modules/next/dist/docs/01-app/02-guides/instrumentation.md
 *
 * F2 M5c — auto-retry SyncJob: tick in-process tiap 30 detik memanggil
 * processDueSyncJobs() (backoff 1m/5m/15m, maks 3x). Menggantikan rencana
 * crontab node script — VPS cuma 1.9GB RAM. Idempoten: claim atomik di
 * sync-job.service (updateMany bersyarat) sehingga tick tumpang-tindih /
 * register ulang (dev HMR) aman.
 *
 * Auto-sync (A+C): order tiap 5 menit + listing/gambar tiap 30 menit via
 * auto-sync.service — juga in-process (alasan RAM yang sama), unref(),
 * dedup per-timer untuk dev HMR, kill-switch AUTO_SYNC_DISABLED.
 */
const TICK_MS = 30_000;
const AUTO_ORDERS_MS = 5 * 60_000;
const AUTO_LISTINGS_MS = 30 * 60_000;

type TimerGlobal = {
  __maxiusSyncRetryTimer?: ReturnType<typeof setInterval>;
  __maxiusAutoOrdersTimer?: ReturnType<typeof setInterval>;
  __maxiusAutoListingsTimer?: ReturnType<typeof setInterval>;
};

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as TimerGlobal;
  const unref = (t: ReturnType<typeof setInterval>) => {
    (t as unknown as { unref?: () => void }).unref?.();
    return t;
  };

  // --- Auto-retry SyncJob (lama) ---
  // Default hanya produksi (pm2 next start); dev opt-in via SYNC_RETRY_DEV,
  // kill-switch total via SYNC_RETRY_DISABLED (mis. saat debug push).
  const retryAllowed =
    process.env.SYNC_RETRY_DISABLED !== "true" &&
    (process.env.NODE_ENV === "production" || process.env.SYNC_RETRY_DEV === "true");
  if (retryAllowed && !g.__maxiusSyncRetryTimer) {
    const { processDueSyncJobs } = await import("./lib/services/sync-job.service");
    g.__maxiusSyncRetryTimer = unref(
      setInterval(() => {
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
      }, TICK_MS)
    );
    console.log(`[SyncRetry] auto-retry SyncJob aktif (tiap ${TICK_MS / 1000}dtk)`);
  }

  // --- Auto-sync order + listing/gambar ---
  const autoAllowed =
    process.env.AUTO_SYNC_DISABLED !== "true" &&
    (process.env.NODE_ENV === "production" || process.env.AUTO_SYNC_DEV === "true");
  if (autoAllowed) {
    const { autoSyncOrdersOnce, autoSyncListingsOnce } = await import(
      "./lib/services/auto-sync.service"
    );

    if (!g.__maxiusAutoOrdersTimer) {
      g.__maxiusAutoOrdersTimer = unref(
        setInterval(() => {
          void autoSyncOrdersOnce()
            .then((r) => {
              if (r.created > 0 || r.errors > 0) {
                console.log(
                  `[AutoSync] order: ${r.accounts} akun, +${r.created} baru, ${r.skipped} sudah ada, ${r.errors} galat`
                );
              }
            })
            .catch((e) => console.error("[AutoSync] order tick gagal:", e instanceof Error ? e.message : e));
        }, AUTO_ORDERS_MS)
      );
      console.log(`[AutoSync] order otomatis aktif (tiap ${AUTO_ORDERS_MS / 60000} menit)`);
    }

    if (!g.__maxiusAutoListingsTimer) {
      g.__maxiusAutoListingsTimer = unref(
        setInterval(() => {
          void autoSyncListingsOnce()
            .then((r) => {
              console.log(
                `[AutoSync] listing: shopee +${r.shopeeNew} item / ${r.shopeeMatched} mapping, tiktok ${r.tiktokSynced} mapping, ${r.errors} galat`
              );
            })
            .catch((e) => console.error("[AutoSync] listing tick gagal:", e instanceof Error ? e.message : e));
        }, AUTO_LISTINGS_MS)
      );
      console.log(`[AutoSync] listing+gambar otomatis aktif (tiap ${AUTO_LISTINGS_MS / 60000} menit)`);
    }
  }
}
