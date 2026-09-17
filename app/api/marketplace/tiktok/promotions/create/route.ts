import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertAccountMappingsInBrand } from "@/lib/services/business-scope.service";
import { createPromotion } from "@/lib/services/promotion-write.service-create";

/**
 * POST /api/marketplace/tiktok/promotions/create — SATU-SATUNYA titik write
 * ke TikTok + DB audit untuk fitur ini.
 *
 * Guardrail G1–G4 di-enforce ULANG di sini server-side (permintaan reviewer):
 * panggilan langsung via curl tanpa lewat UI TETAP kena — G4 (ketik "BUAT")
 * dicek sebelum audit PENDING ditulis, G1–G3 dicek ulang terhadap DB asli.
 * Response /preview tidak pernah dipercaya.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = (await req.json().catch(() => null)) as {
    accountId?: string;
    mappingIds?: string[];
    discountByMappingId?: Record<string, number>;
    beginAt?: string;
    endAt?: string;
    confirmationWord?: string;
    title?: string;
    confirmExtreme?: boolean;
    acknowledgeActiveOverlap?: boolean;
  } | null;

  if (!body?.accountId || !Array.isArray(body.mappingIds) || body.mappingIds.length === 0) {
    return NextResponse.json(
      { error: "accountId dan mappingIds wajib diisi." },
      { status: 400 }
    );
  }

  try {
    await assertAccountMappingsInBrand(body.accountId, body.mappingIds, req.businessId);
  } catch {
    return NextResponse.json({ error: "Toko / mapping tidak ditemukan di brand ini." }, { status: 404 });
  }

  const result = await createPromotion({
    accountId: body.accountId,
    userId: req.user.id,
    username: req.user.username,
    mappingIds: body.mappingIds,
    discountByMappingId: body.discountByMappingId ?? {},
    beginAt: body.beginAt ?? "",
    endAt: body.endAt ?? "",
    // Kosong → G4 menolak dengan pesan "ketik BUAT" (perilaku yang benar).
    confirmationWord: body.confirmationWord ?? "",
    title: body.title,
    confirmExtreme: body.confirmExtreme === true,
    acknowledgeActiveOverlap: body.acknowledgeActiveOverlap === true,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, itemErrors: result.itemErrors ?? [] },
      { status: 400 }
    );
  }

  // ok=true tetap memuat resultStatus — UNVERIFIED/PARTIAL WAJIB ditampilkan
  // UI sebagai peringatan (bukan sukses hijau), alert sudah dibuat service.
  return NextResponse.json(result);
});
