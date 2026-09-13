import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { reconcileShipmentTracking } from "@/lib/services/shipment-reconcile.service";

/**
 * Reconcile Resi — backfill nomor resi & kurir untuk shipment yang masih kosong.
 * POST /api/orders/fulfillment/reconcile
 *
 * Body opsional:
 *   { accountId?: string }  — bila diisi, hanya akun tsb yang di-scan;
 *                             kosong = scan semua akun Tokopedia | Shop.
 *
 * Digunakan tombol "Sync Resi" di halaman Pesanan dan sebagai langkah
 * penutup syncOrdersTikTok agar order dengan resi yang di-assign async
 * tetap terisi datanya.
 */
export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  const accountId = typeof body?.accountId === "string" ? body.accountId : undefined;

  const where = {
    platform: "TIKTOK_SHOP" as const,
    ...(accountId ? { id: accountId } : {}),
  };

  const accounts = await prisma.platformAccount.findMany({
    where,
    select: { id: true, label: true, accessToken: true, shopCipher: true },
  });

  const results = [];
  let totalScanned = 0;
  let totalUpdated = 0;
  const errors = [];

  for (const acc of accounts) {
    if (!acc.accessToken || !acc.shopCipher) {
      results.push({ accountId: acc.id, label: acc.label, error: "Belum punya access token / shop_cipher." });
      continue;
    }
    try {
      const res = await reconcileShipmentTracking(acc.id);
      totalScanned += res.scanned;
      totalUpdated += res.updated;
      results.push({
        accountId: acc.id,
        label: acc.label,
        scanned: res.scanned,
        updated: res.updated,
        noTracking: res.noTracking,
      });
      if (res.errors.length) errors.push(...res.errors.map((e) => `${acc.label}: ${e}`));
    } catch (e) {
      results.push({ accountId: acc.id, label: acc.label, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: totalScanned,
    updated: totalUpdated,
    results,
    errors,
  });
});