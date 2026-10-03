/**
 * Auto-sync in-process — dipanggil ticker di instrumentation.ts.
 *
 * Kenapa in-process: VPS cuma 1.9GB RAM → crontab node script tambahan
 * ditolak (keputusan F2 M5c); pola yang sama dengan processDueSyncJobs.
 *
 * - Order (5 menit): ringan — TikTok/Shopee list order dengan paginasi cap
 *   50 halaman. Webhook tetap sumber utama update status real-time.
 * - Listing + gambar (30 menit): impor item Shopee baru (limit 100/siklus,
 *   lanjut via hasMore), refresh mapping, backfill gambar (idempoten —
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
import { syncOrdersTikTok } from "@/lib/services/order-sync.service";
import { syncOrdersShopee } from "@/lib/services/shopee-order-sync.service";
import { syncShopeeListings } from "@/lib/services/marketplace-shopee.service";
import { importShopeeListings } from "@/lib/services/marketplace-shopee-import.service";
import { syncTikTokListings } from "@/lib/services/marketplace-tiktok.service";

export type OrdersAutoSummary = {
  accounts: number;
  created: number;
  skipped: number;
  errors: number;
};

export type ListingsAutoSummary = {
  businesses: number;
  shopeeNew: number;
  shopeeMatched: number;
  tiktokSynced: number;
  errors: number;
};

let ordersInFlight = false;
let listingsInFlight = false;

export async function autoSyncOrdersOnce(): Promise<OrdersAutoSummary> {
  if (ordersInFlight) {
    return { accounts: 0, created: 0, skipped: 0, errors: 0 };
  }
  ordersInFlight = true;
  try {
    const accounts = await prisma.platformAccount.findMany({
      where: { platform: { in: ["TIKTOK_SHOP", "SHOPEE"] }, accessToken: { not: null } },
      select: { id: true, platform: true },
    });
    const out: OrdersAutoSummary = { accounts: accounts.length, created: 0, skipped: 0, errors: 0 };
    for (const acc of accounts) {
      try {
        const r =
          acc.platform === "TIKTOK_SHOP" ? await syncOrdersTikTok(acc.id) : await syncOrdersShopee(acc.id);
        out.created += r.created;
        out.skipped += r.skipped;
        out.errors += r.errors.length;
        // TikTok sudah menulis SyncLog order_sync per akun di dalam service.
        // Shopee hanya menulis log pada error eksepsi → ringkasan sukses ditulis di sini.
        if (acc.platform === "SHOPEE" && r.created > 0) {
          await prisma.syncLog
            .create({
              data: {
                direction: "in",
                kind: "order_sync",
                status: "success",
                message: `auto: ${r.fetched} ditarik, ${r.created} baru, ${r.skipped} sudah ada`,
                payload: JSON.stringify({ fetched: r.fetched, created: r.created, skipped: r.skipped }),
                accountId: acc.id,
              },
            })
            .catch(() => {});
        }
      } catch (e) {
        out.errors += 1;
        console.warn(`[AutoSync] order akun ${acc.id} gagal:`, e instanceof Error ? e.message : String(e));
      }
    }
    return out;
  } finally {
    ordersInFlight = false;
  }
}

export async function autoSyncListingsOnce(): Promise<ListingsAutoSummary> {
  if (listingsInFlight) {
    return { businesses: 0, shopeeNew: 0, shopeeMatched: 0, tiktokSynced: 0, errors: 0 };
  }
  listingsInFlight = true;
  try {
    const businesses = await prisma.business.findMany({ select: { id: true } });
    const out: ListingsAutoSummary = {
      businesses: businesses.length,
      shopeeNew: 0,
      shopeeMatched: 0,
      tiktokSynced: 0,
      errors: 0,
    };
    for (const biz of businesses) {
      try {
        // Impor listing Shopee (item baru + backfill gambar) — idempoten,
        // limit default 100 item/siklus, sisa diproses di siklus berikutnya (hasMore).
        const imported = await importShopeeListings({ businessId: biz.id });
        for (const a of imported) {
          out.shopeeNew += a.importedItems;
          if (a.importedItems > 0) {
            await prisma.syncLog
              .create({
                data: {
                  direction: "in",
                  kind: "listing_sync",
                  status: "success",
                  message: `auto import: +${a.importedItems} item, ${a.importedVariants} varian`,
                  payload: JSON.stringify({
                    importedItems: a.importedItems,
                    importedVariants: a.importedVariants,
                    existing: a.existing,
                  }),
                  accountId: a.accountId,
                },
              })
              .catch(() => {});
          }
        }

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
