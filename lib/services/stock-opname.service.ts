import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import {
  STOCK_REASONS,
  adjustStockAbsoluteInTx,
  pushVariantStockToOthers,
} from "@/lib/services/central-stock.service";
import { isDeduplicationFailure } from "@/lib/services/stock-guard.policy";

/**
 * Stok Opname (FITUR 1) — hitung fisik ulang stok gudang & koreksi selisih
 * dengan jejak. Sistem ini single-gudang (tidak ada model Warehouse) → tanpa
 * pemilihan gudang.
 *
 * Alur status: PENDING → IN_PROGRESS → COMPLETED | CANCELLED
 * - systemStock di item = SNAPSHOT stok saat varian dimasukkan ke opname
 *   (bukan live): selisih dihitung terhadap snapshot agar konsisten walau stok
 *   bergerak (order masuk/keluar) selama opname berlangsung.
 * - Finalisasi TIDAK bikin jalur stok baru: selisih dikoreksi lewat
 *   adjustStockAbsoluteInTx (inti yang sama dengan adjustStockManually —
 *   update+ledger dalam SATU transaksi, reason STOCK_OPNAME, referenceId =
 *   opname.id) → proteksi anti-oversell TUGAS 1 & audit trail StockLedger
 *   tetap satu pintu.
 * - Opname CANCELLED tidak menyentuh stok sama sekali.
 */

export const OPNAME_STATUSES = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type OpnameStatus = (typeof OPNAME_STATUSES)[keyof typeof OPNAME_STATUSES];

/** Kode referensi manusiawi utk ledger/history: OPN-YYYYMMDD-XXXX. */
function generateOpnameCode(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `OPN-${ymd}-${rand}`;
}

const opnameInclude = {
  items: {
    include: {
      variant: {
        select: { id: true, sku: true, name: true, stock: true },
      },
    },
    orderBy: { id: "asc" as const },
  },
  user: { select: { id: true, username: true } },
} as const;

/** createStockOpname — snapshot stok sistem utk varian terpilih (atau semua). */
export async function createStockOpname(params: {
  businessId: string;
  variantIds?: string[];
  all?: boolean;
  note?: string | null;
  userId?: string | null;
}): Promise<{ ok: boolean; reason?: string; opname?: unknown }> {
  const wantsAll = params.all === true;
  const ids = (params.variantIds ?? []).map((s) => String(s).trim()).filter(Boolean);

  if (!wantsAll && ids.length === 0) {
    return { ok: false, reason: "Pilih minimal satu produk (atau semua)." };
  }

  const variants = await prisma.productVariant.findMany({
    where: {
      masterProduct: { businessId: params.businessId },
      ...(wantsAll ? {} : { id: { in: ids } }),
    },
    select: { id: true, stock: true },
    orderBy: { id: "asc" },
  });
  if (variants.length === 0) {
    return { ok: false, reason: "Tidak ada varian yang cocok." };
  }
  if (!wantsAll && variants.length !== ids.length) {
    return { ok: false, reason: "Sebagian varian tidak ditemukan di brand ini." };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const opname = await prisma.stockOpname.create({
        data: {
          code: generateOpnameCode(),
          status: OPNAME_STATUSES.PENDING,
          note: params.note?.trim() || null,
          userId: params.userId ?? null,
          items: {
            create: variants.map((v) => ({
              id: crypto.randomUUID(),
              variantId: v.id,
              systemStock: v.stock,
              countedStock: null,
            })),
          },
        },
        include: opnameInclude,
      });
      return { ok: true, opname };
    } catch (error) {
      // Bentrok kode (sangat jarang) → coba lagi dgn kode baru.
      const code = (error as Prisma.PrismaClientKnownRequestError)?.code;
      if (code !== "P2002") throw error;
    }
  }
  return { ok: false, reason: "Gagal membuat kode opname unik." };
}

/** Opname harus milik brand peminta (opname dibangun single-brand). */
async function isOpnameOutOfBrand(opnameId: string, businessId: string): Promise<boolean> {
  const items = await prisma.stockOpnameItem.findMany({
    where: { opnameId },
    select: { variant: { select: { masterProduct: { select: { businessId: true } } } } },
  });
  if (items.length === 0) return true;
  return items.some((i) => i.variant.masterProduct.businessId !== businessId);
}

