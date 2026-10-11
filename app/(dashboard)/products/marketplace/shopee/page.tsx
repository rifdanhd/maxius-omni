"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { notify } from "@/components/ui/notify";
import { Feedback, PageState } from "@/components/ui/feedback";
import { friendlyError } from "@/lib/ui/feedback";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ShopeeProductDetail, ShopeeProductList } from "@/components/products/shopee/product-list";
import { fmtDate, fmtNumber, mappingLabels, storeName, type ShopeeListingRow } from "@/components/products/shopee/presentation";
import { useShopeeDisplay } from "@/hooks/use-shopee-display";
import { authFetch } from "@/lib/utils/api-client";

type ListResponse = {
  rows: ShopeeListingRow[];
  total: number;
  page: number;
  pageSize: number;
  counts?: Record<string, number>;
  accounts: Array<{ id: string; label: string; isConnected?: boolean }>;
  lastSyncedAt?: string | null;
  syncProductCount?: number;
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
const TABS: Array<{ id: string; label: string }> = [
  { id: "all", label: "Semua" },
  { id: "active", label: "Aktif" },
  { id: "out", label: "Habis" },
  { id: "unlisted", label: "Nonaktif" },
  { id: "deleted", label: "Dihapus" },
];

export default function ShopeeMarketplacePage() {
  const router = useRouter();
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
  const [mappingFilter, setMappingFilter] = useState("all");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncProductCount, setSyncProductCount] = useState(0);
  const [detail, setDetail] = useState<ShopeeListingRow | null>(null);
  const [detailReturnFocus, setDetailReturnFocus] = useState<HTMLButtonElement | null>(null);
  const [pendingSync, setPendingSync] = useState<{ products?: Array<{ accountId: string; productId: string }>; accountIds?: string[]; count: number } | null>(null);
  const display = useShopeeDisplay();
  const [syncingAll, setSyncingAll] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importAccounts, setImportAccounts] = useState<string[]>([]);
  const [importLimit, setImportLimit] = useState(100);
  const [syncFailure, setSyncFailure] = useState<{ message: string; detail: string; scope: NonNullable<typeof pendingSync> } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterActive = accountFilter.length > 0;
  const selectedRows = rows.filter((row) => selected.has(row.key));
  const busy = syncingAll || importing;
  const connectedAccounts = accounts.filter((account) => account.isConnected !== false);

  useEffect(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (q) sp.set("search", q);
    sp.set("sort", sort);
    sp.set("tab", tab);
    sp.set("mapping", mappingFilter);
    if (accountFilter.length > 0) sp.set("accountIds", accountFilter.join(","));
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await authFetch(`/api/marketplace/shopee/products?${sp.toString()}`, {
          headers: { },
        });
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          if (!cancelled) setError(data?.error ?? `Gagal memuat data (${res.status}).`);
          return;
        }
        const data: ListResponse = await res.json();
        if (cancelled) return;
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setCounts(data.counts ?? {});
        setAccounts(data.accounts ?? []);
        setLastSyncedAt(data.lastSyncedAt ?? null);
        setSyncProductCount(data.syncProductCount ?? data.total ?? 0);
        setSelected(new Set());
        setError(null);
      } catch (e) {
        if (!cancelled) { console.error(e); setError("Terjadi kesalahan saat memuat data."); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [page, q, sort, tab, accountFilter, mappingFilter, refreshKey]);

  useEffect(() => {
    const t = setTimeout(() => { setQ(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const allPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));
  function toggleAll() {
    setSelected((prev) => { const next = new Set(prev); if (allPageSelected) rows.forEach((r) => next.delete(r.key)); else rows.forEach((r) => next.add(r.key)); return next; });
  }
  function toggleRow(key: string) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  function requestSync(products?: ShopeeListingRow[]) {
    if (busy || operationRef.current) return;
    if (products?.some((row) => !row.platformProductId)) {
      notify("error", "Sebagian produk belum memiliki ID Shopee. Perbarui data toko terlebih dahulu.");
      return;
    }
    const scope = products
      ? { products: products.map((row) => ({ accountId: row.accountId, productId: row.platformProductId! })), count: products.length }
      : { ...(accountFilter.length ? { accountIds: [...accountFilter] } : {}), count: syncProductCount };
    if (!products || products.length >= 50) setPendingSync(scope);
    else void syncAll(scope);
  }

  async function syncAll(scope: NonNullable<typeof pendingSync>) {
    if (operationRef.current) return;
    operationRef.current = true;
    setSyncingAll(true);
    setError(null);
    setSyncFailure(null);
    const reportFailure = (detail: string) => {
      const message = friendlyError(detail, "Sinkron gagal. Silakan coba lagi.");
      setSyncFailure({ message, detail, scope });
      notify("error", message, { title: "Sinkron gagal", details: detail, action: { label: /koneksi toko/i.test(message) ? "Perbarui koneksi" : "Coba lagi", onClick: () => { if (/koneksi toko/i.test(message)) router.push("/settings/accounts"); else void syncAll(scope); } } });
    };
    try {
      const res = await authFetch("/api/marketplace/shopee/products/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(scope.products ? { products: scope.products } : {}), ...(scope.accountIds ? { accountIds: scope.accountIds } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Sinkronisasi gagal.");
      const results = (data?.accounts ?? []) as SyncAccountResult[];
      if (results.length === 0) {
        reportFailure("Bisnis aktif belum memiliki toko Shopee. Hubungkan toko melalui Pengaturan Toko.");
        return;
      }
      setRefreshKey((k) => k + 1);
      const failed = results.filter((a) => a.error);
      if (failed.length > 0) {
        reportFailure(failed.map((a) => `${a.label}: ${a.error}`).join(" · "));
        return;
      }
      const okMsg = results
        .map((a) => `${storeName(a.label)}: ${fmtNumber(a.items)} produk, ${fmtNumber(a.models)} varian, ${fmtNumber(a.matched)} diperbarui`)
        .join(" · ");
      notify("success", `Sinkron selesai. ${fmtNumber(results.reduce((sum, account) => sum + account.matched, 0))} varian diperbarui.`, { details: okMsg });
    } catch (e) { reportFailure(e instanceof Error ? e.message : "Sinkron gagal. Silakan coba lagi."); }
    finally { operationRef.current = false; setSyncingAll(false); }
  }

  async function runImport() {
    if (operationRef.current) return;
    operationRef.current = true;
    setImporting(true);
    setError(null);
    try {
      const res = await authFetch("/api/marketplace/shopee/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountIds: importAccounts,
          limit: importLimit,
        }),
      });
      const data = (await res.json().catch(() => null)) as ImportResponse | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Impor gagal (${res.status}).`);
      const totals = data.totals;
      const detail = (data.accounts ?? [])
        .map((a) => {
          if (a.error) return `${a.label}: gagal — ${a.error}`;
          return `${storeName(a.label)}: +${fmtNumber(a.importedItems)} produk / ${fmtNumber(a.importedVariants)} SKU` +
            (a.orphan > 0 ? `, ${a.orphan} belum terhubung` : "") +
            (a.duplicate > 0 ? `, ${a.duplicate} duplikat` : "");
        })
        .join(" · ");
      const tail = totals && totals.zeroStock > 0
        ? ` ${totals.zeroStock} SKU stok 0 — isi lewat Barang Masuk/Opname sebelum mengirim pembaruan stok.`
        : "";
      notify(
        totals && totals.errors > 0 ? "error" : "success",
        totals && totals.errors > 0 ? "Sebagian produk belum berhasil diimpor. Periksa koneksi toko, lalu coba lagi." : `Impor selesai. ${fmtNumber(totals?.importedItems ?? 0)} produk ditambahkan.`,
        { details: `${detail}${tail}` }
      );
      setImportOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Impor gagal.");
    } finally {
      operationRef.current = false;
      setImporting(false);
    }
  }

  const pageNumbers: number[] = [];
  { const start = Math.max(1, Math.min(page - 2, totalPages - 4)); const end = Math.min(totalPages, start + 4); for (let i = start; i <= end; i++) pageNumbers.push(i); }

  return (
    <div className="min-w-0 p-3 sm:p-6 [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-ring [&_input]:focus-visible:ring-2 [&_input]:focus-visible:ring-ring [&_select]:focus-visible:ring-2 [&_select]:focus-visible:ring-ring">
      {syncFailure && <Feedback variant="error" title="Sinkron gagal" description={syncFailure.message} details={syncFailure.detail} className="mb-4" action={<>
        {/koneksi toko|belum memiliki toko/i.test(syncFailure.message) ? <Button variant="outline" asChild><Link href="/settings/accounts">Perbarui koneksi</Link></Button> : <Button variant="outline" disabled={busy} onClick={() => void syncAll(syncFailure.scope)}>Coba lagi</Button>}
        <Button variant="ghost" onClick={() => setSyncFailure(null)}>Tutup pesan</Button>
      </>} />}

      <Dialog open={importOpen} onOpenChange={(open) => { if (!importing) setImportOpen(open); }}>
          <DialogContent className="p-0" showCloseButton={!importing}>
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <DialogHeader className="pr-6 text-left">
                <DialogTitle>Impor produk dari Shopee</DialogTitle>
                <DialogDescription>Tambahkan produk dan varian baru ke katalog pusat.</DialogDescription>
              </DialogHeader>
            </div>

            <div className="space-y-4 px-5 py-4 text-sm text-foreground">
              <ul className="space-y-1 rounded-lg bg-muted border border-border p-3 text-xs text-foreground">
                <li>• 1 produk Shopee menjadi 1 produk induk; tiap varian memiliki SKU dan stok sendiri.</li>
                <li>• Kode produk di Shopee (<b>model_sku / item_sku</b>) dipakai untuk membuat hubungan produk; periksa variasi yang sesuai sebelum menggabungkan stok lintas toko.</li>
                <li>• Produk yang SKU-nya sudah terhubung tidak disentuh (aman dijalankan berulang).</li>
                <li>• Stok awal diambil dari Shopee bila tersedia; sisanya 0 dan dicatat di kartu stok — isi lewat <b>Barang Masuk</b>/<b>Hitung Stok Fisik (Opname)</b> sebelum mengirim pembaruan stok.</li>
                <li>• Gambar produk ikut diambil jika tersedia; harga dan kategori belum ikut diimpor.</li>
              </ul>

              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-foreground">Toko yang diimpor</p>
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
                        <span className="truncate" title={a.id}>{storeName(a.label)}</span>
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
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-foreground">Batas produk per proses</p>
                <div className="flex items-center gap-2">
                  <select
                    value={importLimit}
                    onChange={(e) => setImportLimit(Number(e.target.value))}
                    aria-label="Batas produk per proses impor"
                    className="h-11 rounded-md border border-border bg-card px-3 text-sm outline-none cursor-pointer"
                  >
                    <option value={50}>50 produk</option>
                    <option value={100}>100 produk</option>
                    <option value={200}>200 produk</option>
                    <option value={500}>500 produk</option>
                  </select>
                  <span className="text-xs text-muted-foreground">Bisa diulang sampai semua produk masuk.</span>
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
                {importing ? "Mengimpor..." : "Mulai impor"}
              </button>
            </div>
          </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingSync)} onOpenChange={(open) => { if (!open) setPendingSync(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Perbarui data {pendingSync?.products ? "produk terpilih" : "toko"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingSync?.products ? `${fmtNumber(pendingSync.count)} produk terpilih` : `${pendingSync?.accountIds?.length ?? accounts.length} toko, sekitar ${fmtNumber(pendingSync?.count ?? 0)} produk tercatat`} akan diperiksa ke Shopee. Proses dapat memerlukan beberapa menit dan mengambil stok, judul, serta status terbaru. Stok katalog pusat tidak diubah.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel><AlertDialogAction onClick={() => { if (pendingSync) void syncAll(pendingSync); }}>Perbarui sekarang</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ShopeeProductDetail row={detail} onClose={() => setDetail(null)} threshold={display.threshold} returnFocus={detailReturnFocus} />

      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Produk di Marketplace › Shopee</p>
          <h1 className="text-xl font-bold text-foreground">Produk Shopee</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">Kelola produk Shopee, pantau stok, dan periksa hubungannya dengan katalog pusat.</p>
        </div>
        <div className="flex max-w-full flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip><TooltipTrigger asChild><span tabIndex={connectedAccounts.length === 0 ? 0 : undefined}>
              <Button variant="outline" className="min-h-11" onClick={() => { setImportAccounts(accountFilter.length ? accountFilter : connectedAccounts.map((account) => account.id)); setImportOpen(true); }} disabled={loading || connectedAccounts.length === 0 || busy}>
                <Download aria-hidden="true" />{importing ? "Mengimpor..." : "Impor dari Shopee"}
              </Button></span></TooltipTrigger><TooltipContent className="max-w-xs">{connectedAccounts.length === 0 ? "Hubungkan toko melalui Pengaturan Toko terlebih dahulu." : "Tambahkan produk dan varian baru ke katalog pusat. Produk yang sudah terhubung tidak diimpor ulang."}</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><span tabIndex={connectedAccounts.length === 0 ? 0 : undefined}>
              <Button className="min-h-11" onClick={() => requestSync()} disabled={loading || connectedAccounts.length === 0 || busy} aria-busy={syncingAll}>
                {syncingAll ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{syncingAll ? "Menyinkronkan..." : "Perbarui Data"}
              </Button></span></TooltipTrigger><TooltipContent className="max-w-xs">Ambil stok, judul, gambar, dan status terbaru dari Shopee untuk toko yang dipilih. Tidak mengirim perubahan stok katalog pusat.</TooltipContent></Tooltip>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite" title="Waktu pembaruan produk terbaru pada toko terpilih, bukan waktu seluruh toko selesai disinkronkan.">Terakhir disinkronkan: {loading ? "Memuat..." : fmtDate(lastSyncedAt)}</p>
        </div>
      </div>

      {!loading && !error && connectedAccounts.length === 0 && (
        <div className="mb-6 bg-muted border border-border rounded-xl p-6 text-center">
          <PackageOpen size={32} className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Belum ada akun Shopee terhubung</p>
          <p className="text-xs text-foreground mt-1">Hubungkan toko Shopee melalui <Link href="/settings/accounts" className="underline font-semibold">Tambahkan Marketplace</Link> untuk mulai mengelola produk.</p>
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
                  tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
                {count > 0 && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      tab === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {fmtNumber(count)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="relative w-full sm:max-w-xs">
            <input ref={searchRef} type="text" value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Cari nama produk atau SKU marketplace" placeholder="Cari nama produk atau SKU"
              className="border border-border bg-card rounded-md pl-10 pr-3 py-2 text-sm outline-none w-full h-11 font-medium" />
            <Search size={16} aria-hidden="true" className="pointer-events-none text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          </div>

          <div className="relative max-w-full">
            <ChevronDown size={14} className="text-muted-foreground absolute left-3 top-2.5 pointer-events-none" />
            <select aria-label="Urutkan produk" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}
              className="border border-border rounded-md pl-8 pr-3 py-2 text-sm outline-none h-11 max-w-full bg-card cursor-pointer font-medium">
              <option value="name_asc">Urutkan: Nama A–Z</option>
              <option value="name_desc">Urutkan: Nama Z–A</option>
              <option value="sku_asc">SKU: A–Z</option>
              <option value="sku_desc">SKU: Z–A</option>
              <option value="stock_asc">Stok terendah</option>
              <option value="stock_desc">Stok tertinggi</option>
              <option value="updated_desc">Sinkron terbaru</option>
              <option value="updated_asc">Sinkron terlama</option>
              <option value="account_asc">Toko: A–Z</option>
              <option value="account_desc">Toko: Z–A</option>
              <option value="mapping_asc">Status mapping: A–Z</option>
              <option value="mapping_desc">Status mapping: Z–A</option>
            </select>
          </div>

          <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
            <DropdownMenuTrigger asChild><Button variant="outline" className="min-h-11" aria-label={filterActive ? `Toko/Akun: ${accountFilter.length} toko dipilih` : "Filter Toko/Akun"}>
              <Filter aria-hidden="true" />Toko/Akun{filterActive && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{accountFilter.length}</span>}<ChevronDown aria-hidden="true" />
            </Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
              <DropdownMenuLabel>Toko Shopee · {accountFilter.length} dipilih</DropdownMenuLabel>
              <div className="max-h-56 overflow-y-auto">
                {accounts.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Belum ada toko Shopee.</p>}
                {accounts.map((account) => <DropdownMenuCheckboxItem key={account.id} checked={accountFilter.includes(account.id)} onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => {
                  setAccountFilter((previous) => checked ? [...previous, account.id] : previous.filter((id) => id !== account.id)); setPage(1);
                }}>
                  <span className="min-w-0"><span className="block truncate">{storeName(account.label)}</span><span className="text-[11px] text-muted-foreground">ID: {account.id}</span></span>
                </DropdownMenuCheckboxItem>)}
              </div>
              <DropdownMenuSeparator />
              <div className="flex items-center justify-between px-2 py-1"><Button variant="ghost" size="sm" onClick={() => { setAccountFilter([]); setPage(1); }}>Semua toko</Button><Button size="sm" onClick={() => setFilterOpen(false)}>Selesai</Button></div>
            </DropdownMenuContent>
          </DropdownMenu>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <span className="sr-only">Filter status mapping</span>
            <select aria-label="Filter status mapping" value={mappingFilter} onChange={(event) => { setMappingFilter(event.target.value); setPage(1); }} className="h-11 max-w-full rounded-md border border-border bg-card px-3">
              <option value="all">Semua status mapping</option>
              {Object.entries(mappingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {(q || filterActive || mappingFilter !== "all" || tab !== "all") && <Button variant="ghost" className="min-h-11" onClick={() => { setSearchInput(""); setQ(""); setAccountFilter([]); setMappingFilter("all"); setTab("all"); setPage(1); }}><X aria-hidden="true" />Hapus filter</Button>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs">
          <div className="flex items-center gap-2" role="group" aria-label="Kepadatan tampilan">
            <span className="text-muted-foreground">Tampilan</span>
            <Button size="sm" variant={display.density === "comfortable" ? "secondary" : "ghost"} aria-pressed={display.density === "comfortable"} onClick={() => display.setDensity("comfortable")}>Nyaman</Button>
            <Button size="sm" variant={display.density === "compact" ? "secondary" : "ghost"} aria-pressed={display.density === "compact"} onClick={() => display.setDensity("compact")}>Ringkas</Button>
          </div>
          <label className="flex flex-wrap items-center gap-2 text-muted-foreground">Menipis jika stok di bawah
            <input aria-label="Ambang stok menipis" type="number" min={0} max={1000000} value={display.threshold} onChange={(event) => { if (event.target.value !== "") display.setThreshold(Number(event.target.value)); }} className="h-9 w-20 rounded-md border border-border bg-card px-2 text-right text-foreground" />
            <span title="Preferensi untuk tampilan Shopee pada perangkat ini; tidak mengubah aturan stok atau notifikasi inventori.">(perangkat ini)</span>
          </label>
        </div>
        {selectedRows.length > 0 && !loading && !error && <div role="region" aria-label="Aksi produk terpilih" className="flex flex-wrap items-center gap-3 border-b border-border bg-muted px-4 py-3">
          <span className="text-sm font-semibold" aria-live="polite">{fmtNumber(selectedRows.length)} produk dipilih</span>
          <Button size="sm" className="min-h-11" onClick={() => requestSync(selectedRows)} disabled={busy || selectedRows.some((row) => !row.platformProductId)}><RefreshCw className={syncingAll ? "animate-spin" : ""} aria-hidden="true" />{syncingAll ? "Menyinkronkan..." : "Sinkron terpilih"}</Button>
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setSelected(new Set())}>Batal pilih</Button>
          {selectedRows.some((row) => !row.platformProductId) && <p className="text-xs text-muted-foreground">Perbarui data toko untuk melengkapi ID produk sebelum sinkron terpilih.</p>}
        </div>}
        {loading ? <div aria-busy="true" aria-label="Memuat produk Shopee" className="space-y-3 p-4">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="flex items-center gap-4 rounded-lg border border-border p-3"><Skeleton className="size-10 shrink-0" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div><Skeleton className="h-6 w-16" /></div>)}
        </div> : error ? <PageState variant="error" title="Produk belum dapat dimuat" description={friendlyError(error)} details={error} action={<Button variant="outline" onClick={() => setRefreshKey((key) => key + 1)}>Coba lagi</Button>} /> : rows.length === 0 ? <div className="space-y-3 p-6 text-center text-sm">
          <PackageOpen size={28} className="mx-auto text-muted-foreground" aria-hidden="true" />
          {q.trim() || filterActive || mappingFilter !== "all" || tab !== "all" ? <><p>Tidak ada produk yang cocok dengan pencarian dan filter.</p><Button variant="outline" onClick={() => { setSearchInput(""); setQ(""); setAccountFilter([]); setMappingFilter("all"); setTab("all"); setPage(1); }}>Hapus pencarian dan filter</Button></> : <><p>Belum ada produk Shopee di katalog pusat.</p>{accounts.length > 0 ? <Button variant="outline" onClick={() => { setImportAccounts(accounts.map((account) => account.id)); setImportOpen(true); }} disabled={busy}><Download aria-hidden="true" />Impor dari Shopee</Button> : <Button variant="outline" asChild><Link href="/settings/accounts">Hubungkan toko Shopee</Link></Button>}</>}
        </div> : <ShopeeProductList rows={rows} selected={selected} onToggleRow={toggleRow} onToggleAll={toggleAll} sort={sort} onSort={(value) => { setSort(value); setPage(1); }} density={display.density} threshold={display.threshold} busy={busy} onDetail={(row, trigger) => { setDetailReturnFocus(trigger); setDetail(row); }} onSync={requestSync} />}

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
