import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { searchReturns } from "@/lib/integrations/tiktokShop";
import { upsertTikTokReturn, syncShopeeReturnsForAccount } from "@/lib/services/return-ingest.service";

/**
 * POST /api/returns/sync — tarik retur manual:
 * - TikTok : returns/search (fallback bila webhook belum subscribe).
 * - Shopee : polling get_return_list (satu-satunya jalur — tidak ada push).
 */
export const POST = withAuth(async (req) => {
  const platform = new URL(req.url).searchParams.get("platform")?.toUpperCase() ?? null;

  const accounts = await prisma.platformAccount.findMany({
    where: {
      businessId: req.businessId,
      isFrozen: false,
      ...(platform ? { platform } : { platform: { in: ["TIKTOK_SHOP", "SHOPEE"] } }),
    },
    select: {
      id: true,
      platform: true,
      label: true,
      accessToken: true,
      shopCipher: true,
      externalShopId: true,
    },
  });

  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];

  for (const acc of accounts) {
    if (acc.platform === "TIKTOK_SHOP") {
      if (!acc.accessToken || !acc.shopCipher) {
        results.push({ accountId: acc.id, label: acc.label, error: "Belum punya access token / shop_cipher." });
        continue;
      }
      try {
        // Retur 90 hari terakhir, paging sampai habis.
        let pageToken: string | undefined;
        let fetched = 0;
        let upserted = 0;
        for (let i = 0; i < 20; i++) {
          const { returns, nextPageToken } = await searchReturns(acc.accessToken, acc.shopCipher, {
            createTimeFrom: Math.floor(Date.now() / 1000) - 90 * 86400,
            pageSize: 50,
            pageToken,
          });
          fetched += returns.length;
          for (const raw of returns) {
            const id = await upsertTikTokReturn(acc.id, raw);
            if (id) upserted += 1;
          }
          if (!nextPageToken) break;
          pageToken = nextPageToken;
        }
        results.push({ accountId: acc.id, label: acc.label, platform: "TIKTOK_SHOP", fetched, upserted });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        results.push({ accountId: acc.id, label: acc.label, platform: "TIKTOK_SHOP", error: message });
        errors.push(`${acc.label}: ${message}`);
      }
    } else if (acc.platform === "SHOPEE") {
      if (!acc.accessToken || !acc.externalShopId) {
        results.push({ accountId: acc.id, label: acc.label, error: "Belum punya access token / shop_id." });
        continue;
      }
      try {
        const r = await syncShopeeReturnsForAccount(acc.id);
        results.push({ accountId: acc.id, label: acc.label, platform: "SHOPEE", ...r });
        errors.push(...r.errors.map((e) => `${acc.label}: ${e}`));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        results.push({ accountId: acc.id, label: acc.label, platform: "SHOPEE", error: message });
        errors.push(`${acc.label}: ${message}`);
      }
    }
  }

  return NextResponse.json({ results, errors });
});
