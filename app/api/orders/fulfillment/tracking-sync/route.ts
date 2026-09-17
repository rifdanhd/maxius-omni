import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { ingestTrackingForAccount } from "@/lib/services/shipment-tracking.service";

/**
 * Tracking Sync — ingest timeline tracking TikTok ke ShipmentTrackingEvent.
 * POST /api/orders/fulfillment/tracking-sync
 *
 * Body opsional:
 *   { accountId?: string }  — bila diisi, hanya akun tsb yang di-ingest;
 *                             kosong = semua akun Tokopedia | Shop.
 *
 * Idempotent: re-run tidak menduplikasi event (dedupe unique
 * shipmentId+eventTime+description). Hanya order non-final yang di-scrape.
 */
export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  const accountId = typeof body?.accountId === "string" ? body.accountId : undefined;

  const accounts = await prisma.platformAccount.findMany({
    where: {
      platform: "TIKTOK_SHOP" as const,
      businessId: req.businessId,
      ...(accountId ? { id: accountId } : {}),
    },
    select: { id: true, label: true },
  });

  const results = [];
  let totalScanned = 0;
  let totalIngested = 0;
  let totalEvents = 0;
  let totalAmbiguous = 0;
  const errors = [];

  for (const acc of accounts) {
    try {
      const res = await ingestTrackingForAccount(acc.id);
      totalScanned += res.ordersScanned;
      totalIngested += res.ordersIngested;
      totalEvents += res.eventsInserted;
      totalAmbiguous += res.ordersAmbiguous;
      results.push({
        accountId: acc.id,
        label: acc.label,
        ordersScanned: res.ordersScanned,
        ordersIngested: res.ordersIngested,
        eventsInserted: res.eventsInserted,
        ordersAmbiguous: res.ordersAmbiguous,
      });
      if (res.errors.length) errors.push(...res.errors);
    } catch (e) {
      results.push({
        accountId: acc.id,
        label: acc.label,
        error: e instanceof Error ? e.message : String(e),
      });
      errors.push(`${acc.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    ordersScanned: totalScanned,
    ordersIngested: totalIngested,
    eventsInserted: totalEvents,
    ordersAmbiguous: totalAmbiguous,
    results,
    errors,
  });
});
