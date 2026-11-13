import { prisma } from "@/lib/db/prisma";
import { getItemBaseInfo, getModelList } from "@/lib/integrations/shopee";
import { loadShopeeAccount, withRefreshedToken } from "@/lib/services/marketplace-shopee.service";
import { shopeeRawWithModels } from "@/lib/services/shopee-raw";

/**
 * Isi daftar model Shopee ke ProductMapping.platformStatusRaw.
 *
 * Mapping lama hanya menyimpan `get_item_base_info` (tanpa model), sehingga
 * atribut varian — satu-satunya pembeda saat foto & seller SKU sama — tidak
 * bisa ditampilkan. Satu panggilan get_model_list + get_item_base_info per
 * item, lalu semua mapping item tersebut ditulis ulang.
 */

export type ShopeeModelBackfillReport = {
  items: number;
  fetched: number;
  updated: number;
  withoutModels: number;
  failed: number;
  errors: string[];
};

function hasModelNames(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { model?: Array<{ model_name?: string }> };
    const models = parsed?.model;
    return Array.isArray(models) && models.some((model) => Boolean(model?.model_name));
  } catch {
    return false;
  }
}

export async function backfillShopeeModels(
  businessId: string,
  options: { limit?: number; accountId?: string; dryRun?: boolean } = {}
): Promise<ShopeeModelBackfillReport> {
  const report: ShopeeModelBackfillReport = { items: 0, fetched: 0, updated: 0, withoutModels: 0, failed: 0, errors: [] };
  const accounts = await prisma.platformAccount.findMany({
    where: {
      businessId,
      platform: "SHOPEE",
      accessToken: { not: null },
      isFrozen: false,
      ...(options.accountId ? { id: options.accountId } : {}),
    },
    select: { id: true, label: true },
    orderBy: { label: "asc" },
  });

  for (const summary of accounts) {
    if (options.limit && report.items >= options.limit) break;
    const account = await loadShopeeAccount(summary.id);
    if (!account) continue;

    const mappings = await prisma.productMapping.findMany({
      where: { accountId: account.id },
      select: { id: true, channelSku: true, platformProductId: true, platformStatusRaw: true },
    });
    const byItem = new Map<string, typeof mappings>();
    for (const mapping of mappings) {
      const itemId = mapping.platformProductId ?? mapping.channelSku.split(":")[0];
      if (!/^[1-9]\d*$/.test(itemId)) continue;
      const rows = byItem.get(itemId) ?? [];
      rows.push(mapping);
      byItem.set(itemId, rows);
    }

    for (const [itemId, rows] of byItem) {
      if (options.limit && report.items >= options.limit) break;
      if (rows.every((row) => hasModelNames(row.platformStatusRaw))) continue;
      report.items += 1;
      try {
        const data = await withRefreshedToken(account, async (token, shopId, creds) => {
          const [{ models }, infos] = await Promise.all([
            getModelList(token, shopId, Number(itemId), creds),
            getItemBaseInfo(token, shopId, [Number(itemId)], creds),
          ]);
          return { models, info: infos[0] ?? null };
        });
        report.fetched += 1;
        const models = data.models.filter((model) => model.model_id >= 0);
        if (!data.info || models.length === 0) {
          report.withoutModels += 1;
          continue;
        }
        if (!options.dryRun) {
          const raw = shopeeRawWithModels(data.info, models);
          await prisma.productMapping.updateMany({
            where: { id: { in: rows.map((row) => row.id) } },
            data: { platformStatusRaw: raw },
          });
        }
        report.updated += rows.length;
      } catch (error) {
        report.failed += 1;
        if (report.errors.length < 20) {
          report.errors.push(`${summary.label} item ${itemId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  return report;
}
