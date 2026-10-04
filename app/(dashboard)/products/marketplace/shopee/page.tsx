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
  Download,
  X,
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
  variantCount: number;
  stockTotal: number;
  imageUrl: string | null;
  lastSyncedAt: string | null;
};

type ListResponse = {
  rows: ShopeeListingRow[];
  total: number;
  page: number;
  pageSize: number;
  counts?: Record<string, number>;
  accounts: Array<{ id: string; label: string }>;
};

// Kontrak POST /api/marketplace/shopee/products/sync — baris hasil per akun
// (sync/route.ts → syncShopeeListings). Field lama `synced`/`notFound` tidak
// pernah ada di respons sehingga toast selalu "undefined".
type SyncAccountResult = {
  accountId: string;
  label: string;
  items: number;
  models: number;
  matched: number;
  error?: string;
};

type ImportAccountResult = {
  accountId: string;
  label: string;
  importedItems: number;
  importedVariants: number;
  existing: number;
  orphan: number;
  duplicate: number;
  zeroStock: number;
  itemsScanned: number;
  hasMore: boolean;
  error?: string;
};

type ImportResponse = {
  ok: boolean;
  error?: string;
  accounts?: ImportAccountResult[];
  totals?: {
    importedItems: number;
    importedVariants: number;
    existing: number;
    orphan: number;
    duplicate: number;
    zeroStock: number;
    hasMore: boolean;
    errors: number;
  };
};

