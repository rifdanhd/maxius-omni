import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { backfillOrderItems } from "@/lib/services/orphan-sku.service";

/**
 * PATCH /api/inventory/mappings/:id  — "repoint" mapping ke varian
 * lain. Aman tanpa migrasi data lain: hanya mengubah FK variantId.
 * DELETE /api/inventory/mappings/:id — hapus mapping (listing jadi berdiri
 * sendiri, stoknya tidak lagi digabung dengan varian manapun).
 */
export const PATCH = withAuth(
  async (req: AuthenticatedRequest, ctx?: { params: Promise<{ id?: string }> }) => {
    const { id } = (await ctx?.params) ?? {};
    const body = (await req.json().catch(() => ({}))) as { variantId?: string };

    const variantId = body.variantId?.trim();
    if (!id || !variantId) {
      return NextResponse.json({ error: "Varian target wajib diisi." }, { status: 400 });
    }

    const mapping = await prisma.productMapping.findUnique({ where: { id } });
    if (!mapping) {
      return NextResponse.json({ error: "Mapping tidak ditemukan." }, { status: 404 });
    }

    const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) {
      return NextResponse.json({ error: "Varian target tidak ditemukan." }, { status: 400 });
    }

    const updated = await prisma.productMapping.update({
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
    const backfilled = await backfillOrderItems(mapping.accountId, mapping.channelSku, variantId);

    return NextResponse.json({ ok: true, mapping: updated, backfilled });
  }
);

export const DELETE = withAuth(
  async (_req: AuthenticatedRequest, ctx?: { params: Promise<{ id?: string }> }) => {
    const { id } = (await ctx?.params) ?? {};
    if (!id) return NextResponse.json({ error: "ID mapping wajib." }, { status: 400 });

    const mapping = await prisma.productMapping.findUnique({ where: { id } });
    if (!mapping) {
      return NextResponse.json({ error: "Mapping tidak ditemukan." }, { status: 404 });
    }

    await prisma.productMapping.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }
);