import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { withAuth } from "@/lib/utils/api";
import { prisma } from "@/lib/db/prisma";
import { InventoryConflict } from "@/lib/services/master-stock-mutation.service";
import { lockSellerSkus } from "@/lib/services/master-sku.service";
import { UNFULFILLED_ORDER_STATUSES } from "@/lib/services/master-stock.service";
import { dispatchInventoryAfterResponse } from "@/lib/services/inventory-dispatch.service";

export const GET = withAuth(async (req) => {
  const reviews = await prisma.skuMappingReview.findMany({ where: { businessId: req.businessId, status: "PENDING" },
    orderBy: { createdAt: "asc" }, take: 100,
    select: { id: true, sellerSku: true, reason: true, candidateIds: true, mappingId: true } });
  const ids = [...new Set(reviews.flatMap((review) => Array.isArray(review.candidateIds)
    ? review.candidateIds.filter((value): value is string => typeof value === "string") : []))];
  const candidates = await prisma.productVariant.findMany({ where: { id: { in: ids }, masterProduct: { businessId: req.businessId } },
    select: { id: true, sku: true, stock: true, safetyStock: true, masterProduct: { select: { name: true } } } });
  const total = await prisma.skuMappingReview.count({ where: { businessId: req.businessId, status: "PENDING" } });
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  return NextResponse.json({ reviews: reviews.map((review) => ({ ...review,
    candidateIds: Array.isArray(review.candidateIds) ? review.candidateIds.filter((id) => typeof id === "string" && allowed.has(id)) : [],
  })), candidates, total });
});

export const POST = withAuth(async (req) => {
  const input = z.object({ reviewId: z.string().min(1), variantId: z.string().min(1), acknowledge: z.literal(true) }).strict().parse(await req.json());
  try {
    const result = await prisma.$transaction(async (tx) => {
      const review = await tx.skuMappingReview.findFirst({ where: { id: input.reviewId, businessId: req.businessId, status: "PENDING" } });
      const variant = await tx.productVariant.findFirst({ where: { id: input.variantId, masterProduct: { businessId: req.businessId } } });
      if (!review || !variant) throw new InventoryConflict("Tinjauan atau SKU tidak ditemukan.", 404);
      await lockSellerSkus(tx, req.businessId, [review.sellerSku]);
      const pendingReview = await tx.skuMappingReview.findFirst({ where: { id: review.id, businessId: req.businessId, status: "PENDING" } });
      if (!pendingReview) throw new InventoryConflict("Tinjauan ini sudah diselesaikan pengguna lain. Perbarui antrean.");
      const candidateIds = Array.isArray(pendingReview.candidateIds) ? pendingReview.candidateIds.filter((value): value is string => typeof value === "string") : [];
      if (!candidateIds.includes(variant.id)) throw new InventoryConflict("Pilih salah satu kandidat SKU master yang ditampilkan.", 400);
      const movingIds = candidateIds.filter((id) => id !== variant.id);
      const activeOrders = await tx.orderItem.count({ where: { variantId: { in: movingIds }, variant: { masterProduct: { businessId: req.businessId } },
        order: { importOnly: false, status: { in: UNFULFILLED_ORDER_STATUSES }, account: { businessId: req.businessId } } } });
      if (activeOrders) throw new InventoryConflict("SKU sumber masih memiliki pesanan aktif. Selesaikan peninjauan pesanan sebelum menyatukan mapping.");
      const targets = await tx.productMapping.findMany({ where: { account: { businessId: req.businessId },
        ...(review.mappingId ? { id: review.mappingId } : { variantId: { in: candidateIds } }) }, select: { id: true, variantId: true } });
      for (const mapping of targets) await tx.productMapping.update({ where: { id: mapping.id }, data: { variantId: variant.id } });
      await tx.masterSkuKey.upsert({ where: { businessId_sellerSku: { businessId: req.businessId, sellerSku: review.sellerSku } },
        create: { businessId: req.businessId, sellerSku: review.sellerSku, variantId: variant.id }, update: { variantId: variant.id } });
      await tx.skuMappingReview.update({ where: { id: review.id }, data: { status: "RESOLVED" } });
      for (const id of movingIds) {
        const linked = await tx.productMapping.count({ where: { variantId: id, account: { businessId: req.businessId } } });
        if (!linked) await tx.productVariant.updateMany({ where: { id, masterProduct: { businessId: req.businessId } }, data: { isArchived: true } });
      }
      await tx.stockLedger.create({ data: { id: crypto.randomUUID(), variantId: variant.id, reason: "SKU_MAPPING_REVIEW", changeQty: 0,
        stockAfter: variant.stock, referenceId: review.id, userId: req.user.id,
        note: `Pilih stok acuan SKU ${review.sellerSku}; stok kandidat lain tidak dijumlahkan. ${targets.length} listing dihubungkan.` } });
      await tx.stockOutbox.create({ data: { id: crypto.randomUUID(), businessId: req.businessId, variantId: variant.id, eventKey: `review:${review.id}` } });
      return { mappings: targets.length };
    }, { timeout: 60_000 });
    dispatchInventoryAfterResponse(req.businessId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof InventoryConflict) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});
