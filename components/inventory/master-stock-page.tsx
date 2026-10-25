"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Archive, ChevronDown, ChevronLeft, ChevronRight, Download, Package, RefreshCw, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorFeedback, Feedback, PageState } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authFetch } from "@/lib/utils/api-client";
import type { ListingStock, MasterStockResult, MasterStockRow, MasterStockTab } from "@/lib/inventory/master-stock.types";
import { AllocationDialog, inventoryRequest, numberFormat as fmt, StockChangeDialog } from "@/components/inventory/master-stock-dialogs";
import { MasterStockListings, stockStatusLabel } from "@/components/inventory/master-stock-listings";
import { StockImportDialog } from "@/components/inventory/stock-import-dialog";

const TABS: Array<[MasterStockTab, string, string]> = [
  ["all", "Semua", "Jumlah SKU master sesuai filter. Setiap SKU dihitung sekali."],
  ["empty", "Habis", "Bisa Dijual = 0. Arsip dan produk nonaktif disembunyikan secara default."],
  ["low", "Menipis", "Bisa Dijual di atas nol dan tidak melebihi minimum SKU atau produk induk."],
  ["failed", "Sinkron gagal", "SKU dengan minimal satu listing gagal. Listing lain tetap diproses."],
  ["unmapped", "Belum mapping", "SKU pusat tanpa listing terhubung. Konflik SKU seller masuk tinjauan Mapping Stok."],
  ["oversells", "Oversell", "Jumlah SKU dengan permintaan aktif belum terpenuhi dan belum memotong stok melebihi Bisa Dijual. Bukan jumlah log atau order historis."],
];
const control = "h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm";

