import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { STOCK_REASONS } from "@/lib/services/central-stock.service";

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

export const GET = withAuth(async () => {
  const mappings = await prisma.productMapping.findMany({
    include: mappingInclude,
    orderBy: [{ variant: { masterProduct: { name: "asc" } } }, { variant: { sku: "asc" } }],
  });
  return NextResponse.json({ mappings });
});

/**
 * POST /api/inventory/mappings
 * Buat mapping listing (account + channelSku) ke varian stok pusat.
 * Kalau `variantId` kosong, buat MasterProduct + ProductVariant baru dulu
 * (nama produk & sku bisa disediakan; fallback pakai channelSku).
 */
export const POST = withAuth(async (req) => {
  const body = (await req.json().catch(() => ({}))) as {
    accountId?: string;
    channelSku?: string;
    variantId?: string;
    newProductName?: string;
    sku?: string;
    stock?: number;
    safetyStock?: number;
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

  const newStock = Number.isFinite(Number(body.stock)) ? Math.max(0, Number(body.stock)) : 0;
  const safetyStock = Number.isFinite(Number(body.safetyStock))
    ? Math.max(0, Number(body.safetyStock))
    : 0;

  let variantId = body.variantId;

  if (variantId) {
    const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) {
      return NextResponse.json({ error: "Varian target tidak ditemukan." }, { status: 400 });
    }
  } else {
    // Buat produk + varian baru sekaligus, lalu mapping di bawah.
    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.masterProduct.create({
        data: { name: body.newProductName?.trim() || channelSku },
      });
      const variant = await tx.productVariant.create({
        data: {
          sku: body.sku?.trim() || channelSku,
          stock: newStock,
          safetyStock,
          masterProductId: product.id,
        },
      });
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
    return NextResponse.json({ ok: true, mapping }, { status: 201 });
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