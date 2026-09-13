"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { authFetch } from "@/lib/utils/api-client";

/* ------------------------------ Types ------------------------------ */

type WinningRow = {
  key: string;
  productId: string | null;
  productName: string;
  category: string | null;
  variantId: string | null;
  sku: string | null;
  variantName: string | null;
  qty: number;
  revenue: number;
  orders: number;
};

type Slice = { id: string; label: string; platform?: string; orders: number; revenue: number; units: number };

type OmsetReport = {
  range: { fromMs: number; toMs: number };
  total: { orders: number; revenue: number; units: number };
  buckets: Array<{ bucket: string; orders: number; revenue: number; units: number }>;
  byPlatform: Slice[];
  byAccount: Slice[];
  byCategory: Slice[];
};

type Account = { id: string; platform: string; label: string };

type PresetId = "today" | "7d" | "30d" | "month" | "custom";

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: "today", label: "Hari Ini" },
  { id: "7d", label: "7 Hari" },
  { id: "30d", label: "30 Hari" },
  { id: "month", label: "Bulan Ini" },
  { id: "custom", label: "Custom" },
];

const fmtRp = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");
const fmt = (n: number) => n.toLocaleString("id-ID");

function jakartaYMD(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function presetRange(preset: PresetId, customFrom: string, customTo: string): { from: string; to: string } {
  const today = jakartaYMD(new Date());
  if (preset === "today") return { from: today, to: today };
  if (preset === "custom") return { from: customFrom || today, to: customTo || today };
  if (preset === "month") {
    const first = jakartaYMD(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    return { from: first, to: today };
  }
  const days = preset === "7d" ? 7 : 30;
  const from = jakartaYMD(new Date(Date.now() - (days - 1) * 86_400_000));
  return { from, to: today };
}

async function api<T>(path: string): Promise<T> {
  const res = await authFetch(path, { headers: { "Content-Type": "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

/* ------------------------------ Page ------------------------------ */

export default function SalesReportPage() {
  const [preset, setPreset] = useState<PresetId>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [platform, setPlatform] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [groupBy, setGroupBy] = useState<"variant" | "product">("variant");
  const [omset, setOmset] = useState<OmsetReport | null>(null);
  const [winning, setWinning] = useState<WinningRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    api<{ accounts: Account[] }>("/api/accounts")
      .then((d) => setAccounts(d.accounts))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const { from, to } = presetRange(preset, customFrom, customTo);
        const p = new URLSearchParams({ from, to });
        if (platform) p.set("platform", platform);
        if (accountId) p.set("accountId", accountId);
        const granularity =
          preset === "month" || preset === "custom" ? "day" : preset === "7d" || preset === "today" ? "day" : "week";
        const [o, w] = await Promise.all([
          api<OmsetReport>(`/api/reports/omset?${p.toString()}&granularity=${granularity}`),
          api<{ rows: WinningRow[] }>(
            `/api/reports/winning?${p.toString()}&groupBy=${groupBy}&limit=20`
          ),
        ]);
        if (cancelled) return;
        setOmset(o);
        setWinning(w.rows);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Gagal memuat laporan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [preset, customFrom, customTo, platform, accountId, groupBy, reloadKey]);

  const visibleAccounts = platform ? accounts.filter((a) => a.platform === platform) : accounts;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Laporan Penjualan</h1>
          <p className="mt-1 text-sm text-gray-500">
            Omset & produk paling laku, dihitung langsung dari order (tanpa cancelled/refunded).
          </p>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Muat Ulang
        </button>
      </div>

      {/* Filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-4">
        {PRESETS.map((t) => (
          <button
            key={t.id}
            onClick={() => setPreset(t.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              preset === t.id
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
        {preset === "custom" && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
            <span className="text-sm text-gray-500">s/d</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
          </>
        )}
        <select
          value={platform}
          onChange={(e) => {
            setPlatform(e.target.value);
            setAccountId("");
          }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
        >
          <option value="">Semua Marketplace</option>
          <option value="SHOPEE">Shopee</option>
          <option value="TIKTOK_SHOP">TikTok Shop</option>
          <option value="TOKOPEDIA">Tokopedia</option>
        </select>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
        >
          <option value="">Semua Akun</option>
          {visibleAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !omset ? (
        <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white p-10 text-gray-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat…
        </div>
      ) : (
        <>
          {/* Ringkasan */}
          <div className="mb-4 grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="text-sm font-medium text-gray-500">Total Omset</div>
              <div className="mt-1 text-2xl font-bold text-blue-600">
                {omset ? fmtRp(omset.total.revenue) : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="text-sm font-medium text-gray-500">Total Order</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">
                {omset ? fmt(omset.total.orders) : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="text-sm font-medium text-gray-500">Produk Terjual</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">
                {omset ? fmt(omset.total.units) : "—"}
              </div>
            </div>
          </div>

          {/* Grafik */}
          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 text-base font-bold text-gray-800">Tren Omset</h2>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={(omset?.buckets ?? []).map((b) => ({ bucket: b.bucket, Omset: b.revenue, Order: b.orders }))}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="bucket" axisLine={false} tickLine={false} tick={{ fill: "#9ca3af", fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#9ca3af", fontSize: 12 }} dx={-10} />
                  <Tooltip
                    contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                    formatter={(v, name) =>
                      name === "Omset" ? fmtRp(Number(v ?? 0)) : fmt(Number(v ?? 0))
                    }
                  />
                  <Legend />
                  <Line type="monotone" dataKey="Omset" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Winning */}
          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-800">Produk Paling Laku</h2>
              <div className="flex gap-2">
                {(["variant", "product"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGroupBy(g)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      groupBy === g
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {g === "variant" ? "Per Varian" : "Per Produk"}
                  </button>
                ))}
              </div>
            </div>
            {winning.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">Belum ada penjualan pada periode & filter ini.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-3">#</th>
                    <th className="px-3 py-2">Produk</th>
                    {groupBy === "variant" && <th className="px-3 py-2">SKU</th>}
                    <th className="px-3 py-2">Kategori</th>
                    <th className="px-3 py-2 text-right">Terjual</th>
                    <th className="px-3 py-2 text-right">Omset</th>
                    <th className="px-3 py-2 text-right">Order</th>
                  </tr>
                </thead>
                <tbody>
                  {winning.map((r, i) => (
                    <tr key={r.key} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="py-2.5 pr-3 font-bold text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-gray-900">{r.productName}</div>
                        {groupBy === "variant" && r.variantName && (
                          <div className="text-xs text-gray-500">{r.variantName}</div>
                        )}
                      </td>
                      {groupBy === "variant" && (
                        <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{r.sku}</td>
                      )}
                      <td className="px-3 py-2.5 text-gray-600">{r.category ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right font-semibold">{fmt(r.qty)} pcs</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{fmtRp(r.revenue)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500">{fmt(r.orders)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <BreakdownCard title="Per Marketplace" rows={omset?.byPlatform ?? []} />
            <BreakdownCard title="Per Akun" rows={omset?.byAccount ?? []} />
            <BreakdownCard title="Per Kategori" rows={omset?.byCategory ?? []} />
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: Slice[] }) {
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-base font-bold text-gray-800">{title}</h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500">Tidak ada data.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-800">
                  {r.label}
                  {r.platform && <span className="ml-1 text-xs text-gray-400">{r.platform}</span>}
                </span>
                <span className="font-semibold text-gray-900">{fmtRp(r.revenue)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{ width: `${Math.round((r.revenue / max) * 100)}%` }}
                />
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {fmt(r.orders)} order · {fmt(r.units)} pcs
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
