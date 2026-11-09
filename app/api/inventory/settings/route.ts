import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import {
  BaselineGateError,
  getInventorySettings,
  updateInventorySettings,
  validateInventorySettingsUpdate,
} from "@/lib/services/inventory-settings.service";

// GET /api/inventory/settings — baca baris brand aktif & ringkasan toko terhubung
export const GET = withAuth(async (req) => {
  const [settings, accounts] = await Promise.all([
    getInventorySettings(req.businessId),
    prisma.platformAccount.findMany({
      where: { businessId: req.businessId },
      select: { platform: true, stockPushEnabled: true, isFrozen: true },
    }),
  ]);

  const tiktokCount = accounts.filter((a) => a.platform === "TIKTOK_SHOP").length;
  const shopeeCount = accounts.filter((a) => a.platform === "SHOPEE").length;

  return NextResponse.json({
    settings,
    pushRuntime: { globalEnabled: process.env.STOCK_PUSH_ENABLED === "true" },
    storeSummary: {
      tiktok: tiktokCount,
      shopee: shopeeCount,
      total: accounts.length,
    },
  });
});

// PUT /api/inventory/settings — patch parsial dgn validasi ketat (field salah
// tipe/nilai → 400, field tak dikenal diabaikan).
export const PUT = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  const parsed = validateInventorySettingsUpdate(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason }, { status: 400 });
  }
  try {
    const settings = await updateInventorySettings(req.businessId, parsed.data);
    return NextResponse.json({ settings });
  } catch (error) {
    // 409 + daftar varian penyebab: UI menampilkan SKU & alasan, bukan rollback diam-diam.
    if (error instanceof BaselineGateError) {
      return NextResponse.json({ error: error.message, blockers: error.blockers }, { status: 409 });
    }
    if (error instanceof Error && (error.message.startsWith("Baseline belum lengkap:") || error.message.startsWith("Baseline perlu ditinjau:"))) {
      return NextResponse.json({ error: error.message, blockers: [] }, { status: 409 });
    }
    throw error;
  }
});
