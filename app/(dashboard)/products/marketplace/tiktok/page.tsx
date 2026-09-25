"use client";

import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/utils/api-client";
import Link from "next/link";
import {
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Loader2,
  ChevronUp,
  ExternalLink,
  Filter,
  PackageOpen,
  Radio,
  MoreVertical,
} from "lucide-react";

/* ------------------------------ Types ------------------------------ */

type TabKey =
  | "all"
  | "active"
  | "out"
  | "archived"
  | "attention"
  | "pending"
  | "draft"
  | "failed";

type VariantRow = {
  mappingId: string;
  variantId: string | null;
  sku: string;
  channelSku: string;
  status: string | null;
  tab: TabKey | null;
  price: number | null;
  stock: number;
  platformStock: number | null;
  accountId: string;
  accountLabel: string;
  lastSyncedAt: string | null;
};

type ListingRow = {
  key: string;
  accountId: string;
  accountLabel: string;
  platformProductId: string | null;
  platformTitle: string | null;
  master: {
    id: string | null;
    name: string | null;
    imageUrl: string | null;
    category: string | null;
  } | null;
  status: string | null;
  tab: TabKey | null;
  variantCount: number;
  channelSku: string | null;
  priceMin: number | null;
  priceMax: number | null;
  stockTotal: number;
  lastSyncedAt: string | null;
  variants: VariantRow[];
};

type ListResponse = {
  rows: ListingRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<TabKey, number>;
  tabs: Array<{ key: TabKey; label: string }>;
  accounts: Array<{ id: string; label: string }>;
  lastSyncedAt: string | null;
};

type UnmappedSku = {
  skuId: string;
  sellerSku: string | null;
  stock: number;
  price: number | null;
};

type UnmappedProduct = {
  platformProductId: string;
  title: string | null;
  status: string | null;
  imageUrl: string | null;
  skus: UnmappedSku[];
};

type UnmappedAccount = {
  accountId: string;
  label: string;
  unmapped: UnmappedProduct[];
};

/* ------------------------------ Constants / helpers ------------------------------ */

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Aktif di platform",
  ACTIVATE: "Aktif di platform",
  SELLER_DEACTIVATED: "Nonaktif (seller)",
  PLATFORM_DEACTIVATED: "Nonaktif (platform)",
  FREEZE: "Dibekukan",
  DRAFT: "Draf",
  PENDING: "Menunggu review",
  SCHEDULED: "Terjadwal",
  FAILED: "Gagal publish",
  DELETED: "Dihapus",
  UNMATCHED: "Tidak ditemukan di TikTok",
};

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("id-ID");
}

function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return "Rp" + n.toLocaleString("id-ID");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "belum sync";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "belum sync";
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const isActiveStatus = (s: string | null | undefined) =>
  s === "ACTIVE" || s === "ACTIVATE";

function isDeletedStatus(s: string | null | undefined) {
  return (s ?? "").toUpperCase() === "DELETED";
}

/* ------------------------------ Toast ------------------------------ */

