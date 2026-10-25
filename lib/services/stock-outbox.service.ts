import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { effectiveStock } from "@/lib/services/stock-level.policy";

export async function drainStockOutbox(limit = 100, businessId?: string): Promise<number> {
  return prisma.$transaction(async tx => {
    const events = await tx.$queryRaw<{ id: string; variantId: string; businessId: string }[]>`
      SELECT "id", "variantId", "businessId" FROM "StockOutbox"
      WHERE "status" = 'PENDING' ${businessId ? Prisma.sql`AND "businessId" = ${businessId}` : Prisma.empty} ORDER BY "createdAt", "id"
      LIMIT ${limit} FOR UPDATE SKIP LOCKED
    `;
    for (const event of events) {
      const variant = await tx.productVariant.findFirst({
        where: { id: event.variantId, masterProduct: { businessId: event.businessId } },
        select: { stock: true, safetyStock: true, productMapping: { where: { account: { businessId: event.businessId } }, select: { accountId: true, channelSku: true } } },
      });
      if (variant) {
        for (const mapping of variant.productMapping) {
          const identity = { variantId: event.variantId, accountId: mapping.accountId, channelSku: mapping.channelSku, status: "PENDING" };
          await tx.syncJob.upsert({
            where: { variantId_accountId_channelSku_status: identity },
            create: { ...identity, newSellable: Math.max(0, effectiveStock(variant.stock, variant.safetyStock)) },
            update: { newSellable: Math.max(0, effectiveStock(variant.stock, variant.safetyStock)), retryCount: 0, nextRetryAt: null },
          });
        }
      }
      await tx.stockOutbox.update({ where: { id: event.id }, data: { status: "DONE", handledAt: new Date() } });
    }
    return events.length;
  }, { timeout: 60_000 });
}
