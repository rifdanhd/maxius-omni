"use client";

import { useEffect, useRef, useState, Fragment } from "react";
import { authFetch } from "@/lib/utils/api-client";
import Link from "next/link";
import {
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Loader2,
  PackageOpen,
  Filter,
} from "lucide-react";

type ShopeeListingRow = {
  key: string;
  accountId: string;
  accountLabel: string;
  variantId: string | null;
  platformProductId: string | null;
  platformTitle: string | null;
  status: string | null;
  channelSku: string | null;
  stockTotal: number;
  lastSyncedAt: string | null;
};

type ListResponse = {
  rows: ShopeeListingRow[];
  total: number;
  page: number;
  pageSize: number;
  accounts: Array<{ id: string; label: string }>;
};

const PAGE_SIZE = 20;
const PLATFORM_LABEL = "Shopee";

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("id-ID");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "belum sync";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "belum sync";
  return d.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "Belum di-sync";
  const s = status.toUpperCase();
  if (s === "ACTIVE" || s === "ACTIVATE") return "Aktif di Shopee";
  if (s === "SELLER_DEACTIVATED") return "Nonaktif (seller)";
  if (s === "PLATFORM_DEACTIVATED") return "Nonaktif (platform)";
  if (s === "FREEZE") return "Dibekukan";
  if (s === "DRAFT") return "Draf";
  if (s === "PENDING") return "Menunggu review";
  if (s === "DELETED") return "Dihapus";
  return status;
}

