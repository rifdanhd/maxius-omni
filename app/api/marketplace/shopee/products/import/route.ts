import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import {
  SHOPEE_IMPORT_DEFAULT_LIMIT,
  importShopeeListings,
} from "@/lib/services/marketplace-shopee-import.service";

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    accountIds?: unknown;
    limit?: unknown;
  };
  const accountIds =
    typeof body.accountIds === "string"
      ? body.accountIds.split(",").map((s) => s.trim()).filter(Boolean)
      : Array.isArray(body.accountIds)
        ? body.accountIds.filter((v): v is string => typeof v === "string" && v.trim() !== "")
        : undefined;

  // Scoping: akun pilihan harus milik brand aktif — ID asing → 404 tanpa bocor.
  if (accountIds?.length) {
    const uniqueIds = [...new Set(accountIds)];
    const rows = await prisma.platformAccount.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, businessId: true },
    });
    if (rows.length !== uniqueIds.length) {
      return NextResponse.json({ ok: false, error: "Akun tidak ditemukan." }, { status: 404 });
    }
    for (const row of rows) {
      try {
        assertSameBrand(row.businessId, req.businessId);
      } catch {
        return NextResponse.json({ ok: false, error: "Akun tidak ditemukan." }, { status: 404 });
      }
    }
  }

  try {
    const accounts = await importShopeeListings({
      businessId: req.businessId,
      accountIds: accountIds?.length ? accountIds : undefined,
      limit: body.limit as number | undefined,
    });
    const totals = accounts.reduce(
      (acc, a) => ({
        importedItems: acc.importedItems + a.importedItems,
        importedVariants: acc.importedVariants + a.importedVariants,
        existing: acc.existing + a.existing,
        orphan: acc.orphan + a.orphan,
        duplicate: acc.duplicate + a.duplicate,
        zeroStock: acc.zeroStock + a.zeroStock,
        hasMore: acc.hasMore || a.hasMore,
        errors: acc.errors + (a.error ? 1 : 0),
      }),
      { importedItems: 0, importedVariants: 0, existing: 0, orphan: 0, duplicate: 0, zeroStock: 0, hasMore: false, errors: 0 }
    );
    return NextResponse.json({
      ok: true,
      defaultLimit: SHOPEE_IMPORT_DEFAULT_LIMIT,
      accounts,
      totals,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import gagal.";
    console.error("[Shopee] import listing error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});
