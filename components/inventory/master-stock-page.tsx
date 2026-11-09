"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Download,
  FilterX,
  Info,
  Package,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorFeedback, Feedback, PageState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authFetch } from "@/lib/utils/api-client";
import type { ListingStock, MasterStockResult, MasterStockRow, MasterStockTab } from "@/lib/inventory/master-stock.types";
import { AllocationDialog, inventoryRequest, numberFormat as fmt, StockChangeDialog } from "@/components/inventory/master-stock-dialogs";
import { MasterStockProduct } from "@/components/inventory/master-stock-product";
import { StockImportDialog } from "@/components/inventory/stock-import-dialog";

const TABS: Array<[MasterStockTab, string, string]> = [
  ["all", "Semua", "Jumlah SKU master sesuai filter. Setiap SKU dihitung sekali."],
  ["empty", "Habis", "Bisa Dijual = 0. Arsip dan produk nonaktif disembunyikan secara default."],
  ["low", "Menipis", "Bisa Dijual di atas nol dan tidak melebihi minimum SKU atau produk induk."],
  ["failed", "Sinkron gagal", "SKU dengan minimal satu listing gagal. Listing lain tetap diproses."],
  ["unmapped", "Belum mapping", "SKU pusat tanpa listing terhubung. Konflik SKU seller masuk tinjauan Mapping Stok."],
  ["oversells", "Oversell", "Jumlah SKU dengan permintaan aktif belum terpenuhi dan belum memotong stok melebihi Bisa Dijual. Bukan jumlah log atau order historis."],
];

// Kartu ringkasan di atas halaman (klik = pindah ke tab terkait).
const KPI_CARDS: Array<{ id: MasterStockTab; label: string; icon: LucideIcon; danger: boolean }> = [
  { id: "all", label: "Total Varian", icon: Boxes, danger: false },
  { id: "empty", label: "Stok Habis", icon: Package, danger: true },
  { id: "low", label: "Stok Menipis", icon: AlertTriangle, danger: true },
  { id: "failed", label: "Sinkron Gagal", icon: RefreshCw, danger: true },
];

// Tab yang dianggap "perlu perhatian" bila jumlahnya > 0.
const ATTENTION_TABS: MasterStockTab[] = ["empty", "failed", "unmapped", "oversells"];

