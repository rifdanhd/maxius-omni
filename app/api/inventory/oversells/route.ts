import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

export type OversellEntry = {
  id: string;
  occurredAt: string;
  accountLabel: string;
  platform: string;
  message: string | null;
  skus: string[];
  failedQty: number;
  handledAt: string | null;
  handledBy: string | null;
};

type DeductAttempt = { variantId?: unknown; qty?: unknown };

function parseAttempts(payload: string | null): DeductAttempt[] {
  if (!payload) return [];
  try {
    const p = JSON.parse(payload) as { deductionsAttempted?: unknown };
    return Array.isArray(p.deductionsAttempted)
      ? (p.deductionsAttempted as DeductAttempt[])
      : [];
  } catch {
    return [];
  }
}

/**
 * GET /api/inventory/oversells — entri SyncLog kind=central_stock_deduct
 * (jejak atomic deduct yang gagal = oversell tertangkap).
 * Fresh tanpa cache (badge real-time); satu baris per entri SyncLog dengan
 * agregat SKU + total qty gagal dari payload deductionsAttempted.
 */
export const GET = withAuth(async () => {
  const logs = await prisma.syncLog.findMany({
    where: { kind: "central_stock_deduct" },
    include: { account: { select: { label: true, platform: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const variantIds = new Set<string>();
  const attemptsByLog = new Map<string, DeductAttempt[]>();
  for (const log of logs) {
    const attempts = parseAttempts(log.payload);
    attemptsByLog.set(log.id, attempts);
    for (const a of attempts) {
      if (typeof a.variantId === "string") variantIds.add(a.variantId);
    }
  }

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: [...variantIds] } },
    select: { id: true, sku: true, name: true, masterProduct: { select: { name: true } } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const entries: OversellEntry[] = logs.map((log) => {
    const attempts = attemptsByLog.get(log.id) ?? [];
    const skus: string[] = [];
    let failedQty = 0;
    for (const a of attempts) {
      const qty = typeof a.qty === "number" && Number.isFinite(a.qty) ? a.qty : 0;
      failedQty += qty;
      if (typeof a.variantId === "string") {
        const v = variantById.get(a.variantId);
        skus.push(v ? `${v.sku}${v.name ? ` (${v.name})` : ""}` : a.variantId);
      }
    }
    return {
      id: log.id,
      occurredAt: log.createdAt.toISOString(),
      accountLabel: log.account.label,
      platform: log.account.platform,
      message: log.message,
      skus,
      failedQty,
      handledAt: log.handledAt ? log.handledAt.toISOString() : null,
      handledBy: log.handledBy,
    };
  });

  return NextResponse.json({
    entries,
    unhandledCount: entries.filter((e) => e.handledAt === null).length,
  });
});
