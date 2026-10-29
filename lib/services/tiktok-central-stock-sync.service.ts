import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { searchTikTokInventory } from "@/lib/integrations/tiktokShop";
import { withRefreshedTiktokToken } from "@/lib/services/tiktok-token.service";
import { adjustStockAbsoluteInTx, pushVariantStockToOthers, STOCK_REASONS } from "@/lib/services/central-stock.service";

type SyncMapping = {
  id: string;
  channelSku: string;
  sellerSku: string | null;
  platformSkuId: string | null;
  platformProductId: string | null;
  variantId: string;
  variant: { id: string; sku: string; stock: number; masterProduct: { name: string; imageUrl: string | null } | null };
};

export type TikTokCentralStockSyncResult = {
  accountId: string;
  label: string;
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
  options: { apply?: boolean } = {},
): Promise<TikTokCentralStockSyncResult> {
  const account = await prisma.platformAccount.findFirst({
    where: { id: accountId, businessId, platform: "TIKTOK_SHOP" },
    select: { id: true, label: true, accessToken: true, refreshToken: true, tokenExpiresAt: true, shopCipher: true, isFrozen: true },
  });
  if (!account) throw new Error("Toko TikTok tidak ditemukan pada brand aktif.");
  if (account.isFrozen) throw new Error("Toko TikTok sedang dibekukan.");
  if (!account.accessToken || !account.shopCipher) throw new Error("Toko TikTok belum terhubung lengkap.");

  const mappings = await prisma.productMapping.findMany({
    where: { accountId, account: { businessId }, variantId: { not: null } },
    select: {
      id: true, channelSku: true, sellerSku: true, platformSkuId: true, platformProductId: true,
      variantId: true, variant: { select: { id: true, sku: true, stock: true, masterProduct: { select: { name: true, imageUrl: true } } } },
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
  if (!eligible.length) return { accountId: account.id, label: account.label, updated, skipped };

  const snapshots = await withRefreshedTiktokToken(account, (token, creds) =>
    searchTikTokInventory(token, account.shopCipher ?? undefined, eligible.map((mapping) => mapping.platformSkuId!), creds),
  );

  const touchedVariants: string[] = [];
  for (const mapping of eligible) {
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
    if (!options.apply) {
      updated.push(preview);
      continue;
    }
    const referenceId = `tiktok-stock-sync:${account.id}:${mapping.id}:${crypto.createHash("sha256").update(`${snapshot.productId}:${snapshot.skuId}:${snapshot.availableQuantity}`).digest("hex").slice(0, 24)}`;
    const result = await prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: mapping.variantId, masterProduct: { businessId } },
        select: { id: true, sku: true, stock: true },
      });
      if (!variant) return { ok: false as const, reason: "Varian tidak ditemukan pada brand aktif." };
      const changed = await adjustStockAbsoluteInTx(tx, {
        variantId: variant.id,
        newStock: snapshot.availableQuantity,
        reason: STOCK_REASONS.SYNC_CORRECTION,
        referenceId,
        note: `Koreksi dari stok available TikTok Shop · ${account.label} · SKU ${snapshot.skuId}`,
        userId,
      });
      await tx.productMapping.update({ where: { id: mapping.id }, data: { platformStock: snapshot.availableQuantity, lastSyncedAt: new Date() } });
      return { ...changed, before: variant.stock };
    }, { timeout: 60_000 });
    if (!result.ok) {
      skipped.push({ mappingId: mapping.id, sku: mapping.variant.sku, reason: result.reason ?? "Koreksi stok gagal." });
      continue;
    }
    updated.push({ ...preview, before: result.before, after: result.stockAfter! });
    if (result.changeQty !== 0) touchedVariants.push(mapping.variantId);
  }

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
