import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertAccountMappingsInBrand } from "@/lib/services/business-scope.service";
import { previewPromotion } from "@/lib/services/promotion-write.service";
import {
  extremeDiscountConfirmMessage,
  validateDiscount,
  validateSchedule,
} from "@/lib/services/promotion-write.policy";

/**
 * POST /api/marketplace/tiktok/promotions/preview — hitung harga final &
 * overlap TANPA efek samping (tidak write DB Maxius, tidak call TikTok API).
 *
 * Dipanggil form UI saat user menekan "Preview" SEBELUM dialog konfirmasi.
 * Response memuat semua yang dibutuhkan guardrail G1–G3; keputusan submit
 * tetap divalidasi ulang server-side di /create (jangan percaya client).
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = (await req.json().catch(() => null)) as {
    accountId?: string;
    mappingIds?: string[];
    discountByMappingId?: Record<string, number>;
    /** ISO string */
    beginAt?: string;
    endAt?: string;
  } | null;

  if (!body?.accountId || !Array.isArray(body.mappingIds) || body.mappingIds.length === 0) {
    return NextResponse.json(
      { error: "accountId dan mappingIds wajib diisi." },
      { status: 400 }
    );
  }
  if (body.mappingIds.length > 1000) {
    return NextResponse.json(
      { error: "Maksimum 1.000 produk per activity (batas kebijakan Maxius)." },
      { status: 400 }
    );
  }

  const beginAt = body.beginAt ? new Date(body.beginAt) : null;
  const endAt = body.endAt ? new Date(body.endAt) : null;
  if (!beginAt || !endAt || Number.isNaN(beginAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return NextResponse.json({ error: "beginAt/endAt wajib tanggal valid." }, { status: 400 });
  }

  const scheduleIssue = validateSchedule(beginAt, endAt);
  if (scheduleIssue) {
    const msg =
      scheduleIssue.kind === "LEAD_TIME_TOO_SHORT"
        ? `Waktu mulai minimal ${scheduleIssue.minHours} jam dari sekarang (aturan keamanan Maxius).`
        : scheduleIssue.kind === "END_BEFORE_START"
          ? "Waktu berakhir harus setelah waktu mulai."
          : `Durasi promo maksimal ${scheduleIssue.maxDays} hari.`;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Struktur diskon divalidasi dulu (integer & rentang 0-100). Nilai EXTREME
  // (0% / >=96%) TIDAK ditolak di preview — preview justru harus tetap bisa
  // menampilkan harga finalnya supaya dialog konfirmasi memuat dampak nyata.
  for (const [mappingId, value] of Object.entries(body.discountByMappingId ?? {})) {
    const issue = validateDiscount(value, true);
    if (!issue) continue;
    if (issue.kind === "NOT_INTEGER") {
      return NextResponse.json(
        { error: `Diskon harus bilangan bulat (dapat ${value} untuk ${mappingId}).` },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: `Diskon ${value}% tidak valid (rentang 0–100).` },
      { status: 400 }
    );
  }

  try {
    await assertAccountMappingsInBrand(body.accountId, body.mappingIds, req.businessId);
  } catch {
    return NextResponse.json({ error: "Toko / mapping tidak ditemukan di brand ini." }, { status: 404 });
  }

  const result = await previewPromotion({
    accountId: body.accountId,
    mappingIds: body.mappingIds,
    discountByMappingId: body.discountByMappingId ?? {},
    beginAt,
    endAt,
  });

  // G2: kumpulkan pesan konfirmasi extreme PER PRODUK dengan nama & harga
  // final riil (bukan warning generik). UI wajib menampilkannya + checkbox
  // konfirmasi sebelum boleh submit; /create akan menolak tanpa confirmExtreme.
  const extremeConfirmMessages = result.items
    .filter((item) => {
      const d = body.discountByMappingId?.[item.mappingId];
      return d !== undefined && validateDiscount(d, false)?.kind === "EXTREME_DISCOUNT";
    })
    .map((item) => ({
      mappingId: item.mappingId,
      displayName: item.input.displayName ?? item.input.channelSku,
      discount: body.discountByMappingId?.[item.mappingId] ?? 0,
      message: extremeDiscountConfirmMessage(
        item.input.displayName ?? item.input.channelSku,
        body.discountByMappingId?.[item.mappingId] ?? 0,
        item.finalPrice ?? 0
      ),
    }));

  return NextResponse.json({
    ok: true,
    ...result,
    extremeConfirmMessages,
  });
});
