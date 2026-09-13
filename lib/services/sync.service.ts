import { prisma } from "@/lib/db/prisma";
import { updatePrice } from "@/lib/integrations/tiktokShop";
import { scheduleStockPush } from "@/lib/services/stock-push-queue.service";
import { pushPriceToShopee, pushStockToShopee } from "@/lib/services/marketplace-shopee.service";
import { logStockPush } from "@/lib/services/sync-log.util";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";

/** Platform → kolom gate di InventorySetting (Pengaturan Inventori). */
const PLATFORM_SYNC_GATE = {
  TOKOPEDIA: "syncPushTokopedia",
  SHOPEE: "syncPushShopee",
  TIKTOK_SHOP: "syncPushTiktok",
} as const;

type Mapping = { accountId: string; channelSku: string };

/**
 * SyncPushItemResult — hasil per-(accountId, channelSku) dari satu dispatch.
 *
 * PHASE A fix-up (Temuan #1): syncStockToMarketplaces() WAJIB me-surface
 * hasil per-toko ke pemanggil (bukan menelannya di dalam allSettled),
 * supaya worker SyncJob bisa menentukan SUCCESS/FAILED dari hasil AKTUAL
 * channel, bukan dari "dispatch tidak melempar".
 *
 * - success=true  = stok diterima/dijadwalkan (TikTok: masuk antrean
 *   debounce; gate-off: push memang dimatikan user → tidak ada aksi lanjutan).
 * - success=false = stok TIDAK terkirim & TIDAK terjadwal (token/cipher
 *   kosong, platform belum punya integrasi, akun hilang, atau error tak
 *   terduga) — pemanggil (worker SyncJob) wajib me-retry lalu menandai
 *   FAILED sebagai mismatch marker.
 * - skipped=true  = jalur skip tercatat di SyncLog (tidak pernah silent);
 *   gate-off → success=true (disengaja user), skip lainnya → success=false.
 */
export type SyncPushItemResult = {
  accountId: string;
  channelSku: string;
  success: boolean;
  skipped: boolean;
  error?: string;
};

/**
 * syncStockToMarketplaces(mappings, newStock)
 *
 * Jalankan update stok ke semua akun marketplace yang relevan.
 * Dirancang untuk dipanggil secara fire-and-forget (non-blocking).
 * Error per-akun di-log tapi tidak menyebabkan keseluruhan gagal.
 *
 * ISOLASI (Wajib dipertahankan — PHASE A fix-up Temuan #1): paralel via
 * Promise.allSettled — 1 toko gagal TIDAK membatalkan toko lain. Yang berubah
 * hanya: hasil per-toko di-surface sebagai array return (1 hasil per input,
 * urutan sama), bukan didiamkan.
 *
 * TUGAS 3 (anti rate-limit): untuk TIKTOK_SHOP, push TIDAK langsung memanggil
 * API — dimasukkan ke antrean debounce per akun (stock-push-queue.service):
 * perubahan beruntun pada SKU yang sama digabung (nilai terakhir yang
 * dikirim), lalu dikirim sebagai batch (1 search + 1 update per produk).
 * Setiap penundaan tercatat di SyncLog ("deferred") — tidak pernah silent.
 */
