import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { backfillOrderItems, reconcileMappedOrders } from "@/lib/services/orphan-sku.service";

/**
 * PATCH /api/inventory/mappings/:id  — "repoint" mapping ke varian
 * lain. Aman tanpa migrasi data lain: hanya mengubah FK variantId.
 * DELETE /api/inventory/mappings/:id — hapus mapping (listing jadi berdiri
 * sendiri, stoknya tidak lagi digabung dengan varian manapun).
 */
export const PATCH = withAuth(
  async (req: AuthenticatedRequest, ctx?: { params: Promise<{ id?: string }> }) => {
    const { id } = (await ctx?.params) ?? {};
    const parsed = z.object({ variantId: z.string().trim().min(1).max(200) }).safeParse(await req.json().catch(() => ({})));
    const variantId = parsed.success ? parsed.data.variantId : undefined;
    if (!id || !variantId) {
      return NextResponse.json({ error: "Varian target wajib diisi." }, { status: 400 });
    }

    const mapping = await prisma.productMapping.findUnique({
      where: { id },
      include: { account: { select: { businessId: true } } },
    });
    if (!mapping) {
      return NextResponse.json({ error: "Mapping tidak ditemukan." }, { status: 404 });
    }
    try {
      assertSameBrand(mapping.account.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Mapping tidak ditemukan." }, { status: 404 });
    }

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

    try {
    const { updated, backfilled } = await prisma.$transaction(async (tx) => {
    const updated = await tx.productMapping.update({
      where: { id },
      data: { variantId },
      include: {
        account: { select: { id: true, platform: true, label: true } },
        variant: {
          select: {
            id: true,
            sku: true,
            stock: true,
            safetyStock: true,
            masterProduct: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Repoint = keputusan "SKU ini sebenarnya milik varian X" — backfill juga
    // OrderItem historis yang masih orphan utk pasangan (akun, SKU) ini.
    const backfilled = await backfillOrderItems(mapping.accountId, mapping.channelSku, variantId, tx);
    return { updated, backfilled };
    });
    const stockWarnings = await reconcileMappedOrders(mapping.accountId, variantId);

    return NextResponse.json({ ok: true, mapping: updated, backfilled, stockWarnings });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json({ error: "Varian ini sudah terhubung ke SKU lain di toko yang sama." }, { status: 409 });
      }
      throw error;
    }
  }
);

export const DELETE = withAuth(
  async (req: AuthenticatedRequest, ctx?: { params: Promise<{ id?: string }> }) => {
    const { id } = (await ctx?.params) ?? {};
    if (!id) return NextResponse.json({ error: "ID mapping wajib." }, { status: 400 });

    const mapping = await prisma.productMapping.findUnique({
      where: { id },
      include: { account: { select: { businessId: true } } },
    });
    if (!mapping) {
      return NextResponse.json({ error: "Mapping tidak ditemukan." }, { status: 404 });
    }
    try {
      assertSameBrand(mapping.account.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Mapping tidak ditemukan." }, { status: 404 });
    }

    await prisma.productMapping.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }
);