const PAGE_SIZE = 20;
const PLATFORM_LABEL = "Shopee";
const TABS: Array<{ id: string; label: string }> = [
  { id: "all", label: "Semua" },
  { id: "active", label: "Aktif" },
  { id: "out", label: "Habis" },
  { id: "unlisted", label: "Nonaktif" },
  { id: "deleted", label: "Dihapus" },
];

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
  if (s === "NORMAL" || s === "ACTIVE" || s === "ACTIVATE") return "Aktif di Shopee";
  if (s === "UNLISTED") return "Tanpa dijual (unlisted)";
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
  const [tab, setTab] = useState("all");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [syncingAll, setSyncingAll] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importAccounts, setImportAccounts] = useState<string[]>([]);
  const [importLimit, setImportLimit] = useState(100);
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
    sp.set("tab", tab);
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
        setCounts(data.counts ?? {});
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
  }, [page, q, sort, tab, accountFilter, refreshKey]);

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
      const results = (data?.accounts ?? []) as SyncAccountResult[];
      if (results.length === 0) {
        notify(
          "error",
          "Brand aktif tidak punya akun Shopee — hubungkan toko dulu lewat Tambahkan Marketplace."
        );
        return;
      }
      setRefreshKey((k) => k + 1);
      const failed = results.filter((a) => a.error);
      if (failed.length > 0) {
        notify("error", failed.map((a) => `${a.label}: ${a.error}`).join(" · "));
        return;
      }
      const okMsg = results
        .map((a) => `${a.label}: ${a.items} item, ${a.models} varian, ${a.matched} ter-cocok`)
        .join(" · ");
      notify("success", `Sync selesai — ${okMsg}`);
    } catch (e) { notify("error", e instanceof Error ? e.message : "Sync gagal."); }
    finally { setSyncingAll(false); }
  }

  async function runImport() {
    setImporting(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/marketplace/shopee/products/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          accountIds: importAccounts,
          limit: importLimit,
        }),
      });
      const data = (await res.json().catch(() => null)) as ImportResponse | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Import gagal (${res.status}).`);
      const totals = data.totals;
      const detail = (data.accounts ?? [])
        .map((a) => {
          if (a.error) return `${a.label}: gagal — ${a.error}`;
          return `${a.label}: +${a.importedItems} listing / ${a.importedVariants} SKU` +
            (a.orphan > 0 ? `, ${a.orphan} orphan` : "") +
            (a.duplicate > 0 ? `, ${a.duplicate} duplikat` : "");
        })
        .join(" · ");
      const tail = totals && totals.zeroStock > 0
        ? ` ${totals.zeroStock} SKU stok 0 — isi lewat Stok Masuk/Opname sebelum push.`
        : "";
      notify(
        totals && totals.errors > 0 ? "error" : "success",
        `Import selesai: ${totals?.importedItems ?? 0} listing, ${totals?.importedVariants ?? 0} SKU baru.${detail ? " " + detail : ""}${tail}`
      );
      setImportOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Import gagal.");
    } finally {
      setImporting(false);
    }
  }

  const pageNumbers: number[] = [];
  { const start = Math.max(1, Math.min(page - 2, totalPages - 4)); const end = Math.min(totalPages, start + 4); for (let i = start; i <= end; i++) pageNumbers.push(i); }

  return (
    <div className="p-4 md:p-8">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] max-w-sm">
          <div className={`rounded-xl border px-4 py-3 text-sm shadow-lg flex items-start gap-2 ${
            toast.type === "success" ? "bg-muted border-border text-foreground" : "bg-muted border-border text-foreground"}`}>
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToast(null)} className="underline text-xs opacity-70">Tutup</button>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay/50 p-4">
          <div className="w-full max-w-lg rounded-xl max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h2 className="text-base font-bold text-foreground">Import Listing dari Shopee</h2>
                <p className="text-xs text-muted-foreground">Tarik produk Shopee ke katalog Maxius</p>
              </div>
              <button onClick={() => setImportOpen(false)} disabled={importing} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4 text-sm text-foreground">
              <ul className="space-y-1 rounded-lg bg-muted border border-border p-3 text-xs text-foreground">
                <li>• 1 listing Shopee = 1 produk induk; tiap varian (model) = 1 SKU stok sendiri.</li>
                <li>• Kode produk di Shopee (<b>model_sku / item_sku</b>) dipakai untuk membuat hubungan produk; periksa variasi yang sesuai sebelum menggabungkan stok lintas toko.</li>
                <li>• Listing yang SKU-nya sudah ter-mapping tidak disentuh (aman dijalankan berulang).</li>
                <li>• Stok awal diambil dari Shopee bila tersedia; sisanya 0 dan dicatat di kartu stok — isi lewat <b>Barang Masuk</b>/<b>Hitung Stok Fisik (Opname)</b> sebelum mengirim pembaruan stok.</li>
                <li>• Gambar produk, harga, dan kategori belum ikut diimport.</li>
              </ul>

              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-foreground">Toko yang diimport</p>
                {accounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Tidak ada akun Shopee terhubung.</p>
                ) : (
                  <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
                    {accounts.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm text-foreground hover:bg-muted cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-4 h-4"
                          checked={importAccounts.includes(a.id)}
                          onChange={(e) => setImportAccounts((prev) =>
                            e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id)
                          )}
                        />
                        <span className="truncate">{a.label}</span>
                      </label>
                    ))}
                  </div>
                )}
                {accounts.length > 0 && (
                  <div className="mt-1.5 flex gap-3 text-xs">
                    <button onClick={() => setImportAccounts(accounts.map((a) => a.id))} className="font-medium text-foreground hover:underline">Pilih semua</button>
                    <button onClick={() => setImportAccounts([])} className="font-medium text-muted-foreground hover:underline">Kosongkan</button>
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-foreground">Batas item per proses</p>
                <div className="flex items-center gap-2">
                  <select
                    value={importLimit}
                    onChange={(e) => setImportLimit(Number(e.target.value))}
                    className="h-[38px] rounded-md border border-border bg-card px-3 text-sm outline-none cursor-pointer"
                  >
                    <option value={50}>50 listing</option>
                    <option value={100}>100 listing</option>
                    <option value={200}>200 listing</option>
                    <option value={500}>500 listing</option>
                  </select>
                  <span className="text-xs text-muted-foreground">Bisa diulang sampai semua listing masuk.</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button onClick={() => setImportOpen(false)} disabled={importing} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50">
                Batal
              </button>
              <button
                onClick={runImport}
                disabled={importing || importAccounts.length === 0}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-50"
              >
                {importing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {importing ? "Mengimport..." : "Mulai Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Produk Marketplace › Shopee</p>
          <h1 className="text-xl font-bold text-foreground">Produk Shopee</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">Periksa produk yang dijual di Shopee dan hubungannya dengan katalog pusat; mulai dengan menghubungkan toko di Pengaturan Toko, lalu Import dari Shopee untuk menambahkan produk baru atau Perbarui Data untuk memperbarui produk yang terhubung.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setImportAccounts(accountFilter); setImportOpen(true); }}
            disabled={accounts.length === 0 || importing}
            title={accounts.length === 0 ? "Hubungkan toko Shopee dahulu melalui Pengaturan Toko." : "Tarik listing Shopee menjadi produk + varian + mapping di Maxius"}
            className="flex items-center gap-2 rounded-md border border-primary px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <Download size={16} /> Import dari Shopee
          </button>
          <button onClick={syncAll} disabled={syncingAll} className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-60">
            {syncingAll ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {syncingAll ? "Menyinkronkan..." : "Perbarui Data (Sync Semua)"}
          </button>
        </div>
      </div>

      {!loading && accounts.length === 0 && (
        <div className="mb-6 bg-muted border border-border rounded-xl p-6 text-center">
          <PackageOpen size={32} className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Belum ada akun Shopee terhubung</p>
          <p className="text-xs text-foreground mt-1">Hubungkan toko Shopee melalui <Link href="/settings/accounts" className="underline font-semibold">Tambahkan Marketplace</Link> untuk mulai sync produk.</p>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl shadow-sm">
        {/* Tab status — paritas dgn halaman TikTok (badge count dari server) */}
        <div className="flex items-center overflow-x-auto border-b border-border px-4 bg-card">
          {TABS.map((t) => {
            const count = counts[t.id] ?? 0;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setPage(1);
                }}
                className={`whitespace-nowrap px-4 py-3 text-sm font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
                  tab === t.id ? "border-primary text-foreground" : "border-transparent text-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                {count > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      tab === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="relative w-80">
            <input ref={searchRef} type="text" value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari nama produk atau SKU marketplace"
              className="border border-border rounded-md pl-3 pr-10 py-2 text-sm outline-none w-full h-[38px] font-medium" />
            <Search size={16} className="text-muted-foreground absolute right-3 top-2.5" />
          </div>

          <div className="relative">
            <ChevronDown size={14} className="text-muted-foreground absolute left-3 top-2.5 pointer-events-none" />
            <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}
              className="border border-border rounded-md pl-8 pr-3 py-2 text-sm outline-none h-[38px] bg-card cursor-pointer font-medium">
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
                filterOpen || filterActive ? "border-ring bg-muted/70 text-foreground" : "border-border text-muted-foreground bg-card hover:bg-muted"}`}>
              <Filter size={14} />
              <span>Toko/Akun</span>
              {filterActive && <span className="px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">{accountFilter.length}</span>}
              <ChevronDown size={14} />
            </button>
            {filterOpen && (
              <div className="absolute max-w-[calc(100vw-2rem)] left-0 top-full mt-1 w-72 bg-card border border-border rounded-xl shadow-xl z-30 p-4">
                <p className="text-xs font-bold text-foreground mb-2 uppercase tracking-wide">Akun Shopee</p>
                <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
                  {accounts.length === 0 && <p className="text-xs text-muted-foreground">Tidak ada akun Shopee terdaftar.</p>}
                  {accounts.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm text-foreground cursor-pointer hover:bg-muted rounded px-1 py-1">
                      <input type="checkbox" className="w-4 h-4" checked={accountFilter.includes(a.id)}
                        onChange={() => setAccountFilter((prev) => prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id])} />
                      <span className="truncate">{a.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button onClick={() => setAccountFilter([])} className="text-xs font-medium text-muted-foreground hover:text-foreground underline">Reset</button>
                  <button onClick={() => setFilterOpen(false)} className="text-xs font-semibold bg-primary text-primary-foreground px-3 py-1.5 rounded-md">Terapkan</button>
                </div>
              </div>
            )}
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 ml-auto bg-muted text-foreground text-xs font-semibold px-3 py-2 rounded-md">
              {selected.size} produk dipilih
              <button onClick={() => setSelected(new Set())} className="underline">Batal</button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted border-b border-border text-foreground font-semibold">
              <tr>
                <th className="px-5 py-3 w-10"><input type="checkbox" className="w-4 h-4 rounded border-border" checked={allPageSelected} onChange={toggleAll} /></th>
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
                <tr><td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">Memuat data...</td></tr>
              ) : error ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-foreground">{error}</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">
                    <PackageOpen size={28} className="mx-auto mb-2" />
                    {q.trim() || accountFilter.length || tab !== "all" ? <div className="space-y-2"><p>Tidak ada produk yang cocok dengan pencarian/filter.</p><button className="underline" onClick={() => { setSearchInput(""); setQ(""); setAccountFilter([]); setTab("all"); setPage(1); }}>Hapus Pencarian dan Filter</button></div> : <div className="space-y-2"><p>Belum ada produk Shopee pada tampilan ini. Gunakan Import dari Shopee untuk menambahkan produk ke katalog pusat.</p><Link href="/settings/accounts" className="underline">Hubungkan atau Periksa Toko Shopee</Link></div>}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isExpanded = expanded.has(row.key);
                  const isMapped = row.variantId && row.variantId !== "";
                  return (
                    <Fragment key={row.key}>
                      <tr className="border-b border-border hover:bg-muted/50 align-top">
                        <td className="px-5 py-4 pt-5"><input type="checkbox" className="w-4 h-4 rounded border-border" checked={selected.has(row.key)} onChange={() => toggleRow(row.key)} /></td>
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            {row.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={row.imageUrl} alt="" className="w-12 h-12 rounded object-cover bg-muted shrink-0" />
                            ) : (
                              <div className="w-12 h-12 bg-muted rounded flex items-center justify-center text-muted-foreground shrink-0">
                                <PackageOpen size={18} />
                              </div>
                            )}
                            <div className="max-w-[240px]">
                              <div className="text-foreground font-bold leading-tight">{row.platformTitle ?? row.channelSku ?? "-"}</div>
                              <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold bg-muted text-foreground px-2 py-0.5 rounded-full">{PLATFORM_LABEL}</span>
                              {row.variantCount > 1 && (
                                <span className="inline-flex items-center gap-1 mt-1.5 ml-1 text-[10px] font-bold bg-muted text-muted-foreground px-2 py-0.5 rounded-full" title="Satu produk Shopee dengan banyak model/SKU — stok diakumulasi dari semua varian.">
                                  {row.variantCount} varian
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4"><span className="text-sm text-foreground font-mono font-semibold">{row.variantCount > 1 ? `${row.variantCount} SKU` : (row.channelSku ?? "-")}</span></td>
                        <td className="px-5 py-4 text-foreground font-semibold">{fmtNumber(row.stockTotal)}</td>
                        <td className="px-5 py-4">
                          {isMapped ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-muted text-foreground px-2 py-0.5 rounded-full">✅ Mapped</span>
                          ) : (
                            <Link href="/products/mapping" className="inline-flex items-center gap-1 text-[10px] font-bold bg-muted text-foreground px-2 py-0.5 rounded-full hover:bg-muted">Belum Terhubung (Mapping)</Link>
                          )}
                        </td>
                        <td className="px-5 py-4 text-sm text-foreground">{row.accountLabel}</td>
                        <td className="px-5 py-4 text-xs text-muted-foreground">{fmtDate(row.lastSyncedAt)}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-muted/70 border-b border-border">
                          <td colSpan={7} className="px-5 py-4">
                            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Detail Produk</div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-foreground">
                              <div>Platform Product ID: <span className="font-mono">{row.platformProductId ?? "-"}</span></div>
                              <div>Jumlah SKU: <span className="font-mono">{row.variantCount}</span></div>
                              <div>Channel SKU: <span className="font-mono">{row.channelSku ?? (row.variantCount > 1 ? "per varian" : "-")}</span></div>
                              <div>Status Platform: <span>{statusLabel(row.status)}</span></div>
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
          <div className="px-6 py-4 border-t border-border flex items-center justify-between flex-wrap gap-3">
            <span className="text-sm text-muted-foreground">{total.toLocaleString("id-ID")} produk · halaman {page} dari {totalPages}</span>
            <div className="flex flex-wrap items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-md text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft size={14} /> Sebelumnya
              </button>
              {pageNumbers.map((n) => (
                <button key={n} onClick={() => setPage(n)}
                  className={`w-9 h-9 text-sm rounded-md ${n === page ? "bg-primary text-primary-foreground font-semibold" : "border border-border text-foreground hover:bg-muted"}`}>{n}</button>
              ))}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-md text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                Selanjutnya <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
