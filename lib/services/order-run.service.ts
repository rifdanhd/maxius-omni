/**
 * order-run — background sync pesanan (SyncRun) untuk histori masal.
 *
 * Kenapa: tombol "Sync Pesanan" lama berjalan sinkron di dalam request HTTP +
 * hard cap (TikTok 1.000 order, Shopee 500) → histori 10.000 tidak pernah
 * selesai dan meninggalkan halaman = kehilangan hasil. Run ini:
 *  - dijalankan detached (bukan di dalam request) → UI langsung balas,
 *    user boleh berpindah menu (PRD "background process");
 *  - persist cursor/jendela SETIAP halaman di SyncRun → lanjut lintas proses,
 *    resume setelah server restart (klik Sync lagi);
 *  - jeda antar halaman + phase `rate_wait` saat kena limit API Shopee
 *    (30 req/10 dtk) → jeda wajar, toko tidak diblokir;
 *  - tanpa cap total: terminasi = jendela habis (Shopee) / token habis
 *    (TikTok), dengan guard cursor-macet.
 *
 * Status: QUEUED → RUNNING → DONE | FAILED (sweep stale → FAILED, resume
 * by cursor). Progres live dibaca UI via GET /api/orders/sync/status.
 */
import { prisma } from "@/lib/db/prisma";
import { getOrderList, ShopeeRateLimitError } from "@/lib/integrations/shopee";
import { getOrders } from "@/lib/integrations/tiktokShop";
import {
  ingestShopeeOrderSummaries,
  type ShopeeSyncResult,
} from "@/lib/services/shopee-order-sync.service";
import {
  ingestTikTokOrdersPage,
  postTikTokOrderSync,
  type OrderRaw,
  type TikTokOrderSyncResult,
} from "@/lib/services/order-sync.service";

const KIND = "orders";
/** Jendela waktu Shopee per panggilan — batas resmi get_order_list. */
const WINDOW_SEC = 15 * 86400;
/** Jeda antar halaman (di luar jeda rate-limit) agar tidak membanjiri API. */
const PAGE_DELAY_MS = 400;
/** Retry per halaman sebelum run dinyatakan FAILED (resumable). */
const MAX_PAGE_ATTEMPTS = 3;

/** Run aktif di proses INI (dedup; klaim DB QUEUED→RUNNING = penjaga utama). */
const activeRuns = new Set<string>();

