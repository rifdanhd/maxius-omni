import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { STOCK_REASONS } from "@/lib/services/central-stock.service";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";
import { backfillOrderItems } from "@/lib/services/orphan-sku.service";

const mappingInclude = {
  account: { select: { id: true, platform: true, label: true } },
  variant: {
    select: {
      id: true,
      sku: true,
      stock: true,
      safetyStock: true,
      masterProduct: { select: { id: true, name: true, threshold: true } },
    },
  },
} as const;

export const GET = withAuth(async (req) => {
  const mappings = await prisma.productMapping.findMany({
    where: { account: { businessId: req.businessId } },
    include: mappingInclude,
    orderBy: [{ variant: { masterProduct: { name: "asc" } } }, { variant: { sku: "asc" } }],
  });
  return NextResponse.json({ mappings });
});

/**
 * POST /api/inventory/mappings
 * Buat mapping listing (account + channelSku) ke varian stok pusat.
 * - `variantId` terisi → pakai varian existing.
 * - `variantId` kosong + `masterProductId` terisi → buat varian BARU di bawah
 *   master existing (utk SKU ke-2 dst. dari produk marketplace yang sama).
 * - keduanya kosong → buat MasterProduct + ProductVariant baru dulu
 *   (nama produk & sku bisa disediakan; fallback pakai channelSku).
 */
export const POST = withAuth(async (req) => {
  const body = (await req.json().catch(() => ({}))) as {
    accountId?: string;
    channelSku?: string;
    variantId?: string;
    masterProductId?: string;
    newProductName?: string;
    sku?: string;
    stock?: number;
    safetyStock?: number;
    price?: number;
    imageUrl?: string;
  };

  const accountId = body.accountId?.trim();
  const channelSku = body.channelSku?.trim();
  if (!accountId || !channelSku) {
    return NextResponse.json({ error: "Toko dan channel SKU wajib diisi." }, { status: 400 });
  }
  if (!body.variantId && !channelSku) {
    return NextResponse.json({ error: "Varian atau SKU baru wajib diisi." }, { status: 400 });
  }

  const account = await prisma.platformAccount.findUnique({ where: { id: accountId } });
  if (!account) return NextResponse.json({ error: "Toko tidak ditemukan." }, { status: 400 });
  try {
    assertSameBrand(account.businessId, req.businessId);
  } catch {
    return NextResponse.json({ error: "Toko tidak ditemukan." }, { status: 400 });
  }

  const newStock = Number.isFinite(Number(body.stock)) ? Math.max(0, Number(body.stock)) : 0;
  const safetyStock = Number.isFinite(Number(body.safetyStock))
    ? Math.max(0, Number(body.safetyStock))
    : 0;
  const newPrice = Number.isFinite(Number(body.price)) && Number(body.price) >= 0
    ? Number(body.price)
    : null;
  const newImageUrl = typeof body.imageUrl === "string" && body.imageUrl.trim()
    ? body.imageUrl.trim()
    : null;

  let variantId = body.variantId;

  if (variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { masterProduct: { select: { businessId: true } } },
    });
    if (!variant) {
      return NextResponse.json({ error: "Varian target tidak ditemukan." }, { status: 400 });
    }
    try {
      assertSameBrand(variant.masterProduct.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Varian target tidak ditemukan." }, { status: 400 });
    }
  } else if (body.masterProductId?.trim()) {
    // Varian baru di bawah master existing.
    const master = await prisma.masterProduct.findUnique({
      where: { id: body.masterProductId.trim() },
    });
    if (!master) {
      return NextResponse.json({ error: "Produk master tidak ditemukan." }, { status: 400 });
    }
    try {
      assertSameBrand(master.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Produk master tidak ditemukan." }, { status: 400 });
    }
    const created = await prisma.productVariant.create({
      data: {
        sku: body.sku?.trim() || channelSku,
        stock: newStock,
        safetyStock,
        ...(newPrice !== null ? { price: newPrice, priceUpdatedAt: new Date() } : {}),
        masterProductId: master.id,
      },
    });
    variantId = created.id;

    await prisma.stockLedger.create({
      data: {
        variantId,
        changeQty: newStock,
        reason: STOCK_REASONS.INIT,
        note: `Stok awal varian ${created.sku}`,
        stockAfter: newStock,
      },
    });
  } else {
    // Buat produk + varian baru sekaligus, lalu mapping di bawah.
    // Ambang awal produk baru = setting global Pengaturan Inventori
    // (produk existing tetap pakai threshold per-produk masing-masing).
    const settings = await getCachedInventorySettings();
    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.masterProduct.create({
        data: {
          name: body.newProductName?.trim() || channelSku,
          businessId: req.businessId,
          threshold: settings.lowStockDefaultThreshold,
          ...(newImageUrl ? { imageUrl: newImageUrl } : {}),
        },
      });
      const variant = await tx.productVariant.create({
        data: {
          sku: body.sku?.trim() || channelSku,
          stock: newStock,
          safetyStock,
          ...(newPrice !== null ? { price: newPrice, priceUpdatedAt: new Date() } : {}),
          masterProductId: product.id,
        },
      });
      if (newImageUrl) {
        await tx.productImage.create({
          data: { masterProductId: product.id, url: newImageUrl, isCover: true, order: 0 },
        });
      }
      return variant;
    });
    variantId = created.id;

    // Catat stok awal sebagai titik nol audit.
    await prisma.stockLedger.create({
      data: {
        variantId,
        changeQty: newStock,
        reason: STOCK_REASONS.INIT,
        note: `Stok awal varian ${created.sku}`,
        stockAfter: newStock,
      },
    });
  }

  try {
    const mapping = await prisma.productMapping.create({
      data: { accountId, channelSku, variantId },
      include: mappingInclude,
    });
    // Backfill OrderItem historis yang masih orphan utk SKU ini — analytics
    // (topProducts) langsung menampilkan produk master, bukan SKU mentah.
    const backfilled = await backfillOrderItems(accountId, channelSku, variantId);
    return NextResponse.json({ ok: true, mapping, backfilled }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: `SKU "${channelSku}" di toko ini sudah ter-mapping ke varian lain. Buka mapping tsb lalu "Ganti Varian" bila perlu.` },
        { status: 409 }
      );
    }
    throw e;
  }
});