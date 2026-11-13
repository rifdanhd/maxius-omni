/**
 * Auto-sync in-process — dipanggil ticker di instrumentation.ts.
 *
 * Kenapa in-process: VPS cuma 1.9GB RAM → crontab node script tambahan
 * ditolak (keputusan F2 M5c); pola yang sama dengan processDueSyncJobs.
 *
 * - Order (5 menit): ringan — TikTok/Shopee list order dengan paginasi cap
 *   50 halaman. Webhook tetap sumber utama update status real-time.
 * - Listing + gambar (30 menit): refresh mapping Shopee, backfill gambar (idempoten —
 *   hanya mengisi MasterProduct.imageUrl/ProductImage yang masih kosong),
 *   sync mapping TikTok.
 *
 * Anti tumpang-tindih: flag in-process per fungsi (auto-vs-auto). Auto-vs-
 * manual sama risikonya dengan klik manual dobel (sudah ada di hari ini);
 * order dilindungi withAccountPullLock per akun di dalam service-nya.
 *
 * Kill-switch: AUTO_SYNC_DISABLED=true; opt-in dev: AUTO_SYNC_DEV=true.
 */
import { prisma } from "@/lib/db/prisma";
import { enqueueOrderRuns } from "@/lib/services/order-run.service";
import { syncShopeeListings } from "@/lib/services/marketplace-shopee.service";
import { syncTikTokListings, importTikTokListings } from "@/lib/services/marketplace-tiktok.service";
import { ingestPromotionActivitiesForAccount } from "@/lib/services/promotion-activity.service";
import { ingestShopeePromotionsForAccount } from "@/lib/services/shopee-promotion.service";

export type OrdersAutoSummary = {
  queued: number;
  accounts: number;
  created: number;
  skipped: number;
  errors: number;
};

export type PromosAutoSummary = {
  accounts: number;
  activities: number;
  errors: number;
};

export type ListingsAutoSummary = {
  businesses: number;
  shopeeNew: number;
  shopeeMatched: number;
  tiktokNew: number;
  tiktokSynced: number;
  errors: number;
};

let ordersInFlight = false;
let listingsInFlight = false;
let promosInFlight = false;

export async function autoSyncOrdersOnce(): Promise<OrdersAutoSummary> {
  if (ordersInFlight) {
    return { accounts: 0, queued: 0, created: 0, skipped: 0, errors: 0 };
  }
  ordersInFlight = true;
  try {
    const accounts = await prisma.platformAccount.findMany({
      where: { platform: { in: ["TIKTOK_SHOP", "SHOPEE"] }, accessToken: { not: null }, isFrozen: false },
      select: { id: true, platform: true, lastPulledAt: true, businessId: true },
    });
    const out: OrdersAutoSummary = { accounts: accounts.length, queued: 0, created: 0, skipped: 0, errors: 0 };
    for (const acc of accounts) {
      try {
        const runs = await enqueueOrderRuns(acc.businessId, { accountId: acc.id });
        out.queued += runs.filter((run) => run.runId && !run.skipped).length;
        out.errors += runs.filter((run) => run.error).length;
        out.skipped += runs.filter((run) => run.skipped).length;
      } catch (e) {
        out.errors += 1;
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn(`[AutoSync] order akun ${acc.id} gagal:`, errMsg);
        // Tulis error ke SyncLog agar kegagalan (mis. token expired) terlihat di UI.
        await prisma.syncLog
          .create({
            data: {
              direction: "in",
              kind: "order_sync",
              status: "error",
              message: `auto-sync gagal: ${errMsg.slice(0, 500)}`,
              payload: JSON.stringify({ error: errMsg }),
              accountId: acc.id,
            },
          })
          .catch(() => {});
      }
    }
    return out;
  } finally {
    ordersInFlight = false;
  }
}

