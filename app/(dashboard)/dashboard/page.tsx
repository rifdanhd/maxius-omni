"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ChevronRight, Check, Info, TrendingUp, TrendingDown } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { authFetch } from "@/lib/utils/api-client";

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
  chart: { date: string; current: number | null; previous: number | null }[];
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
  const fmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt.format(new Date(isoStart))} - ${fmt.format(new Date(isoEnd))}`;
}

function trendLabel(pct: number | null): string | undefined {
  if (pct === null) return undefined;
  return `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct)}%`;
}

function trendUp(pct: number | null): boolean {
  return pct !== null && pct >= 0;
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary>({ accountsConnected: 0, activeSku: 0, criticalStock: 0, newOrders: 0, readyToShip: 0, completedOrders: 0, oversell: 0 });
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [opsKpi, setOpsKpi] = useState<OpsKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('potensi'); // potensi, terjual, penjualan, pesanan
  const [panduanAwalOpen, setPanduanAwalOpen] = useState(true);
  const [greet, setGreet] = useState<{ name: string | null; salam: string; date: string } | null>(null);
  useEffect(() => {
    queueMicrotask(() => {
      const h = new Date().getHours();
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
    async function loadAll() {
      try {
        const headers = { };
        const [summaryRes, analyticsRes, kpiRes] = await Promise.all([
          authFetch("/api/summary", { headers }),
          authFetch("/api/analytics", { headers }),
          authFetch("/api/dashboard/kpi", { headers }),
        ]);
        if (summaryRes.ok) {
          setSummary(await summaryRes.json());
        }
        if (analyticsRes.ok) {
          setAnalytics(await analyticsRes.json());
        }
        if (kpiRes.ok) {
          setOpsKpi(await kpiRes.json());
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, []);

  if (loading) {
    return (
      <div className="p-4 md:p-8 animate-pulse">
        {/* Greeting skeleton */}
        <div className="mb-6 bg-card rounded-xl border border-border px-6 py-5">
          <div className="h-7 bg-muted rounded w-64 max-w-full mb-2" />
          <div className="h-4 bg-muted rounded w-48" />
        </div>
        {/* Action cards skeleton */}
        <div className="mb-6 bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <div className="h-5 bg-muted rounded w-48" />
          </div>
          <div className="p-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border border-border rounded-lg p-4 h-[100px] bg-muted/30" />
            ))}
          </div>
        </div>
        {/* Chart skeleton */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-5 border-b border-border">
            <div className="h-5 bg-muted rounded w-32" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-x divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4">
                <div className="h-3 bg-muted rounded w-28 mb-3" />
                <div className="h-6 bg-muted rounded w-20 mb-2" />
                <div className="h-3 bg-muted rounded w-36" />
              </div>
            ))}
          </div>
          <div className="p-6 h-[300px] bg-muted/20 rounded-b-xl" />
        </div>
      </div>
    );
  }

  const m = analytics?.metrics;
  const chartData = analytics?.chart ?? [];
  const potentialOrders = m?.revenue.orders ?? 0;
  const avgDailyUnits = m ? m.units.current / 7 : 0;
  const avgDailyCompletedOrders = m ? m.completedOrders.current / 7 : 0;

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

  return (
    <div className="p-4 md:p-8">
      <div className="mb-4 md:mb-6 bg-card rounded-xl border border-border shadow-sm px-4 md:px-6 py-5">
        <h1 className="text-xl md:text-2xl font-bold text-foreground">
          {greet ? `${greet.salam}, ${greet.name ?? "Seller"}` : "Selamat datang"} 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {greet ? `${greet.date} · ` : ""}Berikut ringkasan toko Anda hari ini.
        </p>
      </div>

      <div className="mb-4 md:mb-6 bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-4 md:px-6 py-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">Yang Perlu Dilakukan</h2>
        </div>
        <div className="p-4 md:p-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <ActionCard title="Pesanan Baru" value={summary.newOrders.toString()} />
          <ActionCard title="Siap Dikirim" value={summary.readyToShip.toString()} />
          <ActionCard title="Stok Menipis" value={summary.criticalStock.toString()} />
          <ActionCard title="Oversell" value={summary.oversell.toString()} />
        </div>
      </div>

      <div className="mb-4 md:mb-6 bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-4 md:px-6 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-bold text-foreground">Kesehatan Operasional</h2>
          <span className="text-xs text-muted-foreground">Stok central & sinkronisasi marketplace</span>
        </div>
        <div className="p-4 md:p-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <ActionCard title="Stok Central (Siap Jual)" value={opsKpi ? opsKpi.centralStock.totalSellable.toLocaleString("id-ID") : "…"} />
          <ActionCard title="Stok Kritis" value={opsKpi ? opsKpi.lowStock.count.toLocaleString("id-ID") : "…"} />
          <ActionCard title="Stok Mismatch" value={opsKpi ? opsKpi.mismatch.total.toLocaleString("id-ID") : "…"} href="/inventory/mismatch" />
          <ActionCard title="Sync Error (7 hari)" value={opsKpi ? opsKpi.syncErrors.count7d.toLocaleString("id-ID") : "…"} />
        </div>
        {opsKpi && opsKpi.storeHealth.length > 0 && (
          <div className="px-4 md:px-6 pb-6">
            <h3 className="text-sm font-bold text-foreground mb-2">Kesehatan Toko</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Toko</th>
                    <th className="px-3 py-2">Platform</th>
                    <th className="px-3 py-2 text-center">Token</th>
                    <th className="px-3 py-2 text-center">Error 7d</th>
                    <th className="px-3 py-2 text-center">Mismatch</th>
                    <th className="px-3 py-2 text-center">SKU Belum Mapping</th>
                    <th className="px-3 py-2">Aktivitas Terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {opsKpi.storeHealth.map((s) => {
                    const lastActive = s.lastOrderAt ?? s.lastSyncAt;
                    const unhealthy = !s.hasToken || s.errors7d > 0 || s.mismatch > 0 || s.orphanSkus > 0;
                    return (
                      <tr key={s.accountId} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3 font-medium text-foreground">
                          <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${unhealthy ? "bg-destructive animate-pulse" : "bg-green-500"}`} title={unhealthy ? "Perlu perhatian" : "Sehat"} />
                          {s.label}
                        </td>
                        <td className="px-3 py-2 text-foreground">{s.platform}</td>
                        <td className="px-3 py-2 text-center">
                          {s.hasToken ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">OK</span> : <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-destructive-subtle text-destructive">Hilang</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-foreground">{s.errors7d}</td>
                        <td className="px-3 py-2 text-center text-foreground">{s.mismatch}</td>
                        <td className="px-3 py-2 text-center">
                          {s.orphanSkus > 0 ? <a href="/products/mapping" className="font-semibold text-foreground hover:underline">{s.orphanSkus}</a> : <span className="text-muted-foreground">0</span>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          {lastActive ? new Date(lastActive).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Section: Panduan Awal — auto-hidden saat semua langkah selesai */}
      {onboardingDone < onboardingSteps.length && (
        <div className="mb-6 md:mb-8 bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-4 md:px-6 py-4 flex items-start justify-between gap-3 cursor-pointer hover:bg-muted" onClick={() => setPanduanAwalOpen(!panduanAwalOpen)}>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground">Panduan Awal</h2>
              <p className="text-sm text-muted-foreground mt-1">Berikut panduan untuk kamu memulai. Kamu akan mendapatkan tips baru seiring bisnis kamu bertumbuh</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-muted text-foreground">{onboardingDone}/{onboardingSteps.length}</span>
              {panduanAwalOpen ? <ChevronUp size={18} className="text-muted-foreground" /> : <ChevronDown size={18} className="text-muted-foreground" />}
            </div>
          </div>
          {panduanAwalOpen && (
            <div className="p-4 md:p-6 border-t border-border">
              <div className="space-y-1">
                {onboardingSteps.map((s) => (
                  <Link
                    key={s.label}
                    href={s.href}
                    className="flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg hover:bg-muted group"
                  >
                    <div className="flex items-center gap-3">
                      {s.done ? (
                        <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white shrink-0">
                          <Check size={12} />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-border border-dashed shrink-0" />
                      )}
                      <span className={`text-sm ${s.done ? "text-muted-foreground line-through" : "font-semibold text-foreground"}`}>{s.label}</span>
                    </div>
                    <ChevronRight size={16} className="text-muted-foreground group-hover:text-foreground shrink-0" />
                  </Link>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-border text-sm text-foreground">
                Butuh bantuan langkah demi langkah?{" "}
                <Link href="/education" className="font-semibold text-foreground hover:underline">
                  Buka Panduan lengkap →
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-foreground">Analisis Bisnis</h2>
            <p className="text-xs text-muted-foreground mt-1">Pembaruan terakhir pada {new Date().toLocaleString()}</p>
          </div>
          <button className="border border-border bg-card px-3 py-1.5 rounded-md text-sm text-foreground font-medium hover:bg-muted flex items-center gap-2">
            Waktu Pesanan Dibuat <ChevronDown size={14}/>
          </button>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 md:p-5 border-b border-border flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-lg font-bold text-foreground">
              Penjualan <Info size={14} className="text-muted-foreground" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="border border-border rounded-md px-3 py-1.5 text-sm text-foreground bg-muted font-medium">
                Semua Marketplace
              </div>
              <div className="border border-border rounded-md px-3 py-1.5 text-sm text-foreground bg-card font-medium">
                {analytics ? formatDateRange(analytics.window.current.start, analytics.window.current.end) : "Periode berjalan"}
              </div>
              <div className="text-sm text-muted-foreground font-medium flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md border border-border">
                vs <span className="text-foreground">{analytics ? formatDateRange(analytics.window.previous.start, analytics.window.previous.end) : "-"}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-x divide-border">
            <MetricTab active={activeTab === 'potensi'} onClick={() => setActiveTab('potensi')} title="Potensi Penjualan" value={m ? formatRp(m.revenue.current) : "Rp0"} trend={m ? trendLabel(m.revenue.changePct) : undefined} trendUp={m ? trendUp(m.revenue.changePct) : false} subtext={`Total pesanan: ${potentialOrders}`} />
            <MetricTab active={activeTab === 'terjual'} onClick={() => setActiveTab('terjual')} title="Produk Terjual" value={m ? m.units.current.toString() : "0"} trend={m ? trendLabel(m.units.changePct) : undefined} trendUp={m ? trendUp(m.units.changePct) : false} subtext={`Rata-rata terjual harian: ${avgDailyUnits.toFixed(1)}`} />
            <MetricTab active={activeTab === 'penjualan'} onClick={() => setActiveTab('penjualan')} title="Penjualan Selesai" value={m ? formatRp(m.completedRevenue.current) : "Rp0"} trend={m ? trendLabel(m.completedRevenue.changePct) : undefined} trendUp={m ? trendUp(m.completedRevenue.changePct) : false} subtext={`Rata-rata penjualan: ${m ? formatRp(m.completedRevenue.current / 7) : "Rp0"}`} />
            <MetricTab active={activeTab === 'pesanan'} onClick={() => setActiveTab('pesanan')} title="Pesanan Selesai" value={m ? m.completedOrders.current.toString() : summary.completedOrders.toString()} trend={m ? trendLabel(m.completedOrders.changePct) : undefined} trendUp={m ? trendUp(m.completedOrders.changePct) : false} subtext={`Rata-rata pesanan harian: ${avgDailyCompletedOrders.toFixed(1)}`} />
          </div>

          <div className="p-4 md:p-6 h-[250px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: 'var(--muted-foreground)', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: 'var(--muted-foreground)', fontSize: 12}} dx={-10} />
                <Tooltip labelStyle={{ color: "var(--popover-foreground)" }} itemStyle={{ color: "var(--popover-foreground)" }} contentStyle={{borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--popover)', color: 'var(--popover-foreground)', boxShadow: 'var(--chart-tooltip-shadow)'}} />
                <Legend iconType="plainline" verticalAlign="top" align="right" wrapperStyle={{paddingBottom: '20px', fontSize: '12px'}} />
                <Line type="monotone" name="Periode Sekarang" dataKey="current" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 6 }} connectNulls={false} />
                <Line type="monotone" name="Periode Sebelumnya" dataKey="previous" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2 text-base font-bold text-foreground border-b border-border pb-4 mb-4">
              Toko Teratas <Info size={14} className="text-muted-foreground" />
            </div>
            {(analytics?.topStores ?? []).length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <Info size={20} className="text-muted-foreground" />
                </div>
                <p className="text-sm font-semibold text-foreground mb-1">Belum Ada Data Penjualan</p>
                <p className="text-xs text-muted-foreground mb-3">Pesanan akan muncul setelah toko kamu terhubung dan menerima pesanan.</p>
                <a href="/settings/accounts" className="text-xs font-semibold text-foreground underline hover:no-underline">Hubungkan Toko →</a>
              </div>
            ) : (analytics!.topStores.map((store) => (
              <div key={store.id} className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border border-border rounded-lg p-3 mb-2 last:mb-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="w-8 h-8 shrink-0 bg-muted text-foreground rounded-md flex items-center justify-center font-bold text-xs">{store.label.charAt(0)}</div>
                    <span className="min-w-0 break-words font-semibold text-sm text-foreground">{store.label}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:gap-8">
                    <div className="min-w-0 break-words">
                      <p className="text-[10px] text-muted-foreground mb-1">Potensi Penjualan</p>
                      <p className="text-sm font-semibold">{formatRp(store.value)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">Produk Terjual</p>
                      <p className="text-sm font-semibold">{store.units}</p>
                    </div>
                  </div>
              </div>
            )))}
          </div>

          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2 text-base font-bold text-foreground border-b border-border pb-4 mb-4">
              Produk Terjual Teratas <Info size={14} className="text-muted-foreground" />
            </div>
            {(analytics?.topProducts ?? []).length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <Info size={20} className="text-muted-foreground" />
                </div>
                <p className="text-sm font-semibold text-foreground mb-1">Belum Ada Produk Terjual</p>
                <p className="text-xs text-muted-foreground mb-3">Data produk terlaris akan muncul saat ada pesanan masuk dalam periode ini.</p>
                <a href="/products" className="text-xs font-semibold text-foreground underline hover:no-underline">Lihat Produk Master →</a>
              </div>
            ) : (analytics!.topProducts.slice(0, 3).map((product) => (
              <div key={product.key} className="flex justify-between items-start gap-3 border border-border rounded-lg p-3 mb-2 last:mb-0">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="w-12 h-12 bg-muted rounded-md shrink-0"></div>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-foreground leading-tight">{product.name}</p>
                      <p className="break-all text-xs text-muted-foreground mt-1">{product.sku ?? product.channelSku ?? "—"}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] text-muted-foreground mb-1">Kuantitas</p>
                    <p className="text-sm font-semibold">{product.qty} Pcs</p>
                  </div>
              </div>
            )))}
          </div>
      </div>
    </div>
  );
}

const CRITICAL_TITLES = ["Oversell", "Stok Menipis", "Stok Kritis", "Stok Mismatch", "Sync Error (7 hari)"];

function ActionCard({ title, value, href }: { title: string, value: string, href?: string }) {
  const isCritical = CRITICAL_TITLES.includes(title) && value !== "0" && value !== "…";
  const cls = `min-w-0 border rounded-lg p-3 sm:p-4 flex flex-col gap-2 justify-between min-h-[100px] hover:shadow-md transition-all cursor-pointer ${
    isCritical
      ? "border-destructive/40 bg-destructive-subtle"
      : "border-border bg-card hover:border-ring"
  }`;
  const valueColor = isCritical ? "text-destructive" : "text-foreground";
  if (href) {
    return (
      <Link href={href} className={cls}>
        <span className={`text-sm font-semibold ${isCritical ? "text-destructive" : "text-foreground"}`}>{title}</span>
        <span className={`text-2xl font-bold ${valueColor}`}>{value}</span>
      </Link>
    );
  }
  return (
    <div className={cls}>
      <span className={`text-sm font-semibold ${isCritical ? "text-destructive" : "text-foreground"}`}>{title}</span>
      <span className={`text-2xl font-bold ${valueColor}`}>{value}</span>
    </div>
  );
}

function MetricTab({ active, onClick, title, value, trend, trendUp, badge, subtext }: {
  active: boolean;
  onClick: () => void;
  title: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
  badge?: string;
  subtext?: string;
}) {
  return (
    <div 
      className={`p-4 cursor-pointer relative transition-colors ${active ? 'bg-card' : 'bg-muted/50 hover:bg-muted'}`}
      onClick={onClick}
    >
      {active && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-primary rounded-t-full"></div>}
      <div className="flex items-center gap-1 text-sm font-semibold text-foreground mb-2">
        {title} <Info size={12} className="text-muted-foreground" />
      </div>
      <div className="flex flex-wrap items-end gap-2 mb-2">
        <span className={`break-all text-xl font-bold ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{value}</span>
        {trend && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
            trendUp 
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          }`}>
            {trendUp ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {trend}
          </span>
        )}
        {badge && (
          <span className="text-[10px] font-bold bg-muted text-foreground px-1.5 py-0.5 rounded ml-1">
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{subtext}</p>
    </div>
  );
}
