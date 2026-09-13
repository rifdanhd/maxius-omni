import { prisma } from "@/lib/db/prisma";
import { logStockPush } from "@/lib/services/sync-log.util";
import type { SyncPushItemResult } from "@/lib/services/sync.service";

/**
 * PHASE B.4 — Adapter Shopee (STUB, paralel dengan jalur TikTok).
 *
 * Kontrak sama seperti push stok TikTok di sync.service.ts:
 * input  = { accountId, accountLabel, channelSku, newStock }
 * output = SyncPushItemResult { accountId, channelSku, success, skipped, error? }
 *
 * Stub ini SENGAJA eksplisit: selalu mengembalikan success:false dengan error
 * "Shopee adapter belum diimplementasikan" + jejak SyncLog (tidak pernah
 * silent skip, tidak pernah throw). Worker SyncJob PHASE A membaca hasil
 * per-item ini → retry backoff → FAILED sebagai mismatch marker, sama seperti
 * kegagalan channel lainnya. Central stock tidak tersentuh.
 *
 * Saat SDK/API key Shopee tersedia: isi body pushStockToShopee dengan
 * pemanggilan API nyata dan kembalikan { success:true } bila diterima —
 * TANPA mengubah struktur syncStockToMarketplaces() maupun SyncJob.
 */

export const SHOPEE_ADAPTER_ERROR = "Shopee adapter belum diimplementasikan";

export async function pushStockToShopee(params: {
  accountId: string;
  accountLabel: string;
  channelSku: string;
  newStock: number;
}): Promise<SyncPushItemResult> {
  const error =
    `${SHOPEE_ADAPTER_ERROR} — push stok ${params.newStock} → SKU "${params.channelSku}" ` +
    `(${params.accountLabel}) belum dikirim. Hubungkan integrasi Shopee lalu isi adapter ini.`;
  await logStockPush(params.accountId, params.channelSku, params.newStock, "skipped", error, error);
  return {
    accountId: params.accountId,
    channelSku: params.channelSku,
    success: false,
    skipped: true,
    error,
  };
}

/**
 * pushPriceToShopee — stub paralel untuk push harga (dipakai
 * syncPriceToMarketplaces). Sama eksplisitnya: jejak SyncLog + tanpa throw.
 */
export async function pushPriceToShopee(params: {
  accountId: string;
  accountLabel: string;
  channelSku: string;
  price: number;
}): Promise<void> {
  const message =
    `${SHOPEE_ADAPTER_ERROR} — push harga ${params.price} → SKU "${params.channelSku}" ` +
    `(${params.accountLabel}) belum dikirim.`;
  try {
    await prisma.syncLog.create({
      data: {
        direction: "out",
        kind: "price_push",
        status: "skipped",
        message,
        errorMessage: message,
        payload: JSON.stringify({ channelSku: params.channelSku, price: params.price }),
        accountId: params.accountId,
      },
    });
  } catch (e) {
    console.warn("[Shopee] gagal menulis SyncLog (price):", e instanceof Error ? e.message : e);
  }
}
