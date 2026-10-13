"use client";

import { ErrorFeedback, Feedback } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status-badge";
import { notify } from "@/components/ui/notify";
import { InlineStockInput } from "@/components/inventory/inline-stock-input";
import { useEffect, useMemo, useState } from "react";
import { History, Minus, PackageOpen, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";
import type { StockRow, StockTab } from "@/app/api/inventory/stock/route";
import type { OversellEntry } from "@/app/api/inventory/oversells/route";

type TabId = StockTab | "oversells";

type Counts = { all: number; empty: number; low: number; oversells: number };

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "Semua Produk" },
  { id: "empty", label: "Habis" },
  { id: "low", label: "Stok Menipis" },
  { id: "oversells", label: "Pesanan Melebihi Stok (Oversell)" },
];

const fmt = (n: number) => n.toLocaleString("id-ID");
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" });

const MOVEMENT_REASONS = {
  IN: ["Pembelian atau restok", "Barang retur", "Koreksi stok masuk", "Lainnya"],
  OUT: ["Barang rusak", "Barang hilang", "Pemakaian internal", "Koreksi stok keluar", "Lainnya"],
} as const;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export default function InventoryStockPage() {
  const [tab, setTab] = useState<TabId>("all");
  const [rows, setRows] = useState<StockRow[]>([]);
  const [entries, setEntries] = useState<OversellEntry[]>([]);
  const [counts, setCounts] = useState<Counts>({ all: 0, empty: 0, low: 0, oversells: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState("all");
  const [sort, setSort] = useState("name_asc");
  const [filterOptions, setFilterOptions] = useState<{
    categories: string[];
    accounts: Array<{ id: string; label: string; platform: string }>;
  }>({ categories: [], accounts: [] });
  const [urlReady, setUrlReady] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<"stock" | "safetyStock">("stock");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [movement, setMovement] = useState<{
    row: StockRow;
    direction: "IN" | "OUT";
    qty: string;
    reason: string;
    note: string;
    requestId: string;
  } | null>(null);
  const [movementSaving, setMovementSaving] = useState(false);

  const [editing, setEditing] = useState<{
    variantId: string;
    field: "safetyStock" | "minStock" | "stock";
    value: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [handlingId, setHandlingId] = useState<string | null>(null);

  const [safetyHist, setSafetyHist] = useState<{ variantId: string; sku: string } | null>(null);
  const [safetyEntries, setSafetyEntries] = useState<
    Array<{
      id: string;
      note: string | null;
      reason: string;
      changeQty: number;
      stockAfter: number;
      createdAt: string;
      user: { username: string } | null;
    }>
  >([]);
  const [safetyLoading, setSafetyLoading] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      const initialTab = params.get("tab") as TabId | null;
      if (initialTab && TABS.some((item) => item.id === initialTab)) setTab(initialTab);
      const initialQ = params.get("q") ?? "";
      setQ(initialQ);
      setQInput(initialQ);
      setCategoryFilter(params.get("category") ?? "all");
      setPlatformFilter(params.get("platform") ?? "all");
      setStoreFilter(params.get("store") ?? "all");
      setSort(params.get("sort") ?? "name_asc");
      setUrlReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const params = new URLSearchParams();
    if (tab !== "all") params.set("tab", tab);
    if (q.trim()) params.set("q", q.trim());
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    if (platformFilter !== "all") params.set("platform", platformFilter);
    if (storeFilter !== "all") params.set("store", storeFilter);
    if (sort !== "name_asc") params.set("sort", sort);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  }, [categoryFilter, platformFilter, q, sort, storeFilter, tab, urlReady]);
  // Initial load & refetch (tab/q/reload): async fn di dalam effect + guard
  // cancelled, tanpa setState sinkron di body effect (aturan
  // react-hooks/set-state-in-effect). Stale-while-revalidate seperti history.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        if (tab === "oversells") {
          const data = await api<{ entries: OversellEntry[]; unhandledCount: number }>(
            "/api/inventory/oversells"
          );
          if (cancelled) return;
          setEntries(data.entries);
          setCounts((prev) => ({ ...prev, oversells: data.unhandledCount }));
          setError(null);
        } else {
          const p = new URLSearchParams({ tab, limit: "50" });
          if (q) p.set("q", q);
          if (categoryFilter !== "all") p.set("category", categoryFilter);
          if (platformFilter !== "all") p.set("platform", platformFilter);
          if (storeFilter !== "all") p.set("account", storeFilter);
          const data = await api<{
            rows: StockRow[];
            nextCursor: string | null;
            counts: Counts;
            filters: typeof filterOptions;
          }>(`/api/inventory/stock?${p.toString()}`);
          if (cancelled) return;
          setRows(data.rows);
          setNextCursor(data.nextCursor);
          setCounts(data.counts);
          setFilterOptions(data.filters);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Gagal memuat data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [tab, q, categoryFilter, platformFilter, storeFilter, reloadKey]);

  // Debounce search 300ms (paritas halaman marketplace) — Enter tetap instan.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ((prev) => (prev === qInput.trim() ? prev : qInput.trim()));
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // Paginasi = event handler (boleh setState langsung).
  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const p = new URLSearchParams({ tab, limit: "50", cursor: nextCursor });
      if (q) p.set("q", q);
      if (categoryFilter !== "all") p.set("category", categoryFilter);
      if (platformFilter !== "all") p.set("platform", platformFilter);
      if (storeFilter !== "all") p.set("account", storeFilter);
      const data = await api<{ rows: StockRow[]; nextCursor: string | null }>(
        `/api/inventory/stock?${p.toString()}`
      );
      setRows((prev) => [...prev, ...data.rows]);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat halaman berikutnya.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function saveInlineStock(
    row: StockRow,
    field: "stock" | "safetyStock",
    value: number,
    showNotice = true
  ): Promise<boolean> {
    setError(null);
    setNotice(null);
    try {
      if (field === "stock") {
        const result = await api<{ ok: boolean; stockAfter: number }>(
          `/api/inventory/variants/${row.variantId}/adjust`,
          {
            method: "POST",
            body: JSON.stringify({
              newStock: value,
              note: "Diatur langsung dari halaman Stok Varian.",
            }),
          }
        );
        setRows((current) =>
          current.map((item) =>
            item.variantId === row.variantId
              ? {
                  ...item,
                  stock: result.stockAfter,
                  available: Math.max(0, result.stockAfter - item.safetyStock),
                }
              : item
          )
        );
      } else {
        const result = await api<{
          safetyStock: number;
          minStock: number | null;
          minStockResolved: number;
          notifyEmail: boolean;
        }>(`/api/inventory/variant/${row.variantId}`, {
          method: "PATCH",
          body: JSON.stringify({ safetyStock: value }),
        });
        setRows((current) =>
          current.map((item) =>
            item.variantId === row.variantId
              ? {
                  ...item,
                  safetyStock: result.safetyStock,
                  available: Math.max(0, item.stock - result.safetyStock),
                }
              : item
          )
        );
      }
      if (showNotice) {
        setNotice(
          `${field === "stock" ? "Stok fisik" : "Stok cadangan"} ${row.sku} disimpan. Sinkronisasi marketplace diproses.`
        );
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan stok.");
      return false;
    }
  }

  async function applyBulkStock() {
    const value = Number(bulkValue);
    if (!Number.isInteger(value) || value < 0) {
      setError("Nilai massal harus berupa angka bulat 0 atau lebih.");
      return;
    }
    const targets = rows.filter((row) => selected.has(row.variantId));
    if (targets.length === 0) return;

    setBulkSaving(true);
    setError(null);
    setNotice(null);
    const failed: string[] = [];
    for (const row of targets) {
      const saved = await saveInlineStock(row, bulkField, value, false);
      if (!saved) failed.push(row.variantId);
    }
    setBulkSaving(false);
    setSelected(new Set(failed));
    if (failed.length === 0) {
      setBulkValue("");
      setNotice(`${targets.length} varian berhasil diperbarui. Sinkronisasi marketplace diproses.`);
    } else {
      setError(`${targets.length - failed.length} varian berhasil dan ${failed.length} varian gagal diperbarui.`);
    }
  }

  async function handleSaveEdit() {
    if (!editing) return;
    if (editing.field === "stock" && editing.value.trim() === "") {
      setError("Stok wajib diisi (angka bulat >= 0).");
      return;
    }
    const parsed =
      editing.field === "minStock" && editing.value.trim() === ""
        ? null
        : Number(editing.value);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) {
      setError(
        editing.field === "stock"
          ? "Stok harus bilangan bulat >= 0."
          : "Nilai harus bilangan bulat >= 0 (kosongkan Batas Min utk ikut produk induk)."
      );
      return;
    }

    // Atur stok fisik langsung dari halaman ini (pola Shopee Seller Centre):
    // angka mutlak → StockLedger MANUAL_ADJUSTMENT + push otomatis ke
    // semua listing ter-mapping (lewati kalau auto-push dimatikan di settings).
    if (editing.field === "stock" && parsed !== null) {
      setSaving(true);
      setError(null);
      try {
        const res = await api<{ ok: boolean; stockAfter: number }>(
          `/api/inventory/variants/${editing.variantId}/adjust`,
          { method: "POST", body: JSON.stringify({ newStock: parsed, note: "Diatur langsung dari halaman Stok Varian." }) }
        );
        setRows((prev) =>
          prev.map((r) =>
            r.variantId === editing.variantId
              ? { ...r, stock: res.stockAfter, available: Math.max(0, res.stockAfter - r.safetyStock) }
              : r
          )
        );
        setEditing(null);
        setReloadKey((k) => k + 1);
        notify("success", `Stok fisik berhasil diubah menjadi ${parsed} dan disinkronkan ke toko.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal menyimpan stok.");
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await api<{
        safetyStock: number;
        minStock: number | null;
        minStockResolved: number;
        notifyEmail: boolean;
      }>(`/api/inventory/variant/${editing.variantId}`, {
        method: "PATCH",
        body: JSON.stringify({ [editing.field]: parsed }),
      });
      setRows((prev) =>
        prev.map((r) =>
          r.variantId === editing.variantId
            ? {
                ...r,
                safetyStock: updated.safetyStock,
                minStock: updated.minStock,
                minStockResolved: updated.minStockResolved,
                available: Math.max(0, r.stock - updated.safetyStock),
              }
            : r
        )
      );
      setEditing(null);
      setReloadKey((k) => k + 1);
      notify("success", editing.field === "safetyStock"
            ? `Stok cadangan berhasil diubah menjadi ${parsed ?? 0}.`
            : "Batas minimum stok berhasil diperbarui.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function openSafetyHistory(row: StockRow) {
    setSafetyHist({ variantId: row.variantId, sku: row.sku });
    setSafetyEntries([]);
    setSafetyLoading(true);
    try {
      const data = await api<{
        entries: Array<{
          id: string;
          note: string | null;
          reason: string;
          changeQty: number;
          stockAfter: number;
          createdAt: string;
          user: { username: string } | null;
        }>;
      }>(`/api/inventory/ledger?variantId=${row.variantId}&limit=50`);
      setSafetyEntries(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat riwayat cadangan.");
      setSafetyHist(null);
    } finally {
      setSafetyLoading(false);
    }
  }

  function openMovement(row: StockRow, direction: "IN" | "OUT") {
    setMovement({
      row,
      direction,
      qty: "",
      reason: MOVEMENT_REASONS[direction][0],
      note: "",
      requestId: crypto.randomUUID(),
    });
  }

  async function saveMovement() {
    if (!movement) return;
    const qty = Number(movement.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError("Jumlah stok harus berupa angka bulat lebih dari 0.");
      return;
    }
    setMovementSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ stockAfter: number; already?: boolean }>(
        "/api/inventory/stock-movement",
        {
          method: "POST",
          body: JSON.stringify({
            variantId: movement.row.variantId,
            direction: movement.direction,
            qty,
            reason: movement.reason,
            note: movement.note,
            requestId: movement.requestId,
          }),
        }
      );
      setRows((current) =>
        current.map((row) =>
          row.variantId === movement.row.variantId
            ? {
                ...row,
                stock: result.stockAfter,
                available: Math.max(0, result.stockAfter - row.safetyStock),
              }
            : row
        )
      );
      setNotice(
        result.already
          ? "Permintaan ini sudah pernah diproses; stok tidak diubah lagi."
          : `Stok ${movement.direction === "IN" ? "masuk" : "keluar"} ${movement.row.sku} berhasil dicatat.`
      );
      setMovement(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pergerakan stok gagal disimpan.");
    } finally {
      setMovementSaving(false);
    }
  }

  const parseSafetyNote = (note: string | null) => {
    const m = note?.match(/Cadangan (\d+) → (\d+)/);
    return m ? { from: m[1], to: m[2] } : null;
  };

  async function handleMarkHandled(id: string) {
    setHandlingId(id);
    setError(null);
    try {
      const updated = await api<{ handledAt: string | null; handledBy: string | null }>(
        `/api/inventory/oversells/${id}/handle`,
        { method: "POST" }
      );
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, handledAt: updated.handledAt, handledBy: updated.handledBy } : e
        )
      );
      setCounts((prev) => ({ ...prev, oversells: Math.max(0, prev.oversells - 1) }));
      notify("success", "Catatan oversell berhasil ditandai sebagai sudah ditangani.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menandai.");
    } finally {
      setHandlingId(null);
    }
  }

  const badge = (id: TabId) =>
    id === "all" ? counts.all : id === "empty" ? counts.empty : id === "low" ? counts.low : counts.oversells;

  const displayRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sort === "stock_desc") return b.available - a.available;
      if (sort === "stock_asc") return a.available - b.available;
      return a.productName.localeCompare(b.productName) || a.sku.localeCompare(b.sku);
    });
    return sorted;
  }, [rows, sort]);

  const resetFilters = () => {
    setQInput("");
    setQ("");
    setCategoryFilter("all");
    setPlatformFilter("all");
    setStoreFilter("all");
    setSort("name_asc");
    setTab("all");
  };

  return (
    <div className="p-4 md:p-8 relative">
      {/* Toast Notification */}

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Stok Varian</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pantau stok gudang per variasi; mulai dengan mencari produk dan memeriksa stok Fisik serta Cadangan sebelum mengubahnya.
          </p>
          <p className="text-xs text-muted-foreground mt-1" title="effectiveStock() = max(0, Fisik − Cadangan)">
            Target stok jual = stok fisik − stok cadangan (buffer), minimal 0. Angka di toko baru berubah jika pengiriman pembaruan berhasil; periksa masalah pengiriman di Stok Mismatch.
          </p>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="flex items-center gap-2 border border-border bg-card px-3 py-1.5 rounded-md text-sm text-foreground font-medium hover:bg-muted"
        >
          <RefreshCw size={14} /> Muat Ulang
        </button>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              tab === t.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-foreground border-border hover:bg-muted"
            }`}
          >
            {t.label}
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                tab === t.id ? "bg-card/20 text-primary-foreground" : "bg-muted text-foreground"
              }`}
            >
              {fmt(badge(t.id))}
            </span>
          </button>
        ))}
      </div>

      {error && <ErrorFeedback error={error} className="mb-4" />}
      {notice && <Feedback variant="success" title="Perubahan disimpan" description={notice} className="mb-4" />}

      {tab !== "oversells" ? (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
            <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setQ(qInput.trim());
                }}
                placeholder="Cari SKU / nama varian / produk…"
                className="w-full border border-border rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <select aria-label="Filter kategori inventori" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="all">Semua kategori</option>
              {filterOptions.categories.map((category) => <option key={category}>{category}</option>)}
            </select>
            <select aria-label="Filter marketplace inventori" value={platformFilter} onChange={(event) => { setPlatformFilter(event.target.value); setStoreFilter("all"); }} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="all">Semua marketplace</option>
              <option value="SHOPEE">Shopee</option>
              <option value="TIKTOK_SHOP">TikTok Shop</option>
              <option value="TOKOPEDIA">Tokopedia</option>
            </select>
            <select aria-label="Filter toko inventori" value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="h-10 max-w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="all">Semua toko</option>
              {filterOptions.accounts.filter((account) => platformFilter === "all" || account.platform === platformFilter).map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
            <select aria-label="Urutkan inventori" value={sort} onChange={(event) => setSort(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="name_asc">Nama A-Z</option>
              <option value="stock_asc">Stok tersedia terendah</option>
              <option value="stock_desc">Stok tersedia tertinggi</option>
            </select>
            {(q || categoryFilter !== "all" || platformFilter !== "all" || storeFilter !== "all" || sort !== "name_asc" || tab !== "all") && (
              <button type="button" onClick={resetFilters} className="h-10 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted">Reset</button>
            )}
            <div className="flex basis-full flex-wrap gap-2" aria-label="Filter inventori aktif">
              {q && <button onClick={() => { setQInput(""); setQ(""); }} className="rounded-full border border-border bg-muted px-3 py-1 text-xs">Cari: {q} ×</button>}
              {categoryFilter !== "all" && <button onClick={() => setCategoryFilter("all")} className="rounded-full border border-border bg-muted px-3 py-1 text-xs">Kategori: {categoryFilter} ×</button>}
              {platformFilter !== "all" && <button onClick={() => setPlatformFilter("all")} className="rounded-full border border-border bg-muted px-3 py-1 text-xs">Marketplace: {platformFilter} ×</button>}
              {storeFilter !== "all" && <button onClick={() => setStoreFilter("all")} className="rounded-full border border-border bg-muted px-3 py-1 text-xs">Toko: {filterOptions.accounts.find((account) => account.id === storeFilter)?.label ?? storeFilter} ×</button>}
            </div>
            </div>
            {selected.size > 0 && (
              <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/40 p-3" role="region" aria-label="Aksi massal stok">
                <p className="mr-auto self-center text-sm font-semibold text-foreground">
                  {selected.size} varian dipilih
                </p>
                <label className="text-xs font-medium text-muted-foreground">
                  Data yang diubah
                  <select
                    value={bulkField}
                    onChange={(event) => setBulkField(event.target.value as "stock" | "safetyStock")}
                    className="mt-1 block h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="stock">Stok fisik</option>
                    <option value="safetyStock">Stok cadangan</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Nilai baru
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={bulkValue}
                    onChange={(event) => setBulkValue(event.target.value)}
                    className="mt-1 block h-9 w-28 rounded-md border border-border bg-background px-3 text-right text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void applyBulkStock()}
                  disabled={bulkSaving || bulkValue.trim() === ""}
                  className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {bulkSaving ? "Menyimpan…" : "Terapkan"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  disabled={bulkSaving}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  Batal
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3 animate-pulse">
                  <div className="w-10 h-10 bg-muted rounded shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded w-48" />
                    <div className="h-2.5 bg-muted rounded w-32" />
                  </div>
                  <div className="h-3 bg-muted rounded w-12" />
                  <div className="h-3 bg-muted rounded w-12" />
                  <div className="h-3 bg-muted rounded w-12" />
                  <div className="h-3 bg-muted rounded w-16" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-4 md:p-8 text-center text-sm text-muted-foreground">{q.trim() || tab !== "all" ? <><span>Tidak ada variasi yang cocok dengan pencarian atau tab.</span><button className="block mx-auto mt-2 underline" onClick={() => { setQ(""); setTab("all"); }}>Hapus Pencarian dan Filter</button></> : <>Belum ada variasi stok pusat. <a href="/products" className="underline">Tambahkan produk di Produk Master</a>, lalu hubungkan produk toko melalui Mapping.</>}</p>
          ) : (
            <div>
              <div className="px-4 py-2 border-b border-border text-xs text-muted-foreground flex items-center justify-between sm:hidden bg-muted/40">
                <span>💡 Geser tabel ke kanan untuk melihat semua kolom</span>
                <span>→</span>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="w-12 px-4 py-3 font-semibold">
                      <input
                        type="checkbox"
                        aria-label="Pilih semua varian yang tampil"
                        checked={displayRows.length > 0 && displayRows.every((row) => selected.has(row.variantId))}
                        onChange={(event) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            for (const row of displayRows) {
                              if (event.target.checked) next.add(row.variantId);
                              else next.delete(row.variantId);
                            }
                            return next;
                          });
                        }}
                        className="size-4 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </th>
                    <th className="px-4 py-3 font-semibold">Produk / Varian</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Stok fisik yang dicatat di gudang. Ketik angka baru lalu tekan Enter atau tombol centang.">Fisik</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Stok yang disisihkan dan tidak ditawarkan ke toko.">Cadangan</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Info saja: jumlah activity promosi AKTIF yang mencakup varian.">Promosi</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Qty order aktif yang BELUM memotong stok — demand yang akan datang">Pesanan</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Target stok jual: fisik dikurangi cadangan, minimal 0.">Tersedia</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Batas minimum per varian. Kosong = ikut threshold produk induk">Batas Min</th>
                    <th className="px-4 py-3 font-semibold">Aksi stok</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {displayRows.map((r) => (
                    <tr key={r.variantId} data-testid={`inventory-row-${r.variantId}`} className="hover:bg-muted">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Pilih varian ${r.sku}`}
                          checked={selected.has(r.variantId)}
                          onChange={(event) => {
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(r.variantId);
                              else next.delete(r.variantId);
                              return next;
                            });
                          }}
                          className="size-4 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          {r.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.imageUrl} alt="" className="w-10 h-10 rounded object-cover bg-muted shrink-0" />
                          ) : (
                            <div className="w-10 h-10 bg-muted rounded flex items-center justify-center text-muted-foreground shrink-0">
                              <PackageOpen size={16} />
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-foreground leading-tight">{r.productName}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {r.variantName ?? r.sku} · <span className="font-mono">{r.sku}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        <InlineStockInput
                          value={r.stock}
                          label={`Stok fisik ${r.sku}`}
                          onSave={(value) => saveInlineStock(r, "stock", value)}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1">
                          <InlineStockInput
                            value={r.safetyStock}
                            label={`Stok cadangan ${r.sku}`}
                            onSave={(value) => saveInlineStock(r, "safetyStock", value)}
                          />
                          <button
                            type="button"
                            title="Riwayat perubahan cadangan"
                            aria-label={`Riwayat stok cadangan ${r.sku}`}
                            onClick={() => openSafetyHistory(r)}
                            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <History size={14} />
                          </button>
                        </span>
                        {r.safetyStock > r.stock && (
                          <span className="mt-1 block text-[11px] font-medium text-foreground">
                            Cadangan melebihi fisik; stok tersedia 0.
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.promoActive > 0 ? (
                          <StatusBadge status="active" label={`${r.promoActive} aktif`} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{fmt(r.orderedQty)}</td>
                      <td className="px-4 py-3 text-right font-bold text-foreground"><div>{fmt(r.available)}</div>{r.available === 0 ? <StatusBadge status="out" /> : r.available <= r.minStockResolved ? <StatusBadge status="low" /> : null}</td>
                      <td className="px-4 py-3 text-right">
                        {editing?.variantId === r.variantId && editing.field === "minStock" ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              placeholder={String(r.minStockResolved)}
                              value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveEdit();
                                if (e.key === "Escape") setEditing(null);
                              }}
                              disabled={saving}
                              autoFocus
                              className="w-20 border border-border rounded-md px-2 py-1 text-sm text-right outline-none focus:ring-2 focus:ring-ring"
                            />
                            <button
                              onClick={handleSaveEdit}
                              disabled={saving}
                              className="text-xs font-bold text-foreground hover:underline disabled:opacity-50"
                            >
                              Simpan
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {r.minStock === null ? (
                              <span className="text-muted-foreground" title="Mengikuti threshold produk induk">
                                {fmt(r.minStockResolved)}*
                              </span>
                            ) : (
                              fmt(r.minStock)
                            )}
                            <button
                              title="Ubah batas minimum (kosongkan = ikut produk induk)"
                              onClick={() =>
                                setEditing({
                                  variantId: r.variantId,
                                  field: "minStock",
                                  value: r.minStock === null ? "" : String(r.minStock),
                                })
                              }
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Pencil size={13} />
                            </button>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex min-w-max items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openMovement(r, "IN")}
                            className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Plus className="size-3.5" aria-hidden="true" /> Masuk
                          </button>
                          <button
                            type="button"
                            onClick={() => openMovement(r, "OUT")}
                            className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Minus className="size-3.5" aria-hidden="true" /> Keluar
                          </button>
                          <button
                            type="button"
                            onClick={() => openSafetyHistory(r)}
                            aria-label={`Lihat riwayat stok ${r.sku}`}
                            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <History className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          )}

          {nextCursor && !loading && (
            <div className="p-4 border-t border-border text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="text-sm font-semibold text-foreground border border-border rounded-lg px-4 py-2 hover:bg-muted disabled:opacity-50"
              >
                {loadingMore ? "Memuat…" : "Muat Lebih Banyak"}
              </button>
            </div>
          )}
          <p className="px-4 pb-3 text-[11px] text-muted-foreground">
            * Mengikuti threshold produk induk. Badge tab = total global (tanpa filter pencarian),
            dihitung fresh tiap buka tab.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <p className="p-4 md:p-8 text-center text-sm text-muted-foreground">Memuat…</p>
          ) : entries.length === 0 ? (
            <p className="p-4 md:p-8 text-center text-sm text-muted-foreground">
              Belum ada pesanan melebihi stok yang tercatat pada tampilan ini.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Produk / Varian (SKU)</th>
                    <th className="px-4 py-3 font-semibold">Toko</th>
                    <th className="px-4 py-3 font-semibold">Waktu</th>
                    <th className="px-4 py-3 font-semibold text-right">Gagal deduct</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-muted">
                      <td className="px-4 py-3">
                        {e.skus.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ul className="list-disc list-inside text-foreground">
                            {e.skus.map((s) => (
                              <li key={s} className="font-mono text-xs">{s}</li>
                            ))}
                          </ul>
                        )}
                        {e.message && (
                          <p className="text-xs text-muted-foreground mt-1 max-w-md truncate" title={e.message}>
                            {e.message}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-foreground">{e.accountLabel}</span>
                        <span className="block text-xs text-muted-foreground">{e.platform}</span>
                      </td>
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">{fmtDate(e.occurredAt)}</td>
                      <td className="px-4 py-3 text-right font-bold text-foreground">{fmt(e.failedQty)}</td>
                      <td className="px-4 py-3">
                        {e.handledAt ? (
                          <StatusBadge status="success" label="Sudah ditangani" />
                        ) : (
                          <StatusBadge status="error" label="Belum ditangani" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!e.handledAt && (
                          <button
                            onClick={() => handleMarkHandled(e.id)}
                            disabled={handlingId === e.id}
                            className="text-xs font-semibold border border-border rounded-lg px-3 py-1.5 hover:bg-muted disabled:opacity-50"
                          >
                            {handlingId === e.id ? "Menyimpan…" : "Tandai sudah ditangani"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {movement && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 p-4"
          onClick={() => !movementSaving && setMovement(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="movement-title"
            className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="movement-title" className="text-base font-bold text-foreground">
                  Stok {movement.direction === "IN" ? "Masuk" : "Keluar"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {movement.row.productName} · <span className="font-mono">{movement.row.sku}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Stok fisik saat ini: {fmt(movement.row.stock)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMovement(null)}
                disabled={movementSaving}
                aria-label="Tutup dialog pergerakan stok"
                className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-4 grid gap-4">
              <label className="text-sm font-medium text-foreground">
                Jumlah
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  autoFocus
                  value={movement.qty}
                  onChange={(event) => setMovement({ ...movement, qty: event.target.value })}
                  className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="text-sm font-medium text-foreground">
                Alasan
                <select
                  value={movement.reason}
                  onChange={(event) => setMovement({ ...movement, reason: event.target.value })}
                  className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {MOVEMENT_REASONS[movement.direction].map((reason) => (
                    <option key={reason}>{reason}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-foreground">
                Catatan <span className="font-normal text-muted-foreground">(opsional)</span>
                <textarea
                  rows={3}
                  value={movement.note}
                  onChange={(event) => setMovement({ ...movement, note: event.target.value })}
                  className="mt-1 block w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMovement(null)}
                disabled={movementSaving}
                className="h-10 rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void saveMovement()}
                disabled={movementSaving || movement.qty.trim() === ""}
                className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {movementSaving ? "Menyimpan…" : `Simpan Stok ${movement.direction === "IN" ? "Masuk" : "Keluar"}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {safetyHist && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 p-4"
          onClick={() => setSafetyHist(null)}
        >
          <div
            className="bg-card rounded-xl shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground">Riwayat stok</h2>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">{safetyHist.sku}</p>
              </div>
              <button
                onClick={() => setSafetyHist(null)}
                className="text-muted-foreground hover:text-foreground"
                title="Tutup"
              >
                <X size={16} />
              </button>
            </div>
            {safetyLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Memuat…</p>
            ) : safetyEntries.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Belum ada pergerakan stok tercatat untuk varian ini.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {safetyEntries.map((e) => {
                  const parsed = parseSafetyNote(e.note);
                  return (
                    <li key={e.id} className="border border-border rounded-lg px-3 py-2 text-sm">
                      <p className="font-semibold text-foreground">
                        {parsed ? <>Cadangan {parsed.from} → {parsed.to}</> : e.note ?? e.reason}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {e.changeQty > 0 ? `+${fmt(e.changeQty)}` : fmt(e.changeQty)} · {e.user?.username ?? "sistem"} · {fmtDate(e.createdAt)} · stok fisik {fmt(e.stockAfter)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
