import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { syncOrdersTikTok } from "@/lib/services/order-sync.service";
import { syncOrdersShopee } from "@/lib/services/shopee-order-sync.service";

export const POST = withAuth(async (req) => {
  const accounts = await prisma.platformAccount.findMany({
    where: { platform: { in: ["TIKTOK_SHOP", "SHOPEE"] }, businessId: req.businessId },
    select: {
      id: true,
      label: true,
      platform: true,
      accessToken: true,
      shopCipher: true,
      externalShopId: true,
    },
  });

  const results = [];
  let totalCreated = 0;
  let totalSkipped = 0;
  const errors = [];

  for (const acc of accounts) {
    // Guard platform: ingest TikTok tidak boleh menyentuh akun non-TikTok —
    // ingest Shopee tidak boleh menyentuh akun non-Shopee (per cabang).
    if (acc.platform === "TIKTOK_SHOP") {
      if (!acc.accessToken || !acc.shopCipher) {
        results.push({ accountId: acc.id, label: acc.label, error: "Belum punya access token / shop_cipher." });
        continue;
      }
      try {
        const { fetched, created, skipped, reconciled = 0, errors: errs } = await syncOrdersTikTok(acc.id);
        totalCreated += created;
        totalSkipped += skipped;
        results.push({ accountId: acc.id, label: acc.label, fetched, created, skipped, reconciled });
        if (errs.length) errors.push(...errs.map((e) => `${acc.label}: ${e}`));
      } catch (e) {
        results.push({ accountId: acc.id, label: acc.label, error: e instanceof Error ? e.message : String(e) });
      }
    } else if (acc.platform === "SHOPEE") {
      if (!acc.accessToken) {
        results.push({ accountId: acc.id, label: acc.label, error: "Belum punya access token." });
        continue;
      }
      try {
        const { fetched, created, skipped, errors: errs } = await syncOrdersShopee(acc.id);
        totalCreated += created;
        totalSkipped += skipped;
        results.push({ accountId: acc.id, label: acc.label, fetched, created, skipped });
        if (errs.length) errors.push(...errs.map((e) => `${acc.label}: ${e}`));
      } catch (e) {
        results.push({ accountId: acc.id, label: acc.label, error: e instanceof Error ? e.message : String(e) });
      }
    } else {
      results.push({ accountId: acc.id, label: acc.label, error: "Ingest order hanya untuk akun TikTok Shop / Shopee." });
    }
  }

  return NextResponse.json({
    synced: totalCreated,
    skipped: totalSkipped,
    errors,
    results,
  });
});
