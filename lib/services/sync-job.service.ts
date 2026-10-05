import { prisma } from "@/lib/db/prisma";
import { syncStockToMarketplaces, type SyncPushItemResult } from "@/lib/services/sync.service";
import { isDeduplicationFailure } from "@/lib/services/stock-guard.policy";
import { businessWhere } from "@/lib/services/business-scope.service";

/**
 * SyncJob — state machine push stok (PHASE A).
 *
 * SyncLog = append-only history (tidak pernah dimutasi).
 * SyncJob  = status yang BISA di-query ulang untuk retry + UI mismatch.
 *
 * Trigger: enqueueSyncJobs() dipanggil dari pushVariantStockToOthers
 * (satu-satunya funnel pasca-mutasi central) — 1 job per
 * (variantId, accountId, channelSku) dengan coalesce: PENDING yang sama
 * di-update ke nilai terbaru (nilai terakhir menang), bukan baris baru.
 * Unique constraint level DB menutup race dua enqueue bersamaan.
 *
 * Retry: processDueSyncJobs() — backoff 1m/5m/15m, max 3x. Setelah habis →
 * status FAILED + retryCount=3 (mismatch marker untuk UI PHASE B).
 * Central stock TIDAK PERNAH di-rollback karena push gagal.
 */

export const SYNC_JOB_STATUSES = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
} as const;
export type SyncJobStatus = (typeof SYNC_JOB_STATUSES)[keyof typeof SYNC_JOB_STATUSES];

/** Batas retry sebelum job dinyatakan FAILED permanen (mismatch). */
export const SYNC_JOB_MAX_RETRIES = 3;

/** Backoff per kegagalan ke-N (1-based): 1m → 5m → 15m. */
export const SYNC_JOB_BACKOFF_MS = [60_000, 300_000, 900_000];

export function syncJobBackoffMs(failedAttempt: number): number {
  const idx = Math.min(
    Math.max(failedAttempt, 1) - 1,
    SYNC_JOB_BACKOFF_MS.length - 1
  );
  return SYNC_JOB_BACKOFF_MS[idx];
}

export type SyncJobTarget = { accountId: string; channelSku: string };

/** Identitas baris — unique constraint DB bekerja di level (triple, status). */
type JobIdentity = {
  id: string;
  variantId: string;
  accountId: string;
  channelSku: string;
};

/**
 * applyStatusTransition — transisi status TANPA pelanggaran unique constraint
 * (variantId, accountId, channelSku, status).
 *
 * Masalah yang diperbaiki: triple yang SUDAH pernah mencapai status tertentu
 * tidak bisa kembali ke status itu (baris lama masih ada) → update melempar
 * P2002, dan karena transisi terminal ada di dalam catch runPushAttempt, error
 * ini tercatat sebagai "kegagalan push" lalu mematikan seluruh tick auto-retry
 * (satu job gagal → job lain di tick yang sama tidak diproses).
 *
 * Aturan:
 * - SUCCESS/FAILED (terminal): baris lama status sama utk triple yang sama =
 *   sisa siklus sebelumnya → DIHAPUS dulu (riwayat tetap utuh di SyncLog yang
 *   append-only). Siklus baru menang.
 * - PENDING: bila PENDING baru sudah ada (dibuat enqueue selama baris ini
 *   PROCESSING), baris ini sudah usang — nilai terbaru menang → buang diri
 *   sendiri, baris baru itulah yang akan diproses.
 */
async function applyStatusTransition(
  job: JobIdentity,
  data: {
    status: string;
    retryCount?: number;
    lastError?: string | null;
    nextRetryAt?: Date | null;
  }
): Promise<"applied" | "superseded"> {
  const triple = {
    variantId: job.variantId,
    accountId: job.accountId,
    channelSku: job.channelSku,
  };

  if (data.status === SYNC_JOB_STATUSES.PENDING) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const newer = await prisma.syncJob.findFirst({
        where: {
          ...triple,
          status: SYNC_JOB_STATUSES.PENDING,
          id: { not: job.id },
        },
        select: { id: true },
      });
      if (newer) {
        await prisma.syncJob.delete({ where: { id: job.id } }).catch(() => undefined);
        return "superseded";
      }
      try {
        await prisma.syncJob.update({ where: { id: job.id }, data });
        return "applied";
      } catch (err) {
        if (!isDeduplicationFailure(err)) throw err;
        // race: PENDING baru tercipta di antara findFirst & update → ulangi.
      }
    }
    // Kalah race 3x berturut-turut — anggap baris sudah usang.
    await prisma.syncJob.delete({ where: { id: job.id } }).catch(() => undefined);
    return "superseded";
  }

  await prisma.syncJob.deleteMany({
    where: { ...triple, status: data.status, id: { not: job.id } },
  });
  await prisma.syncJob.update({ where: { id: job.id }, data });
  return "applied";
}