function Toast({
  toast,
  onClose,
}: {
  toast: { type: "success" | "error"; message: string } | null;
  onClose: () => void;
}) {
  if (!toast) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[60] max-w-sm">
      <div
        className={`rounded-xl border px-4 py-3 text-sm shadow-lg flex items-start gap-2 ${
          toast.type === "success"
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-red-50 border-red-200 text-red-800"
        }`}
      >
        <span className="flex-1">{toast.message}</span>
        <button onClick={onClose} className="underline text-xs opacity-70">
          Tutup
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ Main Page ------------------------------ */

export default function TikTokMarketplacePage() {
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<TabKey, number>>({
    all: 0, active: 0, out: 0, archived: 0, attention: 0, pending: 0, draft: 0, failed: 0,
  });
  const [accounts, setAccounts] = useState<ListResponse["accounts"]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<TabKey>("all");
  const [sort, setSort] = useState<string>("name_asc");
  const [refreshKey, setRefreshKey] = useState(0);

  const [filterOpen, setFilterOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState<string[]>([]);

  const [unmapped, setUnmapped] = useState<UnmappedAccount[]>([]);
  const [unmappedChecked, setUnmappedChecked] = useState(false);
  const [unmappedLoading, setUnmappedLoading] = useState(false);
  const [unmappedOpen, setUnmappedOpen] = useState<Set<string>>(new Set());
  const [mapTarget, setMapTarget] = useState<{
    accountId: string;
    accountLabel: string;
    product: UnmappedProduct;
    sku: UnmappedSku;
  } | null>(null);
  const unmappedTotal = unmapped.reduce((n, a) => n + a.unmapped.length, 0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const [syncingAll, setSyncingAll] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [syncingRows, setSyncingRows] = useState<Set<string>>(new Set());
  const [toggleOverrides, setToggleOverrides] = useState<Map<string, boolean>>(new Map());
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
        const res = await authFetch(`/api/marketplace/tiktok/products?${sp.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(data?.error ?? `Gagal memuat data (${res.status}).`);
          return;
        }
        const data: ListResponse = await res.json();
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setCounts(data.counts);
        setAccounts(data.accounts ?? []);
        setLastSyncedAt(data.lastSyncedAt ?? null);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setError("Terjadi kesalahan saat memuat data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [page, q, sort, tab, accountFilter, refreshKey]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!(filterRef.current?.contains(t))) setFilterOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function switchTab(key: TabKey) {
    setTab(key);
    setPage(1);
    setExpanded(new Set());
    setSelected(new Set());
  }

  const allPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) rows.forEach((r) => next.delete(r.key));
      else rows.forEach((r) => next.add(r.key));
      return next;
    });
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /* ------------------ Actions ------------------ */

  async function syncAll() {
    setSyncingAll(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/marketplace/tiktok/products/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Sync gagal.");
      const accountsMsg = (data.accounts as Array<{ label: string; synced: number; notFound: number; unmapped?: UnmappedProduct[] }>)
        .map((a) => `${a.label}: ${a.synced} update, ${a.notFound} tidak ditemukan${(a.unmapped?.length ?? 0) > 0 ? `, ${a.unmapped!.length} belum ter-mapping` : ""}`)
        .join(" · ");
      notify("success", `Sync selesai. ${accountsMsg}`);
      setUnmapped(
        (data.accounts as Array<{ accountId?: string; id?: string; label: string; unmapped?: UnmappedProduct[] }>)
          .map((a) => ({
            accountId: a.accountId ?? a.id ?? "",
            label: a.label,
            unmapped: a.unmapped ?? [],
          }))
          .filter((a) => a.accountId)
      );
      setUnmappedChecked(true);
      setTab("all");
      setPage(1);
      // refetch via effect
      setRefreshKey((k) => k + 1);
      setLastSyncedAt(new Date().toISOString());
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Sync gagal.");
    } finally {
      setSyncingAll(false);
    }
  }

  async function loadUnmapped() {
    setUnmappedLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/marketplace/tiktok/products/unmapped", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Gagal memuat produk belum ter-mapping.");
      setUnmapped((data.accounts as UnmappedAccount[]) ?? []);
      setUnmappedChecked(true);
      const ids = ((data.accounts as UnmappedAccount[]) ?? [])
        .filter((a) => a.unmapped.length > 0)
        .map((a) => a.accountId);
      setUnmappedOpen(new Set(ids));
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Gagal memuat produk belum ter-mapping.");
    } finally {
      setUnmappedLoading(false);
    }
  }

  function toggleUnmappedAccount(accountId: string) {
    setUnmappedOpen((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  function removeMappedSku(accountId: string, platformProductId: string, channelSku: string) {
    setUnmapped((prev) =>
      prev
        .map((a) =>
          a.accountId !== accountId
            ? a
            : {
                ...a,
                unmapped: a.unmapped
                  .map((p) =>
                    p.platformProductId !== platformProductId
                      ? p
                      : { ...p, skus: p.skus.filter((s) => (s.sellerSku ?? s.skuId) !== channelSku) }
                  )
                  .filter((p) => p.skus.length > 0),
              }
        )
        .filter((a) => a.unmapped.length > 0)
    );
  }

  async function syncRow(row: ListingRow) {
    const mappingId = row.variants[0].mappingId;
    setSyncingRows((prev) => new Set(prev).add(String(mappingId)));
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch(`/api/marketplace/tiktok/products/${mappingId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Refresh gagal.");
      notify("success", `Status "${row.platformTitle ?? row.master?.name ?? row.channelSku}" diperbarui.`);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Refresh gagal.");
    } finally {
      setSyncingRows((prev) => {
        const next = new Set(prev);
        next.delete(String(mappingId));
        return next;
      });
    }
  }

  async function toggleActive(row: ListingRow, nextOn: boolean) {
    const mappingId = row.variants[0].mappingId;
    if (!row.platformProductId) {
      notify("error", "Listing belum pernah di-sync. Klik ikon refresh baris ini dulu.");
      return;
    }
    // Optimistic
    setToggleOverrides((prev) => new Map(prev).set(String(mappingId), nextOn));
    setToggling((prev) => new Set(prev).add(String(mappingId)));
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch(`/api/marketplace/tiktok/products/${mappingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ active: nextOn }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? (nextOn ? "Gagal mengaktifkan." : "Gagal menonaktifkan."));
      notify("success", nextOn ? "Listing diaktifkan di TikTok Shop." : "Listing dinonaktifkan di TikTok Shop.");
      setRefreshKey((k) => k + 1);
    } catch (e) {
      // rollback
      setToggleOverrides((prev) => {
        const next = new Map(prev);
        next.set(String(mappingId), !nextOn);
        return next;
      });
      notify("error", e instanceof Error ? e.message : "Gagal mengubah status.");
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(String(mappingId));
        return next;
      });
    }
  }

  /* ------------------ Render ------------------ */

  const pageNumbers: number[] = [];
  {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) pageNumbers.push(i);
  }

  return (
    <div className="p-8">
      <Toast toast={toast} onClose={() => setToast(null)} />
      {mapTarget && (
        <MapUnmappedModal
          target={mapTarget}
          onClose={() => setMapTarget(null)}
          onMapped={(accountId, platformProductId, channelSku, detail) => {
            removeMappedSku(accountId, platformProductId, channelSku);
            notify("success", `Mapping tersimpan: ${detail}.`);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">
            Produk Marketplace › TikTok Shop
          </p>
          <h1 className="text-xl font-bold text-gray-900">Produk TikTok Shop</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {lastSyncedAt ? (
              <>Terakhir sync <b className="text-gray-600">{fmtDate(lastSyncedAt)}</b></>
            ) : (
              "Belum pernah sync"
            )}
          </span>
          <button
            onClick={syncAll}
            disabled={syncingAll}
            className="flex items-center gap-2 rounded-md bg-[#2a3a8c] px-4 py-2 text-sm font-medium text-white hover:bg-blue-900 disabled:opacity-60"
          >
            {syncingAll ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {syncingAll ? "Menyinkronkan..." : "Sync Semua"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        {(Object.keys(counts) as TabKey[]).map((key) => {
          const label = {
            all: "Semua Produk",
            active: "Aktif",
            out: "Habis",
            archived: "Diarsipkan",
            attention: "Perlu Tindakan",
            pending: "Pending",
            draft: "Draf",
            failed: "Gagal Publish",
          }[key];
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => switchTab(key)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 border transition-colors ${
                active
                  ? "bg-[#2a3a8c] text-white border-transparent"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {label}
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
                }`}
              >
                {counts[key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Produk belum ter-mapping (discovery, bukan auto-import) */}
      {unmappedChecked && unmappedTotal > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-bold text-amber-800">
              {unmappedTotal} produk di TikTok Shop belum ter-mapping ke stok pusat
            </p>
            <button
              onClick={loadUnmapped}
              disabled={unmappedLoading}
              className="text-xs font-semibold text-amber-700 underline hover:text-amber-900 disabled:opacity-50"
            >
              {unmappedLoading ? "Memeriksa..." : "Periksa ulang"}
            </button>
          </div>
          <div className="divide-y divide-amber-100">
            {unmapped.filter((a) => a.unmapped.length > 0).map((a) => (
              <div key={a.accountId}>
                <button
                  onClick={() => toggleUnmappedAccount(a.accountId)}
                  className="w-full px-5 py-2.5 flex items-center justify-between text-sm hover:bg-amber-100/50"
                >
                  <span className="font-semibold text-gray-800">
                    {a.label}
                    <span className="ml-2 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                      {a.unmapped.length}
                    </span>
                  </span>
                  {unmappedOpen.has(a.accountId) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {unmappedOpen.has(a.accountId) && (
                  <div className="px-5 pb-3 flex flex-col gap-2">
                    {a.unmapped.map((p) => (
                      <div key={p.platformProductId} className="bg-white border border-amber-200 rounded-lg p-3">
                        <div className="flex gap-3">
                          {p.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.imageUrl} alt={p.title ?? p.platformProductId} className="w-12 h-12 rounded object-cover bg-gray-100 shrink-0" />
                          ) : (
                            <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-gray-300 shrink-0">
                              <PackageOpen size={18} />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-gray-900 leading-tight" title={p.title ?? undefined}>
                              {p.title ?? p.platformProductId}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              ID {p.platformProductId}
                              {p.status ? ` · ${STATUS_LABEL[p.status] ?? p.status}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-col gap-1">
                          {p.skus.map((s) => {
                            const channelSku = s.sellerSku ?? s.skuId;
                            return (
                              <div key={s.skuId || channelSku} className="flex items-center justify-between gap-2 text-xs bg-gray-50 rounded-md px-2 py-1.5 flex-wrap">
                                <span className="text-gray-600">
                                  <span className="font-mono font-semibold">{channelSku}</span>
                                  <span className="text-gray-400"> · stok {fmtNumber(s.stock)} · {fmtPrice(s.price)}</span>
                                </span>
                                <button
                                  onClick={() => setMapTarget({ accountId: a.accountId, accountLabel: a.label, product: p, sku: s })}
                                  className="shrink-0 text-xs font-semibold bg-[#2a3a8c] text-white px-3 py-1 rounded-md hover:bg-blue-900"
                                >
                                  Mapping
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        {/* Toolbar */}
        <div className="p-4 border-b border-gray-200 flex items-center gap-3 flex-wrap">
          <div className="relative w-80">
            <input
              ref={searchRef}
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari nama produk, SKU, atau SKU channel"
              className="border border-gray-300 rounded-md pl-3 pr-10 py-2 text-sm outline-none w-full h-[38px] font-medium"
            />
            <Search size={16} className="text-gray-400 absolute right-3 top-2.5" />
          </div>

          <div className="relative">
            <ChevronDown
              size={14}
              className="text-gray-400 absolute left-3 top-2.5 pointer-events-none"
            />
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
              className="border border-gray-300 rounded-md pl-8 pr-3 py-2 text-sm outline-none h-[38px] bg-white cursor-pointer font-medium"
            >
              <option value="name_asc">Urutkan: Nama A–Z</option>
              <option value="name_desc">Urutkan: Nama Z–A</option>
              <option value="price_asc">Harga terendah</option>
              <option value="price_desc">Harga tertinggi</option>
              <option value="stock_asc">Stok terendah</option>
              <option value="stock_desc">Stok tertinggi</option>
              <option value="updated_desc">Terakhir di-sync</option>
            </select>
          </div>

          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen((v) => !v)}
              className={`flex items-center gap-2 border rounded-md px-4 py-2 text-sm font-medium h-[38px] ${
                filterOpen || filterActive
                  ? "border-indigo-500 bg-indigo-50/70 text-indigo-700"
                  : "border-gray-300 text-gray-500 bg-white hover:bg-gray-50"
              }`}
            >
              <Filter size={14} />
              <span>Toko/Akun</span>
              {filterActive && (
                <span className="px-1.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
                  {accountFilter.length}
                </span>
              )}
              <ChevronDown size={14} />
            </button>
            {filterOpen && (
              <div className="absolute left-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-30 p-4">
                <p className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">
                  Akun TikTok Shop
                </p>
                <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
                  {accounts.length === 0 && (
                    <p className="text-xs text-gray-400">Tidak ada akun TIKTOK_SHOP terdaftar.</p>
                  )}
                  {accounts.map((a) => (
                    <label
                      key={a.id}
                      className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 rounded px-1 py-1"
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4"
                        checked={accountFilter.includes(a.id)}
                        onChange={() =>
                          setAccountFilter((prev) =>
                            prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id]
                          )
                        }
                      />
                      <span className="truncate">{a.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button
                    onClick={() => setAccountFilter([])}
                    className="text-xs font-medium text-gray-500 hover:text-gray-800 underline"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => setFilterOpen(false)}
                    className="text-xs font-semibold bg-[#2a3a8c] text-white px-3 py-1.5 rounded-md"
                  >
                    Terapkan
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={loadUnmapped}
            disabled={unmappedLoading}
            title="Periksa produk TikTok yang belum ter-mapping ke stok pusat (tanpa mengubah data)"
            className="flex items-center gap-2 border rounded-md px-4 py-2 text-sm font-medium h-[38px] border-gray-300 text-gray-500 bg-white hover:bg-gray-50 disabled:opacity-60"
          >
            {unmappedLoading ? <Loader2 size={14} className="animate-spin" /> : <PackageOpen size={14} />}
            <span>Belum ter-mapping</span>
            {unmappedChecked && unmappedTotal > 0 && (
              <span className="px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {unmappedTotal}
              </span>
            )}
          </button>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 ml-auto bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-2 rounded-md">
              {selected.size} listing dipilih
              <button onClick={() => setSelected(new Set())} className="underline">Batal</button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#f8f9fa] border-b border-gray-200 text-gray-600 font-semibold">
              <tr>
                <th className="px-5 py-3 w-10">
                  <input type="checkbox" className="w-4 h-4 rounded border-gray-300" checked={allPageSelected} onChange={toggleAll} />
                </th>
                <th className="px-5 py-3">Informasi Produk</th>
                <th className="px-5 py-3">Publish Platform</th>
                <th className="px-5 py-3">SKU</th>
                <th className="px-5 py-3">Harga</th>
                <th className="px-5 py-3">Stok</th>
                <th className="px-5 py-3">Master Terkait</th>
                <th className="px-5 py-3">Aktif</th>
                <th className="px-5 py-3 text-right">Atur</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-gray-500">Memuat data...</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-red-600">{error}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-gray-400">
                    <PackageOpen size={28} className="mx-auto mb-2" />
                    Tidak ada listing yang cocok. Klik <b>&quot;Sync Semua&quot;</b> untuk menarik data dari TikTok Shop.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const rowActive = isActiveStatus(row.status);
                  const effectiveActive =
                    toggleOverrides.get(String(row.variants[0].mappingId)) ?? rowActive;
                  const busy = toggling.has(String(row.variants[0].mappingId));
                  const deleted = isDeletedStatus(row.status);
                  const name = row.platformTitle ?? row.master?.name ?? row.channelSku ?? "-";
                  const isExpanded = expanded.has(row.key);
                  const single = row.variantCount === 1;

                  return (
                    <FragmentRow
                      key={row.key}
                      row={row}
                      name={name}
                      deleted={deleted}
                      isExpanded={isExpanded}
                      busy={busy}
                      effectiveActive={effectiveActive}
                      onToggle={() => toggleActive(row, !effectiveActive)}
                      onExpand={() => toggleExpand(row.key)}
                      onSyncRow={() => syncRow(row)}
                      syncing={syncingRows.has(String(row.variants[0].mappingId))}
                      onSelect={() => toggleRow(row.key)}
                      selected={selected.has(row.key)}
                      single={single}
                      menuOpen={openMenu === row.key}
                      onMenuToggle={() => setOpenMenu((k) => (k === row.key ? null : row.key))}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {total.toLocaleString("id-ID")} listing · halaman {page} dari {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} /> Sebelumnya
            </button>
            {pageNumbers.map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`w-9 h-9 text-sm rounded-md ${
                  n === page
                    ? "bg-[#2a3a8c] text-white font-semibold"
                    : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Selanjutnya <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Modal mapping manual ------------------------------ */

type MasterOption = {
  id: string;
  name: string;
  variants: Array<{ id: string; sku: string; stock: number }>;
};

function MapUnmappedModal({
  target,
  onClose,
  onMapped,
}: {
  target: { accountId: string; accountLabel: string; product: UnmappedProduct; sku: UnmappedSku };
  onClose: () => void;
  onMapped: (accountId: string, platformProductId: string, channelSku: string, detail: string) => void;
}) {
  const channelSku = target.sku.sellerSku ?? target.sku.skuId;
  const [masters, setMasters] = useState<MasterOption[]>([]);
  const [loadingMasters, setLoadingMasters] = useState(true);
  const [mode, setMode] = useState<"existing" | "new-master" | "new-variant">("existing");
  const [variantId, setVariantId] = useState("");
  const [masterId, setMasterId] = useState("");
  const [name, setName] = useState(target.product.title ?? "");
  const [sku, setSku] = useState(target.sku.sellerSku ?? target.sku.skuId);
  const [stock, setStock] = useState(String(target.sku.stock));
  const [price, setPrice] = useState(target.sku.price !== null ? String(target.sku.price) : "");
  const [imageUrl, setImageUrl] = useState(target.product.imageUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const token = localStorage.getItem("token");
        const res = await authFetch("/api/products", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? "Gagal memuat produk master.");
        if (!cancelled) setMasters((data.products as MasterOption[]) ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Gagal memuat produk master.");
      } finally {
        if (!cancelled) setLoadingMasters(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      // channelSku kosong (seller_sku & sku.id TikTok dua-duanya kosong) tidak
      // bisa di-mapping — gagalkan cepat dengan pesan jelas, bukan 400 generik.
      if (!channelSku.trim()) {
        throw new Error("SKU TikTok ini tidak memiliki ID/Seller SKU sehingga tidak bisa di-mapping.");
      }
      const token = localStorage.getItem("token");
      const body: Record<string, unknown> = { accountId: target.accountId, channelSku };
      if (mode === "existing") {
        if (!variantId) throw new Error("Pilih varian tujuan dulu.");
        body.variantId = variantId;
      } else {
        if (!sku.trim()) throw new Error("SKU lokal wajib diisi.");
        body.sku = sku.trim();
        const stockNum = Number(stock);
        if (!Number.isInteger(stockNum) || stockNum < 0) throw new Error("Stok harus bilangan bulat >= 0.");
        body.stock = stockNum;
        if (price.trim() !== "") {
          const priceNum = Number(price);
          if (!Number.isFinite(priceNum) || priceNum < 0) throw new Error("Harga tidak valid.");
          body.price = priceNum;
        }
        if (mode === "new-master") {
          if (!name.trim()) throw new Error("Nama produk master wajib diisi.");
          body.newProductName = name.trim();
          if (imageUrl.trim()) body.imageUrl = imageUrl.trim();
        } else {
          if (!masterId) throw new Error("Pilih produk master dulu.");
          body.masterProductId = masterId;
        }
      }
      const res = await authFetch("/api/inventory/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Gagal menyimpan mapping.");
      onMapped(target.accountId, target.product.platformProductId, channelSku, `"${channelSku}" → ${sku.trim() || variantId}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan mapping.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-gray-900">Mapping produk TikTok</h2>
        <p className="text-xs text-gray-500 mt-1">
          {target.product.title ?? target.product.platformProductId} · {target.accountLabel}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          Channel SKU: <span className="font-mono font-semibold text-gray-700">{channelSku}</span>
          <span className="text-gray-400"> · stok TikTok {fmtNumber(target.sku.stock)} · {fmtPrice(target.sku.price)}</span>
        </p>

        <div className="mt-3 flex gap-2 text-xs font-semibold">
          {(
            [
              ["existing", "Varian sudah ada"],
              ["new-variant", "Varian baru"],
              ["new-master", "Produk baru"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`px-3 py-1.5 rounded-md border ${
                mode === key
                  ? "bg-[#2a3a8c] text-white border-transparent"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          {mode === "existing" ? (
            <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
              Varian tujuan
              <select
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                disabled={loadingMasters}
                className="border border-gray-300 rounded-md px-2 py-2 text-sm font-normal outline-none bg-white"
              >
                <option value="">{loadingMasters ? "Memuat..." : "— Pilih varian —"}</option>
                {masters.map((m) => (
                  <optgroup key={m.id} label={m.name}>
                    {m.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.sku} (fisik {v.stock})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : (
            <>
              {mode === "new-variant" ? (
                <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
                  Produk master yang sudah ada
                  <select
                    value={masterId}
                    onChange={(e) => setMasterId(e.target.value)}
                    disabled={loadingMasters}
                    className="border border-gray-300 rounded-md px-2 py-2 text-sm font-normal outline-none bg-white"
                  >
                    <option value="">{loadingMasters ? "Memuat..." : "— Pilih produk master —"}</option>
                    {masters.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
                    Nama produk master baru
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="border border-gray-300 rounded-md px-2 py-2 text-sm font-normal outline-none"
                    />
                  </label>
                  <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
                    URL gambar (opsional, dari TikTok)
                    <input
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="https://..."
                      className="border border-gray-300 rounded-md px-2 py-2 text-sm font-normal outline-none"
                    />
                  </label>
                </>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
                  SKU lokal
                  <input
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="border border-gray-300 rounded-md px-2 py-2 text-sm font-mono font-normal outline-none"
                  />
                </label>
                <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
                  Stok fisik awal
                  <input
                    type="number"
                    min={0}
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className="border border-gray-300 rounded-md px-2 py-2 text-sm font-normal outline-none"
                  />
                </label>
              </div>
              <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
                Harga default / tayang (Rp, opsional)
                <input
                  type="number"
                  min={0}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={target.sku.price !== null ? String(target.sku.price) : "Ikut harga TikTok tampilan saja"}
                  className="border border-gray-300 rounded-md px-2 py-2 text-sm font-normal outline-none"
                />
              </label>
            </>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Batal
          </button>
          <button
            onClick={submit}
            disabled={saving || loadingMasters}
            className="px-4 py-2 text-sm font-semibold bg-[#2a3a8c] text-white rounded-md hover:bg-blue-900 disabled:opacity-60 flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Menyimpan..." : "Simpan mapping"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Row (with expand) ------------------------------ */

function FragmentRow({
  row,
  name,
  deleted,
  isExpanded,
  busy,
  effectiveActive,
  onToggle,
  onExpand,
  onSyncRow,
  syncing,
  onSelect,
  selected,
  single,
  menuOpen,
  onMenuToggle,
}: {
  row: ListingRow;
  name: string;
  deleted: boolean;
  isExpanded: boolean;
  busy: boolean;
  effectiveActive: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onSyncRow: () => void;
  syncing: boolean;
  onSelect: () => void;
  selected: boolean;
  single: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
}) {
  const statusText = STATUS_LABEL[row.status ?? ""] ?? "Belum di-sync";
  const lastSync = row.lastSyncedAt ? fmtDate(row.lastSyncedAt) : "belum sync";
  const stockTitle =
    row.variants[0].platformStock !== null
      ? "Stok tayang TikTok (hasil sync terakhir)."
      : "Stok lokal varian (belum ada stok tayang dari platform).";

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50/50 align-top">
        <td className="px-5 py-4 pt-5">
          <input type="checkbox" className="w-4 h-4 rounded border-gray-300" checked={selected} onChange={onSelect} />
        </td>

        <td className="px-5 py-4">
          <div className="flex gap-3">
            {row.master?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.master.imageUrl} alt={name} className="w-12 h-12 rounded object-cover bg-gray-100 shrink-0" />
            ) : (
              <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-gray-300 shrink-0">
                <PackageOpen size={18} />
              </div>
            )}
            <div className="max-w-[240px]">
              <div className="text-gray-900 font-bold leading-tight flex items-start gap-1.5">
                <span className="min-w-0 truncate" title={name}>{name}</span>
                {deleted && (
                  <span className="shrink-0 inline-flex items-center gap-1 bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    Del
                  </span>
                )}
              </div>
              <button
                onClick={onExpand}
                className="text-xs text-indigo-600 hover:underline mt-1 inline-flex items-center gap-1"
              >
                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                Lihat {row.variantCount} varian produk
              </button>
              {row.accountLabel && (
                <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold bg-black text-white px-2 py-0.5 rounded-full">
                  TikTok Shop
                </span>
              )}
            </div>
          </div>
        </td>

        <td className="px-5 py-4">
          <div className="flex flex-col gap-1">
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full w-fit bg-emerald-100 text-emerald-800`}
              title={row.platformProductId ?? row.channelSku ?? undefined}
            >
              <Radio size={11} /> TikTok Shop {effectiveActive ? "●" : ""}
            </span>
            <span className="text-[10px] text-gray-400 max-w-[120px] truncate">
              {row.platformProductId ?? row.channelSku}
            </span>
          </div>
        </td>

        <td className="px-5 py-4 text-gray-700 font-semibold">
          {single ? row.channelSku ?? "-" : "-"}
          {!single && <span className="block text-[10px] text-gray-400 font-normal">{row.variantCount} varian</span>}
        </td>

        <td className="px-5 py-4 text-gray-700 font-semibold whitespace-nowrap">
          {row.priceMin !== null && row.priceMin !== row.priceMax
            ? `${fmtPrice(row.priceMin)} – ${fmtPrice(row.priceMax)}`
            : fmtPrice(row.priceMin)}
        </td>

        <td className="px-5 py-4 text-gray-700 font-semibold whitespace-nowrap">
          <span className="cursor-help" title={stockTitle}>
            {fmtNumber(row.stockTotal)}
          </span>
          <span className="block text-[10px] text-gray-400 font-normal">{row.accountLabel}</span>
        </td>

        <td className="px-5 py-4">
          {row.master ? (
            <Link
              href={`/products?highlight=${encodeURIComponent(row.master.id ?? "")}`}
              className="text-xs font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1"
            >
              {row.master.name ?? "-"} <ExternalLink size={11} />
            </Link>
          ) : (
            <span className="text-xs text-gray-300">-</span>
          )}
        </td>

        <td className="px-5 py-4">
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              disabled={busy || !row.platformProductId || deleted}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                effectiveActive ? "bg-emerald-500" : "bg-gray-300"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              role="switch"
              aria-checked={effectiveActive}
              title={
                !row.platformProductId
                  ? "Belum di-sync — refresh status baris dulu."
                  : effectiveActive
                    ? "Aktif di TikTok Shop"
                    : "Nonaktif di TikTok Shop"
              }
            >
              {busy ? (
                <Loader2 size={11} className="text-white mx-auto animate-spin" />
              ) : (
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    effectiveActive ? "translate-x-[18px]" : "translate-x-0.5"
                  }`}
                />
              )}
            </button>
            <span className="text-[10px] text-gray-400 max-w-[90px] leading-tight">
              {busy ? "proses..." : statusText}
            </span>
          </div>
        </td>

        <td className="px-5 py-4 text-right">
          <div className="inline-flex items-center gap-1">
            <button
              onClick={onSyncRow}
              disabled={syncing}
              title="Sync ulang status dari TikTok Shop"
              className="p-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
            <button
              onClick={onExpand}
              className="p-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
              title="Detail varian"
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMenuToggle();
                }}
                className={`p-1.5 rounded-md border text-gray-600 hover:bg-gray-50 ${menuOpen ? "border-indigo-300 bg-indigo-50" : "border-gray-300"}`}
                title="Atur"
              >
                <MoreVertical size={14} />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-9 z-20 w-44 bg-white border border-gray-200 rounded-md shadow-lg py-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link
                    href={`/products/marketplace/tiktok/${encodeURIComponent(row.variants[0]?.mappingId ?? "")}/edit`}
                    className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50"
                  >
                    Ubah
                    <span className="block text-[10px] text-gray-400">Edit & publish ke TikTok Shop</span>
                  </Link>
                  <button
                    onClick={onSyncRow}
                    className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50"
                  >
                    Sync ulang status
                  </button>
                  <button
                    onClick={onExpand}
                    className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50"
                  >
                    Detail varian
                  </button>
                </div>
              )}
            </div>
          </div>
          <span className="block text-[10px] text-gray-300 mt-1">{lastSync}</span>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-gray-50/70 border-b border-gray-100">
          <td colSpan={9} className="px-5 py-4">
            <div className="mb-2 text-xs font-bold text-gray-500 uppercase tracking-wide">
              Varian — {row.accountLabel}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-gray-200">
                  <th className="py-2 pr-4">SKU Lokal</th>
                  <th className="py-2 pr-4">SKU Channel</th>
                  <th className="py-2 pr-4">Harga</th>
                  <th className="py-2 pr-4">Stok</th>
                  <th className="py-2 pr-4">Status Platform</th>
                  <th className="py-2">Sync Terakhir</th>
                </tr>
              </thead>
              <tbody>
                {row.variants.map((v) => (
                  <tr key={v.mappingId} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-4 text-gray-700 font-semibold">{v.sku}</td>
                    <td className="py-2 pr-4 text-gray-500">{v.channelSku}</td>
                    <td className="py-2 pr-4 text-gray-700 font-semibold">{fmtPrice(v.price)}</td>
                    <td className="py-2 pr-4 text-gray-700">{fmtNumber(v.stock)}</td>
                    <td className="py-2 pr-4">
                      <span className="text-[10px] font-bold text-gray-600">
                        {STATUS_LABEL[v.status ?? ""] ?? "Belum di-sync"}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-gray-400">{fmtDate(v.lastSyncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}