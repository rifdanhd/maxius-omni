"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  PackageCheck,
  RefreshCw,
  ShoppingCart,
  Store,
  TrendingDown,
  TrendingUp,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { authFetch } from "@/lib/utils/api-client";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DASHBOARD_TIME_ZONE, DAY_MS, dashboardPeriod, dashboardPreset, jakartaDateKey } from "@/lib/utils/dashboard-period";

const CHART_TABS = {
  potensi: { title: "Tren Potensi Penjualan", currency: true },
  terjual: { title: "Tren Produk Terjual", currency: false },
  penjualan: { title: "Tren Penjualan Selesai", currency: true },
  pesanan: { title: "Tren Pesanan Selesai", currency: false },
};

type Summary = {
  accountsConnected: number;
  activeSku: number;
  criticalStock: number;
  newOrders: number;
  readyToShip: number;
  completedOrders: number;
  oversell: number;
};

type AnalyticsData = {
  generatedAt: string;
  window: {
    current: { start: string; end: string };
    previous: { start: string; end: string };
  };
  metrics: {
    revenue: { current: number; previous: number; changePct: number | null; orders: number };
    units: { current: number; previous: number; changePct: number | null };
    completedRevenue: { current: number; previous: number; changePct: number | null };
    completedOrders: { current: number; previous: number; changePct: number | null };
  };
  chart: {
    date: string;
    current: number | null;
    previous: number | null;
    units: { current: number; previous: number };
    completedRevenue: { current: number; previous: number };
    completedOrders: { current: number; previous: number };
  }[];
  topStores: { id: string; label: string; platform: string; value: number; units: number }[];
  topProducts: { key: string; name: string; sku: string | null; channelSku: string | null; qty: number; value: number }[];
};

type OpsKpi = {
  centralStock: { variantCount: number; totalUnits: number; totalSellable: number };
  lowStock: {
    count: number;
    top: Array<{
      variantId: string;
      sku: string;
      variantName: string | null;
      productName: string;
      stock: number;
      safetyStock: number;
      sellable: number;
      severity: "low" | "out";
    }>;
  };
  mismatch: { total: number; failed: number; pendingRetry: number };
  syncErrors: { count7d: number; byKind: Array<{ kind: string; count: number }> };
  storeHealth: Array<{
    accountId: string;
    label: string;
    platform: string;
    hasToken: boolean;
    hasCipher: boolean;
    lastOrderAt: string | null;
    lastSyncAt: string | null;
    errors7d: number;
    mismatch: number;
    orphanSkus: number;
  }>;
};

function formatRp(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

function formatDateRange(isoStart: string, isoEnd: string): string {
  const fmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: DASHBOARD_TIME_ZONE });
  return `${fmt.format(new Date(isoStart))} - ${fmt.format(new Date(isoEnd))}`;
}

function trendLabel(pct: number | null): string | undefined {
  if (pct === null) return undefined;
  return `${Math.abs(pct)}%`;
}

