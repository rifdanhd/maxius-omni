import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { searchTikTokInventory } from "@/lib/integrations/tiktokShop";
import { withRefreshedTiktokToken } from "@/lib/services/tiktok-token.service";
import { adjustStockAbsoluteInTx, pushVariantStockToOthers, STOCK_REASONS } from "@/lib/services/central-stock.service";
import { StockPreviewConflict, signStockPreview, stockPlanDigest, verifyStockPreview } from "@/lib/services/stock-preview.policy";

type SyncMapping = {
  id: string;
  channelSku: string;
  sellerSku: string | null;
  platformSkuId: string | null;
  platformProductId: string | null;
  variantId: string;
  updatedAt: Date;
  variant: { id: string; sku: string; stock: number; version: number; masterProduct: { name: string; imageUrl: string | null } | null };
};

export type TikTokCentralStockSyncResult = {
  accountId: string;
  label: string;
  previewToken?: string;
  updated: Array<{ mappingId: string; sku: string; channelSku: string; productName: string; imageUrl: string | null; before: number; after: number }>;
  skipped: Array<{ mappingId: string; sku: string; reason: string }>;
};

function mappingMatch(mapping: SyncMapping, snapshot: { productId: string; skuId: string; sellerSku: string | null }) {
  if (mapping.platformSkuId) return mapping.platformSkuId === snapshot.skuId;
  if (mapping.sellerSku) return mapping.sellerSku === snapshot.sellerSku;
  return mapping.channelSku === snapshot.skuId || mapping.channelSku === snapshot.sellerSku;
}

