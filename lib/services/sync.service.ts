import { prisma } from "@/lib/db/prisma";
import { updateStock, updatePrice } from "@/lib/integrations/tiktokShop";

type Mapping = { accountId: string; channelSku: string };

/**
 * syncStockToMarketplaces(mappings, newStock)
 *
 * Jalankan update stok ke semua akun marketplace yang relevan.
 * Dirancang untuk dipanggil secara fire-and-forget (non-blocking).
 * Error per-akun di-log tapi tidak menyebabkan keseluruhan gagal.
 */
export async function syncStockToMarketplaces(
  mappings: Mapping[],
  newStock: number
): Promise<void> {
  const results = await Promise.allSettled(
    mappings.map(async (mapping) => {
      const account = await prisma.platformAccount.findUnique({
        where: { id: mapping.accountId },
      });

      if (!account) return;

      // Saat ini hanya TikTok Shop yang punya integrasi API.
      // Shopee / Tokopedia akan ditambahkan di sini saat SDK-nya siap.
      if (account.platform === "TIKTOK_SHOP") {
        if (!account.accessToken) {
          await logStockPush(account.id, mapping.channelSku, newStock, "skipped",
            `"${account.label}" belum punya access token di database.`);
          return;
        }
        if (!account.shopCipher) {
          await logStockPush(account.id, mapping.channelSku, newStock, "skipped",
            `"${account.label}" belum punya shop_cipher — skip sync.`);
          return;
        }

        try {
          await updateStock(
            account.accessToken,
            mapping.channelSku,
            newStock,
            account.shopCipher
          );
          await logStockPush(account.id, mapping.channelSku, newStock, "success",
            `Stok ${newStock} → SKU "${mapping.channelSku}" (${account.label}).`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await logStockPush(account.id, mapping.channelSku, newStock, "error",
            `SKU "${mapping.channelSku}" (${account.label}).`, msg);
          throw err; // biar tercatat sbg rejected di allSettled
        }
      } else {
        await logStockPush(account.id, mapping.channelSku, newStock, "skipped",
          `Platform ${account.platform} belum punya integrasi push stok.`);
      }
    })
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`[Sync] ${failed.length}/${results.length} sinkronisasi gagal.`);
    failed.forEach((r) => {
      if (r.status === "rejected") console.error("[Sync]", r.reason);
    });
  }
}

/**
 * logStockPush — catat hasil push stok ke SyncLog (direction "out") supaya
 * operasional bisa menelusuri & me-retry push yang gagal.
 */
async function logStockPush(
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
 * syncPriceToMarketplaces(mappings, price)
 *
 * Push harga tayang ke semua akun marketplace yang relevan (mirip
 * syncStockToMarketplaces). Fire-and-forget: error per-akun di-log di
 * SyncLog ("price_push") tapi tidak menggagalkan update harga di DB.
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
