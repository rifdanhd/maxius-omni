import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { STOCK_REASONS } from "@/lib/services/central-stock.service";
import { businessWhere } from "@/lib/services/business-scope.service";

/**
 * FITUR 2 — Riwayat Inventori: SATU tampilan untuk setiap pergerakan stok.
 *
 * Sumber data (disatukan di level TAMPILAN, bukan refactor skema):
 * 1. StockLedger  — satu-satunya jejak perubahan angka stok (order masuk,
 *   batal, sale, penyesuaian manual, stok opname, init) dari TUGAS 1.
 * 2. SyncLog(kind=central_stock_deduct, status=skipped) — oversell tertangkap:
 *   order gagal deduct → stok TIDAK berubah (tidak ada baris ledger) tetapi
 *   kejadian ini HARUS terlihat di history.
 *
 * Kenapa oversell tidak dimasukkan ke ledger: ledger dijaga unique
 * (reason, referenceId, variantId) sebagai kunci idempotency — baris
 * changeQty=0 dgn reason ORDER akan bertabrakan dgn deduct sukses order yang
 * sama saat retry webhook. Jadi oversell tetap di SyncLog, digabung di sini.
 */

export type InventoryHistoryItem = {
  id: string;
  source: "LEDGER" | "SYNCLOG";
  occurredAt: Date;
  variantId: string | null;
  productName: string | null;
  sku: string | null;
  event: string;
  eventKind: "ORDER" | "ORDER_CANCEL" | "SALE" | "MANUAL" | "OPNAME" | "OVERSELL" | "OTHER";
  changeQty: number | null; // null = stok tidak berubah (oversell)
  stockBefore: number | null;
  stockAfter: number | null;
  referenceNo: string | null; // no. order / kode opname / id referensi
  accountLabel: string | null;
  username: string | null;
  note: string | null;
};

/** Tambah 1 hari utk filter tanggal (inklusif — s/d akhir hari). */
function endOfDay(d: Date): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return next;
}

/**
 * listInventoryHistory — cursor pagination (keyset createdAt,id DESC).
 * Cursor = base64 "createdAt|id" dari item terakhir halaman sebelumnya —
 * stabil utk data besar & bergerak, tidak skip/baru muncul dobel
 * (pelajaran TUGAS 2).
 */
