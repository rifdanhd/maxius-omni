"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertOctagon,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ClipboardCheck,
  Minus,
  Package,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";

/* ------------------------------ Types ------------------------------ */

type HistoryItem = {
  id: string;
  source: "LEDGER" | "SYNCLOG";
  occurredAt: string;
  variantId: string | null;
  productName: string | null;
  sku: string | null;
  event: string;
  eventKind: "ORDER" | "ORDER_CANCEL" | "SALE" | "MANUAL" | "OPNAME" | "OVERSELL" | "OTHER";
  changeQty: number | null;
  stockBefore: number | null;
  stockAfter: number | null;
  referenceNo: string | null;
  accountLabel: string | null;
  username: string | null;
  note: string | null;
};

/* ------------------------------ Constants ------------------------------ */

// Sumber event dibedakan visual (ikon + warna) supaya gampang di-scan.
const KIND_STYLE: Record<
  HistoryItem["eventKind"],
  { icon: typeof Package; cls: string; label: string }
> = {
  ORDER: { icon: Package, cls: "bg-blue-100 text-blue-700", label: "Order" },
  ORDER_CANCEL: { icon: ArrowUpRight, cls: "bg-amber-100 text-amber-700", label: "Batal/Refund" },
  SALE: { icon: Tag, cls: "bg-violet-100 text-violet-700", label: "Penjualan" },
  MANUAL: { icon: ClipboardCheck, cls: "bg-gray-100 text-gray-600", label: "Manual" },
  OPNAME: { icon: ClipboardCheck, cls: "bg-emerald-100 text-emerald-700", label: "Stok Opname" },
  OVERSELL: { icon: AlertOctagon, cls: "bg-red-100 text-red-700", label: "Oversell" },
  OTHER: { icon: Minus, cls: "bg-gray-100 text-gray-500", label: "Lainnya" },
};

const SOURCE_FILTERS = [
  { id: "", label: "Semua" },
  { id: "ledger", label: "Pergerakan Stok" },
  { id: "synclog", label: "Oversell" },
] as const;

const fmt = (n: number) => n.toLocaleString("id-ID");
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" });

// Default filter = 30 hari terakhir (JANGAN "semua data dari awal berdiri").
// Dihitung sekali di module scope — bukan saat render (react-hooks/purity).
const DEFAULT_FROM = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

async function api<T>(path: string): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await authFetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

/* ------------------------------ Page ------------------------------ */

