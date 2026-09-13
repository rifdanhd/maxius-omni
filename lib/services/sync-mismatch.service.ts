import { prisma } from "@/lib/db/prisma";
import { effectiveStock } from "@/lib/services/stock-level.policy";
import { SYNC_JOB_MAX_RETRIES } from "@/lib/services/sync-job.service";

/**
 * PHASE B.1 — Stock Mismatch View (read-only).
 *
 * Membaca state SyncJob PHASE A apa adanya + join minimal untuk display.
 * TIDAK menambah state/kolom baru, TIDAK memutasi apa pun.
 *
 * "Mismatch" = job yang butuh perhatian operasional:
 *   - status FAILED (retry habis → mismatch marker permanen), ATAU
 *   - status PENDING dengan retryCount >= 1 (sudah pernah gagal, menunggu backoff)
 * PENDING segar (retryCount = 0) & SUCCESS bukan mismatch — hanya tampil
 * bila filter eksplisit memintanya.
 */

export const MISMATCH_STATUSES = {
  MISMATCH: "mismatch",
  FAILED: "FAILED",
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  ALL: "all",
} as const;
export type MismatchFilter = (typeof MISMATCH_STATUSES)[keyof typeof MISMATCH_STATUSES];

export type MismatchRow = {
  id: string;
  channelSku: string;
  newSellable: number;
  status: string;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  nextRetryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  variant: {
    id: string;
    sku: string;
    name: string | null;
    stock: number;
    safetyStock: number;
    centralStock: number;
    productName: string;
  };
  account: { id: string; platform: string; label: string };
  /** newSellable yang gagal di-push minus stok central saat ini. */
  diffVsCentral: number;
};

/**
 * countMismatchSyncJobs — angka KPI untuk dashboard (PHASE C.1).
 * Predikat SAMA dengan filter "mismatch" di atas (FAILED + PENDING retry>=1),
 * hanya COUNT tanpa rows — dipakai kartu "Stock Mismatch", bukan query baru.
 */
export async function countMismatchSyncJobs(): Promise<{
  total: number;
  failed: number;
  pendingRetry: number;
}> {
  const [failed, pendingRetry] = await Promise.all([
    prisma.syncJob.count({ where: { status: "FAILED" } }),
    prisma.syncJob.count({ where: { status: "PENDING", retryCount: { gte: 1 } } }),
  ]);
  return { total: failed + pendingRetry, failed, pendingRetry };
}

function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ c: updatedAt.toISOString(), i: id }), "utf8").toString("base64");
}

function decodeCursor(cursor: string | null | undefined): { c: Date; i: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as { c: string; i: string };
    const c = new Date(parsed.c);
    if (Number.isNaN(c.getTime()) || typeof parsed.i !== "string") return null;
    return { c, i: parsed.i };
  } catch {
    return null;
  }
}

export async function listMismatchSyncJobs(params: {
  status?: string | null;
  q?: string | null;
  limit?: number;
  cursor?: string | null;
}): Promise<{ rows: MismatchRow[]; nextCursor: string | null }> {
  const limit = Math.min(100, Math.max(1, Number(params.limit ?? 50) || 50));
  const rawStatus = (params.status ?? MISMATCH_STATUSES.MISMATCH).toUpperCase() === "ALL"
    ? MISMATCH_STATUSES.ALL
    : (params.status ?? MISMATCH_STATUSES.MISMATCH);
  const status: string = Object.values(MISMATCH_STATUSES).includes(rawStatus as MismatchFilter)
    ? rawStatus
    : MISMATCH_STATUSES.MISMATCH;

  const statusWhere =
    status === MISMATCH_STATUSES.ALL
      ? {}
      : status === MISMATCH_STATUSES.FAILED
        ? { status: "FAILED" }
        : status === MISMATCH_STATUSES.PENDING
          ? { status: "PENDING" }
          : status === MISMATCH_STATUSES.SUCCESS
            ? { status: "SUCCESS" }
            : { OR: [{ status: "FAILED" }, { status: "PENDING", retryCount: { gte: 1 } }] };

  // Filter teks: cocok bila SKU/nama produk varian ATAU channelSku cocok.
  const q = params.q?.trim();
  let qWhere: Record<string, unknown> = {};
  if (q) {
    const variants = await prisma.productVariant.findMany({
      where: {
        OR: [
          { sku: { contains: q } },
          { name: { contains: q } },
          { masterProduct: { is: { name: { contains: q } } } },
        ],
      },
      select: { id: true },
      take: 200,
    });
    const variantIds = variants.map((v) => v.id);
    qWhere = {
      OR: [
        ...(variantIds.length > 0 ? [{ variantId: { in: variantIds } }] : []),
        { channelSku: { contains: q } },
      ],
    };
  }

  const cursor = decodeCursor(params.cursor);
  const cursorWhere = cursor
    ? {
        OR: [
          { updatedAt: { lt: cursor.c } },
          { updatedAt: cursor.c, id: { lt: cursor.i } },
        ],
      }
    : {};

  const jobs = await prisma.syncJob.findMany({
    where: {
      AND: [statusWhere, qWhere, cursorWhere],
    },
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
          stock: true,
          safetyStock: true,
          masterProduct: { select: { name: true } },
        },
      },
      account: { select: { id: true, platform: true, label: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = jobs.length > limit;
  const page = hasMore ? jobs.slice(0, limit) : jobs;

  const rows: MismatchRow[] = page.map((j) => {
    const central = effectiveStock(j.variant.stock, j.variant.safetyStock);
    return {
      id: j.id,
      channelSku: j.channelSku,
      newSellable: j.newSellable,
      status: j.status,
      retryCount: j.retryCount,
      maxRetries: SYNC_JOB_MAX_RETRIES,
      lastError: j.lastError,
      nextRetryAt: j.nextRetryAt,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      variant: {
        id: j.variant.id,
        sku: j.variant.sku,
        name: j.variant.name,
        stock: j.variant.stock,
        safetyStock: j.variant.safetyStock,
        centralStock: central,
        productName: j.variant.masterProduct.name,
      },
      account: j.account,
      diffVsCentral: j.newSellable - central,
    };
  });

  const last = page[page.length - 1];
  return {
    rows,
    nextCursor: hasMore && last ? encodeCursor(last.updatedAt, last.id) : null,
  };
}
