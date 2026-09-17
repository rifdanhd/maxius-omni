import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { prisma } from "@/lib/db/prisma";
import { getCategories } from "@/lib/integrations/tiktokShop";

// GET /api/marketplace/tiktok/categories?keyword=...&accountId=...
//   Proksi ke kategori Tokopedia | Shop (search by keyword) untuk tree-select.
async function resolveAccount(accountId?: string | null, businessId?: string) {
  if (accountId) {
    const acc = await prisma.platformAccount.findUnique({ where: { id: accountId } });
    if (acc?.accessToken && (!businessId || acc.businessId === businessId)) return acc;
    return null;
  }
  return (
    (await prisma.platformAccount.findFirst({
      where: {
        platform: "TIKTOK_SHOP",
        accessToken: { not: null },
        ...(businessId ? { businessId } : {}),
      },
    })) ?? null
  );
}

export const GET = withAuth(async (req) => {
  const sp = req.nextUrl.searchParams;
  const keyword = sp.get("keyword") ?? undefined;
  const accountId = sp.get("accountId") ?? undefined;

  const acc = await resolveAccount(accountId, req.businessId);
  if (!acc) return NextResponse.json({ error: "Tidak ada akun Tokopedia | Shop valid." }, { status: 400 });

  try {
    const categories = await getCategories(
      acc.accessToken!,
      acc.shopCipher ?? undefined,
      keyword,
      "TIKTOK_SHOP"
    );
    const tree = categories.map((c) => ({
      id: c.id,
      name: c.local_name,
      parentId: c.parent_id,
      isLeaf: c.is_leaf,
      permissionStatuses: c.permission_statuses,
    }));
    return NextResponse.json({ ok: true, account: { id: acc.id, label: acc.label }, categories: tree });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal memuat kategori.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});