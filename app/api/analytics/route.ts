import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { getAnalyticsAggregated } from "@/lib/services/analytics-agg.service";
import { cached } from "@/lib/utils/ttl-cache";
import { prisma } from "@/lib/db/prisma";
import { dashboardPeriod, dashboardPreset } from "@/lib/utils/dashboard-period";

const CACHE_TTL_MS = 60_000;

export const GET = withAuth(async (req) => {
  const params = req.nextUrl.searchParams;
  const defaults = dashboardPreset(7);
  const start = params.get("start") ?? defaults.start;
  const end = params.get("end") ?? defaults.end;
  const accountId = params.get("accountId") ?? "";
  if (params.has("start") !== params.has("end")) {
    return NextResponse.json({ error: "Isi tanggal awal dan akhir." }, { status: 400 });
  }
  try {
    dashboardPeriod(start, end);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Periode tidak valid." }, { status: 400 });
  }
  if (accountId && !await prisma.platformAccount.findFirst({ where: { id: accountId, businessId: req.businessId }, select: { id: true } })) {
    return NextResponse.json({ error: "Akun toko tidak ditemukan." }, { status: 404 });
  }
  const filters = { start, end, accountId };
  const data = await cached(`analytics:${JSON.stringify([req.businessId, start, end, accountId])}`, CACHE_TTL_MS, () =>
    getAnalyticsAggregated(req.businessId, filters)
  );
  return NextResponse.json(data);
});
