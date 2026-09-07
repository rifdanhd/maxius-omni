import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { cached } from "@/lib/utils/ttl-cache";

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
 * - criticalStock   : varian dengan stock <= threshold master product
 * - oversell        : jumlah varian di mana total qty order AKTIF (status ∉
 *                     CANCELLED/COMPLETED) melebihi stock tersisa varian
 */
export const GET = withAuth(async () => {
  const data = await cached("summary", CACHE_TTL_MS, async () => {
    const startToday = startOfToday();

    const [accountsCount, activeSku, criticalCount, newOrders, readyToShip, completedOrders, committed, variantsStock] =
      await Promise.all([
        prisma.platformAccount.count(),
        prisma.productVariant.count(),

        prisma.productVariant
          .findMany({
            select: {
              stock: true,
              masterProduct: { select: { threshold: true } },
            },
          })
          .then((variants) =>
            variants.filter((v) => v.stock <= v.masterProduct.threshold).length
          ),

        prisma.order.count({
          where: {
            createTime: { gte: startToday },
            status: { not: "CANCELLED" },
          },
        }),

        prisma.order.count({
          where: { status: "AWAITING_SHIPMENT" },
        }),

        prisma.order.count({
          where: { status: "COMPLETED" },
        }),

        prisma.orderItem.groupBy({
          by: ["variantId"],
          where: {
            variantId: { not: null },
            order: { status: { notIn: ["CANCELLED", "COMPLETED"] } },
          },
          _sum: { qty: true },
        }),

        prisma.productVariant.findMany({
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