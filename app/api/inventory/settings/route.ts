import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import {
  getInventorySettings,
  updateInventorySettings,
  validateInventorySettingsUpdate,
} from "@/lib/services/inventory-settings.service";

// GET /api/inventory/settings — baca singleton (baris default auto-dibuat
// saat pertama dibaca — tanpa seed terpisah).
export const GET = withAuth(async () => {
  const settings = await getInventorySettings();
  return NextResponse.json({ settings });
});

// PUT /api/inventory/settings — patch parsial dgn validasi ketat (field salah
// tipe/nilai → 400, field tak dikenal diabaikan).
export const PUT = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  const parsed = validateInventorySettingsUpdate(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.reason }, { status: 400 });
  }
  const settings = await updateInventorySettings(parsed.data);
  return NextResponse.json({ settings });
});