export default function InventoryHistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter: tanggal default = 30 hari terakhir (dari module scope, bukan render).
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  // Naikkan via tombol Muat Ulang (event handler) utk memicu effect.
  const [reloadKey, setReloadKey] = useState(0);

  const buildUrl = useCallback(
    (cursor: string | null) => {
      const p = new URLSearchParams();
      if (cursor) p.set("cursor", cursor);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (q) p.set("q", q);
      if (source) p.set("source", source);
      p.set("limit", "50");
      return `/api/inventory/history?${p.toString()}`;
    },
    [from, to, q, source]
  );

  // Initial load & reload: pola existing (promotions) — async fn di dalam
  // effect + guard cancelled (aturan react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const [first, second] = await Promise.all([
          api<{ items: HistoryItem[]; nextCursor: string | null }>(buildUrl(null)),
          api<{ counts: Record<string, number> }>("/api/inventory/history/counts").catch(
            () => ({ counts: {} })
          ),
        ]);
        if (cancelled) return;
        setItems(first.items);
        setNextCursor(first.nextCursor);
        setCounts(second.counts);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          console.error("[InventoryHistory] load gagal:", e);
          setError(e instanceof Error ? e.message : "Gagal memuat riwayat.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [buildUrl, reloadKey]);

  // Debounce pencarian produk/SKU.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await api<{ items: HistoryItem[]; nextCursor: string | null }>(
        buildUrl(nextCursor)
      );
      setItems((prev) => [...prev, ...next.items]);
      setNextCursor(next.nextCursor);
    } catch (e) {
      console.error("[InventoryHistory] loadMore gagal:", e);
      setError(e instanceof Error ? e.message : "Gagal memuat halaman berikutnya.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Riwayat Inventori</h1>
          <p className="mt-1 text-sm text-gray-500">
            Semua pergerakan stok dalam satu tempat — order, penjualan, penyesuaian, stok opname,
            dan oversell tertangkap.
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

      {/* Filter chips dgn jumlah (agregasi DB-level) */}
      <div className="mb-4 flex flex-wrap gap-2">
        {SOURCE_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setSource(f.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              source === f.id
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          {(Object.keys(KIND_STYLE) as Array<HistoryItem["eventKind"]>).map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className={`rounded px-1.5 py-0.5 ${KIND_STYLE[k].cls}`}>
                {counts[k] ?? 0}
              </span>{" "}
              {KIND_STYLE[k].label}
            </span>
          ))}
        </span>
      </div>

      {/* Filter tanggal + pencarian */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2">
          <CalendarDays className="h-4 w-4 text-gray-400" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="text-sm text-gray-700 focus:outline-none"
          />
          <span className="mx-1 text-gray-400">s/d</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="text-sm text-gray-700 focus:outline-none"
          />
        </div>
        <div className="flex min-w-56 flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Cari produk / SKU…"
            className="w-full text-sm text-gray-700 focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tabel riwayat */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center p-10 text-gray-500">Memuat…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            Tidak ada pergerakan stok pada filter ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Referensi</th>
                  <th className="px-4 py-3">Waktu</th>
                  <th className="px-4 py-3">Produk</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3 text-right">Fisik (sebelum → sesudah)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const style = KIND_STYLE[it.eventKind] ?? KIND_STYLE.OTHER;
                  const Icon = style.icon;
                  return (
                    <tr key={`${it.source}-${it.id}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-md p-1.5 ${style.cls}`} title={style.label}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="font-mono text-xs text-gray-600">
                            {it.referenceNo ?? "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                        {fmtDate(it.occurredAt)}
                      </td>
                      <td className="max-w-52 truncate px-4 py-3 text-gray-900">
                        {it.productName ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {it.sku ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className={`font-medium ${it.eventKind === "OVERSELL" ? "text-red-600" : "text-gray-800"}`}>
                          {it.event}
                        </div>
                        {(it.accountLabel || it.username) && (
                          <div className="text-xs text-gray-500">
                            {[it.accountLabel, it.username].filter(Boolean).join(" · ")}
                          </div>
                        )}
                        {it.note && it.note !== it.event && (
                          <div className="mt-0.5 max-w-72 truncate text-xs text-gray-400" title={it.note}>
                            {it.note}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {it.changeQty === null ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                            title="Stok tidak diubah — order perlu ditinjau manual"
                          >
                            <AlertOctagon className="h-3.5 w-3.5" />
                            Tidak berubah (oversell)
                          </span>
                        ) : it.changeQty === 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium">
                            <span className="text-gray-500">
                              {it.stockBefore !== null ? fmt(it.stockBefore) : "?"}
                            </span>
                            <span className="text-gray-300">→</span>
                            <span className="text-gray-900">{fmt(it.stockAfter ?? 0)}</span>
                            {it.changeQty > 0 ? (
                              <span className="ml-1 inline-flex items-center text-xs font-semibold text-emerald-600">
                                <ArrowUpRight className="h-3.5 w-3.5" />+{fmt(it.changeQty)}
                              </span>
                            ) : (
                              <span className="ml-1 inline-flex items-center text-xs font-semibold text-red-600">
                                <ArrowDownRight className="h-3.5 w-3.5" />
                                {fmt(it.changeQty)}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination cursor — tidak pernah findMany semua data */}
        {nextCursor && !loading && (
          <div className="border-t border-gray-100 p-4 text-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {loadingMore ? "Memuat…" : "Muat Lebih Banyak"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
