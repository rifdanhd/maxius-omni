import { prisma } from "@/lib/db/prisma";
import { updateStock } from "@/lib/integrations/tiktokShop";

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
          console.warn(
            `[Sync] ⚠️ "${account.label}" belum punya access token di database.`
          );
          return;
        }
        if (!account.shopCipher) {
          console.warn(
            `[Sync] ⚠️ "${account.label}" belum punya shop_cipher — skip sync.`
          );
          return;
        }

        await updateStock(
          account.accessToken,
          mapping.channelSku,
          newStock,
          account.shopCipher
        );
        console.log(
          `[Sync] ✅ Stok → ${newStock} untuk SKU "${mapping.channelSku}" di "${account.label}"`
        );
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
