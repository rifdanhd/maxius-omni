import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { getPromotionAlerts } from "@/lib/services/promotion-alert.service";

/**
 * GET /api/marketplace/tiktok/promotions/alerts — sumber banner halaman Promosi.
 * Ringan (baca audit terbaru saja) → aman dipoll tiap load halaman.
 */
export const GET = withAuth(async () => {
  const alerts = await getPromotionAlerts();
  return NextResponse.json({ ok: true, alerts });
});