export async function listInventoryHistory(params: {
  businessId: string;
  cursor?: string | null;
  limit?: number;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  source?: string | null; // ledger | synclog | null (semua)
}): Promise<{ items: InventoryHistoryItem[]; nextCursor: string | null }> {
  const limit = Math.min(100, Math.max(1, Number(params.limit ?? 50) || 50));
  const to = params.to ? endOfDay(new Date(params.to)) : null;
  const from = params.from ? new Date(params.from) : null;
  if ((to && Number.isNaN(to.getTime())) || (from && Number.isNaN(from.getTime()))) {
    return { items: [], nextCursor: null };
  }

  // Cari produk/SKU dulu (query kecil) → id varian utk filter kedua feed.
  let variantIds: string[] | null = null;
  const q = params.q?.trim();
  if (q) {
    const variants = await prisma.productVariant.findMany({
      where: {
        AND: [
          businessWhere.variant(params.businessId),
          {
            OR: [{ sku: { contains: q } }, { name: { contains: q } }, { masterProduct: { is: { name: { contains: q } } } }],
          },
        ],
      },
      select: { id: true },
      take: 200,
    });
    variantIds = variants.map((v) => v.id);
    if (variantIds.length === 0) return { items: [], nextCursor: null };
  }

  // Cursor PER-FEED: merge-cut dua feed di satu titik dgn cursor tunggal bisa
  // MELEWATKAN baris (baris ledger yang belum tampil terlewati cursor global).
  // Cursor menyimpan posisi terakhir yang SUDAH TAMPIL per feed; feed tanpa
  // baris tampil pertahankan posisi sebelumnya → baris tidak pernah hilang,
  // paling hanya di-fetch ulang.
  type FeedCursor = { c: string; i: string } | null;
  let prevL: FeedCursor = null;
  let prevS: FeedCursor = null;
  if (params.cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(params.cursor, "base64").toString("utf8")) as {
        l?: FeedCursor;
        s?: FeedCursor;
      };
      prevL = parsed.l ?? null;
      prevS = parsed.s ?? null;
    } catch {
      // cursor rusak → mulai dari awal
    }
  }
  const feedWhere = (fc: FeedCursor) =>
    fc
      ? {
          OR: [
            { createdAt: { lt: new Date(fc.c) } },
            { createdAt: new Date(fc.c), id: { lt: fc.i } },
          ],
        }
      : {};

  const wantLedger = params.source !== "synclog";
  const wantSync = params.source !== "ledger";

  const ledgerWhere: Prisma.StockLedgerWhereInput = {
    AND: [
      businessWhere.ledger(params.businessId),
      feedWhere(prevL),
      ...(from || to ? [{ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }] : []),
      ...(variantIds ? [{ variantId: { in: variantIds } }] : []),
    ],
  };
  const syncWhere: Prisma.SyncLogWhereInput = {
    kind: "central_stock_deduct",
    status: "skipped",
    AND: [
      businessWhere.syncLog(params.businessId),
      feedWhere(prevS),
      ...(from || to ? [{ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }] : []),
    ],
  };

  const ledgerRows = wantLedger
    ? await prisma.stockLedger.findMany({
        where: ledgerWhere,
        select: {
          id: true,
          changeQty: true,
          reason: true,
          referenceId: true,
          note: true,
          stockAfter: true,
          createdAt: true,
          variantId: true,
          variant: { select: { sku: true, name: true, masterProduct: { select: { name: true } } } },
          account: { select: { label: true } },
          user: { select: { username: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        // limit+1 → mendeteksi "masih ada halaman berikutnya" tanpa count mahal.
        take: limit + 1,
      })
    : [];

  // SyncLog oversell tidak punya variantId → filter produk/SKU di JS (batas
  // ambil dinaikkan saat mencari;take tetap ketat).
  const syncRowsRaw = wantSync
    ? await prisma.syncLog.findMany({
        where: syncWhere,
        select: { id: true, message: true, payload: true, createdAt: true, accountId: true, account: { select: { label: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: variantIds ? 400 : limit + 1,
      })
    : [];

  // Lengkapi info varian utk baris oversell (payload hanya berisi id).
  const oversellVariantIds = [
    ...new Set(
      syncRowsRaw.flatMap((r) => parseOversellPayload(r.payload).variantIds)
    ),
  ].slice(0, 100);
  const oversellVariants = oversellVariantIds.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: oversellVariantIds }, ...businessWhere.variant(params.businessId) },
        select: { id: true, sku: true, name: true, masterProduct: { select: { name: true } } },
      })
    : [];
  const oversellVariantInfo = new Map(oversellVariants.map((v) => [v.id, v]));

  // stockBefore ledger = stockAfter − changeQty (ledger tidak menyimpan before).
  const ledgerItems: InventoryHistoryItem[] = ledgerRows.map((r) => {
    const kind = ledgerEventKind(r.reason);
    return {
      id: r.id,
      source: "LEDGER" as const,
      occurredAt: r.createdAt,
      variantId: r.variantId,
      productName: r.variant.masterProduct.name,
      sku: r.variant.sku,
      event: ledgerEventLabel(r.reason, r.note, r.referenceId),
      eventKind: kind,
      changeQty: r.changeQty,
      stockBefore: r.stockAfter - r.changeQty,
      stockAfter: r.stockAfter,
      referenceNo: r.referenceId,
      accountLabel: r.account?.label ?? null,
      username: r.user?.username ?? null,
      note: r.note,
    };
  });

  const syncItems: InventoryHistoryItem[] = [];
  for (const r of syncRowsRaw) {
    if (syncItems.length >= limit) break;
    const parsed = parseOversellPayload(r.payload);
    if (
      variantIds &&
      parsed.variantIds.length > 0 &&
      !parsed.variantIds.some((id) => variantIds!.includes(id))
    ) {
      continue;
    }
    const vi = parsed.variantIds[0] ? oversellVariantInfo.get(parsed.variantIds[0]) : undefined;
    const orderNo = r.message?.match(/^order (.+?):/)?.[1] ?? null;
    syncItems.push({
      id: r.id,
      source: "SYNCLOG" as const,
      occurredAt: r.createdAt,
      variantId: parsed.variantIds[0] ?? null,
      productName: vi?.masterProduct.name ?? null,
      sku: vi?.sku ?? null,
      event: `Oversell tertangkap${orderNo ? ` [${orderNo}]` : ""}`,
      eventKind: "OVERSELL",
      changeQty: null,
      stockBefore: null,
      stockAfter: null,
      referenceNo: parsed.orderId,
      accountLabel: r.account?.label ?? null,
      username: null,
      note: r.message,
    });
  }

  // Gabung + sort desc + potong limit + buat cursor berikutnya.
  const merged = [...ledgerItems, ...syncItems].sort((a, b) => {
    const t = b.occurredAt.getTime() - a.occurredAt.getTime();
    return t !== 0 ? t : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  });
  const items = merged.slice(0, limit);

  // Posisi cursor baru = baris TERAKHIR yang TAMPIL per feed (feed tanpa baris
  // tampil → pertahankan posisi lama supaya barisnya di-fetch ulang, tidak
  // hilang). Ada halaman berikutnya ⟺ ada baris yang belum tampil.
  const lastShownKey = (src: "LEDGER" | "SYNCLOG") => {
    const shown = items.filter((it) => it.source === src);
    const lastShown = shown[shown.length - 1];
    return lastShown ? { c: lastShown.occurredAt.toISOString(), i: lastShown.id } : null;
  };
  const nextCursor =
    merged.length > limit
      ? Buffer.from(
          JSON.stringify({ l: lastShownKey("LEDGER") ?? prevL, s: lastShownKey("SYNCLOG") ?? prevS }),
          "utf8"
        ).toString("base64")
      : null;

  return { items, nextCursor };
}

function ledgerEventKind(reason: string): InventoryHistoryItem["eventKind"] {
  switch (reason) {
    case STOCK_REASONS.ORDER:
      return "ORDER";
    case STOCK_REASONS.ORDER_CANCELLED:
    case STOCK_REASONS.ORDER_REFUNDED:
      return "ORDER_CANCEL";
    case STOCK_REASONS.SALE:
      return "SALE";
    case STOCK_REASONS.MANUAL_ADJUSTMENT:
      return "MANUAL";
    case STOCK_REASONS.STOCK_OPNAME:
      return "OPNAME";
    default:
      return "OTHER";
  }
}

function ledgerEventLabel(reason: string, note: string | null, referenceId: string | null): string {
  switch (reason) {
    case STOCK_REASONS.ORDER:
      return `Pesanan Baru${referenceId ? ` [${referenceId}]` : ""}`;
    case STOCK_REASONS.ORDER_CANCELLED:
      return `Pesanan Dibatalkan${referenceId ? ` [${referenceId}]` : ""}`;
    case STOCK_REASONS.ORDER_REFUNDED:
      return `Pesanan Refund${referenceId ? ` [${referenceId}]` : ""}`;
    case STOCK_REASONS.SALE:
      return "Penjualan Manual";
    case STOCK_REASONS.MANUAL_ADJUSTMENT:
      return "Penyesuaian Manual";
    case STOCK_REASONS.STOCK_OPNAME: {
      const code = note?.match(/Stok opname (OPN-[0-9A-Z-]+)/)?.[1];
      return `Stok Opname${code ? ` [${code}]` : ""}`;
    }
    case STOCK_REASONS.INIT:
      return "Inisialisasi Stok";
    case STOCK_REASONS.SAFETY_STOCK_CHANGE: {
      const m = note?.match(/Cadangan (\d+) → (\d+)/);
      return m ? `Ubah Cadangan ${m[1]} → ${m[2]}` : "Ubah Cadangan";
    }
    default:
      return reason;
  }
}

function parseOversellPayload(payload: string | null): {
  orderId: string | null;
  variantIds: string[];
} {
  try {
    const p = JSON.parse(payload ?? "{}") as {
      orderId?: string;
      deductionsAttempted?: Array<{ variantId?: string }>;
    };
    const variantIds = (p.deductionsAttempted ?? [])
      .map((d) => d.variantId)
      .filter((v): v is string => typeof v === "string");
    return { orderId: p.orderId ?? null, variantIds };
  } catch {
    return { orderId: null, variantIds: [] };
  }
}

/** Agregasi ringan utk filter chips (DB-level, bukan tarik semua baris). */
export async function getInventoryHistoryCounts(businessId: string): Promise<Record<string, number>> {
  const [byKind, oversell] = await Promise.all([
    prisma.stockLedger.groupBy({
      by: ["reason"],
      where: businessWhere.ledger(businessId),
      _count: { _all: true },
    }),
    prisma.syncLog.count({ where: { kind: "central_stock_deduct", status: "skipped", ...businessWhere.syncLog(businessId) } }),
  ]);
  const counts: Record<string, number> = { OVERSELL: oversell };
  for (const g of byKind) {
    const kind = ledgerEventKind(g.reason);
    counts[kind] = (counts[kind] ?? 0) + g._count._all;
  }
  return counts;
}
