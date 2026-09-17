import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { cached } from "@/lib/utils/ttl-cache";
import { isLowStock } from "@/lib/services/central-stock.service";

const CACHE_TTL_MS = 60_000;

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * GET /api/summary — ringkasan dashboard "Yang Perlu Dilakukan".
 *
 * Definisi (sesuai konfirmasi):
 * - newOrders       : Order masuk hari ini (createTime >= start of day, bukan CANCELLED)
 * - readyToShip     : Order berstatus AWAITING_SHIPMENT
 * - completedOrders : Order berstatus COMPLETED
 * - criticalStock   : varian "stok menipis" menurut isLowStock()
 *   (stock-level.policy) — definisi yang SAMA dengan /api/stock-alerts &
 *   halaman Stok Varian: tersedia <= minStock per-varian (fallback threshold).
 * - oversell        : jumlah varian di mana total qty order AKTIF (status ∉
 *                     CANCELLED/COMPLETED) melebihi stock tersisa varian
 */
export const GET = withAuth(async (req) => {
  const businessId = req.businessId;
  const data = await cached(`summary:${businessId}`, CACHE_TTL_MS, async () => {
    const startToday = startOfToday();

    const [accountsCount, activeSku, criticalCount, newOrders, readyToShip, completedOrders, committed, variantsStock] =
      await Promise.all([
        prisma.platformAccount.count({ where: { businessId } }),
        prisma.productVariant.count({ where: { masterProduct: { businessId } } }),

        prisma.productVariant
          .findMany({
            where: { masterProduct: { businessId } },
            select: {
              stock: true,
              safetyStock: true,
              minStock: true,
              masterProduct: { select: { threshold: true } },
            },
          })
          .then((variants) =>
            variants.filter((v) =>
              isLowStock(v.stock, v.safetyStock, v.minStock, v.masterProduct.threshold)
            ).length
          ),

        prisma.order.count({
          where: {
            account: { businessId },
            createTime: { gte: startToday },
            status: { not: "CANCELLED" },
          },
        }),

        prisma.order.count({
          where: { account: { businessId }, status: "AWAITING_SHIPMENT" },
        }),

        prisma.order.count({
          where: { account: { businessId }, status: "COMPLETED" },
        }),

        prisma.orderItem.groupBy({
          by: ["variantId"],
          where: {
            variantId: { not: null },
            order: { status: { notIn: ["CANCELLED", "COMPLETED"] }, account: { businessId } },
          },
          _sum: { qty: true },
        }),

        prisma.productVariant.findMany({
          where: { masterProduct: { businessId } },
          select: { id: true, stock: true },
        }),
      ]);

    const stockByVariant = new Map(
      variantsStock.map((v) => [v.id, v.stock] as const)
    );
    const oversell = committed.filter(
      (c) => (c._sum.qty ?? 0) > (stockByVariant.get(c.variantId ?? "") ?? 0)
    ).length;

    return {
      accountsConnected: accountsCount,
      activeSku,
      criticalStock: criticalCount,
      newOrders,
      readyToShip,
      completedOrders,
      oversell,
    };
  });

  return NextResponse.json(data);
});