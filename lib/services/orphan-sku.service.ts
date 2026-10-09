/**
 * ORPHAN SKU SERVICE — satu sumber kebenaran untuk "channel SKU marketplace
 * yang muncul di order tapi belum ter-mapping ke varian stok pusat".
 *
 * Orphan = OrderItem.variantId NULL (dibiarkan NULL oleh order-sync saat
 * ProductMapping (accountId, channelSku) tidak ditemukan — lihat
 * resolveVariantId di order-sync.service.ts).
 *
 * Dipakai oleh:
 *  - GET /api/inventory/orphan-skus  → deteksi (panel UI bulk-mapping)
 *  - POST /api/inventory/mappings    → buat mapping + backfill historis
 *  - PATCH /api/inventory/mappings/:id (repoint) → backfill historis
 *  - scripts/map-orphan-skus.mts     → cleanup backlog (deprecated wrapper)
 *
 * Prinsip (disetujui owner):
 *  - Sistem CUMA mendeteksi & menandai; keputusan buat master baru vs mapping
 *    ke varian existing tetap di tangan user lewat UI. TIDAK ada auto-create.
 *  - Semua pembuatan varian baru mencatat StockLedger reason INIT (stok awal
 *    0 / yang diminta user) — audit trail tetap utuh, tidak ada UPDATE diam.
 */
