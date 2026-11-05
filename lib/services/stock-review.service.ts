import { prisma } from "@/lib/db/prisma";
import { stockReviewReason } from "@/lib/services/stock-review.policy";

export async function getStockReviews(businessId: string, variantIds?: string[]) {
  const variants = await prisma.productVariant.findMany({
    where: { masterProduct: { businessId, isActive: true }, isArchived: false,
      ...(variantIds ? { id: { in: variantIds } } : {}) },
    select: { id: true, sku: true, stock: true, masterProduct: { select: { name: true } },
      stockLedger: { where: { reason: { in: ["INIT", "INITIAL_STOCK"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1,
        select: { stockAfter: true, reason: true } } },
  });
  return variants.flatMap((variant) => {
    const initial = variant.stockLedger[0];
    const reasons = [...new Set([stockReviewReason(variant.stock), initial ? stockReviewReason(initial.stockAfter) : null].filter((reason): reason is string => reason !== null))];
    return reasons.length ? [{ variantId: variant.id, sku: variant.sku, name: variant.masterProduct.name, stock: variant.stock,
      initialStock: initial?.stockAfter ?? null, initialReason: initial?.reason ?? null, reasons }] : [];
  });
}
