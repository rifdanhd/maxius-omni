import { prisma } from "@/lib/db/prisma";

/**
 * logStockPush — catat hasil (atau penjadwalan) push stok ke SyncLog
 * (direction "out", kind "stock_push") supaya operasional bisa menelusuri
 * & me-retry push yang gagal. Dipakai bersama oleh sync.service (routing)
 * dan stock-push-queue.service (flush/backoff) — TUGAS 3.
 *
 * Status yang dipakai:
 *   - "deferred": push DITUNDA & digabung dalam window debounce (anti rate-limit)
 *   - "success" : push selesai
 *   - "error"   : gagal (termasuk rate-limit yang dijadwalkan retry backoff)
 *   - "skipped" : tidak dikirim (token/cipher kosong, platform belum didukung)
 */
export async function logStockPush(
  accountId: string,
  channelSku: string,
  newStock: number,
  status: string,
  message: string,
  errorMessage?: string
) {
  try {
    await prisma.syncLog.create({
      data: {
        direction: "out",
        kind: "stock_push",
        status,
        message,
        errorMessage,
        payload: JSON.stringify({ channelSku, newStock }),
        accountId,
      },
    });
  } catch (e) {
    // Logging tidak boleh merusak push itu sendiri.
    console.warn("[Sync] gagal menulis SyncLog:", e instanceof Error ? e.message : e);
  }
}