export async function syncStockToMarketplaces(
  mappings: Mapping[],
  newStock: number
): Promise<SyncPushItemResult[]> {
  const settled = await Promise.allSettled(
    mappings.map(async (mapping): Promise<SyncPushItemResult> => {
      const done = (success: boolean, skipped: boolean, error?: string): SyncPushItemResult => ({
        accountId: mapping.accountId,
        channelSku: mapping.channelSku,
        success,
        skipped,
        ...(error ? { error } : {}),
      });

      const account = await prisma.platformAccount.findUnique({
        where: { id: mapping.accountId },
      });

      if (!account) {
        await logStockPush(mapping.accountId, mapping.channelSku, newStock, "skipped",
          `Akun ${mapping.accountId} tidak ditemukan — push stok dibatalkan.`);
        return done(false, true, `Akun ${mapping.accountId} tidak ditemukan.`);
      }

      // Gate Pengaturan Inventori: auto-push utk platform ini dimatikan →
      // skip dgn jejak SyncLog (tidak pernah silent). Ini konfigurasi
      // DISENGAJA user → success=true (tidak ada aksi retry yang berguna).
      const gateKey = PLATFORM_SYNC_GATE[account.platform as keyof typeof PLATFORM_SYNC_GATE];
      if (gateKey) {
        const settings = await getCachedInventorySettings();
        if (!settings[gateKey]) {
          await logStockPush(account.id, mapping.channelSku, newStock, "skipped",
            `Auto-push stok ke ${account.platform} dimatikan di Pengaturan Inventori.`);
          return done(true, true);
        }
      }

      // Saat ini hanya TikTok Shop yang punya integrasi API.
      // Shopee / Tokopedia akan ditambahkan di sini saat SDK-nya siap.
      if (account.platform === "TIKTOK_SHOP") {
        if (!account.accessToken) {
          await logStockPush(account.id, mapping.channelSku, newStock, "skipped",
            `"${account.label}" belum punya access token di database.`);
          return done(false, true, `"${account.label}" belum punya access token — push stok dibatalkan.`);
        }
        if (!account.shopCipher) {
          await logStockPush(account.id, mapping.channelSku, newStock, "skipped",
            `"${account.label}" belum punya shop_cipher — skip sync.`);
          return done(false, true, `"${account.label}" belum punya shop_cipher — push stok dibatalkan.`);
        }

        // Masuk antrean debounce — coalesce + batch + backoff terjadi di queue.
        // "Diterima antrean" = success (pengiriman downstream + retry-nya
        // dimiliki queue & tercatat di SyncLog).
        scheduleStockPush(account.id, mapping.channelSku, newStock);
        return done(true, false);
      } else if (account.platform === "SHOPEE") {
        // Adapter Shopee (PHASE B.4, stub): kontrak hasil per-item SAMA dengan
        // TikTok — success:false eksplisit + jejak SyncLog, TANPA throw.
        // Worker SyncJob membaca hasil ini → retry/FAILED seperti biasa.
        const r = await pushStockToShopee({
          accountId: account.id,
          accountLabel: account.label,
          channelSku: mapping.channelSku,
          newStock,
        });
        return done(r.success, r.skipped, r.error);
      } else {
        await logStockPush(account.id, mapping.channelSku, newStock, "skipped",
          `Platform ${account.platform} belum punya integrasi push stok.`);
        return done(false, true, `Platform ${account.platform} belum punya integrasi push stok.`);
      }
    })
  );

  // allSettled → fulfilled = hasil per-toko di atas; rejected = error tak
  // terduga di dalam satu item → success:false (isolasi: item lain tetap utuh).
  return settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
    return {
      accountId: mappings[i].accountId,
      channelSku: mappings[i].channelSku,
      success: false,
      skipped: false,
      error: msg,
    };
  });
}

/**
 * logPricePush — catat hasil push harga ke SyncLog (direction "out",
 * kind "price_push") untuk traceability & retry.
 */
async function logPricePush(
  accountId: string,
  channelSku: string,
  price: number,
  status: string,
  message: string,
  errorMessage?: string
) {
  try {
    await prisma.syncLog.create({
      data: {
        direction: "out",
        kind: "price_push",
        status,
        message,
        errorMessage,
        payload: JSON.stringify({ channelSku, price }),
        accountId,
      },
    });
  } catch (e) {
    console.warn("[Sync] gagal menulis SyncLog (price):", e instanceof Error ? e.message : e);
  }
}

/**
 * syncPriceToMarketplaces(mappings, price)
 *
 * Push harga tayang ke semua akun marketplace yang relevan. Fire-and-forget:
 * error per-akun di-log di SyncLog ("price_push") tapi tidak menggagalkan
 * update harga di DB. (Harga jarang berubah beruntun — tidak didebounce;
 * jika nanti perlu, pola queue yang sama bisa dipakai.)
 */
export async function syncPriceToMarketplaces(
  mappings: Mapping[],
  price: number
): Promise<void> {
  const results = await Promise.allSettled(
    mappings.map(async (mapping) => {
      const account = await prisma.platformAccount.findUnique({
        where: { id: mapping.accountId },
      });

      if (!account) return;

      if (account.platform === "TIKTOK_SHOP") {
        if (!account.accessToken) {
          await logPricePush(account.id, mapping.channelSku, price, "skipped",
            `"${account.label}" belum punya access token di database.`);
          return;
        }
        if (!account.shopCipher) {
          await logPricePush(account.id, mapping.channelSku, price, "skipped",
            `"${account.label}" belum punya shop_cipher — skip sync.`);
          return;
        }

        try {
          await updatePrice(
            account.accessToken,
            mapping.channelSku,
            price,
            account.shopCipher
          );
          await logPricePush(account.id, mapping.channelSku, price, "success",
            `Harga ${price} → SKU "${mapping.channelSku}" (${account.label}).`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await logPricePush(account.id, mapping.channelSku, price, "error",
            `SKU "${mapping.channelSku}" (${account.label}).`, msg);
          throw err; // biar tercatat sbg rejected di allSettled
        }
      } else if (account.platform === "SHOPEE") {
        // Adapter Shopee (PHASE B.4, stub): jejak eksplisit, tanpa throw —
        // paralel dengan stub stok di atas.
        await pushPriceToShopee({
          accountId: account.id,
          accountLabel: account.label,
          channelSku: mapping.channelSku,
          price,
        });
      } else {
        await logPricePush(account.id, mapping.channelSku, price, "skipped",
          `Platform ${account.platform} belum punya integrasi push harga.`);
      }
    })
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`[Sync] ${failed.length}/${results.length} push harga gagal.`);
    failed.forEach((r) => {
      if (r.status === "rejected") console.error("[Sync]", r.reason);
    });
  }
}
