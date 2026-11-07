import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getTikTokUnmapped, type TikTokUnmappedProduct } from "@/lib/services/marketplace-tiktok.service";
import { STOCK_REASONS } from "@/lib/services/central-stock.service";

const PROMO_WORDS = new Set(["promo", "murah", "gratis", "free", "official", "ori", "original", "ready", "stok", "best", "sale"]);
const COLOR_ALIASES: Record<string, string> = { hitam: "black", blk: "black", black: "black", putih: "white", white: "white", abu: "grey", abuabu: "grey", grey: "grey", gray: "grey", merah: "red", red: "red", biru: "blue", blue: "blue", navy: "navy", coklat: "brown", brown: "brown" };
const SIZE_ALIASES: Record<string, string> = { kecil: "s", small: "s", sedang: "m", medium: "m", besar: "l", large: "l", xbesar: "xl", xlarge: "xl" };

export type MatchBucket = "exact" | "suggested" | "review" | "new";
export type MatchRow = {
  accountId: string; accountLabel: string; platformProductId: string; channelSku: string; sellerSku: string | null;
  title: string | null; variantName: string | null; imageUrl: string | null; stock: number; bucket: MatchBucket;
  score: number; candidate: { id: string; sku: string; name: string; imageUrl: string | null; stock: number } | null;
};

function tokens(value: string | null | undefined): string[] {
  return [...new Set((value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).filter((token) => !PROMO_WORDS.has(token)))];
}
function canonicalTokens(value: string | null | undefined): string[] {
  return tokens(value).map((token) => COLOR_ALIASES[token] ?? SIZE_ALIASES[token] ?? token);
}
function similarity(left: string | null | undefined, right: string | null | undefined): number {
  const a = new Set(canonicalTokens(left)); const b = new Set(canonicalTokens(right));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / new Set([...a, ...b]).size;
}
function extractAttributes(value: string | null | undefined): { color: string | null; size: string | null } {
  const found = canonicalTokens(value);
  return { color: found.find((token) => Object.values(COLOR_ALIASES).includes(token)) ?? null, size: found.find((token) => /^(xs|s|m|l|xl|xxl|xxxl|[0-9]{1,2})$/.test(token)) ?? null };
}
function scoreMatch(source: string, candidate: string): number {
  const base = similarity(source, candidate);
  const a = extractAttributes(source); const b = extractAttributes(candidate);
  return Math.min(1, base + (a.color && a.color === b.color ? 0.2 : 0) + (a.size && a.size === b.size ? 0.2 : 0));
}
function rowFrom(product: TikTokUnmappedProduct, sku: TikTokUnmappedProduct["skus"][number], accountId: string, accountLabel: string, candidates: Array<{ id: string; sku: string; name: string; imageUrl: string | null; stock: number }>, exactBySku: Map<string, typeof candidates[number]>): MatchRow {
  const exact = sku.sellerSku ? exactBySku.get(sku.sellerSku.trim().toLowerCase()) : undefined;
  const source = [product.title, sku.skuName, sku.sellerSku].filter(Boolean).join(" ");
  const ranked = candidates.map((candidate) => ({ candidate, score: scoreMatch(source, `${candidate.name} ${candidate.sku}`) })).sort((a, b) => b.score - a.score);
  const best = exact ? { candidate: exact, score: 1 } : ranked[0] ?? null;
  const bucket: MatchBucket = exact ? "exact" : best && best.score >= 0.72 ? "suggested" : best && best.score >= 0.4 ? "review" : "new";
  return { accountId, accountLabel, platformProductId: product.platformProductId, channelSku: sku.skuId, sellerSku: sku.sellerSku, title: product.title, variantName: sku.skuName ?? null, imageUrl: sku.imageUrl ?? product.imageUrl, stock: sku.stock, bucket, score: Number((best?.score ?? 0).toFixed(3)), candidate: best?.candidate ?? null };
}