/** recordCount — simpan hasil hitung fisik per varian (boleh bertahap). */
export async function recordOpnameCounts(params: {
  opnameId: string;
  counts: Array<{ variantId: string; countedStock: number }>;
  businessId?: string;
}): Promise<{ ok: boolean; reason?: string; opname?: unknown }> {
  const counts = (params.counts ?? []).filter(
    (c) => typeof c?.variantId === "string" && Number.isFinite(Number(c?.countedStock))
  );
  if (counts.length === 0) {
    return { ok: false, reason: "Tidak ada hasil hitung yang valid." };
  }

  const opname = await prisma.stockOpname.findUnique({ where: { id: params.opnameId } });
  if (!opname) return { ok: false, reason: "Opname tidak ditemukan." };
  if (params.businessId && (await isOpnameOutOfBrand(params.opnameId, params.businessId))) {
    return { ok: false, reason: "Opname tidak ditemukan." };
  }
  if (opname.status === OPNAME_STATUSES.COMPLETED) {
    return { ok: false, reason: "Opname sudah difinalisasi — tidak bisa diubah." };
  }
  if (opname.status === OPNAME_STATUSES.CANCELLED) {
    return { ok: false, reason: "Opname sudah dibatalkan." };
  }

  await prisma.$transaction(async (tx) => {
    for (const c of counts) {
      const counted = Math.floor(Number(c.countedStock));
      if (counted < 0) {
        throw new Error("Hasil hitung tidak boleh negatif.");
      }
      await tx.stockOpnameItem.updateMany({
        // updateMany (bukan update) → varian yang tidak ada di opname ini
        // di-skip diam-diam, bukan error 500.
        where: { opnameId: params.opnameId, variantId: c.variantId },
        data: { countedStock: counted },
      });
    }
    if (opname.status === OPNAME_STATUSES.PENDING) {
      await tx.stockOpname.update({
        where: { id: params.opnameId },
        data: { status: OPNAME_STATUSES.IN_PROGRESS },
      });
    }
  });

  const fresh = await prisma.stockOpname.findUnique({
    where: { id: params.opnameId },
    include: opnameInclude,
  });
  return { ok: true, opname: fresh };
}

/** cancelStockOpname — batal sebelum finalisasi; TIDAK menyentuh stok. */
export async function cancelStockOpname(params: {
  opnameId: string;
  userId?: string | null;
  businessId?: string;
}): Promise<{ ok: boolean; reason?: string; opname?: unknown }> {
  const opname = await prisma.stockOpname.findUnique({ where: { id: params.opnameId } });
  if (!opname) return { ok: false, reason: "Opname tidak ditemukan." };
  if (params.businessId && (await isOpnameOutOfBrand(params.opnameId, params.businessId))) {
    return { ok: false, reason: "Opname tidak ditemukan." };
  }
  if (opname.status === OPNAME_STATUSES.COMPLETED) {
    return { ok: false, reason: "Opname sudah difinalisasi — tidak bisa dibatalkan." };
  }
  if (opname.status === OPNAME_STATUSES.CANCELLED) {
    return { ok: false, reason: "Opname sudah dibatalkan." };
  }

  const fresh = await prisma.stockOpname.update({
    where: { id: params.opnameId },
    data: { status: OPNAME_STATUSES.CANCELLED, cancelledAt: new Date() },
    include: opnameInclude,
  });
  return { ok: true, opname: fresh };
}

/**
 * finalizeStockOpname — koreksi selisih (countedStock vs systemStock) lewat
 * jalur central-stock yang SAMA dgn penyesuaian manual, lalu tutup opname.
 *
 * - Wajib SEMUA item sudah dihitung (hitung fisik parsial = belum siap
 *   finalisasi — koreksi stok dari data setengah hitung adalah resep selisih
 *   baru; trade-off disengaja: lebih ketat, tapi angka yang masuk ledger
 *   dijamin berasal dari hitungan penuh).
 * - Semua koreksi dalam SATU transaksi: ada 1 varian gagal → seluruh koreksi
 *   di-rollback & opname tetap IN_PROGRESS (all-or-nothing, pola TUGAS 1).
 * - Finalisasi ganda bersamaan saling gugur via unique ledger
 *   (reason STOCK_OPNAME + referenceId opname id) → idempoten.
 */