function envInt(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type SyncRunRow = {
  id: string;
  accountId: string;
  startedAt: Date;
  rangeField: string;
  windowFrom: Date | null;
  cursor: string | null;
  fetched: number;
  created: number;
  skipped: number;
};

export type EnqueueAccountResult = {
  accountId: string;
  label: string;
  runId?: string;
  /** "masih berjalan" — akun sudah punya run QUEUED/RUNNING. */
  skipped?: string;
  error?: string;
};

/**
 * enqueueOrderRuns — buat (atau resume) SyncRun order per akun brand ini,
 * lalu jalankan detached. TIDAK menunggu selesai (PRD: background).
 *
 * Mode run (disimpan di SyncRun.rangeField, dipertahankan saat resume):
 *  - delta (default): update_time ≥ lastPulledAt − 10 mnt → HANYA order baru /
 *    berubah sejak tarikan terakhir (bukan ulang 30 hari tiap klik);
 *  - full (bootstrap tanpa watermark, atau opts.full): create_time mundur
 *    SHOPEE_ORDER_SYNC_DAYS hari — utk backfill histori.
 */
export async function enqueueOrderRuns(
  businessId: string,
  opts?: { full?: boolean }
): Promise<EnqueueAccountResult[]> {
  const accounts = await prisma.platformAccount.findMany({
    where: { platform: { in: ["TIKTOK_SHOP", "SHOPEE"] }, businessId },
    select: {
      id: true,
      label: true,
      platform: true,
      accessToken: true,
      shopCipher: true,
      externalShopId: true,
      lastPulledAt: true,
    },
  });

  const out: EnqueueAccountResult[] = [];
  for (const acc of accounts) {
    // Guard token — sama seperti route lama (pesan tetap familiar).
    if (acc.platform === "TIKTOK_SHOP" && (!acc.accessToken || !acc.shopCipher)) {
      out.push({ accountId: acc.id, label: acc.label, error: "Belum punya access token / shop_cipher." });
      continue;
    }
    if (acc.platform === "SHOPEE" && !acc.accessToken) {
      out.push({ accountId: acc.id, label: acc.label, error: "Belum punya access token." });
      continue;
    }

    const active = await prisma.syncRun.findFirst({
      where: { accountId: acc.id, kind: KIND, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    });
    if (active) {
      out.push({ accountId: acc.id, label: acc.label, runId: active.id, skipped: "masih berjalan" });
      continue;
    }

    // Resume: run FAILED yang masih punya posisi (cursor/jendela) → lanjut,
    // bukan mulai dari nol (hemat untuk histori 10.000+ yang terputus restart).
    // opts.full (backfill eksplisit) TIDAK resume — mulai run penuh baru.
    const resumable = opts?.full
      ? null
      : await prisma.syncRun.findFirst({
          where: { accountId: acc.id, kind: KIND, status: "FAILED", cursor: { not: null } },
          orderBy: { startedAt: "desc" },
          select: { id: true },
        });
    let runId: string;
    if (resumable) {
      await prisma.syncRun.update({
        where: { id: resumable.id },
        data: { status: "QUEUED", phase: "resume", error: null, finishedAt: null, message: "lanjut dari posisi terakhir" },
      });
      runId = resumable.id;
    } else {
      const now = new Date();
      const since = opts?.full ? null : acc.lastPulledAt;
      const useDelta = since !== null;
      const rangeField = useDelta ? "update_time" : "create_time";
      const windowFrom = useDelta
        ? new Date(since.getTime() - 600_000) // overlap 10 mnt (clock skew / run kecil sebelumnya)
        : new Date(now.getTime() - envInt("SHOPEE_ORDER_SYNC_DAYS", 30) * 86_400_000);
      const run = await prisma.syncRun.create({
        data: {
          businessId,
          accountId: acc.id,
          kind: KIND,
          status: "QUEUED",
          phase: "pulling",
          message: useDelta ? "antrian — delta dari watermark" : "antrian — jendela penuh",
          startedAt: now,
          rangeField,
          windowFrom,
        },
      });
      runId = run.id;
    }
    out.push({ accountId: acc.id, label: acc.label, runId });
    startRun(runId);
  }
  return out;
}

/** Jalankan run detached (fire-and-forget) — aman dipanggil ulang. */
export function startRun(runId: string): void {
  if (activeRuns.has(runId)) return;
  activeRuns.add(runId);
  void processOrderRun(runId).finally(() => activeRuns.delete(runId));
}

async function processOrderRun(runId: string): Promise<void> {
  // Klaim atomik: hanya satu proses yang memenangkan QUEUED → RUNNING.
  const claim = await prisma.syncRun.updateMany({
    where: { id: runId, status: "QUEUED" },
    data: { status: "RUNNING", phase: "pulling", message: "mulai menarik order" },
  });
  if (claim.count === 0) return;

  const run = await prisma.syncRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const account = await prisma.platformAccount.findUnique({ where: { id: run.accountId } });
  if (!account) return failRun(runId, "Akun tidak ditemukan.");
  if (!account.accessToken) return failRun(runId, "Akun tidak punya access token.");

  try {
    if (account.platform === "SHOPEE") {
      if (!account.externalShopId) return failRun(runId, "Akun tidak punya external shop id.");
      await runShopee(run, account.accessToken, account.externalShopId);
    } else if (account.platform === "TIKTOK_SHOP") {
      if (!account.shopCipher) return failRun(runId, "Akun tidak punya shop_cipher.");
      await runTikTok(run, account.accessToken, account.shopCipher);
    } else {
      return failRun(runId, `Platform ${account.platform} tidak didukung.`);
    }
  } catch (e) {
    await failRun(runId, errMsg(e));
  }
}

/** Persist progres; false = run sudah di-sweep/diubah proses lain → HENTIKAN. */
async function persist(
  runId: string,
  data: {
    phase?: string;
    message?: string;
    cursor?: string;
    windowFrom?: Date;
    windowTo?: Date;
    fetched: number;
    created: number;
    skipped: number;
    error?: string | null;
  }
): Promise<boolean> {
  const r = await prisma.syncRun.updateMany({
    where: { id: runId, status: "RUNNING" },
    data,
  });
  return r.count > 0;
}

async function failRun(runId: string, message: string): Promise<void> {
  await prisma.syncRun.updateMany({
    where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } },
    data: {
      status: "FAILED",
      phase: "error",
      error: message,
      message: "terputus — klik Sync Pesanan untuk lanjut dari posisi terakhir",
      finishedAt: new Date(),
    },
  });
}

async function finishRun(runId: string, message: string): Promise<void> {
  await prisma.syncRun.updateMany({
    where: { id: runId, status: "RUNNING" },
    data: { status: "DONE", phase: "done", message, error: null, finishedAt: new Date() },
  });
}

