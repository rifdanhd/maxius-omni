import { prisma } from "@/lib/db/prisma";
import { updateStockBatch, type StockBatchItem } from "@/lib/integrations/tiktokShop";
import { logStockPush } from "@/lib/services/sync-log.util";
import { backoffDelayMs, isTransientPlatformError, MAX_TRANSIENT_RETRIES } from "@/lib/services/rate-limit.policy";

/**
 * Antrean push stok dengan DEBOUNCE + BATCHING (TUGAS 3 — anti rate-limit).
 *
 * Masalah yang dipecahkan: setiap perubahan stok langsung memicu 1 API call
 * (padahal updateStock lama = getProduct 1–3 call + 1 call update per SKU).
 * Di volume tinggi (puluhan ribu SKU, order masuk beruntun) ini gampang kena
 * rate limit dan sync gagal/telat.
 *
 * Desain (per akun marketplace):
 *   1. Perubahan stok TIDAK langsung dikirim — dikumpulkan dalam window
 *      debounce pendek (DEBOUNCE_WINDOW_MS). Beberapa perubahan beruntun pada
 *      varian yang sama → cukup NILAI TERAKHIR yang dikirim (coalesce).
 *   2. Saat window berakhir, semua SKU tertunda dikirim SEBAGAI BATCH:
 *      1 call search utk banyak SKU + 1 call update per produk
 *      (updateStockBatch) — jauh lebih sedikit call daripada per-SKU.
 *   3. Error sementara (429/5xx/network) di-retry dengan exponential backoff
 *      + jitter (rate-limit.policy). Error validasi/permanen GAGAL JELAS —
 *      tidak di-retry (retry payload invalid selalu invalid).
 *   4. Setiap penundaan, keberhasilan, retry, dan kegagalan dicatat ke SyncLog
 *      (status: deferred/success/error/skipped) — keterlambatan sync tidak
 *      pernah silent.
 *
 * Konsumen: central-stock.service (pushVariantStockToOthers). Hook ini
 * fire-and-forget: memanggilnya tidak pernah melempar.
 */

/** Window debounce: perubahan dalam jendela ini digabung jadi satu batch. */
export const DEBOUNCE_WINDOW_MS = 8_000;
/** Batas SKU per batch flush (1 search + beberapa update call). */
const BATCH_CHUNK = 50;

type QueueEntry = { channelSku: string; quantity: number };

type AccountQueue = {
  /** Nilai TERAKHIR per channelSku — coalesce perubahan beruntun. */
  pending: Map<string, QueueEntry>;
  /** Percobaan backoff per channelSku (bertahan antar flush bila gagal sementara). */
  attempts: Map<string, number>;
  timer: ReturnType<typeof setTimeout> | null;
  /** true bila flush sedang berjalan (pending tetap bisa diisi). */
  flushing: boolean;
};

const queues = new Map<string, AccountQueue>();

function getQueue(accountId: string): AccountQueue {
  let q = queues.get(accountId);
  if (!q) {
    q = { pending: new Map(), attempts: new Map(), timer: null, flushing: false };
    queues.set(accountId, q);
  }
  return q;
}

/**
 * scheduleStockPush — masukkan perubahan stok ke antrean akun (coalesce per
 * SKU, kirim nilai terakhir). Memanggil ini TIDAK langsung memanggil API.
 */
export function scheduleStockPush(accountId: string, channelSku: string, quantity: number): void {
  const q = getQueue(accountId);
  q.pending.set(channelSku, { channelSku, quantity });

  // Catatan: cek pakai `=== null` (bukan truthiness) — id timer bisa falsy.
  if (q.timer === null && !q.flushing) {
    // Log "deferred" SEKALI per window (saat timer pertama dipasang) —
    // perubahan beruntun berikutnya hanya coalesce, tanpa spam log.
    void logStockPush(
      accountId,
      channelSku,
      quantity,
      "deferred",
      `Push stok SKU "${channelSku}" ditunda & digabung (debounce ${DEBOUNCE_WINDOW_MS / 1000}s, anti rate-limit).`
    );
    q.timer = setTimeout(() => {
      q.timer = null;
      void flushAccount(accountId);
    }, DEBOUNCE_WINDOW_MS);
    // Jangan menahan proses hidup hanya karena ada push tertunda (CLI/test
    // bisa exit). Di server Next.js event loop tetap hidup — timer tetap jalan.
    q.timer.unref?.();
  }
}

/**
 * flushAccount — kirim semua nilai tertunda satu akun sebagai batch
 * (di-chunk), dengan retry backoff utk error sementara.
 * Selama flush, perubahan baru masuk `pending` dan diflush di ronde berikutnya.
 */