function trendUp(pct: number | null): boolean {
  return pct !== null && pct >= 0;
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary>({ accountsConnected: 0, activeSku: 0, criticalStock: 0, newOrders: 0, readyToShip: 0, completedOrders: 0, oversell: 0 });
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [opsKpi, setOpsKpi] = useState<OpsKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Array<{ id: string; platform: string; label: string }>>([]);
  const [filters, setFilters] = useState(() => ({ ...dashboardPreset(7), accountId: "" }));
  const [draftFilters, setDraftFilters] = useState(filters);
  const [periodPreset, setPeriodPreset] = useState("7");
  const [filterError, setFilterError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<keyof typeof CHART_TABS>("potensi");
  const [syncErrorsOpen, setSyncErrorsOpen] = useState(false);
  const [panduanAwalOpen, setPanduanAwalOpen] = useState(true);
  const [greet, setGreet] = useState<{ name: string | null; salam: string; date: string } | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: DASHBOARD_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
      setGreet({
        name: localStorage.getItem("username"),
        salam: h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam",
        date: new Intl.DateTimeFormat("id-ID", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Asia/Jakarta",
        }).format(new Date()),
      });
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadAll() {
      try {
        const options = { signal: controller.signal };
        const query = new URLSearchParams(filters);
        const [summaryRes, analyticsRes, kpiRes, accountsRes] = await Promise.all([
          authFetch("/api/summary", options),
          authFetch(`/api/analytics?${query}`, options),
          authFetch("/api/dashboard/kpi", options),
          authFetch("/api/accounts", options),
        ]);
        for (const response of [summaryRes, analyticsRes, kpiRes, accountsRes]) {
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(typeof body?.error === "string" ? body.error : "Data dashboard gagal dimuat.");
          }
        }
        const [summaryData, analyticsData, kpiData, accountsData] = await Promise.all([
          summaryRes.json(), analyticsRes.json(), kpiRes.json(), accountsRes.json(),
        ]);
        if (controller.signal.aborted) return;
        setSummary(summaryData);
        setAnalytics(analyticsData);
        setOpsKpi(kpiData);
        setAccounts(accountsData.accounts);
        setLoadError(null);
      } catch (e) {
        if (controller.signal.aborted) return;
        console.error(e);
        setLoadError(e instanceof Error ? e.message : "Data dashboard gagal dimuat.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadAll();
    return () => controller.abort();
  }, [reloadKey, filters]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-8 animate-pulse">
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="h-7 w-64 max-w-full rounded-md bg-muted" />
            <div className="h-4 w-48 rounded-md bg-muted" />
          </div>
          <div className="h-9 w-40 rounded-lg bg-muted" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[132px] rounded-2xl border border-border bg-card" />
          ))}
        </div>
        <div className="h-[420px] rounded-2xl border border-border bg-card" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[104px] rounded-2xl border border-border bg-card" />
          ))}
        </div>
      </div>
    );
  }

  if (loadError)
    return (
      <PageState
        variant="error"
        title="Ringkasan belum dapat dimuat"
        description={loadError}
        action={
          <div className="flex flex-wrap gap-2"><Button
            variant="outline"
            onClick={() => {
              setLoading(true);
              setReloadKey((key) => key + 1);
            }}
          >
            Coba lagi
          </Button>
          <Button variant="outline" onClick={() => {
            const next = { ...dashboardPreset(7), accountId: "" };
            setDraftFilters(next);
            setPeriodPreset("7");
            setFilters(next);
            setLoading(true);
          }}>Reset filter</Button></div>
        }
      />
    );

  const m = analytics?.metrics;
  const chartMetric = CHART_TABS[activeTab];
  const chartData = (analytics?.chart ?? []).map((point) => ({
    date: point.date,
    ...(activeTab === "terjual" ? point.units
      : activeTab === "penjualan" ? point.completedRevenue
      : activeTab === "pesanan" ? point.completedOrders
      : { current: point.current, previous: point.previous }),
  }));
  const potentialOrders = m?.revenue.orders ?? 0;
  const periodDays = analytics ? Math.round((new Date(analytics.window.current.end).getTime() - new Date(analytics.window.current.start).getTime()) / DAY_MS) + 1 : 7;
  const avgDailyUnits = m ? m.units.current / periodDays : 0;
  const avgDailyCompletedOrders = m ? m.completedOrders.current / periodDays : 0;
  const selectedAccount = accounts.find((account) => account.id === filters.accountId);
  const accountLabel = selectedAccount ? `${selectedAccount.label} (${selectedAccount.platform})` : "Semua akun toko";
  const periodLabel = analytics ? `${formatDateRange(analytics.window.current.start, analytics.window.current.end)} WIB` : "Periode berjalan";

  // Panduan Awal: progres dihitung dari data asli (summary + KPI), bukan hardcoded.
  const onboardingSteps = [
    { label: "Sambungkan toko marketplace (Shopee / TikTok)", href: "/settings/accounts", done: summary.accountsConnected > 0 },
    { label: "Buat produk master & varian", href: "/products", done: summary.activeSku > 0 },
    {
      label: "Mapping varian ke SKU tiap toko",
      href: "/products/mapping",
      done: summary.activeSku > 0 && (opsKpi?.storeHealth.length ?? 0) > 0 && (opsKpi?.storeHealth.every((s) => s.orphanSkus === 0) ?? false),
    },
    { label: "Isi stok siap jual di Inventori", href: "/inventory", done: (opsKpi?.centralStock.totalSellable ?? 0) > 0 },
    { label: "Pesanan pertama masuk", href: "/orders", done: summary.newOrders + summary.completedOrders > 0 },
    {
      label: "Sinkronisasi berjalan tanpa error (7 hari)",
      href: "/settings/accounts",
      done: summary.accountsConnected > 0 && (opsKpi?.syncErrors.count7d ?? 1) === 0,
    },
  ];
  const onboardingDone = onboardingSteps.filter((s) => s.done).length;
  const onboardingPct = Math.round((onboardingDone / onboardingSteps.length) * 100);
  const maxStoreValue = Math.max(1, ...(analytics?.topStores ?? []).map((s) => s.value));

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-8">
      {/* ───────── Header ───────── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-[28px]">
            {greet ? `${greet.salam}, ${greet.name ?? "Seller"}` : "Selamat datang"} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {greet ? `${greet.date} · ` : ""}Berikut ringkasan performa toko Anda.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm">
            <CalendarDays size={15} className="text-muted-foreground" />
            {periodLabel}
          </span>
          <Button
            variant="outline"
            onClick={() => {
              setLoading(true);
              setReloadKey((key) => key + 1);
            }}
          >
            <RefreshCw size={14} className="mr-2" />
            Muat ulang
          </Button>
        </div>
      </header>

      <form className="space-y-3 rounded-2xl border border-border bg-card p-4" onSubmit={(event) => {
        event.preventDefault();
        try {
          dashboardPeriod(draftFilters.start, draftFilters.end);
          setFilterError(null);
          setLoading(true);
          setFilters({ ...draftFilters });
        } catch (error) {
          setFilterError(error instanceof Error ? error.message : "Periode tidak valid.");
        }
      }}>
        <p className="text-sm font-semibold">Filter performa penjualan</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">Akun toko
            <select aria-label="Akun toko" className="h-10 max-w-full rounded-lg border border-input bg-background px-3 text-sm" value={draftFilters.accountId} onChange={(event) => setDraftFilters({ ...draftFilters, accountId: event.target.value })}>
              <option value="">Semua akun toko</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.label} ({account.platform})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">Periode
            <select aria-label="Periode penjualan" className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={periodPreset} onChange={(event) => {
              setPeriodPreset(event.target.value);
              if (event.target.value !== "custom") setDraftFilters({ ...draftFilters, ...dashboardPreset(Number(event.target.value)) });
            }}>
              <option value="7">7 hari terakhir</option>
              <option value="1">Hari ini</option>
              <option value="30">30 hari terakhir</option>
              <option value="custom">Tanggal khusus</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">Dari (WIB)
            <input aria-label="Tanggal awal" type="date" required max={jakartaDateKey()} className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={draftFilters.start} onChange={(event) => { setPeriodPreset("custom"); setDraftFilters({ ...draftFilters, start: event.target.value }); }} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">Sampai (WIB)
            <input aria-label="Tanggal akhir" type="date" required min={draftFilters.start} max={jakartaDateKey()} className="h-10 rounded-lg border border-input bg-background px-3 text-sm" value={draftFilters.end} onChange={(event) => { setPeriodPreset("custom"); setDraftFilters({ ...draftFilters, end: event.target.value }); }} />
          </label>
          <Button type="submit">Terapkan</Button>
        </div>
        <p className="text-xs text-muted-foreground">Aktif: {accountLabel} · {periodLabel}. Maksimal 90 hari; dibandingkan dengan periode sebelumnya yang sama panjang.</p>
        {filterError && <p role="alert" className="text-sm text-destructive">{filterError}</p>}
      </form>

      {/* ───────── KPI utama (juga berfungsi sebagai tab chart) ───────── */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Wallet}
          active={activeTab === "potensi"}
          onClick={() => setActiveTab("potensi")}
          title="Potensi Penjualan"
          value={m ? formatRp(m.revenue.current) : "Rp0"}
          trend={m ? trendLabel(m.revenue.changePct) : undefined}
          trendUp={m ? trendUp(m.revenue.changePct) : false}
          subtext={`Total pesanan: ${potentialOrders}`}
        />
        <KpiCard
          icon={PackageCheck}
          active={activeTab === "terjual"}
          onClick={() => setActiveTab("terjual")}
          title="Produk Terjual"
          value={m ? m.units.current.toLocaleString("id-ID") : "0"}
          trend={m ? trendLabel(m.units.changePct) : undefined}
          trendUp={m ? trendUp(m.units.changePct) : false}
          subtext={`Rata-rata harian: ${avgDailyUnits.toFixed(1)} pcs`}
        />
        <KpiCard
          icon={CheckCircle2}
          active={activeTab === "penjualan"}
          onClick={() => setActiveTab("penjualan")}
          title="Penjualan Selesai"
          value={m ? formatRp(m.completedRevenue.current) : "Rp0"}
          trend={m ? trendLabel(m.completedRevenue.changePct) : undefined}
          trendUp={m ? trendUp(m.completedRevenue.changePct) : false}
          subtext={`Rata-rata harian: ${m ? formatRp(m.completedRevenue.current / periodDays) : "Rp0"}`}
        />
        <KpiCard
          icon={ShoppingCart}
          active={activeTab === "pesanan"}
          onClick={() => setActiveTab("pesanan")}
          title="Pesanan Selesai"
          value={m ? m.completedOrders.current.toLocaleString("id-ID") : summary.completedOrders.toString()}
          trend={m ? trendLabel(m.completedOrders.changePct) : undefined}
          trendUp={m ? trendUp(m.completedOrders.changePct) : false}
          subtext={`Rata-rata harian: ${avgDailyCompletedOrders.toFixed(1)} pesanan`}
        />
      </section>

      {/* ───────── Chart + panel samping ───────── */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title={chartMetric.title}
          subtitle={`Data dimuat ${analytics ? new Date(analytics.generatedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: DASHBOARD_TIME_ZONE }) : "—"} WIB`}
          action={
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              <span className="rounded-md border border-border bg-muted px-2.5 py-1 text-foreground">{accountLabel}</span>
              <span className="rounded-md border border-border px-2.5 py-1 text-muted-foreground">
                vs {analytics ? formatDateRange(analytics.window.previous.start, analytics.window.previous.end) : "-"}
              </span>
            </div>
          }
        >
          <div className="h-[260px] md:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} dx={-10} allowDecimals={chartMetric.currency} />
                <Tooltip
                  formatter={(value) => chartMetric.currency ? formatRp(Number(value)) : `${Number(value).toLocaleString("id-ID")} ${activeTab === "terjual" ? "pcs" : "pesanan"}`}
                  labelStyle={{ color: "var(--popover-foreground)" }}
                  itemStyle={{ color: "var(--popover-foreground)" }}
                  contentStyle={{ borderRadius: "12px", border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)", boxShadow: "var(--chart-tooltip-shadow)" }}
                />
                <Legend iconType="plainline" verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: "20px", fontSize: "12px" }} />
                <Line type="monotone" name="Periode Sekarang" dataKey="current" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} activeDot={{ r: 6 }} connectNulls={false} />
                <Line type="monotone" name="Periode Sebelumnya" dataKey="previous" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Yang Perlu Dilakukan" subtitle="Seluruh toko · kondisi terkini; pesanan baru dihitung sejak 00.00 WIB">
          <div className="space-y-2.5">
            <TaskRow icon={ShoppingCart} label="Pesanan Baru" value={summary.newOrders} href="/orders" />
            <TaskRow icon={Truck} label="Siap Dikirim" value={summary.readyToShip} href="/orders" />
            <TaskRow icon={Boxes} label="Stok Menipis" value={summary.criticalStock} href="/inventory?tab=low" critical />
            <TaskRow icon={AlertTriangle} label="Oversell" value={summary.oversell} href="/inventory?tab=oversells" critical />
          </div>
        </Panel>
      </section>

      {/* ───────── Kesehatan operasional ───────── */}
      <Panel title="Kesehatan Operasional" subtitle="Seluruh toko · stok gudang terkini; error sinkronisasi 7 hari terakhir. Tidak mengikuti filter performa penjualan.">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard icon={Boxes} title="Stok Central (Siap Jual)" value={opsKpi ? opsKpi.centralStock.totalSellable.toLocaleString("id-ID") : "…"} href="/inventory" />
          <StatCard icon={AlertTriangle} title="Stok Kritis" value={opsKpi ? opsKpi.lowStock.count.toLocaleString("id-ID") : "…"} href="/inventory" critical />
          <StatCard icon={Info} title="Stok Mismatch" value={opsKpi ? opsKpi.mismatch.total.toLocaleString("id-ID") : "…"} href="/inventory/mismatch" critical />
          <StatCard icon={RefreshCw} title="Gagal Sinkron (7 hari)" value={opsKpi ? opsKpi.syncErrors.count7d.toLocaleString("id-ID") : "…"} onClick={() => setSyncErrorsOpen(true)} critical />
        </div>

        {opsKpi && opsKpi.storeHealth.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Kesehatan Toko</h3>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Toko</th>
                    <th className="px-3 py-3 font-semibold">Platform</th>
                    <th className="px-3 py-3 text-center font-semibold">Token</th>
                    <th className="px-3 py-3 text-center font-semibold">Error 7d</th>
                    <th className="px-3 py-3 text-center font-semibold">Mismatch</th>
                    <th className="px-3 py-3 text-center font-semibold">SKU Belum Mapping</th>
                    <th className="px-4 py-3 font-semibold">Aktivitas Terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {opsKpi.storeHealth.map((s) => {
                    const lastActive = [s.lastOrderAt, s.lastSyncAt].filter((value): value is string => Boolean(value)).sort().at(-1);
                    const unhealthy = !s.hasToken || s.errors7d > 0 || s.mismatch > 0 || s.orphanSkus > 0;
                    return (
                      <tr key={s.accountId} className="border-t border-border transition-colors hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold text-foreground">
                              {s.label.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">{s.label}</div>
                              <StatusBadge status={unhealthy ? "warning" : "success"} label={unhealthy ? "Perlu perhatian" : "Sehat"} className="mt-1" />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-foreground">{s.platform}</td>
                        <td className="px-3 py-3 text-center">
                          <StatusBadge status={s.hasToken ? "success" : "error"} label={s.hasToken ? "Tersedia" : "Belum tersedia"} />
                        </td>
                        <td className="px-3 py-3 text-center text-foreground">{s.errors7d}</td>
                        <td className="px-3 py-3 text-center text-foreground">{s.mismatch}</td>
                        <td className="px-3 py-3 text-center">
                          {s.orphanSkus > 0 ? (
                            <Link href="/products/mapping" className="font-semibold text-foreground hover:underline">
                              {s.orphanSkus}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {lastActive ? `${new Date(lastActive).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: DASHBOARD_TIME_ZONE })} WIB` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      <Dialog open={syncErrorsOpen} onOpenChange={setSyncErrorsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gagal Sinkron (7 hari)</DialogTitle>
            <DialogDescription>Ringkasan error sinkronisasi marketplace dalam 7 hari terakhir.</DialogDescription>
          </DialogHeader>
          {(opsKpi?.syncErrors.byKind.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada error sinkronisasi dalam periode ini.</p>
          ) : (
            <ul className="space-y-2">
              {opsKpi!.syncErrors.byKind.map((error) => (
                <li key={error.kind} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                  <span className="break-all">{error.kind}</span>
                  <span className="font-semibold">{error.count.toLocaleString("id-ID")}</span>
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="outline"><Link href="/settings/accounts">Periksa koneksi toko</Link></Button>
        </DialogContent>
      </Dialog>

      {/* ───────── Panduan Awal (auto-hidden saat semua langkah selesai) ───────── */}
      {onboardingDone < onboardingSteps.length && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <button
            type="button"
            className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/40 md:px-6"
            onClick={() => setPanduanAwalOpen(!panduanAwalOpen)}
            aria-expanded={panduanAwalOpen}
          >
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-foreground">Panduan Awal</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Selesaikan langkah berikut untuk memulai. Tips baru akan muncul seiring bisnis Anda bertumbuh.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-2 max-w-xs flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${onboardingPct}%` }} />
                </div>
                <span className="text-xs font-semibold text-foreground">
                  {onboardingDone}/{onboardingSteps.length} selesai
                </span>
              </div>
            </div>
            {panduanAwalOpen ? <ChevronUp size={18} className="mt-1 shrink-0 text-muted-foreground" /> : <ChevronDown size={18} className="mt-1 shrink-0 text-muted-foreground" />}
          </button>

          {panduanAwalOpen && (
            <div className="border-t border-border p-3 md:p-4">
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
                {onboardingSteps.map((s, i) => (
                  <Link key={s.label} href={s.href} className="group flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted">
                    <div className="flex min-w-0 items-center gap-3">
                      {s.done ? (
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-subtle text-success">
                          <Check size={13} />
                        </div>
                      ) : (
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[11px] font-semibold text-muted-foreground">
                          {i + 1}
                        </div>
                      )}
                      <span className={`text-sm ${s.done ? "text-muted-foreground line-through" : "font-medium text-foreground"}`}>
                        {s.label}
                        <span className="sr-only">{s.done ? ", selesai" : ", belum selesai"}</span>
                      </span>
                    </div>
                    <ArrowRight size={15} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </Link>
                ))}
              </div>
              <div className="mt-2 border-t border-border px-3 pt-3 text-sm text-muted-foreground">
                Butuh bantuan langkah demi langkah?{" "}
                <Link href="/education" className="font-semibold text-foreground hover:underline">
                  Buka panduan lengkap →
                </Link>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ───────── Top lists ───────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Toko Teratas" subtitle={`${accountLabel} · ${periodLabel}`}>
          {(analytics?.topStores ?? []).length === 0 ? (
            <EmptyState
              title="Belum Ada Data Penjualan"
              description="Tidak ada penjualan untuk akun dan periode yang dipilih. Coba ubah filter atau periksa koneksi toko."
              href="/settings/accounts"
              cta="Hubungkan Toko"
            />
          ) : (
            <ul className="space-y-3">
              {analytics!.topStores.map((store, i) => (
                <li key={store.id} className="rounded-xl border border-border p-3 transition-colors hover:bg-muted/40">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold text-foreground">
                        {i + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{store.label}</p>
                        <p className="text-xs text-muted-foreground">{store.platform}</p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-foreground">{formatRp(store.value)}</p>
                      <p className="text-xs text-muted-foreground">{store.units} pcs terjual</p>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (store.value / maxStoreValue) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Produk Terjual Teratas" subtitle={`3 produk dengan kuantitas tertinggi · ${periodLabel}`}>
          {(analytics?.topProducts ?? []).length === 0 ? (
            <EmptyState
              title="Belum Ada Produk Terjual"
              description="Tidak ada produk terjual untuk akun dan periode yang dipilih. Coba ubah filter untuk melihat periode lain."
              href="/products"
              cta="Lihat Produk Master"
            />
          ) : (
            <ul className="space-y-3">
              {analytics!.topProducts.slice(0, 3).map((product, i) => (
                <li key={product.key} className="flex items-start justify-between gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-muted/40">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-bold text-muted-foreground">
                      #{i + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold leading-tight text-foreground">{product.name}</p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">{product.sku ?? product.channelSku ?? "—"}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-muted-foreground">Kuantitas</p>
                    <p className="text-sm font-semibold text-foreground">{product.qty} Pcs</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </div>
  );
}

/* ───────────────────────── Komponen UI ───────────────────────── */

function Panel({
  title,
  subtitle,
  action,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-card shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 md:px-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5 md:p-6">{children}</div>
    </section>
  );
}

function KpiCard({
  icon: Icon,
  active,
  onClick,
  title,
  value,
  trend,
  trendUp,
  subtext,
}: {
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  title: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
  subtext?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group relative rounded-2xl border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
        active ? "border-primary ring-1 ring-primary/30" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
          <Icon size={17} />
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <span className="break-all text-2xl font-bold tracking-tight text-foreground">{value}</span>
        {trend && (
          <span
            className={`mb-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              trendUp ? "bg-success-subtle text-success" : "bg-destructive-subtle text-destructive"
            }`}
          >
            {trendUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {trend}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{subtext}</p>
    </button>
  );
}

function TaskRow({
  icon: Icon,
  label,
  value,
  href,
  critical,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  href: string;
  critical?: boolean;
}) {
  const alert = critical && value > 0;
  return (
    <Link
      href={href}
      className={`group flex items-center justify-between gap-3 rounded-xl border p-3.5 transition-all hover:shadow-sm ${
        alert ? "border-destructive/40 bg-destructive-subtle" : "border-border bg-card hover:bg-muted/40"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${alert ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"}`}>
          <Icon size={16} aria-hidden="true" />
        </span>
        <span className={`text-sm font-medium ${alert ? "text-destructive" : "text-foreground"}`}>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-xl font-bold ${alert ? "text-destructive" : "text-foreground"}`}>{value}</span>
        <ArrowUpRight size={14} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </Link>
  );
}

function StatCard({
  icon: Icon,
  title,
  value,
  href,
  onClick,
  critical,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  href?: string;
  onClick?: () => void;
  critical?: boolean;
}) {
  const alert = !!critical && value !== "0" && value !== "…";
  const cls = `block min-w-0 rounded-xl border p-4 transition-all hover:shadow-md ${
    alert ? "border-destructive/40 bg-destructive-subtle" : "border-border bg-card hover:border-ring"
  }`;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-medium ${alert ? "text-destructive" : "text-muted-foreground"}`}>{title}</span>
        <Icon size={15} className={alert ? "text-destructive" : "text-muted-foreground"} aria-hidden="true" />
      </div>
      <p className={`mt-3 text-2xl font-bold tracking-tight ${alert ? "text-destructive" : "text-foreground"}`}>{value}</p>
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : onClick ? (
    <button type="button" onClick={onClick} className={`${cls} w-full text-left`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function EmptyState({ title, description, href, cta }: { title: string; description: string; href: string; cta: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-4 py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Store size={20} className="text-muted-foreground" />
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mb-3 mt-1 max-w-xs text-xs text-muted-foreground">{description}</p>
      <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:underline">
        {cta} <ArrowRight size={12} />
      </Link>
    </div>
  );
}
