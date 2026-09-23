import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import {
  pushVariantStockToOthers,
  STOCK_REASONS,
} from "@/lib/services/central-stock.service";

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/**
 * PATCH /api/inventory/variant/:id — edit inline dari halaman Inventori.
 * Body: { safetyStock?: number, minStock?: number | null, notifyEmail?: boolean }
 * - minStock null = reset ke "ikut threshold produk induk".
 * - safetyStock mengubah effectiveStock → push angka baru ke marketplace
 *   (fire-and-forget, mengikuti adjustStockManually). minStock/notifyEmail
 *   tidak memengaruhi angka tayang → tanpa push.
 */
export const PATCH = withAuth(async (req: AuthenticatedRequest, ctx) => {
  const params = (await ctx?.params) as { id?: string } | undefined;
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "Variant id wajib diisi." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  const data: { safetyStock?: number; minStock?: number | null; notifyEmail?: boolean } = {};
  if ("safetyStock" in body) {
    if (!isNonNegInt(body.safetyStock)) {
      return NextResponse.json({ error: "safetyStock harus bilangan bulat >= 0." }, { status: 400 });
    }
    data.safetyStock = body.safetyStock;
  }
  if ("minStock" in body) {
    if (body.minStock !== null && !isNonNegInt(body.minStock)) {
      return NextResponse.json({ error: "minStock harus bilangan bulat >= 0 atau null." }, { status: 400 });
    }
    data.minStock = body.minStock;
  }
  if ("notifyEmail" in body) {
    if (typeof body.notifyEmail !== "boolean") {
      return NextResponse.json({ error: "notifyEmail harus boolean." }, { status: 400 });
    }
    data.notifyEmail = body.notifyEmail;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Tidak ada field yang diubah." }, { status: 400 });
  }

  const before = await prisma.productVariant.findUnique({
    where: { id },
    select: {
      id: true,
      sku: true,
      stock: true,
      safetyStock: true,
      masterProduct: { select: { businessId: true } },
    },
  });
  if (!before) {
    return NextResponse.json({ error: "Varian tidak ditemukan." }, { status: 404 });
  }
  try {
    assertSameBrand(before.masterProduct.businessId, req.businessId);
  } catch {
    return NextResponse.json({ error: "Varian tidak ditemukan." }, { status: 404 });
  }

  const updated = await prisma.productVariant.update({
    where: { id },
    data,
    select: {
      id: true,
      sku: true,
      stock: true,
      safetyStock: true,
      minStock: true,
      notifyEmail: true,
      masterProduct: { select: { threshold: true } },
    },
  });

  if (data.safetyStock !== undefined && data.safetyStock !== before.safetyStock) {
    // Audit trail: siapa/kapan/berapa (stok fisik tidak berubah → changeQty 0).
    // referenceId unik per perubahan (unique reason+referenceId+variantId).
    await prisma.stockLedger.create({
      data: {
        id: crypto.randomUUID(),
        variantId: id,
        changeQty: 0,
        reason: STOCK_REASONS.SAFETY_STOCK_CHANGE,
        referenceId: `safety-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        note: `Cadangan ${before.safetyStock} → ${data.safetyStock}`,
        stockAfter: before.stock,
        userId: req.user.id,
      },
    });
    pushVariantStockToOthers(id, null).catch((err) =>
      console.error(`[Inventory] push error varian ${id}:`, err)
    );
  }

  return NextResponse.json({
    variantId: updated.id,
    sku: updated.sku,
    safetyStock: updated.safetyStock,
    minStock: updated.minStock,
    minStockResolved: updated.minStock ?? updated.masterProduct.threshold,
    notifyEmail: updated.notifyEmail,
  });
});
