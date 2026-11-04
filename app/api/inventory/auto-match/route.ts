import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/utils/api";
import { applyAutoMatch, previewAutoMatch } from "@/lib/services/auto-match.service";

const decision = z.object({
  accountId: z.string().min(1), channelSku: z.string().min(1), variantId: z.string().optional(),
  createMaster: z.boolean().optional(), masterName: z.string().optional(), sku: z.string().optional(), imageUrl: z.string().nullable().optional(),
});

export const GET = withAuth(async (req) => {
  try {
    const accountId = req.nextUrl.searchParams.get("accountId")?.trim() || undefined;
    return NextResponse.json({ ok: true, ...(await previewAutoMatch(req.businessId, accountId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal membuat preview auto-match.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
});

export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => ({}));
  const parsed = z.object({ decisions: z.array(decision).min(1).max(500) }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Daftar keputusan auto-match tidak valid." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await applyAutoMatch(req.businessId, parsed.data.decisions)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyimpan auto-match.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
});
