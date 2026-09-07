import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { cached } from "@/lib/utils/ttl-cache";

const CACHE_TTL_MS = 60_000;
const WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
const TZ = "Asia/Jakarta";

// GMV = nilai order yang dibuat dalam periode (status CANCELLED dikecualikan;
// UNPAID tetap dihitung sebagai "potensi penjualan").
const GMV_EXCLUDE = ["CANCELLED"];

type OrderBrief = {
  id: string;
  createTime: Date | null;
  accountId: string;
  status: string;
  amount: number | null;
};

type ItemBrief = {
  orderId: string;
  qty: number;
  price: number | null;
  variantId: string | null;
  channelSku: string;
};

function startOfDayUTC(date: Date): Date {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return new Date(`${key}T00:00:00+07:00`);
}

function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function pct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * GET /api/analytics — data section "Analisis Bisnis".
 *
 * Periode: rolling 7 hari berakhir hari ini (Asia/Jakarta) dibandingkan dengan
 * 7 hari sebelumnya. Agregat dihitung per request lalu di-cache 60s (memadai
 * untuk skala saat ini; saat volume besar ganti ke pre-agregasi + job).
 */
export const GET = withAuth(async () => {
  const data = await cached("analytics", CACHE_TTL_MS, async () => {
    const midnightToday = startOfDayUTC(new Date());

    const currentDays: number[] = [];
    const previousDays: number[] = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      currentDays.push(midnightToday.getTime() - i * DAY_MS);
    }
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      previousDays.push(midnightToday.getTime() - (WINDOW_DAYS + i) * DAY_MS);
    }

    const rangeStart = previousDays[0];
    const rangeEnd = midnightToday.getTime() + DAY_MS;

    const orders: OrderBrief[] = await prisma.order.findMany({
      where: {
        createTime: { gte: new Date(rangeStart), lt: new Date(rangeEnd) },
        status: { notIn: GMV_EXCLUDE },
      },
      select: {
        id: true,
        createTime: true,
        accountId: true,
        status: true,
        amount: true,
      },
    });

    const items: ItemBrief[] =
      orders.length > 0
        ? await prisma.orderItem.findMany({
            where: { orderId: { in: orders.map((o) => o.id) } },
            select: {
              orderId: true,
              qty: true,
              price: true,
              variantId: true,
              channelSku: true,
            },
          })
        : [];

    const revenueOf = new Map<string, number>();
    const unitsOf = new Map<string, number>();
    for (const it of items) {
      revenueOf.set(it.orderId, (revenueOf.get(it.orderId) ?? 0) + (it.price ?? 0) * it.qty);
      unitsOf.set(it.orderId, (unitsOf.get(it.orderId) ?? 0) + it.qty);
    }

    const bucketByDay = (t: number) =>
      (o: OrderBrief) =>
        o.createTime !== null &&
        o.createTime.getTime() >= t &&
        o.createTime.getTime() < t + DAY_MS;

    const sumSeries = (days: number[], filter: (o: OrderBrief) => boolean) => {
      let revenue = 0;
      let units = 0;
      let count = 0;
      for (const day of days) {
        for (const o of orders) {
          if (!bucketByDay(day)(o) || !filter(o)) continue;
          revenue += revenueOf.get(o.id) ?? o.amount ?? 0;
          units += unitsOf.get(o.id) ?? 0;
          count += 1;
        }
      }
      return { revenue, units, count };
    };

    const gmvMatch = () => true;
    const completedMatch = (o: OrderBrief) => o.status === "COMPLETED";

    const currentGMV = sumSeries(currentDays, gmvMatch);
    const previousGMV = sumSeries(previousDays, gmvMatch);
    const currentCompleted = sumSeries(currentDays, completedMatch);
    const previousCompleted = sumSeries(previousDays, completedMatch);

    const chart = currentDays.map((day, i) => {
      const c = sumSeries([day], gmvMatch);
      const p = sumSeries([previousDays[i]], gmvMatch);
      return {
        date: dayLabel(new Date(day)),
        current: c.revenue > 0 ? c.revenue : null,
        previous: p.revenue > 0 ? p.revenue : null,
      };
    });

    // Toko Teratas: GMV + unit per akun, periode berjalan, urut turun.
    const storeRevenue = new Map<string, number>();
    const storeUnits = new Map<string, number>();
    for (const day of currentDays) {
      for (const o of orders) {
        if (!bucketByDay(day)(o)) continue;
        const id = o.accountId;
        storeRevenue.set(id, (storeRevenue.get(id) ?? 0) + (revenueOf.get(o.id) ?? o.amount ?? 0));
        storeUnits.set(id, (storeUnits.get(id) ?? 0) + (unitsOf.get(o.id) ?? 0));
      }
    }
    const accountIds = [...storeRevenue.keys()];
    const accounts =
      accountIds.length > 0
        ? await prisma.platformAccount.findMany({
            where: { id: { in: accountIds } },
            select: { id: true, label: true, platform: true },
          })
        : [];
    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    const topStores = [...storeRevenue.entries()]
      .map(([id, value]) => ({
        id,
        label: accountMap.get(id)?.label ?? id,
        platform: accountMap.get(id)?.platform ?? "",
        value,
        units: storeUnits.get(id) ?? 0,
      }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Produk Terjual Teratas: qty per varian, periode berjalan, urut turun.
    const currentOrderIds = new Set(
      currentDays.flatMap((day) =>
        orders.filter(bucketByDay(day)).map((o) => o.id)
      )
    );
    const productAgg = new Map<string, { qty: number; value: number; channelSku?: string }>();
    for (const it of items) {
      if (!currentOrderIds.has(it.orderId)) continue;
      const key = (it.variantId ?? it.channelSku) || "unknown";
      const agg = productAgg.get(key) ?? { qty: 0, value: 0 };
      agg.qty += it.qty;
      agg.value += (it.price ?? 0) * it.qty;
      if (!it.variantId) agg.channelSku = it.channelSku;
      productAgg.set(key, agg);
    }
    const variantIds = [...productAgg.entries()]
      .filter(([, agg]) => !agg.channelSku)
      .map(([key]) => key);
    const variants =
      variantIds.length > 0
        ? await prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: {
              id: true,
              sku: true,
              masterProduct: { select: { name: true } },
            },
          })
        : [];
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const topProducts = [...productAgg.entries()]
      .map(([key, agg]) => {
        const variant = key !== "unknown" ? variantMap.get(key) : undefined;
        return {
          key,
          name: variant?.masterProduct.name ?? agg.channelSku ?? key,
          sku: variant?.sku ?? agg.channelSku ?? null,
          qty: agg.qty,
          value: agg.value,
        };
      })
      .filter((p) => p.qty > 0)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    return {
      window: {
        current: { start: new Date(currentDays[0]).toISOString(), end: new Date(currentDays[6]).toISOString() },
        previous: { start: new Date(previousDays[0]).toISOString(), end: new Date(previousDays[6]).toISOString() },
      },
      metrics: {
        revenue: {
          current: currentGMV.revenue,
          previous: previousGMV.revenue,
          changePct: pct(currentGMV.revenue, previousGMV.revenue),
          orders: currentGMV.count,
        },
        units: {
          current: currentGMV.units,
          previous: previousGMV.units,
          changePct: pct(currentGMV.units, previousGMV.units),
        },
        completedRevenue: {
          current: currentCompleted.revenue,
          previous: previousCompleted.revenue,
          changePct: pct(currentCompleted.revenue, previousCompleted.revenue),
        },
        completedOrders: {
          current: currentCompleted.count,
          previous: previousCompleted.count,
          changePct: pct(currentCompleted.count, previousCompleted.count),
        },
      },
      chart,
      topStores,
      topProducts,
    };
  });

  return NextResponse.json(data);
});