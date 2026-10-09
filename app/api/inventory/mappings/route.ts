import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { STOCK_REASONS } from "@/lib/services/central-stock.service";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";
import { backfillOrderItems, reconcileMappedOrders } from "@/lib/services/orphan-sku.service";
import { stockQuantity } from "@/lib/security/input";

const mappingSchema = z.object({
  accountId: z.string().trim().min(1).max(200),
  channelSku: z.string().trim().min(1).max(200),
  channelSkuAliases: z.array(z.string().trim().min(1).max(200)).max(2).default([]),
  variantId: z.string().trim().min(1).max(200).optional(),
  masterProductId: z.string().trim().min(1).max(200).optional(),
  newProductName: z.string().max(2000).optional(),
  sku: z.string().max(200).optional(),
  stock: stockQuantity.optional(),
  safetyStock: stockQuantity.optional(),
  price: z.number().nonnegative().optional(),
  imageUrl: z.string().max(2000).optional(),
});

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
  const parsed = mappingSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Data mapping tidak valid. Pilih toko, SKU, dan varian yang benar." }, { status: 400 });
  const body = parsed.data;

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

  const newStock = stockQuantity.parse(body.stock ?? 0);
  const safetyStock = stockQuantity.parse(body.safetyStock ?? 0);
  const newPrice = Number.isFinite(Number(body.price)) && Number(body.price) >= 0
    ? Number(body.price)
    : null;
  const newImageUrl = typeof body.imageUrl === "string" && body.imageUrl.trim()
    ? body.imageUrl.trim()
    : null;

  const settings = await getCachedInventorySettings(req.businessId);
  try {
  const result = await prisma.$transaction(async (tx) => {
  let variantId = body.variantId;
  const existingForChannel = await tx.productMapping.findUnique({ where: { accountId_channelSku: { accountId, channelSku } } });
  if (existingForChannel?.variantId && existingForChannel.variantId !== variantId) {
    return NextResponse.json({ error: "SKU ini sudah terhubung ke varian lain di toko yang sama. Gunakan Ganti Varian pada mapping yang ada." }, { status: 409 });
  }
  const aliasMapping = await tx.productMapping.findFirst({
    where: { accountId, channelSku: { in: body.channelSkuAliases }, variantId: { not: null } },
  });
  if (aliasMapping && aliasMapping.variantId !== variantId) {
    return NextResponse.json({ error: "Seller SKU sudah terhubung ke varian lain di toko ini. Periksa mapping yang ada." }, { status: 409 });
  }

  if (variantId) {
    const variant = await tx.productVariant.findUnique({
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
    const master = await tx.masterProduct.findUnique({
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
    const created = await tx.productVariant.create({
      data: {
        sku: body.sku?.trim() || channelSku,
        stock: newStock,
        safetyStock,
        ...(newPrice !== null ? { price: newPrice, priceUpdatedAt: new Date() } : {}),
        masterProductId: master.id,
      },
    });
    variantId = created.id;

    await tx.stockLedger.create({
      data: {
        id: crypto.randomUUID(),
        variantId,
        changeQty: newStock,
        reason: STOCK_REASONS.INIT,
        note: `Stok awal varian ${created.sku}`,
        stockAfter: newStock,
      },
    });
  } else {
    // Buat produk + varian baru sekaligus, lalu mapping di bawah.
    // Ambang awal produk baru = setting Pengaturan Inventori brand aktif
    // (produk existing tetap pakai threshold per-produk masing-masing).
    const created = await (async () => {
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
          data: { id: crypto.randomUUID(), updatedAt: new Date(), masterProductId: product.id, url: newImageUrl, isCover: true, order: 0 },
        });
      }
      return variant;
    })();
    variantId = created.id;

    // Catat stok awal sebagai titik nol audit.
    await tx.stockLedger.create({
      data: {
        id: crypto.randomUUID(),
        variantId,
        changeQty: newStock,
        reason: STOCK_REASONS.INIT,
        note: `Stok awal varian ${created.sku}`,
        stockAfter: newStock,
      },
    });
  }

    const existingMapping = existingForChannel ?? aliasMapping;
    const mapping = existingMapping
      ? await tx.productMapping.update({ where: { id: existingMapping.id }, data: { channelSku, variantId }, include: mappingInclude })
      : await tx.productMapping.create({
      data: { id: crypto.randomUUID(), accountId, channelSku, variantId, updatedAt: new Date() },
      include: mappingInclude,
    });
    // Backfill OrderItem historis yang masih orphan utk SKU ini — analytics
    // (topProducts) langsung menampilkan produk master, bukan SKU mentah.
    const backfilled = await backfillOrderItems(accountId, channelSku, variantId, tx, body.channelSkuAliases);
    return { mapping, backfilled, variantId };
  });
  if (result instanceof Response) return result;
  const stockWarnings = await reconcileMappedOrders(accountId, result.variantId);
  return NextResponse.json({ ok: true, mapping: result.mapping, backfilled: result.backfilled, stockWarnings }, { status: 201 });
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