export async function syncTikTokStockToCentral(
  businessId: string,
  userId: string,
  accountId: string,
  options: { apply?: boolean; previewToken?: string } = {},
): Promise<TikTokCentralStockSyncResult> {
  const scope = { businessId, userId, accountId };
  const approved = options.apply ? verifyStockPreview(options.previewToken, scope) : null;
  const account = await prisma.platformAccount.findFirst({
    where: { id: accountId, businessId, platform: "TIKTOK_SHOP" },
    select: { id: true, label: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, shopCipher: true, isFrozen: true },
  });
  if (!account) throw new Error("Toko TikTok tidak ditemukan pada brand aktif.");
  if (account.isFrozen) throw new Error("Toko TikTok sedang dibekukan.");
  if (!account.accessToken || !account.shopCipher) throw new Error("Toko TikTok belum terhubung lengkap.");

  const mappings = await prisma.productMapping.findMany({
    where: { accountId, account: { businessId }, variantId: { not: null },
      platformStatus: { in: ["ACTIVATE", "ACTIVE"] },
      variant: { isArchived: false, masterProduct: { businessId, isActive: true } } },
    select: {
      id: true, channelSku: true, sellerSku: true, platformSkuId: true, platformProductId: true,
      variantId: true, updatedAt: true, variant: { select: { id: true, sku: true, stock: true, version: true, masterProduct: { select: { name: true, imageUrl: true } } } },
    },
    orderBy: { id: "asc" },
  }) as SyncMapping[];
  const updated: TikTokCentralStockSyncResult["updated"] = [];
  const skipped: TikTokCentralStockSyncResult["skipped"] = [];
  const eligible = mappings.filter((mapping) => {
    if (!mapping.platformSkuId) {
      skipped.push({ mappingId: mapping.id, sku: mapping.variant.sku, reason: "Mapping belum memiliki TikTok SKU ID terverifikasi." });
      return false;
    }
    return true;
  });
  if (!eligible.length && !options.apply) return { accountId: account.id, label: account.label, updated, skipped };

  const snapshots = await withRefreshedTiktokToken(account, (token, creds) =>
    searchTikTokInventory(token, account.shopCipher ?? undefined, eligible.map((mapping) => mapping.platformSkuId!), creds),
  );

  const touchedVariants: string[] = [];
  const groups = new Map<string, SyncMapping[]>();
  for (const mapping of eligible) groups.set(mapping.variantId, [...(groups.get(mapping.variantId) ?? []), mapping]);
  for (const group of groups.values()) {
    const quantities = new Set<number>();
    let incomplete = false;
    for (const entry of group) {
      const matches = snapshots.filter(snapshot => mappingMatch(entry, snapshot) && (!entry.platformProductId || entry.platformProductId === snapshot.productId));
      if (matches.length !== 1) { incomplete = true; break; }
      quantities.add(matches[0].availableQuantity);
    }
    if (incomplete || quantities.size !== 1) {
      for (const entry of group) skipped.push({ mappingId: entry.id, sku: entry.variant.sku,
        reason: incomplete ? "Identitas SKU TikTok pada stok bersama belum lengkap atau ambigu." : "Beberapa listing memakai stok pusat sama tetapi nilainya berbeda. Pilih stok acuan sebelum mengganti stok pusat." });
      continue;
    }
    const mapping = group[0];
    const matches = snapshots.filter((snapshot) =>
      mappingMatch(mapping, snapshot) && (!mapping.platformProductId || mapping.platformProductId === snapshot.productId),
    );
    if (matches.length !== 1) {
      skipped.push({ mappingId: mapping.id, sku: mapping.variant.sku, reason: matches.length ? "SKU TikTok ambigu atau product ID tidak cocok." : "SKU TikTok tidak ditemukan pada inventory search." });
      continue;
    }
    const snapshot = matches[0];
    const preview = {
      mappingId: mapping.id,
      sku: mapping.variant.sku,
      channelSku: mapping.channelSku,
      productName: mapping.variant.masterProduct?.name ?? mapping.variant.sku,
      imageUrl: mapping.variant.masterProduct?.imageUrl ?? null,
      before: mapping.variant.stock,
      after: snapshot.availableQuantity,
    };
    updated.push(preview);
  }

  const digest = stockPlanDigest({ mappings: mappings.map((row) => [row.id, row.channelSku, row.platformSkuId, row.platformProductId, row.variantId, row.updatedAt.toISOString(), row.variant.version, row.variant.stock]),
    changes: updated.map((row) => [row.mappingId, row.before, row.after]), skipped });
  if (!options.apply) return { accountId, label: account.label, updated, skipped, previewToken: signStockPreview(scope, digest) };
  if (approved?.digest !== digest) throw new StockPreviewConflict("Stok atau mapping berubah sejak preview. Periksa preview baru; belum ada stok yang disimpan.");
  await prisma.$transaction(async (tx) => {
    const stillAllowed = await tx.platformAccount.findFirst({ where: { id: accountId, businessId, isFrozen: false } });
    if (!stillAllowed) throw new StockPreviewConflict("Kondisi toko berubah. Ambil preview baru.");
    for (const change of [...updated].sort((a, b) => a.mappingId.localeCompare(b.mappingId))) {
      const mapping = mappings.find((row) => row.id === change.mappingId)!;
      for (const member of mappings.filter((row) => row.variantId === mapping.variantId)) {
        const current = await tx.productMapping.findFirst({ where: { id: member.id, variantId: member.variantId, updatedAt: member.updatedAt,
          channelSku: member.channelSku, platformSkuId: member.platformSkuId, platformProductId: member.platformProductId,
          sellerSku: member.sellerSku, platformStatus: { in: ["ACTIVATE", "ACTIVE"] }, accountId } });
        if (!current) throw new StockPreviewConflict("Mapping berubah saat penyimpanan. Semua perubahan dibatalkan.");
      }
      const [variant] = await tx.$queryRaw<{ stock: number; version: number }[]>`SELECT stock, version FROM "ProductVariant" WHERE id=${mapping.variantId} FOR UPDATE`;
      if (!variant || variant.stock !== change.before || variant.version !== mapping.variant.version) throw new StockPreviewConflict("Stok berubah saat penyimpanan. Semua perubahan dibatalkan; ambil preview baru.");
      const result = await adjustStockAbsoluteInTx(tx, { variantId: mapping.variantId, newStock: change.after,
        reason: STOCK_REASONS.SYNC_CORRECTION, referenceId: `tiktok-preview:${approved!.jti}:${mapping.id}`, userId,
        note: `Stok sesuai preview yang dikonfirmasi · ${account.label}` });
      if (!result.ok) throw new StockPreviewConflict(result.reason ?? "Koreksi dibatalkan.");
      await tx.productMapping.update({ where: { id: mapping.id }, data: { platformStock: change.after, lastSyncedAt: new Date() } });
      if (result.changeQty) touchedVariants.push(mapping.variantId);
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });

  for (const variantId of [...new Set(touchedVariants)]) {
    await pushVariantStockToOthers(variantId, account.id);
  }
  if (!options.apply) return { accountId: account.id, label: account.label, updated, skipped };

  await prisma.syncLog.create({
    data: {
      direction: "in", kind: "tiktok_central_stock_sync", status: "success",
      message: `Stok pusat diperbarui dari TikTok: ${updated.length} berubah, ${skipped.length} dilewati.`,
      payload: JSON.stringify({ accountId: account.id, updated: updated.length, skipped: skipped.length }), accountId: account.id,
    },
  });
  return { accountId: account.id, label: account.label, updated, skipped };
}
