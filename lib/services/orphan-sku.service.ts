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
import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import { STOCK_REASONS } from "@/lib/services/central-stock.service";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";
import { businessWhere } from "@/lib/services/business-scope.service";

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
  const rows = await prisma.orderItem.groupBy({
    by: ["channelSku"],
    where: {
      variantId: null,
      channelSku: { not: "" },
      order: { status: { not: "CANCELLED" }, ...businessWhere.order(businessId) },
    },
    _sum: { qty: true },
    _count: { orderId: true },
    _min: { id: true },
  });

  if (rows.length === 0) return [];

  // groupBy tidak bisa mengambil kolom relasi (productName/order) → ambil
  // sample + waktu via query kecil per grup (jumlah grup kecil: SKU unik orphan).
  const results = await Promise.all(
    rows.map(async (r) => {
      const sample = await prisma.orderItem.findFirst({
        where: {
          channelSku: r.channelSku,
          variantId: null,
          order: { status: { not: "CANCELLED" }, ...businessWhere.order(businessId) },
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
      const accountId = sample?.order.accountId ?? "";
      const existing = accountId
        ? await prisma.productMapping.findUnique({
            where: { accountId_channelSku: { accountId, channelSku: r.channelSku } },
            select: { id: true },
          })
        : null;
      return {
        channelSku: r.channelSku,
        accountId: sample?.order.accountId ?? "",
        accountLabel: sample?.order.account?.label ?? null,
        platform: sample?.order.account?.platform ?? null,
        qty: r._sum.qty ?? 0,
        orderCount: r._count.orderId,
        sampleProductName: sample?.productName ?? null,
        firstSeenAt: null,
        lastSeenAt: sample?.order.createTime ?? null,
        existingMappingId: existing?.id ?? null,
      } satisfies OrphanSku;
    })
  );

  return results.sort((a, b) => b.qty - a.qty);
}

/** Backfill OrderItem historis yang masih orphan untuk (accountId, channelSku). */
export async function backfillOrderItems(accountId: string, channelSku: string, variantId: string) {
  const res = await prisma.orderItem.updateMany({
    where: { channelSku, variantId: null, order: { accountId } },
    data: { variantId },
  });
  return res.count;
}

export type MapToVariantResult =
  | { ok: true; mappingId: string; backfilled: number }
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

  const mapping = await prisma.productMapping.upsert({
    where: { accountId_channelSku: { accountId: params.accountId, channelSku: params.channelSku } },
    create: { id: crypto.randomUUID(), accountId: params.accountId, channelSku: params.channelSku, variantId: params.variantId, updatedAt: new Date() },
    update: { variantId: params.variantId },
    select: { id: true },
  });
  const backfilled = await backfillOrderItems(params.accountId, params.channelSku, params.variantId);
  return { ok: true, mappingId: mapping.id, backfilled };
}

export type MapToNewMasterResult = {
  masterProductId: string;
  variantId: string;
  mappingId: string;
  backfilled: number;
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
  const stock = Math.max(0, Math.floor(params.stock ?? 0));
  const safetyStock = Math.max(0, Math.floor(params.safetyStock ?? 0));
  const sku = params.sku?.trim() || params.channelSku;
  const settings = await getCachedInventorySettings();

  const existingForSku = await prisma.productMapping.findUnique({
    where: { accountId_channelSku: { accountId: params.accountId, channelSku: params.channelSku } },
    select: { id: true },
  });
  if (existingForSku) {
    throw new Error(
      `SKU "${params.channelSku}" sudah punya mapping di toko ini — gunakan "Ganti Varian" (repoint), bukan buat master baru.`
    );
  }

  const { masterId, variantId, mappingId } = await prisma.$transaction(async (tx) => {
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

    return { masterId: product.id, variantId: variant.id, mappingId: mapping.id };
  });

  const backfilled = await backfillOrderItems(params.accountId, params.channelSku, variantId);
  return { masterProductId: masterId, variantId, mappingId, backfilled };
}
