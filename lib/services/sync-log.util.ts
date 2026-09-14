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

/**
 * logOrphanSku — penanda PASIF (kind "orphan_sku", status "warning") bahwa
 * order masuk memuat channel SKU yang belum ter-mapping ke varian stok pusat.
 *
 * Sistem CUMA menandai — keputusan mapping tetap manual via panel
 * "SKU Order Belum Ter-mapping" di halaman Mapping (tanpa auto-create).
 * Idempotent: tidak menulis marker baru bila masih ada marker unhandled
 * untuk (akun, SKU) yang sama — supaya sync berkala tidak menumpuk baris.
 * Tidak pernah melempar: penandaan tidak boleh menggagalkan ingest order.
 */
export async function logOrphanSku(accountId: string, channelSku: string, qty: number) {
  try {
    const existing = await prisma.syncLog.findFirst({
      where: {
        accountId,
        kind: "orphan_sku",
        handledAt: null,
        payload: { contains: `"${channelSku}"` },
      },
      select: { id: true },
    });
    if (existing) return;
    await prisma.syncLog.create({
      data: {
        direction: "in",
        kind: "orphan_sku",
        status: "warning",
        message: `Order memuat SKU "${channelSku}" yang belum ter-mapping (${qty} pcs). Buka halaman Mapping untuk menindaklanjuti.`,
        payload: JSON.stringify({ channelSku, qty }),
        accountId,
      },
    });
  } catch (e) {
    console.warn("[Sync] gagal menulis marker orphan_sku:", e instanceof Error ? e.message : e);
  }
}
