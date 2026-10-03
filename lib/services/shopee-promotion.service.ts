/**
 * shopee-promotion — ingest campaign diskon Shopee (get_discount_list) ke
 * PromotionActivity (akun SHOPEE) supaya halaman Promosi menampilkan
 * promo/campaign diskon TERBARU lintas marketplace (TikTok + Shopee).
 *
 * - Read-only: tidak membuat/mengubah apa pun di Shopee.
 * - Status Shopee (ongoing/upcoming) disimpan apa adanya → classifyPromotionTab
 *   memetakan ke tab aktif/mendatang; expired tidak ditarik (tab berakhir
 *   cukup dari data yang pernah ada).
 * - Upsert per (accountId, discount_id) — ingest ulang idempotent.
 */
import { prisma } from "@/lib/db/prisma";
import { getDiscountList } from "@/lib/integrations/shopee";
import { loadShopeeAccount, withRefreshedToken } from "@/lib/services/marketplace-shopee.service";

export type ShopeePromoIngestResult = {
  accountId: string;
  discovered: number;
  upserted: number;
  error?: string;
};

const PULL_STATUSES = ["ongoing", "upcoming"] as const;
const MAX_PAGES = 5;

export async function ingestShopeePromotionsForAccount(
  accountId: string
): Promise<ShopeePromoIngestResult> {
  const out: ShopeePromoIngestResult = { accountId, discovered: 0, upserted: 0 };
  try {
    const account = await loadShopeeAccount(accountId);
    if (!account || account.platform !== "SHOPEE") {
      out.error = "Akun Shopee tidak ditemukan.";
      return out;
    }

    for (const status of PULL_STATUSES) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const r = await withRefreshedToken(account, (token, shopId, creds) =>
          getDiscountList(token, shopId, { status, pageNo: page, pageSize: 100 }, creds)
        );
        out.discovered += r.discounts.length;

        for (const d of r.discounts) {
          if (!d.discount_id) continue;
          const title = d.discount_name?.trim() || `Diskon Shopee #${d.discount_id}`;
          const startsAt = new Date((d.start_time ?? Math.floor(Date.now() / 1000)) * 1000);
          const endsAt = new Date((d.end_time ?? Math.floor(Date.now() / 1000)) * 1000);
          const payload = JSON.stringify(d).slice(0, 8000);
          try {
            await prisma.promotionActivity.upsert({
              where: {
                accountId_externalActivityId: {
                  accountId,
                  externalActivityId: String(d.discount_id),
                },
              },
              create: {
                accountId,
                externalActivityId: String(d.discount_id),
                title,
                activityType: "SHOPEE_DISCOUNT",
                status: d.status ?? status,
                productLevel: "ALL",
                startsAt,
                endsAt,
                lastConfirmedAt: new Date(),
                rawPayload: payload,
                updatedAt: new Date(),
              },
              update: {
                title,
                status: d.status ?? status,
                startsAt,
                endsAt,
                lastConfirmedAt: new Date(),
                rawPayload: payload,
              },
            });
            out.upserted += 1;
          } catch (e) {
            out.error = e instanceof Error ? e.message : String(e);
          }
        }

        if (!r.more || r.discounts.length === 0) break;
      }
    }
    return out;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
}