/**
 * enqueueSyncJobs — catat 1 job PENDING per target (coalesce ke nilai terbaru).
 * Tidak pernah melempar: kegagalan enqueue tidak boleh menggagalkan mutasi stok.
 */
export async function enqueueSyncJobs(
  variantId: string,
  targets: SyncJobTarget[],
  newSellable: number
): Promise<void> {
  for (const t of targets) {
    try {
      await prisma.syncJob.create({
        data: {
          variantId,
          accountId: t.accountId,
          channelSku: t.channelSku,
          newSellable,
          status: SYNC_JOB_STATUSES.PENDING,
        },
      });
    } catch (err) {
      if (isDeduplicationFailure(err)) {
        // PENDING untuk triple ini sudah ada (dibuat proses bersamaan) →
        // update ke nilai terbaru, bukan baris baru.
        await prisma.syncJob.updateMany({
          where: {
            variantId,
            accountId: t.accountId,
            channelSku: t.channelSku,
            status: SYNC_JOB_STATUSES.PENDING,
          },
          data: { newSellable },
        });
        continue;
      }
      console.error("[SyncJob] enqueue gagal:", err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Hasil push satu job menurut pusher.
 *
 * PHASE A fix-up (Temuan #1): pusher MENGEMBALIKAN hasil aktual channel
 * ({ success: false, error }) alih-alih hanya "selesai tanpa throw".
 * Return void (kontrak lama — pusher test yang hanya resolve) = sukses.
 * Throw tetap didukung (gagal tak terduga) dan diperlakukan sama dengan
 * success:false — masuk jalur retry/FAILED di bawah.
 */
export type SyncJobPushResult = { success: boolean; error?: string };

/** Fungsi pengirim aktual — di-inject agar test bisa mensimulasikan gagal. */
export type SyncJobPusher = (job: {
  id: string;
  accountId: string;
  channelSku: string;
  newSellable: number;
}) => Promise<SyncJobPushResult | void>;

/**
 * Pusher produksi: lewat jalur antrean debounce yang sudah ada, dan
 * MENERUSKAN hasil per-item aktualnya (Temuan #1) — bukan sekadar
 * "dispatch selesai". syncStockToMarketplaces() tidak pernah melempar
 * untuk kegagalan per-toko (isolasi allSettled), jadi tanpa penerusan
 * hasil ini worker SELALU melihat sukses palsu.
 */
async function defaultPusher(job: {
  accountId: string;
  channelSku: string;
  newSellable: number;
}): Promise<SyncJobPushResult> {
  const results = await syncStockToMarketplaces(
    [{ accountId: job.accountId, channelSku: job.channelSku }],
    job.newSellable
  );
  const r = results[0];
  return { success: r.success, error: r.error };
}

/**
 * runPushAttempt — SATU-SATUNYA implementasi satu kali percobaan push.
 *
 * Dipakai bersama oleh:
 * - processDueSyncJobs() (retry otomatis, loop) — PHASE A, perilaku unchanged.
 * - retrySingleSyncJob() (retry manual 1 job dari UI) — PHASE B.2.
 *
 * Aturan transisi identik: hasil aktual pusher success:false/throw →
 * retryCount+1 → PENDING+backoff, atau FAILED permanen bila habis.
 * SUCCESS → status SUCCESS + lastError null. Central stock tidak disentuh.
 */
async function runPushAttempt(
  job: {
    id: string;
    variantId: string;
    accountId: string;
    channelSku: string;
    newSellable: number;
    retryCount: number;
  },
  pusher: SyncJobPusher,
  now: Date
): Promise<{ outcome: "succeeded" | "pendingRetry" | "failed" }> {
  const identity: JobIdentity = {
    id: job.id,
    variantId: job.variantId,
    accountId: job.accountId,
    channelSku: job.channelSku,
  };

  // Push DIEKSEKUSI TERPISAH dari pencatatan status: error unique-constraint
  // saat menulis status tidak boleh lagi tercatat sebagai "kegagalan push"
  // (dulu: catch membaca error P2002 sbg push gagal → retryCount naik palsu +
  // baris terminal selalu bentrok → tick crash berulang tiap ~5 menit).
  let pushError: string | null = null;
  try {
    const out = await pusher(job);
    if (out && out.success === false) {
      pushError = out.error ?? "push stok ke channel gagal";
    }
  } catch (err) {
    pushError = err instanceof Error ? err.message : String(err);
  }

  if (pushError === null) {
    await applyStatusTransition(identity, {
      status: SYNC_JOB_STATUSES.SUCCESS,
      lastError: null,
    });
    return { outcome: "succeeded" };
  }

  const retryCount = job.retryCount + 1;
  if (retryCount >= SYNC_JOB_MAX_RETRIES) {
    // Retry habis → FAILED permanen (mismatch marker, JANGAN dihapus).
    // Central stock tetap benar; yang retry/mismatch adalah job ini.
    await applyStatusTransition(identity, {
      status: SYNC_JOB_STATUSES.FAILED,
      retryCount,
      lastError: pushError,
    });
    return { outcome: "failed" };
  }
  await applyStatusTransition(identity, {
    status: SYNC_JOB_STATUSES.PENDING,
    retryCount,
    lastError: pushError,
    nextRetryAt: new Date(now.getTime() + syncJobBackoffMs(retryCount)),
  });
  return { outcome: "pendingRetry" };
}
/**
 * settleDispatchedSyncJobs — tandai job yang push-nya SUDAH dieksekusi langsung
 * oleh jalur cepat (pushVariantStockToOthers → syncStockToMarketplaces) sebagai
 * SUCCESS, supaya tick auto-retry tidak MENDORONG ULANG nilai yang sama.
 *
 * Guard `newSellable = nilai yang didorong`: coalesce enqueue boleh saja sudah
 * menaikkan baris ke nilai lebih baru (dorongan terpisah yang akan settle
 * sendiri) — nilai lama tidak boleh menandai baris itu SUCCESS.
 *
 * Hasil gagal TIDAK disettle di sini: baris tetap PENDING (retryCount 0) dan
 * menjadi tanggung jawab processDueSyncJobs() → backoff 1m/5m/15m.
 */
export async function settleDispatchedSyncJobs(
  variantId: string,
  dispatchedSellable: number,
  results: Pick<SyncPushItemResult, "accountId" | "channelSku" | "success">[]
): Promise<void> {
  const succeeded = results.filter((r) => r.success);
  if (succeeded.length === 0) return;
  const triples = succeeded.map((r) => ({ accountId: r.accountId, channelSku: r.channelSku }));
  // Buang baris SUCCESS lama utk triple tsb (sisa siklus sebelumnya) supaya
  // transisi ini tidak melanggar unique constraint — riwayat tetap di SyncLog.
  await prisma.syncJob.deleteMany({
    where: { variantId, status: SYNC_JOB_STATUSES.SUCCESS, OR: triples },
  });
  await prisma.syncJob.updateMany({
    where: {
      variantId,
      newSellable: dispatchedSellable,
      status: SYNC_JOB_STATUSES.PENDING,
      OR: triples,
    },
    data: { status: SYNC_JOB_STATUSES.SUCCESS, lastError: null, nextRetryAt: null },
  });
}

/**
 * SYNC_JOB_STALE_PROCESSING_MS — batas PROCESSING dianggap putus di tengah
 * jalan (process crash / pm2 restart / OOM): klaim menulis status tapi
 * prosesnya mati sebelum hasil push terakhir tercatat, sehingga baris tidak
 * pernah dipilih ulang (findMany hanya PENDING/FAILED) dan tidak bisa di-retry
 * dari UI (retrySingleSyncJob → CONFLICT). Di-sweep jadi PENDING lagi tiap tick.
 */
export const SYNC_JOB_STALE_PROCESSING_MS = 5 * 60_000;

async function requeueStaleProcessingJobs(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - SYNC_JOB_STALE_PROCESSING_MS);
  const msg = "Proses terputus saat push berjalan (restart/crash) — diantre ulang.";
  const stale = await prisma.syncJob.findMany({
    where: { status: SYNC_JOB_STATUSES.PROCESSING, updatedAt: { lt: cutoff } },
    select: { id: true, variantId: true, accountId: true, channelSku: true, retryCount: true },
  });
  let count = 0;
  for (const job of stale) {
    try {
      const exhausted = job.retryCount >= SYNC_JOB_MAX_RETRIES;
      // Retry habis → penanda mismatch permanen, tetap bisa di-retry manual.
      // applyStatusTransition menangani bentrok unique + kasus baris sudah
      // digantikan PENDING baru (nilai terbaru menang → baris lama dibuang).
      await applyStatusTransition(
        job,
        exhausted
          ? { status: SYNC_JOB_STATUSES.FAILED, lastError: msg }
          : { status: SYNC_JOB_STATUSES.PENDING, nextRetryAt: null, lastError: msg }
      );
      count += 1;
    } catch (err) {
      console.error("[SyncJob] sweep PROCESSING gagal:", err instanceof Error ? err.message : err);
    }
  }
  return count;
}

/**
 * processDueSyncJobs — proses job PENDING/FAILED yang jatuh tempo
 * (nextRetryAt null = baru, atau <= now) dan retryCount < max.
 * Claim via updateMany bersyarat → dua worker bersamaan tidak memproses
 * job yang sama dua kali.
 */
export async function processDueSyncJobs(opts?: {
  pusher?: SyncJobPusher;
  now?: Date;
  limit?: number;
  /** Bila diisi, hanya job milik akun brand ini yang diproses (worker global: kosong = semua brand). */
  businessId?: string;
}): Promise<{
  processed: number;
  succeeded: number;
  pendingRetry: number;
  failed: number;
  requeued: number;
}> {
  const now = opts?.now ?? new Date();
  const pusher = opts?.pusher ?? defaultPusher;
  const result = { processed: 0, succeeded: 0, pendingRetry: 0, failed: 0, requeued: 0 };

  // Sweep dulu: PROCESSING yatim (proses mati di tengah push) → bisa dipilih
  // lagi di tick yang sama, jadi tidak pernah tersangkut selamanya.
  result.requeued = await requeueStaleProcessingJobs(now);

  const due = await prisma.syncJob.findMany({
    where: {
      status: { in: [SYNC_JOB_STATUSES.PENDING, SYNC_JOB_STATUSES.FAILED] },
      retryCount: { lt: SYNC_JOB_MAX_RETRIES },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      ...(opts?.businessId ? businessWhere.syncJob(opts.businessId) : {}),
    },
    orderBy: { createdAt: "asc" },
    take: opts?.limit ?? 50,
  });

  for (const job of due) {
    // Isolasi per-job: satu job gagal (P2002/dll) TIDAK boleh mematikan
    // seluruh tick — job lain di daftar yang sama tetap harus diproses.
    try {
      let claimed: { count: number };
      try {
        claimed = await prisma.syncJob.updateMany({
          where: { id: job.id, status: job.status },
          data: { status: SYNC_JOB_STATUSES.PROCESSING },
        });
      } catch (err) {
        // P2002: triple masih punya baris PROCESSING in-flight (enqueue membuat
        // PENDING baru selama push lama berjalan) — bukan error, biarkan tick
        // berikutnya setelah baris lama settle.
        if (isDeduplicationFailure(err)) continue;
        throw err;
      }
      if (claimed.count === 0) continue; // direbut worker lain / baris hilang
      result.processed += 1;

      // Satu-satunya jalur percobaan (shared dengan retry manual PHASE B.2).
      const { outcome } = await runPushAttempt(job, pusher, now);
      if (outcome === "succeeded") result.succeeded += 1;
      else if (outcome === "pendingRetry") result.pendingRetry += 1;
      else result.failed += 1;
    } catch (err) {
      console.error(
        `[SyncRetry] job ${job.id} gagal diproses (tick tetap lanjut):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return result;
}

/** Error retry manual: dibedakan agar endpoint memetakan ke status HTTP. */
export class SyncJobRetryError extends Error {
  readonly code: "NOT_FOUND" | "NOT_ELIGIBLE" | "CONFLICT";
  constructor(code: "NOT_FOUND" | "NOT_ELIGIBLE" | "CONFLICT", message: string) {
    super(message);
    this.name = "SyncJobRetryError";
    this.code = code;
  }
}

/**
 * retrySingleSyncJob — retry manual 1 job dari UI (PHASE B.2).
 *
 * Memakai runPushAttempt yang SAMA dengan retry otomatis: tidak ada logika
 * retry kedua/duplikat. Yang beda hanya gerbang eligibility (niat eksplisit
 * operator, bukan jadwal backoff):
 * - Hanya job FAILED / PENDING yang bisa di-retry sekarang (SUCCESS tidak
 *   perlu; PROCESSING = sedang diproses worker lain).
 * - nextRetryAt & batas retryCount<max worker DIABAIKAN untuk percobaan ini:
 *   FAILED permanen (retryCount=max) justru kasus utama tombol ini — gagal
 *   lagi → kembali FAILED dengan retryCount+1; sukses → SUCCESS.
 * - Guard spam-klik: claim atomik (updateMany bersyarat); klik bersamaan
 *   kedua dst. melempar CONFLICT, bukan percobaan ganda.
 * - Central stock TIDAK PERNAH di-rollback/diubah di sini.
 */
export async function retrySingleSyncJob(
  jobId: string,
  opts?: { pusher?: SyncJobPusher; now?: Date; businessId?: string }
): Promise<{ id: string; status: string; retryCount: number; lastError: string | null }> {
  const now = opts?.now ?? new Date();
  const pusher = opts?.pusher ?? defaultPusher;

  const job = await prisma.syncJob.findUnique({
    where: { id: jobId },
    include: { account: { select: { businessId: true } } },
  });
  if (!job) {
    throw new SyncJobRetryError("NOT_FOUND", "SyncJob tidak ditemukan.");
  }
  // Verifikasi brand akun: job milik brand lain → 404 yang sama (anti tebak ID).
  if (opts?.businessId && job.account.businessId !== opts.businessId) {
    throw new SyncJobRetryError("NOT_FOUND", "SyncJob tidak ditemukan.");
  }
  if (job.status === SYNC_JOB_STATUSES.SUCCESS) {
    throw new SyncJobRetryError("NOT_ELIGIBLE", "Job sudah SUCCESS — tidak perlu retry.");
  }
  if (job.status === SYNC_JOB_STATUSES.PROCESSING) {
    throw new SyncJobRetryError("CONFLICT", "Job sedang diproses — coba lagi sesaat.");
  }
  if (job.status !== SYNC_JOB_STATUSES.FAILED && job.status !== SYNC_JOB_STATUSES.PENDING) {
    throw new SyncJobRetryError("NOT_ELIGIBLE", `Status ${job.status} tidak bisa di-retry.`);
  }

  let claimed: { count: number };
  try {
    claimed = await prisma.syncJob.updateMany({
      where: { id: job.id, status: { in: [SYNC_JOB_STATUSES.FAILED, SYNC_JOB_STATUSES.PENDING] } },
      data: { status: SYNC_JOB_STATUSES.PROCESSING },
    });
  } catch (err) {
    // P2002: triple ini masih punya baris PROCESSING lain (in-flight) →
    // bentrok unique, bukan keadaan yang bisa di-retry sekarang.
    if (isDeduplicationFailure(err)) {
      throw new SyncJobRetryError("CONFLICT", "Job sedang diproses — coba lagi sesaat.");
    }
    throw err;
  }
  if (claimed.count === 0) {
    throw new SyncJobRetryError("CONFLICT", "Job sedang diproses — coba lagi sesaat.");
  }

  await runPushAttempt(job, pusher, now);

  const fresh = await prisma.syncJob.findUnique({ where: { id: job.id } });
  if (!fresh) {
    // applyStatusTransition membuang baris ini karena PENDING baru (nilai
    // terbaru) sudah menggantikannya — bukan hilang begitu saja.
    throw new SyncJobRetryError(
      "CONFLICT",
      "Job sudah digantikan antrean dengan nilai lebih baru — muat ulang daftar."
    );
  }
  return { id: fresh.id, status: fresh.status, retryCount: fresh.retryCount, lastError: fresh.lastError };
}