export async function autoSyncListingsOnce(): Promise<ListingsAutoSummary> {
  if (listingsInFlight) {
    return { businesses: 0, shopeeNew: 0, shopeeMatched: 0, tiktokNew: 0, tiktokSynced: 0, errors: 0 };
  }
  listingsInFlight = true;
  try {
    const businesses = await prisma.business.findMany({ select: { id: true } });
    const out: ListingsAutoSummary = {
      businesses: businesses.length,
      shopeeNew: 0,
      shopeeMatched: 0,
      tiktokNew: 0,
      tiktokSynced: 0,
      errors: 0,
    };
    for (const biz of businesses) {
      try {
        const synced = await syncShopeeListings(biz.id);
        for (const r of synced) {
          if (r.error) {
            out.errors += 1;
            console.warn(`[AutoSync] listing Shopee "${r.label}": ${r.error}`);
            continue;
          }
          out.shopeeMatched += r.matched;
          await prisma.syncLog
            .create({
              data: {
                direction: "in",
                kind: "listing_sync",
                status: "success",
                message: `auto sync: ${r.matched} mapping (${r.items} item / ${r.models} model)`,
                payload: JSON.stringify({ items: r.items, models: r.models, matched: r.matched }),
                accountId: r.accountId,
              },
            })
            .catch(() => {});
        }

        // Impor listing TikTok baru → MasterProduct (dengan dedup nama) — idempoten.
        const ttImported = await importTikTokListings({ businessId: biz.id });
        for (const r of ttImported) {
          out.tiktokNew += r.importedItems;
          if (r.importedItems > 0 || r.orphan > 0 || r.duplicate > 0) {
            await prisma.syncLog
              .create({
                data: {
                  direction: "in",
                  kind: "listing_sync",
                  status: "success",
                  message: `auto import TikTok: +${r.importedItems} item, ${r.importedVariants} varian, ${r.orphan} review, ${r.duplicate} duplikat`,
                  payload: JSON.stringify({
                    importedItems: r.importedItems,
                    importedVariants: r.importedVariants,
                    existing: r.existing,
                    orphan: r.orphan,
                    duplicate: r.duplicate,
                  }),
                  accountId: r.accountId,
                },
              })
              .catch(() => {});
          }
        }

        // TikTok: service sudah menulis listing_sync per akun sendiri.
        const tt = await syncTikTokListings(biz.id);
        for (const r of tt) out.tiktokSynced += r.synced;
      } catch (e) {
        out.errors += 1;
        console.warn(`[AutoSync] listing brand ${biz.id} gagal:`, e instanceof Error ? e.message : String(e));
      }
    }
    return out;
  } finally {
    listingsInFlight = false;
  }
}

/**
 * autoSyncPromotionsOnce — tarik promo/campaign TERBARU lintas marketplace:
 * TikTok (searchPromotionActivities → PromotionActivity) + Shopee
 * (get_discount_list → PromotionActivity). Read-only, idempoten (upsert),
 * tanpa guard SyncRun (tidak menyentuh stok/order).
 */
export async function autoSyncPromotionsOnce(): Promise<PromosAutoSummary> {
  if (promosInFlight) {
    return { accounts: 0, activities: 0, errors: 0 };
  }
  promosInFlight = true;
  try {
    const accounts = await prisma.platformAccount.findMany({
      where: { platform: { in: ["TIKTOK_SHOP", "SHOPEE"] }, accessToken: { not: null } },
      select: { id: true, platform: true, label: true },
    });
    const out: PromosAutoSummary = { accounts: accounts.length, activities: 0, errors: 0 };
    for (const acc of accounts) {
      try {
        if (acc.platform === "TIKTOK_SHOP") {
          const r = await ingestPromotionActivitiesForAccount(acc.id);
          out.activities += r.itemsStored;
          out.errors += r.errors.length;
          if (r.errors.length > 0) {
            console.warn(`[AutoSync] promo TikTok "${acc.label}":`, r.errors.slice(0, 2).join(" | "));
          }
        } else {
          const r = await ingestShopeePromotionsForAccount(acc.id);
          out.activities += r.upserted;
          if (r.error) {
            out.errors += 1;
            console.warn(`[AutoSync] promo Shopee "${acc.label}":`, r.error);
          }
        }
      } catch (e) {
        out.errors += 1;
        console.warn(
          `[AutoSync] promo akun ${acc.id} gagal:`,
          e instanceof Error ? e.message : String(e)
        );
      }
    }
    return out;
  } finally {
    promosInFlight = false;
  }
}
