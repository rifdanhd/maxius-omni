import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import {
  setListingActive,
  syncTikTokMapping,
} from "@/lib/services/marketplace-tiktok.service";
import { submitTikTokEdit } from "@/lib/services/marketplace-tiktok-edit.service";
import type { SubmitEditInput } from "@/lib/services/marketplace-tiktok-edit.service";

// PATCH /api/marketplace/tiktok/products/[mappingId]
//   { active: true }  → aktifkan listing di Tokopedia | Shop (API real)
//   { active: false } → nonaktifkan listing (API real)
// POST /api/marketplace/tiktok/products/[mappingId]
//   Sync ulang satu mapping dari Tokopedia | Shop.
// PUT /api/marketplace/tiktok/products/[mappingId]
//   Submit "Publish Semua" — upload media lalu Update Product ke TikTok.

async function getMappingId(
  ctx: { params: Promise<Record<string, string | undefined>> } | undefined
): Promise<string | null> {
  return ctx?.params ? (await ctx.params).mappingId ?? null : null;
}

export const PATCH = withAuth(async (req: AuthenticatedRequest, ctx) => {
  const mappingId = await getMappingId(ctx);
  if (!mappingId) return NextResponse.json({ error: "Mapping id hilang." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "Body harus memuat field aktif: boolean." }, { status: 400 });
  }

  const result = await setListingActive(mappingId, body.active!, req.businessId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});

export const POST = withAuth(async (req: AuthenticatedRequest, ctx) => {
  const mappingId = await getMappingId(ctx);
  if (!mappingId) return NextResponse.json({ error: "Mapping id hilang." }, { status: 400 });

  try {
    const result = await syncTikTokMapping(mappingId, req.businessId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync mapping gagal.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});

export const PUT = withAuth(async (req: AuthenticatedRequest, ctx) => {
  const mappingId = await getMappingId(ctx);
  if (!mappingId) return NextResponse.json({ error: "Mapping id hilang." }, { status: 400 });

  const body = (await req.json().catch(() => null)) as SubmitEditInput | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Body tidak valid." }, { status: 400 });
  }

  const mappingBrand = await prisma.productMapping.findUnique({
    where: { id: mappingId },
    select: { account: { select: { businessId: true } } },
  });
  if (!mappingBrand) {
    return NextResponse.json({ ok: false, error: "Mapping tidak ditemukan." }, { status: 404 });
  }
  try {
    assertSameBrand(mappingBrand.account.businessId, req.businessId);
  } catch {
    return NextResponse.json({ ok: false, error: "Mapping tidak ditemukan." }, { status: 404 });
  }

  const result = await submitTikTokEdit(mappingId, body);
  if (!result.ok) {
    const status = result.error?.startsWith("[Tokopedia | Shop]") ? 502 : 400;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }
  return NextResponse.json(result);
});