export default function ShopeeMarketplacePage() {
  const [rows, setRows] = useState<ShopeeListingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [accounts, setAccounts] = useState<ListResponse["accounts"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("name_asc");
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [syncingAll, setSyncingAll] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterActive = accountFilter.length > 0;

  const notify = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 6000);
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    const sp = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (q) sp.set("search", q);
    sp.set("sort", sort);
    if (accountFilter.length > 0) sp.set("accountIds", accountFilter.join(","));
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await authFetch(`/api/marketplace/shopee/products?${sp.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) { const data = await res.json().catch(() => null); setError(data?.error ?? `Gagal memuat data (${res.status}).`); return; }
        const data: ListResponse = await res.json();
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setAccounts(data.accounts ?? []);
        setError(null);
      } catch (e) {
        if (!cancelled) { console.error(e); setError("Terjadi kesalahan saat memuat data."); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [page, q, sort, accountFilter, refreshKey]);

  useEffect(() => {
    const t = setTimeout(() => { setQ(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (!(filterRef.current?.contains(e.target as Node))) setFilterOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const allPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));
  function toggleAll() {
    setSelected((prev) => { const next = new Set(prev); if (allPageSelected) rows.forEach((r) => next.delete(r.key)); else rows.forEach((r) => next.add(r.key)); return next; });
  }
  function toggleRow(key: string) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  function toggleExpand(key: string) {
    setExpanded((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }

  async function syncAll() {
    setSyncingAll(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/marketplace/shopee/products/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Sync gagal.");
      const accountsMsg = ((data.accounts as Array<{ label: string; synced: number; notFound: number }> ?? [])
        .map((a) => `${a.label}: ${a.synced} update, ${a.notFound} tidak ditemukan`).join(" · ") ?? "");
      notify("success", `Sync selesai${accountsMsg ? ": " + accountsMsg : ""}`);
      setRefreshKey((k) => k + 1);
    } catch (e) { notify("error", e instanceof Error ? e.message : "Sync gagal."); }
    finally { setSyncingAll(false); }
  }

  const pageNumbers: number[] = [];
  { const start = Math.max(1, Math.min(page - 2, totalPages - 4)); const end = Math.min(totalPages, start + 4); for (let i = start; i <= end; i++) pageNumbers.push(i); }

  return (
    <div className="p-8">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] max-w-sm">
          <div className={`rounded-xl border px-4 py-3 text-sm shadow-lg flex items-start gap-2 ${
            toast.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToast(null)} className="underline text-xs opacity-70">Tutup</button>
          </div>
        </div>
      )}

      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">Produk Marketplace › Shopee</p>
          <h1 className="text-xl font-bold text-gray-900">Produk Shopee</h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={syncAll} disabled={syncingAll} className="flex items-center gap-2 rounded-md bg-[#2a3a8c] px-4 py-2 text-sm font-medium text-white hover:bg-blue-900 disabled:opacity-60">
            {syncingAll ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {syncingAll ? "Menyinkronkan..." : "Sync Semua"}
          </button>
        </div>
      </div>

      {!loading && accounts.length === 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <PackageOpen size={32} className="mx-auto mb-3 text-amber-500" />
          <p className="text-sm font-semibold text-amber-800">Belum ada akun Shopee terhubung</p>
          <p className="text-xs text-amber-600 mt-1">Hubungkan toko Shopee melalui <Link href="/settings/accounts" className="underline font-semibold">Tambahkan Marketplace</Link> untuk mulai sync produk.</p>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="p-4 border-b border-gray-200 flex items-center gap-3 flex-wrap">
          <div className="relative w-80">
            <input ref={searchRef} type="text" value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari nama produk atau SKU marketplace"
              className="border border-gray-300 rounded-md pl-3 pr-10 py-2 text-sm outline-none w-full h-[38px] font-medium" />
            <Search size={16} className="text-gray-400 absolute right-3 top-2.5" />
          </div>

          <div className="relative">
            <ChevronDown size={14} className="text-gray-400 absolute left-3 top-2.5 pointer-events-none" />
            <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}
              className="border border-gray-300 rounded-md pl-8 pr-3 py-2 text-sm outline-none h-[38px] bg-white cursor-pointer font-medium">
              <option value="name_asc">Urutkan: Nama A–Z</option>
              <option value="name_desc">Urutkan: Nama Z–A</option>
              <option value="sku_asc">SKU: A–Z</option>
              <option value="sku_desc">SKU: Z–A</option>
              <option value="stock_asc">Stok terendah</option>
              <option value="stock_desc">Stok tertinggi</option>
              <option value="updated_desc">Terakhir di-sync</option>
            </select>
          </div>

          <div className="relative" ref={filterRef}>
            <button onClick={() => setFilterOpen((v) => !v)}
              className={`flex items-center gap-2 border rounded-md px-4 py-2 text-sm font-medium h-[38px] ${
                filterOpen || filterActive ? "border-indigo-500 bg-indigo-50/70 text-indigo-700" : "border-gray-300 text-gray-500 bg-white hover:bg-gray-50"}`}>
              <Filter size={14} />
              <span>Toko/Akun</span>
              {filterActive && <span className="px-1.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">{accountFilter.length}</span>}
              <ChevronDown size={14} />
            </button>
            {filterOpen && (
              <div className="absolute left-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-30 p-4">
                <p className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">Akun Shopee</p>
                <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
                  {accounts.length === 0 && <p className="text-xs text-gray-400">Tidak ada akun Shopee terdaftar.</p>}
                  {accounts.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 rounded px-1 py-1">
                      <input type="checkbox" className="w-4 h-4" checked={accountFilter.includes(a.id)}
                        onChange={() => setAccountFilter((prev) => prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id])} />
                      <span className="truncate">{a.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button onClick={() => setAccountFilter([])} className="text-xs font-medium text-gray-500 hover:text-gray-800 underline">Reset</button>
                  <button onClick={() => setFilterOpen(false)} className="text-xs font-semibold bg-[#2a3a8c] text-white px-3 py-1.5 rounded-md">Terapkan</button>
                </div>
              </div>
            )}
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 ml-auto bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-2 rounded-md">
              {selected.size} produk dipilih
              <button onClick={() => setSelected(new Set())} className="underline">Batal</button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#f8f9fa] border-b border-gray-200 text-gray-600 font-semibold">
              <tr>
                <th className="px-5 py-3 w-10"><input type="checkbox" className="w-4 h-4 rounded border-gray-300" checked={allPageSelected} onChange={toggleAll} /></th>
                <th className="px-5 py-3">Informasi Produk</th>
                <th className="px-5 py-3">SKU</th>
                <th className="px-5 py-3">Stok</th>
                <th className="px-5 py-3">Status Mapping</th>
                <th className="px-5 py-3">Akun</th>
                <th className="px-5 py-3">Terakhir Sync</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-500">Memuat data...</td></tr>
              ) : error ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-red-600">{error}</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                    <PackageOpen size={28} className="mx-auto mb-2" />
                    Tidak ada produk Shopee ditemukan. Klik <b>&quot;Sync Semua&quot;</b> untuk menarik data dari Shopee.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isExpanded = expanded.has(row.key);
                  const isMapped = row.variantId && row.variantId !== "";
                  return (
                    <Fragment key={row.key}>
                      <tr className="border-b border-gray-100 hover:bg-gray-50/50 align-top">
                        <td className="px-5 py-4 pt-5"><input type="checkbox" className="w-4 h-4 rounded border-gray-300" checked={selected.has(row.key)} onChange={() => toggleRow(row.key)} /></td>
                        <td className="px-5 py-4">
                          <div className="max-w-[240px]">
                            <div className="text-gray-900 font-bold leading-tight">{row.platformTitle ?? row.channelSku ?? "-"}</div>
                            <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{PLATFORM_LABEL}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4"><span className="text-sm text-gray-700 font-mono font-semibold">{row.channelSku ?? "-"}</span></td>
                        <td className="px-5 py-4 text-gray-700 font-semibold">{fmtNumber(row.stockTotal)}</td>
                        <td className="px-5 py-4">
                          {isMapped ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">✅ Mapped</span>
                          ) : (
                            <Link href="/products/mapping" className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full hover:bg-amber-200">⚠️ Belum Mapped</Link>
                          )}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-600">{row.accountLabel}</td>
                        <td className="px-5 py-4 text-xs text-gray-400">{fmtDate(row.lastSyncedAt)}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50/70 border-b border-gray-100">
                          <td colSpan={7} className="px-5 py-4">
                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">Detail Produk</div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                              <div>Platform Product ID: <span className="font-mono">{row.platformProductId ?? "-"}</span></div>
                              <div>Channel SKU: <span className="font-mono">{row.channelSku ?? "-"}</span></div>
                              <div>Status Platform: <span>{statusLabel(row.status)}</span></div>
                              <div>Mapping ID: <span className="font-mono">{row.key}</span></div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <span className="text-sm text-gray-500">{total.toLocaleString("id-ID")} produk · halaman {page} dari {totalPages}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft size={14} /> Sebelumnya
              </button>
              {pageNumbers.map((n) => (
                <button key={n} onClick={() => setPage(n)}
                  className={`w-9 h-9 text-sm rounded-md ${n === page ? "bg-[#2a3a8c] text-white font-semibold" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{n}</button>
              ))}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                Selanjutnya <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