export async function previewAutoMatch(businessId: string, accountId?: string): Promise<{ rows: MatchRow[]; counts: Record<MatchBucket, number> }> {
  const [accounts, variants, unmapped] = await Promise.all([
    prisma.platformAccount.findMany({ where: { businessId, ...(accountId ? { id: accountId } : {}), platform: { in: ["TIKTOK_SHOP", "SHOPEE"] } }, select: { id: true, label: true } }),
    prisma.productVariant.findMany({ where: { isArchived: false, masterProduct: { businessId } }, select: { id: true, sku: true, stock: true, masterProduct: { select: { name: true, imageUrl: true } } } }),
    getTikTokUnmapped(businessId, accountId),
  ]);
  const candidateRows = variants.map((v) => ({ id: v.id, sku: v.sku, name: v.masterProduct.name, imageUrl: v.masterProduct.imageUrl, stock: v.stock }));
  const exactBySku = new Map<string, typeof candidateRows[number]>();
  for (const candidate of candidateRows) exactBySku.set(candidate.sku.trim().toLowerCase(), candidate);
  const rows = unmapped.filter((account) => accounts.some((item) => item.id === account.accountId)).flatMap((account) => account.unmapped.flatMap((product) => product.skus.map((sku) => rowFrom(product, sku, account.accountId, account.label, candidateRows, exactBySku))));
  const counts = { exact: 0, suggested: 0, review: 0, new: 0 } as Record<MatchBucket, number>;
  for (const row of rows) counts[row.bucket] += 1;
  return { rows, counts };
}

export async function applyAutoMatch(businessId: string, decisions: Array<{ accountId: string; channelSku: string; variantId?: string; createMaster?: boolean; masterName?: string; sku?: string; imageUrl?: string | null }>) {
  if (!decisions.length || decisions.length > 500) throw new Error("Pilih 1–500 hasil auto-match untuk diproses.");
  const ids = [...new Set(decisions.map((d) => d.accountId))];
  const accounts = await prisma.platformAccount.findMany({ where: { id: { in: ids }, businessId }, select: { id: true } });
  if (accounts.length !== ids.length) throw new Error("Ada toko yang bukan milik brand aktif.");
  return prisma.$transaction(async (tx) => {
    let mapped = 0; let created = 0;
    for (const decision of decisions) {
      let variantId = decision.variantId;
      if (decision.createMaster) {
        const name = decision.masterName?.trim(); const sku = decision.sku?.trim();
        if (!name || !sku) throw new Error("Master baru wajib memiliki nama dan SKU lokal.");
        const duplicate = await tx.productVariant.findFirst({ where: { sku, masterProduct: { businessId } }, select: { id: true } });
        if (duplicate) throw new Error(`SKU lokal ${sku} sudah digunakan.`);
        const master = await tx.masterProduct.create({ data: { id: crypto.randomUUID(), businessId, name, imageUrl: decision.imageUrl?.trim() || undefined, importedFrom: "marketplace-auto-match" } });
        const variant = await tx.productVariant.create({ data: { id: crypto.randomUUID(), masterProductId: master.id, sku, stock: 0, safetyStock: 0 } });
        await tx.stockLedger.create({ data: { id: crypto.randomUUID(), variantId: variant.id, changeQty: 0, reason: STOCK_REASONS.INIT, referenceId: `auto-master:${decision.accountId}:${decision.channelSku}`, stockAfter: 0, note: "Master dibuat dari preview auto-match" } });
        variantId = variant.id; created += 1;
      }
      if (!variantId) continue;
      const variant = await tx.productVariant.findFirst({ where: { id: variantId, masterProduct: { businessId }, isArchived: false }, select: { id: true } });
      if (!variant) throw new Error("Varian target tidak ditemukan atau tidak aktif.");
      await tx.productMapping.upsert({ where: { accountId_channelSku: { accountId: decision.accountId, channelSku: decision.channelSku } }, create: { accountId: decision.accountId, channelSku: decision.channelSku, variantId, origin: "auto", updatedAt: new Date() }, update: { variantId, origin: "auto", updatedAt: new Date() } });
      mapped += 1;
    }
    return { mapped, created };
  });
}
