import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";

export async function lockSellerSkus(tx: Prisma.TransactionClient, businessId: string, skus: string[]) {
  for (const sku of [...new Set(skus.map((value) => value.trim()).filter(Boolean))].sort()) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${businessId + ":" + sku}, 0))`;
  }
}

export async function findMasterSku(tx: Prisma.TransactionClient, businessId: string, sellerSku: string) {
  // First check existing masterSkuKey to preserve mapping
  const key = await tx.masterSkuKey.findUnique({ where: { businessId_sellerSku: { businessId, sellerSku } },
    include: { variant: { select: { id: true, isArchived: true, masterProduct: { select: { businessId: true } } } } } });
  
  // If key exists and variant is valid, return it regardless of archived status
  if (key?.variant && key.variant.masterProduct.businessId === businessId) {
    // Check if variant is archived and if we should resurrect it
    if (key.variant.isArchived) {
      // Resurrect archived variant - unarchive it
      await tx.productVariant.update({ where: { id: key.variant.id }, data: { isArchived: false } });
    }
    return { variantId: key.variant.id, ambiguous: false, candidates: [key.variant.id] };
  }
  
  // Search for active (non-archived) variants first
  const candidates = await tx.productVariant.findMany({
    where: { sku: sellerSku, isArchived: false, masterProduct: { businessId } }, select: { id: true }, take: 20,
  });
  
  // If found exactly one active variant, use it
  if (candidates.length === 1 && (!key || key.variantId !== null)) {
    await tx.masterSkuKey.upsert({ where: { businessId_sellerSku: { businessId, sellerSku } },
      create: { businessId, sellerSku, variantId: candidates[0].id }, update: { variantId: candidates[0].id } });
    return { variantId: candidates[0].id, ambiguous: false, candidates: [candidates[0].id] };
  }
  
  // If no active variant found, check if there are archived variants that could be resurrected
  const archivedCandidates = await tx.productVariant.findMany({
    where: { sku: sellerSku, isArchived: true, masterProduct: { businessId } }, select: { id: true }, take: 20,
  });
  
  // If exactly one archived variant exists, resurrect it
  if (archivedCandidates.length === 1) {
    await tx.productVariant.update({ where: { id: archivedCandidates[0].id }, data: { isArchived: false } });
    await tx.masterSkuKey.upsert({ where: { businessId_sellerSku: { businessId, sellerSku } },
      create: { businessId, sellerSku, variantId: archivedCandidates[0].id }, update: { variantId: archivedCandidates[0].id } });
    return { variantId: archivedCandidates[0].id, ambiguous: false, candidates: [archivedCandidates[0].id] };
  }
  
  return { variantId: null, ambiguous: candidates.length > 1 || (key?.variantId === null && candidates.length > 0) || archivedCandidates.length > 0, candidates: candidates.map((candidate) => candidate.id) };
}

export async function queueSkuReview(tx: Prisma.TransactionClient, input: {
  businessId: string; mappingId: string; sellerSku: string; candidateIds: string[]; reason: string;
}) {
  const existing = await tx.skuMappingReview.findFirst({ where: { businessId: input.businessId, mappingId: input.mappingId, status: "PENDING" }, select: { id: true } });
  if (existing) {
    await tx.skuMappingReview.update({ where: { id: existing.id }, data: { candidateIds: input.candidateIds, reason: input.reason } });
    return;
  }
  await tx.skuMappingReview.create({ data: { id: crypto.randomUUID(), ...input } });
}

export async function registerSellerSku(tx: Prisma.TransactionClient, input: {
  businessId: string; mappingId: string; sellerSku: string;
}) {
  await lockSellerSkus(tx, input.businessId, [input.sellerSku]);
  const candidates = await tx.productVariant.findMany({
    where: { isArchived: false, masterProduct: { businessId: input.businessId }, OR: [
      { sku: input.sellerSku }, { productMapping: { some: { sellerSku: input.sellerSku, account: { businessId: input.businessId } } } },
    ] }, select: { id: true }, take: 100,
  });
  const variantId = candidates.length === 1 ? candidates[0].id : null;
  const mapping = await tx.productMapping.findFirst({ where: { id: input.mappingId, account: { businessId: input.businessId } }, select: { variantId: true } });
  await tx.masterSkuKey.upsert({ where: { businessId_sellerSku: { businessId: input.businessId, sellerSku: input.sellerSku } },
    create: { businessId: input.businessId, sellerSku: input.sellerSku, variantId }, update: { variantId } });
  if (!variantId || mapping?.variantId !== variantId) await queueSkuReview(tx, { ...input, candidateIds: candidates.map((candidate) => candidate.id),
    reason: candidates.length > 1 ? "SKU seller terhubung ke beberapa stok pusat. Pilih stok acuan tanpa menjumlahkannya."
      : candidates.length ? "Listing belum terhubung ke stok acuan SKU seller ini. Tinjau mapping sebelum menghubungkannya." : "SKU seller belum memiliki SKU master." });
  else await tx.skuMappingReview.updateMany({ where: { businessId: input.businessId, mappingId: input.mappingId, status: "PENDING" }, data: { status: "RESOLVED" } });
}