/**
 * Majukan watermark akun HANYA setelah run sukses tanpa error. Range end =
 * startedAt (bukan waktu selesai) — order yang berubah selama run berjalan
 * tetap ke-cover delta berikutnya; overlap 10 menit menutup clock skew.
 * Gagal update watermark tidak boleh menggagalkan run.
 */
async function advanceWatermark(run: SyncRunRow): Promise<void> {
  await prisma.platformAccount
    .update({ where: { id: run.accountId }, data: { lastPulledAt: run.startedAt } })
    .catch(() => {});
}

/**
 * sweepStaleOrderRuns — run RUNNING yang tidak berdenyut >2 menit (proses
 * mati / restart server) → FAILED resumable. Dipanggil tick instrumentation.
 */
export async function sweepStaleOrderRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - 2 * 60_000);
  const r = await prisma.syncRun.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: cutoff } },
    data: {
      status: "FAILED",
      phase: "error",
      error: "Terputus (server restart atau proses mati).",
      message: "terputus — klik Sync Pesanan untuk lanjut dari posisi terakhir",
      finishedAt: new Date(),
    },
  });
  return r.count;
}

/** Daftar run terbaru utk brand (UI polling status). */
export async function listOrderRuns(businessId: string, take = 10) {
  return prisma.syncRun.findMany({
    where: { businessId, kind: KIND },
    orderBy: { startedAt: "desc" },
    take,
    select: {
      id: true,
      accountId: true,
      status: true,
      phase: true,
      message: true,
      fetched: true,
      created: true,
      skipped: true,
      error: true,
      startedAt: true,
      updatedAt: true,
      finishedAt: true,
      account: { select: { label: true, platform: true } },
    },
  });
}

/* ───────────────────────────── Shopee ───────────────────────────── */

async function runShopee(
  run: SyncRunRow,
  accessToken: string,
  shopId: string
): Promise<void> {
  const pageSize = 50;
  const rangeEnd = Math.floor(run.startedAt.getTime() / 1000);
  // Counter diinit dari run → resume tidak mengulang/menghapus capaian.
  const result: ShopeeSyncResult = {
    fetched: run.fetched,
    created: run.created,
    skipped: run.skipped,
    errors: [],
  };
  const seen = new Set<string>();

  // Mode: delta = update_time (dari watermark, disimpan enqueue); penuh =
  // create_time mundur N hari. windowFrom SELALU diisi enqueue/resume.
  const timeRangeField = run.rangeField === "update_time" ? "update_time" : "create_time";
  let windowFrom =
    run.windowFrom !== null
      ? Math.floor(run.windowFrom.getTime() / 1000)
      : rangeEnd - envInt("SHOPEE_ORDER_SYNC_DAYS", 30) * 86400;
  let cursor = run.cursor ?? "";
  let pages = 0;

  while (windowFrom < rangeEnd) {
    const winTo = Math.min(windowFrom + WINDOW_SEC, rangeEnd);
    let windowDone = false;

    while (!windowDone) {
      let page: Awaited<ReturnType<typeof getOrderList>> | null = null;
      let attempts = 0;
      while (page === null) {
        try {
          page = await getOrderList(accessToken, shopId, {
            createTimeFrom: windowFrom,
            createTimeTo: winTo,
            cursor,
            pageSize,
            timeRangeField,
          });
        } catch (e) {
          if (e instanceof ShopeeRateLimitError) {
            // Jeda rate limit = normal (PRD poin 1) — phase rate_wait, lalu coba lagi.
            await persist(run.id, {
              phase: "rate_wait",
              message: "jeda rate limit API Shopee…",
              cursor,
              windowFrom: new Date(windowFrom * 1000),
              windowTo: new Date(winTo * 1000),
              fetched: result.fetched,
              created: result.created,
              skipped: result.skipped,
              error: result.errors.slice(0, 5).join(" | ") || null,
            }).catch(() => false);
            await sleep(2_000);
            continue;
          }
          attempts += 1;
          if (attempts >= MAX_PAGE_ATTEMPTS) {
            await failRun(run.id, `get_order_list: ${errMsg(e)}`);
            return;
          }
          await sleep(3_000);
        }
      }

      pages += 1;
      const fresh = (page.orders ?? []).filter((o) => {
        const sn = o.order_sn;
        if (!sn || seen.has(sn)) return false;
        seen.add(sn);
        return true;
      });
      if (fresh.length > 0) {
        await ingestShopeeOrderSummaries(prisma, run.accountId, accessToken, shopId, fresh, result);
      }

      const pageLen = page.orders?.length ?? 0;
      const sameCursor = page.nextCursor === cursor;
      const progressed = pageLen > 0 && page.hasMore && !sameCursor;
      if (progressed) cursor = page.nextCursor;

      const alive = await persist(run.id, {
        phase: "pulling",
        message: `menarik halaman ${pages} — ${result.fetched} ditarik, ${result.created} baru`,
        cursor: progressed ? cursor : "",
        windowFrom: new Date(windowFrom * 1000),
        windowTo: new Date(winTo * 1000),
        fetched: result.fetched,
        created: result.created,
        skipped: result.skipped,
        error: result.errors.slice(0, 5).join(" | ") || null,
      });
      if (!alive) return; // di-sweep — biarkan proses lain yang mengurus

      if (pageLen === 0 || !progressed) windowDone = true;
      else await sleep(PAGE_DELAY_MS);
    }

    windowFrom = winTo;
    cursor = "";
  }

  // Ringkasan akhir → SyncLog (jejak audit; payload memuat error detail).
  try {
    await prisma.syncLog.create({
      data: {
        direction: "in",
        kind: "order_sync",
        status: result.errors.length > 0 ? "error" : "success",
        message: `${result.fetched} ditarik, ${result.created} baru, ${result.skipped} sudah ada (background run)`,
        payload: JSON.stringify({
          fetched: result.fetched,
          created: result.created,
          skipped: result.skipped,
          errors: result.errors,
        }),
        accountId: run.accountId,
      },
    });
  } catch {
    /* log gagal tidak menggagalkan run */
  }
  if (result.errors.length === 0) await advanceWatermark(run);
  await finishRun(run.id, `${result.fetched} ditarik, ${result.created} baru, ${result.skipped} sudah ada`);
}

