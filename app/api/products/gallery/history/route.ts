import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { listImageHistory } from "@/lib/services/gallery.service";

// GET /api/products/gallery/history
// Riwayat aktivitas gambar sederhana (dari createdAt/updatedAt ProductImage).
export const GET = withAuth(async (req) => {
  const rows = await listImageHistory(100, req.businessId);
  return NextResponse.json({ rows });
});