const control = "h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export default function MasterStockPage() {
  const [data, setData] = useState<MasterStockResult | null>(null);
  const [filters, setFilters] = useState({ q: "", tab: "all" as MasterStockTab, category: "", platform: "", store: "", warehouse: "", sort: "name", archives: false });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [dense, setDense] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [collapsedSearchProducts, setCollapsedSearchProducts] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<MasterStockRow[] | null>(null);
  const [allocation, setAllocation] = useState<{ row: MasterStockRow; listings: ListingStock[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [urlReady, setUrlReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const query = new URLSearchParams(window.location.search);
      const tab = query.get("tab");
      const q = query.get("q") ?? "";
      setFilters({
        q,
        tab: TABS.some(([id]) => id === tab) ? (tab as MasterStockTab) : "all",
        category: query.get("category") ?? "",
        platform: query.get("platform") ?? "",
        store: query.get("store") ?? "",
        warehouse: query.get("warehouse") ?? "",
        sort: query.get("sort") ?? "name",
        archives: query.get("archives") === "true",
      });
      setSearch(q);
      setUrlReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => ({ ...current, q: search.trim() }));
      setCollapsedSearchProducts(new Set());
      setPage(1);
      setSelected(new Set());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!urlReady) return;
    let cancelled = false;
    let fetching = false;
    let request: AbortController | null = null;
    async function load(initial = false) {
      if (fetching) return;
      fetching = true;
      request = new AbortController();
      if (initial) setLoading(true);
      try {
        const query = new URLSearchParams({ page: String(page), limit: String(pageSize), groupBy: "product" });
        for (const [key, value] of Object.entries(filters)) if (value !== "" && value !== false) query.set(key, String(value));
        const response = await authFetch(`/api/inventory/master-stock?${query}`, { signal: request.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Stok belum dapat dimuat.");
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled && !(cause instanceof Error && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Stok belum dapat dimuat.");
      } finally {
        fetching = false;
        if (!cancelled) setLoading(false);
      }
    }
    void load(true);
    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => {
      cancelled = true;
      request?.abort();
      clearInterval(timer);
    };
  }, [filters, page, pageSize, revision, urlReady]);

  useEffect(() => {
    if (!urlReady) return;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value !== "" && value !== false && !(key === "tab" && value === "all") && !(key === "sort" && value === "name")) query.set(key, String(value));
    window.history.replaceState(null, "", query.size ? `${window.location.pathname}?${query}` : window.location.pathname);
  }, [filters, urlReady]);

  function filter<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setSelected(new Set());
  }
  function resetFilters() {
    setSearch("");
    setFilters((current) => ({ ...current, q: "", category: "", platform: "", store: "", warehouse: "", archives: false }));
    setPage(1);
    setSelected(new Set());
  }
  function saved() {
    setNotice("Perubahan disimpan. Pengiriman stok sedang menunggu diproses.");
    setSelected(new Set());
    setRevision((value) => value + 1);
  }
  async function retry(rows: MasterStockRow[], listingId?: string) {
    setBusy(true);
    setError(null);
    try {
      await inventoryRequest({ action: "retry", variantIds: rows.map((row) => row.id), ...(listingId ? { listingId } : {}) });
      saved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sinkron ulang belum berhasil.");
    } finally {
      setBusy(false);
    }
  }
  async function retryListings(row: MasterStockRow, listings: ListingStock[]) {
    if (!listings.length) return;
    setBusy(true);
    setError(null);
    try {
      // API retry bekerja per listing; jalankan berurutan agar tidak membanjiri antrean.
      for (const listing of listings) await inventoryRequest({ action: "retry", variantIds: [row.id], listingId: listing.id });
      saved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sinkron ulang belum berhasil.");
    } finally {
      setBusy(false);
    }
  }
  async function exportFile() {
    setBusy(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value !== "" && value !== false) query.set(key, String(value));
      if (selected.size) query.set("ids", [...selected].join(","));
      const response = await authFetch(`/api/inventory/master-stock/spreadsheet?${query}`);
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Ekspor belum berhasil.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "stok-sku-master.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ekspor belum berhasil.");
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.rows ?? [];
  const products = [...rows.reduce((groups, row) => {
    const variants = groups.get(row.productId) ?? [];
    variants.push(row);
    groups.set(row.productId, variants);
    return groups;
  }, new Map<string, MasterStockRow[]>())];
  const productTotal = data?.productTotal ?? products.length;
  const chosen = rows.filter((row) => selected.has(row.id));
  const hasActiveFilters = Boolean(filters.q || filters.category || filters.platform || filters.store || filters.warehouse || filters.archives);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 pb-28 md:p-8 md:pb-28">
      {/* ───────── Header halaman ───────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Stok Varian</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Cara stok dihitung" className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm space-y-1.5 p-3 text-xs leading-relaxed">
                <p>
                  <strong>Bisa Dijual = max(Di Gudang − Disisihkan, 0).</strong>
                </p>
                <p>Menunggu diproses adalah permintaan aktif yang belum memotong stok; tidak dikurangi lagi.</p>
                <p>Pesanan historis/import_only tidak memengaruhi stok.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Buka produk untuk melihat varian dan mengubah stok masing-masing SKU.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={() => setImporting(true)}>
            <Upload className="size-4" />
            Impor
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void exportFile();
            }}
          >
            <Download className="size-4" />
            Ekspor
          </Button>
        </div>
      </header>

      {error && <ErrorFeedback error={error} action={<Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Muat ulang</Button>} />}
      {notice && <Feedback variant="info" title="Perubahan stok" description={notice} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Tutup</Button>} />}

      {/* ───────── Kartu ringkasan ───────── */}
      <section aria-label="Ringkasan stok" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPI_CARDS.map(({ id, label, icon: Icon, danger }) => {
          const value = data ? data.counts[id] : null;
          const alert = danger && value !== null && value > 0;
          const active = filters.tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => filter("tab", id)}
              aria-pressed={active}
              className={`rounded-xl border p-3 text-left transition-colors hover:bg-muted/40 sm:p-4 ${
                alert ? "border-destructive/20 bg-destructive-subtle/40" : "border-border bg-card"
              } ${active ? "ring-1 ring-primary/30" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-medium ${alert ? "text-destructive" : "text-muted-foreground"}`}>{label}</span>
                <span className={`flex size-6 items-center justify-center rounded-lg ${alert ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
              </div>
              <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${alert ? "text-destructive" : "text-foreground"}`}>{value === null ? "…" : fmt(value)}</p>
            </button>
          );
        })}
      </section>

      {/* ───────── Kartu tabel utama ───────── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* Tab status */}
        <div role="tablist" aria-label="Status SKU master" className="flex gap-1 overflow-x-auto border-b border-border px-2">
          {TABS.map(([id, name, definition]) => {
            const count = data ? data.counts[id] : null;
            const active = filters.tab === id;
            const attention = ATTENTION_TABS.includes(id) && count !== null && count > 0;
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <button
                    role="tab"
                    aria-selected={active}
                    onClick={() => filter("tab", id)}
                    className={`relative inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm font-medium transition-colors ${
                      active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {name}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                        attention && !active ? "bg-destructive-subtle text-destructive" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {count === null ? "…" : fmt(count)}
                    </span>
                    {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t-full bg-primary" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{definition}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="space-y-3 border-b border-border p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative w-full sm:min-w-48 sm:flex-1">
              <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
              <input className={`${control} w-full pl-9`} aria-label="Cari SKU atau nama produk" placeholder="Cari nama produk atau SKU…"
                value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
              <select aria-label="Urutkan SKU" className={control} value={filters.sort} onChange={(event) => filter("sort", event.target.value)}>
                <option value="name">Nama produk</option>
                <option value="sku">SKU seller</option>
                <option value="stock_asc">Stok terkecil</option>
                <option value="stock_desc">Stok terbesar</option>
              </select>
            <Button variant="outline" disabled={busy} onClick={() => setRevision((value) => value + 1)} aria-label="Perbarui status stok">
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            {hasActiveFilters && <Button size="sm" variant="ghost" onClick={resetFilters}><FilterX className="size-4" />Reset</Button>}
          </div>
          <details className="group">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              <SlidersHorizontal className="size-3.5" />Filter &amp; tampilan
              {(filters.category || filters.platform || filters.store || filters.warehouse || filters.archives) && <span className="size-1.5 rounded-full bg-primary" />}
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <select aria-label="Kategori" className={control} value={filters.category} onChange={(event) => filter("category", event.target.value)}>
              <option value="">Semua kategori</option>
              {data?.filters.categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
            <select aria-label="Marketplace" className={control} value={filters.platform} onChange={(event) => filter("platform", event.target.value)}>
              <option value="">Semua marketplace</option>
              <option value="SHOPEE">Shopee</option>
              <option value="TIKTOK_SHOP">TikTok Shop</option>
            </select>
            <select aria-label="Toko" className={control} value={filters.store} onChange={(event) => filter("store", event.target.value)}>
              <option value="">Semua toko</option>
              {data?.filters.stores
                .filter((store) => !filters.platform || store.platform === filters.platform)
                .map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.label}
                  </option>
                ))}
            </select>
            <select aria-label="Gudang" className={control} value={filters.warehouse} onChange={(event) => filter("warehouse", event.target.value)}>
              <option value="">Semua gudang</option>
              {data?.filters.warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-muted-foreground">
                <input type="checkbox" checked={filters.archives} onChange={(event) => filter("archives", event.target.checked)} />
                Tampilkan arsip{data ? ` (${fmt(data.archivedCounts.all)})` : ""}
              </label>
              <div className="flex flex-wrap items-center gap-3">
              <select aria-label="Kepadatan tabel" className={control} value={dense ? "compact" : "comfortable"} onChange={(event) => setDense(event.target.value === "compact")}>
                <option value="comfortable">Nyaman</option>
                <option value="compact">Ringkas</option>
              </select>
                <Link href="/products/mapping" className="font-medium text-primary hover:underline">Mapping Stok</Link>
              </div>
            </div>
            {data && data.archivedCounts.empty > 0 && <p className="mt-2 text-xs text-muted-foreground">{fmt(data.archivedCounts.empty)} varian habis berada pada produk arsip atau nonaktif.</p>}
          </details>
        </div>

        <div aria-busy={loading} className="space-y-3 bg-muted/20 p-3 md:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
            <label className="inline-flex min-h-8 items-center gap-2">
              <input type="checkbox" className="size-4 accent-primary" aria-label="Pilih semua SKU di halaman ini"
                checked={rows.length > 0 && rows.every((row) => selected.has(row.id))}
                onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())} />
              Pilih semua varian
            </label>
            <span>{data ? `${fmt(productTotal)} produk · ${fmt(data.total)} varian` : "Memuat produk…"}</span>
          </div>
          {loading && !data ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28 w-full rounded-xl" />)
            : products.map(([productId, variants]) => (
              <MasterStockProduct key={productId} variants={variants} dense={dense} busy={busy}
                open={filters.q ? !collapsedSearchProducts.has(productId) : expandedProducts.has(productId)}
                filtered={hasActiveFilters || filters.tab !== "all"} selected={selected} expanded={expanded}
                toggle={() => {
                  const update = filters.q ? setCollapsedSearchProducts : setExpandedProducts;
                  update((current) => {
                    const next = new Set(current);
                    if (next.has(productId)) next.delete(productId);
                    else next.add(productId);
                    return next;
                  });
                }}
                select={(variants, checked) => setSelected((current) => {
                  const next = new Set(current);
                  for (const row of variants) {
                    if (checked) next.add(row.id);
                    else next.delete(row.id);
                  }
                  return next;
                })}
                toggleListing={(id) => setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })}
                edit={(row) => setEditing([row])} allocate={(row, listings) => setAllocation({ row, listings })}
                retry={(row, listing) => { void retry([row], listing.id); }} message={setNotice}
                syncMany={(row, listings) => { void retryListings(row, listings); }}
                refresh={() => setRevision((value) => value + 1)}
                archive={(row) => {
                  void inventoryRequest({ action: "archive", variantId: row.id, archived: !row.ownArchived })
                    .then(() => setRevision((value) => value + 1))
                    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Gagal mengubah arsip."));
                }}
              />
            ))}
          {!loading && !rows.length && <PageState title="Tidak ada produk pada tampilan ini" description="Coba ubah pencarian atau filter. SKU yang belum terhubung dapat diperiksa di Mapping Stok." />}
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <p className="tabular-nums">
            {data ? `${fmt(productTotal)} produk · ${fmt(data.total)} varian · halaman ${page} dari ${Math.max(1, Math.ceil(productTotal / pageSize))}` : "Memuat produk…"}
          </p>
          <div className="flex items-center gap-2">
            <select
              aria-label="Produk per halaman"
              className={control}
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
                setSelected(new Set());
              }}
            >
              {[25, 50, 100, 200].map((size) => (
                <option key={size} value={size}>
                  {size} produk / halaman
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon"
              aria-label="Halaman sebelumnya"
              disabled={page <= 1 || loading}
              onClick={() => {
                setPage((value) => value - 1);
                setSelected(new Set());
              }}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Halaman berikutnya"
              disabled={!data || page * pageSize >= productTotal || loading}
              onClick={() => {
                setPage((value) => value + 1);
                setSelected(new Set());
              }}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* ───────── Bulk action bar mengambang ───────── */}
      {chosen.length > 0 && (
        <div role="region" aria-label="Aksi massal" className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-xl">
          <div className="flex items-center gap-3">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{chosen.length}</span>
            <span className="text-sm font-medium text-foreground">SKU dipilih di halaman ini{chosen.length > 200 ? " · Maksimal 200 SKU per aksi" : ""}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={chosen.length > 200} onClick={() => setEditing(chosen)}>
              <Pencil className="size-3.5" />
              Ubah stok
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || chosen.length > 200}
              onClick={() => {
                void retry(chosen);
              }}
            >
              <RefreshCw className="size-3.5" />
              Sinkron ulang
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X className="size-3.5" />
              Batal pilih
            </Button>
          </div>
        </div>
      )}

      {editing && data && <StockChangeDialog rows={editing} warehouses={data.filters.warehouses} onClose={() => setEditing(null)} onSaved={saved} />}
      {allocation && <AllocationDialog row={allocation.row} listings={allocation.listings} onClose={() => setAllocation(null)} onSaved={saved} />}
      {importing && data && <StockImportDialog warehouses={data.filters.warehouses} onClose={() => setImporting(false)} onSaved={saved} />}
    </div>
  );
}