import { stockQuantity } from "@/lib/security/input";
import type { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import { STOCK_REASONS, ACTIVE_ORDER_STOCK_STATUSES, deductStockForOrder } from "@/lib/services/central-stock.service";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";

export type OrphanSku = {
  channelSku: string;
  accountId: string;
  accountLabel: string | null;
  platform: string | null;
  qty: number;
  orderCount: number;
  /** Judul listing dari payload platform (contoh terbaru yang punya nama). */
  sampleProductName: string | null;
  /** SKU master (varian) bila OrderItem menyertakan varian — selalu null utk orphan. */
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  /** Bila mapping utk (akun, SKU) SUDAH ada tapi order lama masih orphan →
   *  perbaikannya via repoint (PATCH), bukan bikin mapping baru (409). */
  existingMappingId: string | null;
};

/**
 * Deteksi semua orphan SKU per (account, channelSku), terurut qty terbesar.
 * Hanya order non-CANCELLED yang dihitung — order batal tidak menambah kebutuhan
 * mapping (analytics juga mengecualikan CANCELLED).
 */
export async function findOrphanSkus(businessId: string): Promise<OrphanSku[]> {
  const accounts = await prisma.platformAccount.findMany({
    where: { businessId },
    select: { id: true, label: true, platform: true },
  });
  const perAccount = await Promise.all(accounts.map(async (account) => {
    const rows = await prisma.orderItem.groupBy({
      by: ["channelSku", "orderId"],
      where: {
        variantId: null,
        channelSku: { not: "" },
        order: { accountId: account.id, status: { not: "CANCELLED" } },
      },
      _sum: { qty: true },
    });

    if (rows.length === 0) return [];

    const groups = new Map<string, { channelSku: string; qty: number; orderCount: number }>();
    for (const row of rows) {
      const group = groups.get(row.channelSku) ?? { channelSku: row.channelSku, qty: 0, orderCount: 0 };
      group.qty += row._sum.qty ?? 0;
      group.orderCount += 1;
      groups.set(row.channelSku, group);
    }
    const results = await Promise.all(
      [...groups.values()].map(async (r) => {
        const sample = await prisma.orderItem.findFirst({
          where: {
            channelSku: r.channelSku,
            variantId: null,
            order: { accountId: account.id, status: { not: "CANCELLED" } },
          },
          orderBy: [{ order: { createTime: "desc" } }, { id: "desc" }],
          select: {
            productName: true,
            order: {
              select: {
                accountId: true,
                createTime: true,
                account: { select: { label: true, platform: true } },
              },
            },
          },
        });
        const accountId = account.id;
        const existing = accountId
          ? await prisma.productMapping.findUnique({
              where: { accountId_channelSku: { accountId, channelSku: r.channelSku } },
              select: { id: true },
            })
          : null;
        return {
          channelSku: r.channelSku,
          accountId,
          accountLabel: account.label,
          platform: account.platform,
          qty: r.qty,
          orderCount: r.orderCount,
          sampleProductName: sample?.productName ?? null,
          firstSeenAt: null,
          lastSeenAt: sample?.order.createTime ?? null,
          existingMappingId: existing?.id ?? null,
        } satisfies OrphanSku;
      })
    );

    return results;
  }));
  return perAccount.flat().sort((a, b) => b.qty - a.qty);
}

/** Backfill OrderItem historis yang masih orphan untuk (accountId, channelSku). */
export async function backfillOrderItems(accountId: string, channelSku: string, variantId: string, tx: Prisma.TransactionClient = prisma, aliases: string[] = []) {
  const res = await tx.orderItem.updateMany({
    where: { channelSku: { in: [...new Set([channelSku, ...aliases])] }, variantId: null, order: { accountId } },
    data: { variantId },
  });
  return res.count;
}

export async function reconcileMappedOrders(accountId: string, variantId: string): Promise<string[]> {
  const orders = await prisma.order.findMany({
    where: {
      accountId,
      status: { in: ACTIVE_ORDER_STOCK_STATUSES },
      items: { some: { variantId } },
    },
    select: { id: true, orderNo: true },
  });
  const warnings: string[] = [];
  for (const order of orders) {
    try {
      const effect = await deductStockForOrder(order.id);
      if (!effect.ok) warnings.push(`${order.orderNo}: ${effect.reason ?? "stok belum terpotong"}`);
    } catch (error) {
      warnings.push(`${order.orderNo}: ${error instanceof Error ? error.message : "rekonsiliasi stok gagal"}`);
    }
  }
  return warnings;
}

export type MapToVariantResult =
  | { ok: true; mappingId: string; backfilled: number; stockWarnings: string[] }
  | { ok: false; reason: "variant_already_mapped"; message: string };

/**
 * Mapping channel SKU ke varian EXISTING + backfill historis.
 * Dipanggil POST /api/inventory/mappings (varian existing) dan opsional dari UI panel orphan.
 * Idempotent-friendly: kalau mapping sudah ada utk (accountId, channelSku) →
 * tetap backfill lalu kembalikan mapping yang ada (caller memutuskan 409/200).
 *
 * Constraint schema @@unique([accountId, variantId]): satu varian hanya boleh
 * memegang SATU channel SKU per akun — bila varian sudah dipakai SKU lain,
 * kembalikan ok:false (409 di route), bukan P2002 mentah.
 */
export async function mapOrphanToVariant(params: {
  accountId: string;
  channelSku: string;
  variantId: string;
}): Promise<MapToVariantResult> {
  const existingForVariant = await prisma.productMapping.findFirst({
    where: { accountId: params.accountId, variantId: params.variantId },
    select: { id: true, channelSku: true },
  });
  if (existingForVariant && existingForVariant.channelSku !== params.channelSku) {
    return {
      ok: false,
      reason: "variant_already_mapped",
      message: `Varian ini sudah dipakai channel SKU "${existingForVariant.channelSku}" di toko yang sama. Pilih varian lain, atau lepas mapping lama dulu.`,
    };
  }

  const { mapping, backfilled } = await prisma.$transaction(async (tx) => {
    const mapping = await tx.productMapping.upsert({
      where: { accountId_channelSku: { accountId: params.accountId, channelSku: params.channelSku } },
      create: { id: crypto.randomUUID(), accountId: params.accountId, channelSku: params.channelSku, variantId: params.variantId, updatedAt: new Date() },
      update: { variantId: params.variantId },
      select: { id: true },
    });
    const backfilled = await backfillOrderItems(params.accountId, params.channelSku, params.variantId, tx);
    return { mapping, backfilled };
  });
  const stockWarnings = await reconcileMappedOrders(params.accountId, params.variantId);
  return { ok: true, mappingId: mapping.id, backfilled, stockWarnings };
}

export type MapToNewMasterResult = {
  masterProductId: string;
  variantId: string;
  mappingId: string;
  backfilled: number;
  stockWarnings: string[];
};

/**
 * Buat MasterProduct + varian baru + mapping + backfill historis.
 * Persis alur cleanup backlog (yang di-approve owner), diparameterisasi.
 * Stock awal varian = `stock` (default 0) dan SELALU dicatat ke StockLedger
 * reason INIT supaya ada titik nol audit.
 */
export async function mapOrphanToNewMaster(params: {
  businessId: string;
  accountId: string;
  channelSku: string;
  newProductName?: string;
  sku?: string;
  category?: string;
  stock?: number;
  safetyStock?: number;
  platformTitle?: string;
}): Promise<MapToNewMasterResult> {
  const stock = stockQuantity.parse(params.stock ?? 0);
  const safetyStock = stockQuantity.parse(params.safetyStock ?? 0);
  const sku = params.sku?.trim() || params.channelSku;
  const settings = await getCachedInventorySettings(params.businessId);

  const existingForSku = await prisma.productMapping.findUnique({
    where: { accountId_channelSku: { accountId: params.accountId, channelSku: params.channelSku } },
    select: { id: true },
  });
  if (existingForSku) {
    throw new Error(
      `SKU "${params.channelSku}" sudah punya mapping di toko ini — gunakan "Ganti Varian" (repoint), bukan buat master baru.`
    );
  }

  const { masterId, variantId, mappingId, backfilled } = await prisma.$transaction(async (tx) => {
    const product = await tx.masterProduct.create({
      data: {
        name: params.newProductName?.trim() || params.channelSku,
        businessId: params.businessId,
        ...(params.category?.trim() ? { category: params.category.trim() } : {}),
        threshold: settings.lowStockDefaultThreshold,
        productVariant: {
          create: [{ sku, stock, safetyStock }],
        },
      },
      select: { id: true, productVariant: { select: { id: true } } },
    });
    const variant = product.productVariant[0];
    if (!variant) throw new Error("Gagal membuat varian baru.");

    const mapping = await tx.productMapping.create({
      data: {
        id: crypto.randomUUID(),
        accountId: params.accountId,
        channelSku: params.channelSku,
        variantId: variant.id,
        ...(params.platformTitle ? { platformTitle: params.platformTitle } : {}),
        updatedAt: new Date(),
      },
      select: { id: true },
    });

    await tx.stockLedger.create({
      data: {
        id: crypto.randomUUID(),
        variantId: variant.id,
        changeQty: stock,
        reason: STOCK_REASONS.INIT,
        note: `Stok awal varian ${sku}`,
        stockAfter: stock,
      },
    });

    const backfilled = await backfillOrderItems(params.accountId, params.channelSku, variant.id, tx);
    return { masterId: product.id, variantId: variant.id, mappingId: mapping.id, backfilled };
  });
  const stockWarnings = await reconcileMappedOrders(params.accountId, variantId);
  return { masterProductId: masterId, variantId, mappingId, backfilled, stockWarnings };
}
