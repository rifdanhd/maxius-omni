import { prisma } from "@/lib/db/prisma";
import { updatePrice } from "@/lib/integrations/tiktokShop";
import { scheduleStockPush, pushStockAndWait } from "@/lib/services/stock-push-queue.service";
import { pushPriceToShopee, pushStockToShopee } from "@/lib/services/marketplace-shopee.service";
import { logStockPush } from "@/lib/services/sync-log.util";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";
import { stockPushDisabledReason } from "@/lib/services/stock-push.policy";
import { allocationQuantity, resolveAllocation } from "@/lib/services/stock-allocation.policy";
import { safeStockPushMessage } from "@/lib/services/stock-push-error";

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
  outcome?: "success" | "failed" | "deferred" | "disabled" | "dry_run";
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
  mappings: Mapping[], newStock: number, options?: { dryRun?: boolean; waitForDelivery?: boolean }
): Promise<SyncPushItemResult[]> {
  const settled = await Promise.allSettled(mappings.map(async (mapping): Promise<SyncPushItemResult> => {
    const done = (success: boolean, skipped: boolean, outcome: SyncPushItemResult["outcome"], error?: string): SyncPushItemResult => ({ ...mapping, success, skipped, outcome, ...(error ? { error } : {}) });
    const fail = async (message: string) => {
      await logStockPush(mapping.accountId, mapping.channelSku, newStock, "error", message, message);
      return done(false, false, "failed", message);
    };
    if (!Number.isFinite(newStock) || newStock < 0) return fail("Stok yang dikirim harus angka minimal nol.");
    const account = await prisma.platformAccount.findUnique({ where: { id: mapping.accountId } });
    if (!account) return done(false, true, "failed", "Akun marketplace tidak ditemukan.");
    const listing = await prisma.productMapping.findUnique({
      where: { accountId_channelSku: mapping }, include: { variant: { select: { masterProduct: { select: { businessId: true } } } } },
    });
    if (!listing?.variant) return fail("Mapping SKU master tidak tersedia; tinjau Mapping Stok.");
    if (listing.variant.masterProduct.businessId !== account.businessId) return fail("Mapping toko dan SKU berbeda customer.");
    if (account.platform === "SHOPEE") {
      const ids = mapping.channelSku.match(/^(\d+):(\d+)$/);
      if (ids && ((listing.platformProductId && listing.platformProductId !== ids[1]) || (listing.platformSkuId && listing.platformSkuId !== ids[2]))) return fail("SKU_MISMATCH: item/model Shopee bertentangan dengan metadata mapping; tinjau listing sebelum push.");
    }
    const settings = await getCachedInventorySettings(account.businessId);
    const disabled = stockPushDisabledReason(account, settings);
    const policy = resolveAllocation(listing, account);
    const count = policy.mode === "EQUAL" ? await prisma.productMapping.count({ where: { variantId: listing.variantId, account: { businessId: account.businessId } } }) : 1;
    const quantity = allocationQuantity(newStock, policy, count);
    if (disabled) {
      await logStockPush(account.id, mapping.channelSku, quantity, "skipped_disabled", disabled);
      return done(true, true, "disabled", disabled);
    }
    if (options?.dryRun) {
      await logStockPush(account.id, mapping.channelSku, quantity, "dry_run", `Pratinjau ${account.platform}: ${quantity} unit; tidak dikirim ke marketplace.`);
      return done(true, false, "dry_run");
    }
    if (account.platform === "TIKTOK_SHOP") {
      if (!account.accessToken || !account.shopCipher) {
        const error = !account.accessToken ? "Toko belum punya access token TikTok; hubungkan ulang toko." : "Toko belum punya shop_cipher TikTok; hubungkan ulang toko.";
        await logStockPush(account.id, mapping.channelSku, quantity, "skipped", error, error);
        return done(false, true, "failed", error);
      }
      if (options?.waitForDelivery) return { ...mapping, ...await pushStockAndWait(account.id, mapping.channelSku, quantity) };
      scheduleStockPush(account.id, mapping.channelSku, quantity, true);
      return done(true, false, "deferred");
    }
    if (account.platform === "SHOPEE") {
      const result = await pushStockToShopee({ accountId: account.id, accountLabel: account.label, channelSku: mapping.channelSku, newStock: quantity });
      return { ...result, outcome: result.outcome ?? (result.success ? "success" : "failed") };
    }
    return fail(`Platform ${account.platform} belum mendukung push stok.`);
  }));
  return Promise.all(settled.map(async (result, index): Promise<SyncPushItemResult> => {
    if (result.status === "fulfilled") return result.value;
    const error = safeStockPushMessage(result.reason);
    await logStockPush(mappings[index].accountId, mappings[index].channelSku, newStock, "error", "Push stok gagal sebelum diterima marketplace.", error);
    return { ...mappings[index], success: false, skipped: false, outcome: "failed", error };
  }));
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