export default function MasterStockPage() {
  const [data, setData] = useState<MasterStockResult | null>(null);
  const [filters, setFilters] = useState({ q: "", tab: "all" as MasterStockTab, category: "", platform: "", store: "", warehouse: "", sort: "name", archives: false });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [dense, setDense] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<MasterStockRow[] | null>(null);
  const [allocation, setAllocation] = useState<{ row: MasterStockRow; listing: ListingStock } | null>(null);
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
      setFilters({ q, tab: TABS.some(([id]) => id === tab) ? tab as MasterStockTab : "all",
        category: query.get("category") ?? "", platform: query.get("platform") ?? "", store: query.get("store") ?? "",
        warehouse: query.get("warehouse") ?? "", sort: query.get("sort") ?? "name", archives: query.get("archives") === "true" });
      setSearch(q); setUrlReady(true);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { setFilters((current) => ({ ...current, q: search.trim() })); setPage(1); setSelected(new Set()); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!urlReady) return;
    let cancelled = false;
    let fetching = false;
    let request: AbortController | null = null;
    async function load(initial = false) {
      if (fetching) return;
      fetching = true; request = new AbortController();
      if (initial) setLoading(true);
      try {
        const query = new URLSearchParams({ page: String(page), limit: String(pageSize) });
        for (const [key, value] of Object.entries(filters)) if (value !== "" && value !== false) query.set(key, String(value));
        const response = await authFetch(`/api/inventory/master-stock?${query}`, { signal: request.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Stok belum dapat dimuat.");
        if (!cancelled) { setData(result); setError(null); }
      } catch (cause) { if (!cancelled && !(cause instanceof Error && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Stok belum dapat dimuat."); }
      finally { fetching = false; if (!cancelled) setLoading(false); }
    }
    void load(true);
    const timer = setInterval(() => { void load(); }, 5000);
    return () => { cancelled = true; request?.abort(); clearInterval(timer); };
  }, [filters, page, pageSize, revision, urlReady]);
  useEffect(() => {
    if (!urlReady) return;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== "" && value !== false && !(key === "tab" && value === "all") && !(key === "sort" && value === "name")) query.set(key, String(value));
    window.history.replaceState(null, "", query.size ? `${window.location.pathname}?${query}` : window.location.pathname);
  }, [filters, urlReady]);
  function filter<K extends keyof typeof filters>(key: K, value: typeof filters[K]) {
    setFilters((current) => ({ ...current, [key]: value })); setPage(1); setSelected(new Set());
  }
  function saved() { setNotice("Perubahan disimpan. Pengiriman stok sedang menunggu diproses."); setSelected(new Set()); setRevision((value) => value + 1); }
  async function retry(rows: MasterStockRow[], listingId?: string) {
    setBusy(true); setError(null);
    try { await inventoryRequest({ action: "retry", variantIds: rows.map((row) => row.id), ...(listingId ? { listingId } : {}) }); saved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Sinkron ulang belum berhasil."); } finally { setBusy(false); }
  }
  async function exportFile() {
    setBusy(true); setError(null);
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value !== "" && value !== false) query.set(key, String(value));
      if (selected.size) query.set("ids", [...selected].join(","));
      const response = await authFetch(`/api/inventory/master-stock/spreadsheet?${query}`);
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? "Ekspor belum berhasil."); }
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a");
      link.href = url; link.download = "stok-sku-master.xlsx"; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ekspor belum berhasil."); } finally { setBusy(false); }
  }
  const rows = data?.rows ?? [];
  const chosen = rows.filter((row) => selected.has(row.id));
  const promotion = rows.some((row) => row.promoActive > 0);
  const columns = 10 + Number(promotion);
  const padding = dense ? "px-3 py-2" : "px-3 py-3";
  return <div className="space-y-5 p-4 md:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><h1 className="text-xl font-semibold tracking-tight">Stok Varian</h1>
      <p className="mt-1 text-sm text-muted-foreground">Satu baris untuk satu SKU master, terhubung ke semua listing toko.</p>
      <p className="mt-2 text-sm"><strong>Bisa Dijual = max(Di Gudang − Disisihkan, 0).</strong> Menunggu diproses adalah permintaan aktif yang belum memotong stok; tidak dikurangi lagi. Pesanan historis/import_only tidak memengaruhi stok.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => setImporting(true)}><Upload className="size-4" />Impor</Button><Button variant="outline" disabled={busy} onClick={() => { void exportFile(); }}><Download className="size-4" />Ekspor</Button><Button disabled={!chosen.length || busy} onClick={() => setEditing(chosen)}>Ubah stok{chosen.length ? ` (${chosen.length})` : ""}</Button></div></div>
    {error && <ErrorFeedback error={error} action={<Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Muat ulang</Button>} />}
    {notice && <Feedback variant="info" title="Perubahan stok" description={notice} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Tutup</Button>} />}
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-sm"><span>SKU seller yang ganda atau belum dikenali perlu ditinjau sebelum stok digabung.</span><Button asChild size="sm" variant="outline"><Link href="/products/mapping">Mapping Stok</Link></Button></div>
    <div role="tablist" aria-label="Status SKU master" className="flex flex-wrap gap-1 border-b pb-2">{TABS.map(([id, name, definition]) => <Tooltip key={id}><TooltipTrigger asChild><button role="tab" aria-selected={filters.tab === id} onClick={() => filter("tab", id)} className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm ${filters.tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{name}<span className="rounded bg-background/15 px-1.5 tabular-nums">{data ? fmt(data.counts[id]) : "…"}</span></button></TooltipTrigger><TooltipContent className="max-w-xs">{definition}</TooltipContent></Tooltip>)}</div>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6"><label className="relative sm:col-span-2"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><input className={`${control} w-full pl-9`} aria-label="Cari SKU atau nama produk" placeholder="Cari SKU seller atau nama produk" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <select aria-label="Kategori" className={control} value={filters.category} onChange={(event) => filter("category", event.target.value)}><option value="">Semua kategori</option>{data?.filters.categories.map((category) => <option key={category}>{category}</option>)}</select>
      <select aria-label="Marketplace" className={control} value={filters.platform} onChange={(event) => filter("platform", event.target.value)}><option value="">Semua marketplace</option><option value="SHOPEE">Shopee</option><option value="TIKTOK_SHOP">TikTok Shop</option></select>
      <select aria-label="Toko" className={control} value={filters.store} onChange={(event) => filter("store", event.target.value)}><option value="">Semua toko</option>{data?.filters.stores.filter((store) => !filters.platform || store.platform === filters.platform).map((store) => <option key={store.id} value={store.id}>{store.label}</option>)}</select>
      <select aria-label="Gudang" className={control} value={filters.warehouse} onChange={(event) => filter("warehouse", event.target.value)}><option value="">Semua gudang</option>{data?.filters.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><label className="inline-flex min-h-10 items-center gap-2"><input type="checkbox" checked={filters.archives} onChange={(event) => filter("archives", event.target.checked)} />Tampilkan arsip{data ? ` (${fmt(data.archivedCounts.all)})` : ""}</label><div className="flex flex-wrap gap-2"><select aria-label="Urutkan SKU" className={control} value={filters.sort} onChange={(event) => filter("sort", event.target.value)}><option value="name">Nama produk</option><option value="sku">SKU seller</option><option value="stock_asc">Stok terkecil</option><option value="stock_desc">Stok terbesar</option></select><select aria-label="Kepadatan tabel" className={control} value={dense ? "compact" : "comfortable"} onChange={(event) => setDense(event.target.value === "compact")}><option value="comfortable">Nyaman</option><option value="compact">Ringkas</option></select><Button variant="outline" disabled={busy} onClick={() => setRevision((value) => value + 1)} aria-label="Perbarui status stok"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></Button></div></div>
    {data && data.archivedCounts.empty > 0 && <p className="text-xs text-muted-foreground">{fmt(data.archivedCounts.empty)} SKU habis berada pada produk nonaktif/arsip. Hitungan tab mengikuti filter dan pilihan arsip.</p>}
    {chosen.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3 text-sm"><strong>{chosen.length} SKU dipilih di halaman ini</strong><Button size="sm" onClick={() => setEditing(chosen)}>Ubah stok</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { void retry(chosen); }}>Sinkron ulang terpilih</Button><Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Batal pilih</Button></div>}
    <div className="max-h-[68vh] overflow-auto rounded-lg border bg-card" aria-busy={loading}><table className="w-full min-w-[1100px] text-sm"><thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground"><tr><th className="w-10 p-3"><input type="checkbox" aria-label="Pilih semua SKU di halaman ini" checked={rows.length > 0 && rows.every((row) => selected.has(row.id))} onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())} /></th><th className="w-10" aria-label="Rincian" />{['Produk / SKU master', 'Toko terhubung', 'Di Gudang', 'Disisihkan', 'Menunggu diproses', 'Bisa Dijual', ...(promotion ? ['Promosi'] : []), 'Status sinkron', 'Aksi'].map((label) => <th key={label} className="whitespace-nowrap p-3 text-left font-medium">{label}</th>)}</tr></thead><tbody>
      {loading && !data ? Array.from({ length: 6 }, (_, index) => <tr key={index}><td className="p-3" colSpan={columns}><Skeleton className="h-12 w-full" /></td></tr>) : rows.map((row) => {
        const open = expanded.has(row.id);
        const sku = !/^\d+(?::\d+)?$/.test(row.sku) ? row.sku : row.listings.find((listing) => listing.sellerSku)?.sellerSku ?? "SKU seller belum tersedia";
        return <Fragment key={row.id}><tr data-testid="master-stock-row" className={`border-t align-middle ${selected.has(row.id) ? "bg-muted/50" : "hover:bg-muted/20"}`}>
          <td className={padding}><input type="checkbox" aria-label={`Pilih ${sku}`} checked={selected.has(row.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /></td>
          <td><button type="button" className="inline-flex size-10 items-center justify-center rounded-md hover:bg-muted" aria-label={`Rincian ${sku}`} aria-expanded={open} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })}>{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button></td>
          <td className={`${padding} min-w-64 max-w-96`}><div className="flex items-center gap-3">{row.imageUrl ? <Image alt="" src={row.imageUrl} width={44} height={44} unoptimized className="size-11 shrink-0 rounded-md border object-cover" /> : <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted"><Package className="size-5 text-muted-foreground" /></div>}<div className="min-w-0"><p title={row.name} className="line-clamp-2 font-medium leading-snug">{row.name}</p>{row.variantName && !/^\d+(?::\d+)?$/.test(row.variantName) && <p className="line-clamp-1 text-xs text-muted-foreground">{row.variantName}</p>}<p className="mt-1 break-all font-mono text-xs text-muted-foreground">{sku}</p>{row.archived && <StatusBadge status="inactive" label="Arsip / nonaktif" />}</div></div></td>
          <td className={padding}><span className="whitespace-nowrap rounded-full border bg-muted/40 px-2 py-1 text-xs">{new Set(row.listings.map((listing) => listing.accountId)).size} toko</span></td>
          {[row.stock, row.safetyStock, row.pending, row.available].map((value, index) => <td key={index} className={`${padding} tabular-nums ${index === 3 ? "font-semibold" : ""}`}>{fmt(value)}</td>)}
          {promotion && <td className={`${padding} tabular-nums`}>{row.promoActive ? `${row.promoActive} aktif` : "—"}</td>}
          <td className={padding}><StatusBadge status={row.listings.length ? row.status.toLowerCase() : "unlinked"} label={row.listings.length ? stockStatusLabel(row.status) : "Belum mapping"} /></td><td className={padding}><Button size="sm" variant="outline" disabled={busy || row.archived} onClick={() => setEditing([row])}>Ubah stok</Button></td></tr>
          {open && <tr className="border-t bg-muted/20"><td colSpan={columns}><MasterStockListings row={row} busy={busy} allocate={(listing) => setAllocation({ row, listing })} retry={(listing) => { void retry([row], listing.id); }} message={setNotice} /><div className="px-4 pb-3 sm:pl-16"><Button size="sm" variant="ghost" onClick={() => { void inventoryRequest({ action: "archive", variantId: row.id, archived: !row.ownArchived }).then(() => setRevision((value) => value + 1)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Gagal mengubah arsip.")); }}><Archive className="size-3" />{row.ownArchived ? "Lepas arsip SKU" : "Arsipkan SKU"}</Button></div></td></tr>}
        </Fragment>;
      })}
      {!loading && !rows.length && <tr><td colSpan={columns}><PageState title="Tidak ada SKU pada tampilan ini" description="Coba ubah pencarian, filter, atau pilihan arsip. Listing tanpa SKU master dapat diperiksa melalui Mapping Stok." /></td></tr>}
    </tbody></table></div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"><p className="tabular-nums">{data ? `${fmt(data.total)} SKU master · halaman ${page} dari ${Math.max(1, Math.ceil(data.total / pageSize))}` : "Memuat SKU master…"} · Total semua gudang; stok per gudang ada di rincian.</p><div className="flex items-center gap-2"><select aria-label="SKU per halaman" className={control} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); setSelected(new Set()); }}>{[25, 50, 100, 200].map((size) => <option key={size} value={size}>{size} / halaman</option>)}</select><Button variant="outline" size="icon" aria-label="Halaman sebelumnya" disabled={page <= 1 || loading} onClick={() => { setPage((value) => value - 1); setSelected(new Set()); }}><ChevronLeft className="size-4" /></Button><Button variant="outline" size="icon" aria-label="Halaman berikutnya" disabled={!data || page * pageSize >= data.total || loading} onClick={() => { setPage((value) => value + 1); setSelected(new Set()); }}><ChevronRight className="size-4" /></Button></div></div>
    {editing && data && <StockChangeDialog rows={editing} warehouses={data.filters.warehouses} onClose={() => setEditing(null)} onSaved={saved} />}
    {allocation && <AllocationDialog row={allocation.row} listing={allocation.listing} onClose={() => setAllocation(null)} onSaved={saved} />}
    {importing && data && <StockImportDialog warehouses={data.filters.warehouses} onClose={() => setImporting(false)} onSaved={saved} />}
  </div>;
}