async function flushAccount(accountId: string): Promise<void> {
  const q = getQueue(accountId);
  if (q.flushing) return; // ronde lain sedang jalan; pending tersentuh nanti
  q.flushing = true;

  try {
    do {
      // Ambil snapshot pending (map baru) & kosongkan antrean aktif.
      const snapshot = new Map(q.pending);
      q.pending.clear();
      if (snapshot.size === 0) break;

      const items = [...snapshot.values()];
      const chunks: StockBatchItem[][] = [];
      for (let i = 0; i < items.length; i += BATCH_CHUNK) chunks.push(items.slice(i, i + BATCH_CHUNK));

      for (const chunk of chunks) {
        await flushChunkWithRetry(accountId, chunk, q);
      }
    } while (q.pending.size > 0);
  } catch (err) {
    // flushChunkWithRetry sudah menangkap per-item; ini safety net —
    // antrean tidak boleh membuat proses induk crash.
    console.error("[StockPushQueue] flush error tak terduga:", err instanceof Error ? err.message : err);
  } finally {
    q.flushing = false;
    if (q.pending.size > 0 && q.timer === null) {
      q.timer = setTimeout(() => {
        q.timer = null;
        void flushAccount(accountId);
      }, DEBOUNCE_WINDOW_MS);
      q.timer.unref?.();
    }
  }
}

/** Kirim satu chunk + kelola retry per item. */
async function flushChunkWithRetry(accountId: string, chunk: StockBatchItem[], q: AccountQueue): Promise<void> {
  const account = await prisma.platformAccount.findUnique({
    where: { id: accountId },
    select: { accessToken: true, shopCipher: true },
  });
  if (!account?.accessToken) {
    for (const it of chunk) {
      await logStockPush(accountId, it.channelSku, it.quantity, "skipped", "Akun belum punya access token — push stok dibatalkan.");
    }
    return;
  }

  let result;
  try {
    result = await updateStockBatch(account.accessToken, chunk, account.shopCipher ?? undefined);
  } catch (err) {
    // Kegagalan level batch (mis. auth error di search) → tangani per item.
    for (const it of chunk) {
      await handleItemError(accountId, it, err, q);
    }
    return;
  }

  for (const it of result.ok) {
    q.attempts.delete(it.channelSku);
    await logStockPush(
      accountId,
      it.channelSku,
      it.quantity,
      "success",
      `Stok ${it.quantity} → SKU "${it.channelSku}" (batch ${result.ok.length}+${result.failed.length}).`
    );
  }
  for (const f of result.failed) {
    await handleItemError(accountId, f.item, f.error, q);
  }
}

/** Klasifikasikan error item: retry backoff (sementara) atau gagal jelas (permanen). */
async function handleItemError(accountId: string, item: StockBatchItem, err: unknown, q: AccountQueue): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);

  if (isTransientPlatformError(err)) {
    const attempt = (q.attempts.get(item.channelSku) ?? 0) + 1;
    if (attempt <= MAX_TRANSIENT_RETRIES) {
      q.attempts.set(item.channelSku, attempt);
      const delay = backoffDelayMs(attempt - 1);
      await logStockPush(
        accountId,
        item.channelSku,
        item.quantity,
        "error",
        `Rate limit/error sementara saat push stok SKU "${item.channelSku}" — retry ke-${attempt}/${MAX_TRANSIENT_RETRIES} dalam ${(delay / 1000).toFixed(1)}s.`,
        msg
      );
      setTimeout(() => {
        void (async () => {
          const qq = getQueue(accountId);
          // Kembalikan item ke pending (nilai terakhir menang jika ada update baru).
          const current = qq.pending.get(item.channelSku);
          if (!current) qq.pending.set(item.channelSku, item);
          if (qq.timer === null && !qq.flushing) {
            qq.timer = setTimeout(() => {
              qq.timer = null;
              void flushAccount(accountId);
            }, DEBOUNCE_WINDOW_MS);
            qq.timer.unref?.();
          }
        })();
      }, delay);
      return;
    }
    q.attempts.delete(item.channelSku);
    await logStockPush(
      accountId,
      item.channelSku,
      item.quantity,
      "error",
      `Push stok SKU "${item.channelSku}" GAGAL permanen setelah ${MAX_TRANSIENT_RETRIES} retry backoff — perlu tinjauan manual.`,
      msg
    );
    return;
  }

  // Error validasi/permanen → gagal JELAS, tanpa retry.
  q.attempts.delete(item.channelSku);
  await logStockPush(
    accountId,
    item.channelSku,
    item.quantity,
    "error",
    `Push stok SKU "${item.channelSku}" ditolak (error permanen/validasi) — TIDAK di-retry otomatis.`,
    msg
  );
}

/** Hanya untuk test — bersihkan state singleton antar kasus. */
export function _resetStockPushQueueForTests(): void {
  for (const q of queues.values()) {
    if (q.timer) clearTimeout(q.timer);
  }
  queues.clear();
}