export async function finalizeStockOpname(params: {
  opnameId: string;
  userId?: string | null;
  businessId?: string;
}): Promise<{
  ok: boolean;
  reason?: string;
  opname?: unknown;
  adjusted?: number;
  skipped?: number;
  already?: boolean;
}> {
  const opname = await prisma.stockOpname.findUnique({
    where: { id: params.opnameId },
    include: { items: true },
  });
  if (!opname) return { ok: false, reason: "Opname tidak ditemukan." };
  if (params.businessId && (await isOpnameOutOfBrand(params.opnameId, params.businessId))) {
    return { ok: false, reason: "Opname tidak ditemukan." };
  }
  if (opname.status === OPNAME_STATUSES.COMPLETED) {
    return { ok: false, reason: "Opname sudah difinalisasi." };
  }
  if (opname.status === OPNAME_STATUSES.CANCELLED) {
    return { ok: false, reason: "Opname sudah dibatalkan." };
  }

  const uncounted = opname.items.filter((i) => i.countedStock === null);
  if (uncounted.length > 0) {
    return {
      ok: false,
      reason: `${uncounted.length} produk belum dihitung — lengkapi dulu sebelum finalisasi.`,
    };
  }
  const targetable = opname.items.filter((i) => i.countedStock !== null);
  if (targetable.length === 0) {
    return { ok: false, reason: "Tidak ada item terhitung untuk difinalisasi." };
  }

  let adjusted = 0;
  let skipped = 0;
  let already = false;
  try {
    await prisma.$transaction(async (tx) => {
      for (const item of opname.items) {
        const counted = item.countedStock as number;
        // Selisih dihitung terhadap SNAPSHOT systemStock (bukan stok live).
        const diff = counted - item.systemStock;
        if (diff === 0) {
          skipped++;
          continue;
        }
        const result = await adjustStockAbsoluteInTx(tx, {
          variantId: item.variantId,
          newStock: counted,
          reason: STOCK_REASONS.STOCK_OPNAME,
          referenceId: opname.id,
          note: `Stok opname ${opname.code}: sistem ${item.systemStock} → fisik ${counted}`,
          userId: params.userId ?? null,
        });
        if (!result.ok) {
          throw new Error(`Varian ${item.variantId}: ${result.reason ?? "gagal"}`);
        }
        adjusted++;
      }
      await tx.stockOpname.update({
        where: { id: opname.id },
        data: {
          status: OPNAME_STATUSES.COMPLETED,
          finalizedAt: new Date(),
        },
      });
    });
  } catch (error) {
    if (isDeduplicationFailure(error)) {
      // Finalisasi ganda bersamaan → ledger unique (STOCK_OPNAME, opname.id)
      // menolak; anggap sudah difinalisasi proses lain.
      already = true;
    } else {
      return { ok: false, reason: error instanceof Error ? error.message : "Gagal finalisasi." };
    }
  }

  if (already) {
    const fresh = await prisma.stockOpname.findUnique({
      where: { id: params.opnameId },
      include: opnameInclude,
    });
    return { ok: true, already: true, opname: fresh, adjusted: 0, skipped: 0 };
  }

  // Push stok baru ke semua listing ter-mapping — koreksi fisik global
  // (best-effort, hasilnya tercatat di SyncLog oleh lapisan sync).
  const changed = opname.items.filter(
    (i) => i.countedStock !== null && i.countedStock !== i.systemStock
  );
  for (const item of changed) {
    pushVariantStockToOthers(item.variantId, null).catch((err) =>
      console.error(`[StockOpname] push error varian ${item.variantId}:`, err)
    );
  }

  const fresh = await prisma.stockOpname.findUnique({
    where: { id: params.opnameId },
    include: opnameInclude,
  });
  return { ok: true, opname: fresh, adjusted, skipped };
}

/** List opname dgn ringkasan item + filter status (utk tab & badge). */
export async function listStockOpnames(params: {
  businessId: string;
  status?: string | null;
}): Promise<unknown> {
  const status = params.status && Object.values(OPNAME_STATUSES).includes(params.status as OpnameStatus)
    ? params.status
    : undefined;
  const opnames = await prisma.stockOpname.findMany({
    where: {
      ...(status ? { status } : {}),
      items: { some: { variant: { masterProduct: { businessId: params.businessId } } } },
    },
    include: {
      items: { select: { countedStock: true, systemStock: true } },
      user: { select: { id: true, username: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return opnames.map((o) => ({
    id: o.id,
    code: o.code,
    status: o.status,
    note: o.note,
    startedAt: o.startedAt,
    finalizedAt: o.finalizedAt,
    cancelledAt: o.cancelledAt,
    user: o.user,
    totalItems: o.items.length,
    countedItems: o.items.filter((i) => i.countedStock !== null).length,
    // Selisih dihitung terhadap snapshot systemStock.
    diffItems: o.items.filter((i) => i.countedStock !== null && i.countedStock !== i.systemStock)
      .length,
  }));
}
