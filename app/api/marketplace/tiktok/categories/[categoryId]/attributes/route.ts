import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { prisma } from "@/lib/db/prisma";
import {
  getCategoryAttributes,
  getCategoryRules,
} from "@/lib/integrations/tiktokShop";

// GET /api/marketplace/tiktok/categories/[categoryId]/attributes?accountId=...
//   Skema atribut (wajib & opsional) untuk kategori TikTok terpilih.
export const GET = withAuth(async (req: AuthenticatedRequest, ctx) => {
  const categoryId = ctx?.params ? (await ctx.params).categoryId ?? null : null;
  if (!categoryId) return NextResponse.json({ error: "Category id hilang." }, { status: 400 });

  const sp = req.nextUrl.searchParams;
  const accountId = sp.get("accountId") ?? undefined;
  let acc = accountId
    ? await prisma.platformAccount.findUnique({ where: { id: accountId } })
    : null;
  if (acc && acc.businessId !== req.businessId) acc = null;
  if (!acc?.accessToken) {
    acc = await prisma.platformAccount.findFirst({
      where: { platform: "TIKTOK_SHOP", accessToken: { not: null }, businessId: req.businessId },
    });
  }
  if (!acc?.accessToken) {
    return NextResponse.json({ error: "Tidak ada akun Tokopedia | Shop valid." }, { status: 400 });
  }

  try {
    const [attributes, rules] = await Promise.all([
      getCategoryAttributes(acc.accessToken, acc.shopCipher ?? undefined, categoryId),
      getCategoryRules(acc.accessToken, acc.shopCipher ?? undefined, categoryId).catch(
        () => ({} as Record<string, unknown>)
      ),
    ]);
    const out = attributes.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      required: (a.is_requried as boolean) ?? (a.is_required as boolean) ?? false,
      multiple: (a.is_multiple_selection as boolean) ?? false,
      customizable: (a.is_customizable as boolean) ?? false,
      options: ((a.values as Array<Record<string, unknown>>) ?? []).map((v) => ({
        id: v.id,
        name: v.name,
      })),
    }));
    const certifications = (
      (rules.product_certifications as Array<Record<string, unknown>>) ?? []
    ).map((r) => ({
      id: r.id,
      title: (r.name as string) ?? r.id,
      required: (r.is_required as boolean) ?? false,
      documentDetails: (r.document_details as string | undefined) ?? undefined,
    }));
    return NextResponse.json({ ok: true, attributes: out, certifications });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal memuat atribut kategori.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});