"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Check, Info } from "lucide-react";
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

  useEffect(() => {
    async function loadAll() {
      try {
        const token = localStorage.getItem("token");
        const headers = { Authorization: `Bearer ${token}` };
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
    return <div className="min-h-full flex items-center justify-center text-gray-500 text-sm py-20">Memuat...</div>;
  }

  const m = analytics?.metrics;
  const chartData = analytics?.chart ?? [];
  const potentialOrders = m?.revenue.orders ?? 0;
  const avgDailyUnits = m ? m.units.current / 7 : 0;
  const avgDailyCompletedOrders = m ? m.completedOrders.current / 7 : 0;

  return (
    <div className="p-4 md:p-8">
      <div className="mb-4 md:mb-6 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 md:px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">Yang Perlu Dilakukan</h2>
        </div>
        <div className="p-4 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ActionCard title="Pesanan Baru" value={summary.newOrders.toString()} />
          <ActionCard title="Siap Dikirim" value={summary.readyToShip.toString()} />
          <ActionCard title="Stok Menipis" value={summary.criticalStock.toString()} />
          <ActionCard title="Oversell" value={summary.oversell.toString()} />
        </div>
      </div>

      <div className="mb-4 md:mb-6 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 md:px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">Kesehatan Operasional</h2>
          <span className="text-xs text-gray-500">Stok central & sinkronisasi marketplace</span>
        </div>
        <div className="p-4 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <ActionCard title="Stok Central (Siap Jual)" value={opsKpi ? opsKpi.centralStock.totalSellable.toLocaleString("id-ID") : "…"} />
          <ActionCard title="Stok Kritis" value={opsKpi ? opsKpi.lowStock.count.toLocaleString("id-ID") : "…"} />
          <ActionCard title="Stok Mismatch" value={opsKpi ? opsKpi.mismatch.total.toLocaleString("id-ID") : "…"} />
          <ActionCard title="Sync Error (7 hari)" value={opsKpi ? opsKpi.syncErrors.count7d.toLocaleString("id-ID") : "…"} />
        </div>
        {opsKpi && opsKpi.storeHealth.length > 0 && (
          <div className="px-4 md:px-6 pb-6">
            <h3 className="text-sm font-bold text-gray-700 mb-2">Kesehatan Toko</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
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
                      <tr key={s.accountId} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 pr-3 font-medium text-gray-900">
                          <span className={`mr-2 inline-block h-2 w-2 rounded-full ${unhealthy ? "bg-amber-500" : "bg-emerald-500"}`} title={unhealthy ? "Perlu perhatian" : "Sehat"} />
                          {s.label}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{s.platform}</td>
                        <td className="px-3 py-2 text-center">
                          {s.hasToken ? <span className="text-emerald-600 font-semibold">OK</span> : <span className="text-red-600 font-semibold">Hilang</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-gray-700">{s.errors7d}</td>
                        <td className="px-3 py-2 text-center text-gray-700">{s.mismatch}</td>
                        <td className="px-3 py-2 text-center">
                          {s.orphanSkus > 0 ? <a href="/products/mapping" className="font-semibold text-amber-600 hover:underline">{s.orphanSkus}</a> : <span className="text-gray-400">0</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">
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

      {/* Section: Panduan Awal */}
      <div className="mb-6 md:mb-8 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 md:px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50" onClick={() => setPanduanAwalOpen(!panduanAwalOpen)}>
          <div>
            <h2 className="text-lg font-bold text-gray-800">Panduan Awal</h2>
            <p className="text-sm text-gray-500 mt-1">Berikut panduan untuk kamu memulai. Kamu akan mendapatkan tips baru seiring bisnis kamu bertumbuh</p>
          </div>
          {panduanAwalOpen ? <ChevronUp className="text-gray-400" /> : <ChevronDown className="text-gray-400" />}
        </div>
        {panduanAwalOpen && (
          <div className="p-4 md:p-6 border-t border-gray-100">
            <div className="bg-blue-50 text-blue-600 font-semibold text-xs px-3 py-1 rounded-md inline-block mb-4">1/6 Selesai</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white"><Check size={12} /></div>
                  <span className="text-sm text-gray-700">Buat Produk Master</span>
                </div>
                <ChevronDown size={16} className="text-gray-400" />
              </div>
              <div className="py-2 border-b border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full border-2 border-gray-200 border-dashed"></div>
                    <span className="text-sm font-semibold text-gray-800">Tambah Produk ke Marketplace</span>
                  </div>
                  <ChevronUp size={16} className="text-gray-400" />
                </div>
                <div className="ml-8 bg-gray-50 rounded-lg p-4 md:p-5 flex border border-gray-100 flex-col md:flex-row">
                  <div className="flex-1">
                    <h3 className="text-base font-bold text-gray-900 mb-2">Tambah produk kamu ke marketplace</h3>
                    <p className="text-sm text-gray-600 mb-6">Tambah produk master ke semua marketplace kamu. <a href="#" className="text-blue-600 hover:underline">Lebih Lanjut</a></p>
                    <div className="flex items-center gap-4">
                      <button className="bg-[#2a3a8c] text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-blue-900 transition-colors">Tambah Sekarang</button>
                      <a href="#" className="text-sm font-semibold text-[#2a3a8c] hover:underline">Kaitkan Produk Marketplace ke Master</a>
                    </div>
                  </div>
                  <div className="w-full md:w-64 shrink-0 rounded-lg overflow-hidden relative shadow-sm border border-gray-200 bg-white flex items-center justify-center mt-4 md:mt-0">
                    <div className="absolute inset-0 bg-[#42509f] opacity-90 p-4">
                      <div className="text-white text-xs font-bold mb-2 flex items-center gap-2"><span className="bg-yellow-400 text-gray-900 px-1 py-0.5 rounded text-[10px]">Step 2</span></div>
                      <div className="text-white font-bold text-sm leading-tight">How to publish product to Marketplace</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 rounded-full border-2 border-gray-200 border-dashed"></div>
                  <span className="text-sm text-gray-600">Kelola Inventori</span>
                </div>
                <ChevronDown size={16} className="text-gray-400" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Analisis Bisnis</h2>
            <p className="text-xs text-gray-500 mt-1">Pembaruan terakhir pada {new Date().toLocaleString()}</p>
          </div>
          <button className="border border-gray-200 bg-white px-3 py-1.5 rounded-md text-sm text-gray-600 font-medium hover:bg-gray-50 flex items-center gap-2">
            Waktu Pesanan Dibuat <ChevronDown size={14}/>
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 md:p-5 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-lg font-bold text-gray-800">
              Penjualan <Info size={14} className="text-gray-400" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select className="border border-gray-200 rounded-md px-3 py-1.5 text-sm text-gray-700 outline-none bg-white font-medium">
                <option>Semua Marketplace</option>
              </select>
              <select className="border border-gray-200 rounded-md px-3 py-1.5 text-sm text-gray-700 outline-none bg-white font-medium">
                <option>{analytics ? formatDateRange(analytics.window.current.start, analytics.window.current.end) : "Periode berjalan"}</option>
              </select>
              <div className="text-sm text-gray-600 font-medium flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-md border border-gray-100">
                Perbandingan: <span className="text-gray-900">{analytics ? formatDateRange(analytics.window.previous.start, analytics.window.previous.end) : "-"}</span> <ChevronDown size={14}/>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-x divide-gray-100">
            <MetricTab active={activeTab === 'potensi'} onClick={() => setActiveTab('potensi')} title="Potensi Penjualan" value={m ? formatRp(m.revenue.current) : "Rp0"} trend={m ? trendLabel(m.revenue.changePct) : undefined} trendUp={m ? trendUp(m.revenue.changePct) : false} subtext={`Total pesanan: ${potentialOrders}`} />
            <MetricTab active={activeTab === 'terjual'} onClick={() => setActiveTab('terjual')} title="Produk Terjual" value={m ? m.units.current.toString() : "0"} trend={m ? trendLabel(m.units.changePct) : undefined} trendUp={m ? trendUp(m.units.changePct) : false} subtext={`Rata-rata terjual harian: ${avgDailyUnits.toFixed(1)}`} />
            <MetricTab active={activeTab === 'penjualan'} onClick={() => setActiveTab('penjualan')} title="Penjualan Selesai" value={m ? formatRp(m.completedRevenue.current) : "Rp0"} trend={m ? trendLabel(m.completedRevenue.changePct) : undefined} trendUp={m ? trendUp(m.completedRevenue.changePct) : false} subtext={`Rata-rata penjualan: ${m ? formatRp(m.completedRevenue.current / 7) : "Rp0"}`} />
            <MetricTab active={activeTab === 'pesanan'} onClick={() => setActiveTab('pesanan')} title="Pesanan Selesai" value={m ? m.completedOrders.current.toString() : summary.completedOrders.toString()} trend={m ? trendLabel(m.completedOrders.changePct) : undefined} trendUp={m ? trendUp(m.completedOrders.changePct) : false} subtext={`Rata-rata pesanan harian: ${avgDailyCompletedOrders.toFixed(1)}`} />
          </div>

          <div className="p-4 md:p-6 h-[250px] md:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} dx={-10} />
                <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                <Legend iconType="plainline" verticalAlign="top" align="right" wrapperStyle={{paddingBottom: '20px', fontSize: '12px'}} />
                <Line type="monotone" name="Periode Sekarang" dataKey="current" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 6 }} connectNulls={false} />
                <Line type="monotone" name="Periode Sebelumnya" dataKey="previous" stroke="#93c5fd" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2 text-base font-bold text-gray-800 border-b border-gray-100 pb-4 mb-4">
              Toko Teratas <Info size={14} className="text-gray-400" />
            </div>
            {(analytics?.topStores ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">Belum ada penjualan pada periode ini.</p>
            ) : (analytics!.topStores.map((store) => (
              <div key={store.id} className="flex items-center justify-between border border-gray-100 rounded-lg p-3 mb-2 last:mb-0">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-green-100 text-green-700 rounded-md flex items-center justify-center font-bold text-xs">{store.label.charAt(0)}</div>
                    <span className="font-semibold text-sm text-gray-800">{store.label}</span>
                  </div>
                  <div className="flex items-center gap-8">
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1">Potensi Penjualan</p>
                      <p className="text-sm font-semibold">{formatRp(store.value)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1">Produk Terjual</p>
                      <p className="text-sm font-semibold">{store.units}</p>
                    </div>
                  </div>
              </div>
            )))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2 text-base font-bold text-gray-800 border-b border-gray-100 pb-4 mb-4">
              Produk Terjual Teratas <Info size={14} className="text-gray-400" />
            </div>
            {(analytics?.topProducts ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">Belum ada penjualan pada periode ini.</p>
            ) : (analytics!.topProducts.slice(0, 3).map((product) => (
              <div key={product.key} className="flex justify-between items-center border border-gray-100 rounded-lg p-3 mb-2 last:mb-0">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 bg-orange-200 rounded-md shrink-0"></div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800 leading-tight">{product.name}</p>
                      <p className="text-xs text-gray-500 mt-1">{product.sku ?? product.channelSku ?? "—"}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400 mb-1">Kuantitas</p>
                    <p className="text-sm font-semibold">{product.qty} Pcs</p>
                  </div>
              </div>
            )))}
          </div>
      </div>
    </div>
  );
}

function ActionCard({ title, value }: { title: string, value: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white flex flex-col justify-between h-[100px] hover:border-emerald-500 transition-colors cursor-pointer">
      <span className="text-sm font-semibold text-gray-800">{title}</span>
      <span className="text-2xl font-bold text-blue-600">{value}</span>
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
      className={`p-4 cursor-pointer relative ${active ? 'bg-white' : 'bg-gray-50 hover:bg-gray-100'}`}
      onClick={onClick}
    >
      {active && <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600"></div>}
      <div className="flex items-center gap-1 text-sm font-semibold text-gray-700 mb-2">
        {title} <Info size={12} className="text-gray-400" />
      </div>
      <div className="flex items-end gap-2 mb-2">
        <span className={`text-xl font-bold ${active ? 'text-blue-600' : 'text-gray-900'}`}>{value}</span>
        {trend && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${trendUp ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {trend}
          </span>
        )}
        {badge && (
          <span className="text-[10px] font-bold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded ml-1">
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500">{subtext}</p>
    </div>
  );
}