/* ───────────────────────────── TikTok ───────────────────────────── */

async function runTikTok(
  run: SyncRunRow,
  accessToken: string,
  shopCipher: string
): Promise<void> {
  const result: TikTokOrderSyncResult = {
    fetched: run.fetched,
    created: run.created,
    skipped: run.skipped,
    errors: [],
    reconciled: 0,
    reconcileScan: 0,
    trackingEvents: 0,
  };
  let pageToken: string | undefined = run.cursor || undefined;
  let pages = 0;
  // Delta: update_time_ge dari watermark (windowFrom = since − 10 mnt);
  // mode penuh tanpa filter (ambil semua, urut terbaru).
  const updateTimeGe =
    run.rangeField === "update_time" && run.windowFrom
      ? Math.floor(run.windowFrom.getTime() / 1000)
      : undefined;

  for (;;) {
    let res: Awaited<ReturnType<typeof getOrders>> | null = null;
    let attempts = 0;
    while (res === null) {
      try {
        res = await getOrders(accessToken, shopCipher, { pageToken, updateTimeGe });
      } catch (e) {
        attempts += 1;
        if (attempts >= MAX_PAGE_ATTEMPTS) {
          await failRun(run.id, `orders/search: ${errMsg(e)}`);
          return;
        }
        await persist(run.id, {
          phase: "rate_wait",
          message: "jeda — orders/search gagal, mencoba ulang…",
          cursor: pageToken ?? "",
          fetched: result.fetched,
          created: result.created,
          skipped: result.skipped,
        }).catch(() => false);
        await sleep(3_000);
      }
    }

    pages += 1;
    const raws = (res.orders ?? []) as OrderRaw[];
    result.fetched += raws.length;
    if (raws.length > 0) {
      await ingestTikTokOrdersPage(prisma, run.accountId, raws, result);
    }

    const next = res.nextPageToken ?? undefined;
    const progressed = raws.length > 0 && Boolean(next) && next !== pageToken;
    if (progressed) pageToken = next;

    const alive = await persist(run.id, {
      phase: "pulling",
      message: `menarik halaman ${pages} — ${result.fetched} ditarik, ${result.created} baru`,
      cursor: pageToken ?? "",
      fetched: result.fetched,
      created: result.created,
      skipped: result.skipped,
      error: result.errors.slice(0, 5).join(" | ") || null,
    });
    if (!alive) return;

    if (raws.length === 0 || !progressed) break;
    await sleep(PAGE_DELAY_MS);
  }

  // Pasca-ingest sekali di akhir: reconcile resi + tracking + SyncLog.
  await postTikTokOrderSync(prisma, run.accountId, result);
  const reconcileNote = result.reconciled > 0 ? `, ${result.reconciled} resi dilengkapi` : "";
  if (result.errors.length === 0) await advanceWatermark(run);
  await finishRun(
    run.id,
    `${result.fetched} ditarik, ${result.created} baru, ${result.skipped} sudah ada${reconcileNote}`
  );
}
