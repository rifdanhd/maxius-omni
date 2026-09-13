"use client";

import { useEffect, useState } from "react";
import { History, Pencil, RefreshCw, Search, X } from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";
import type { StockRow, StockTab } from "@/app/api/inventory/stock/route";
import type { OversellEntry } from "@/app/api/inventory/oversells/route";

type TabId = StockTab | "oversells";

type Counts = { all: number; empty: number; low: number; oversells: number };

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "Semua Produk" },
  { id: "empty", label: "Habis" },
  { id: "low", label: "Stok Menipis" },
  { id: "oversells", label: "Oversells" },
];

const fmt = (n: number) => n.toLocaleString("id-ID");
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "medium" });

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

  const [editing, setEditing] = useState<{
    variantId: string;
    field: "safetyStock" | "minStock";
    value: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [handlingId, setHandlingId] = useState<string | null>(null);

  const [safetyHist, setSafetyHist] = useState<{ variantId: string; sku: string } | null>(null);
  const [safetyEntries, setSafetyEntries] = useState<
    Array<{ id: string; note: string | null; stockAfter: number; createdAt: string; user: { username: string } | null }>
  >([]);
  const [safetyLoading, setSafetyLoading] = useState(false);

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
          const data = await api<{
            rows: StockRow[];
            nextCursor: string | null;
            counts: Counts;
          }>(`/api/inventory/stock?${p.toString()}`);
          if (cancelled) return;
          setRows(data.rows);
          setNextCursor(data.nextCursor);
          setCounts(data.counts);
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
  }, [tab, q, reloadKey]);

  // Paginasi = event handler (boleh setState langsung).
  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const p = new URLSearchParams({ tab, limit: "50", cursor: nextCursor });
      if (q) p.set("q", q);
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

  async function handleSaveEdit() {
    if (!editing) return;
    const parsed =
      editing.field === "minStock" && editing.value.trim() === ""
        ? null
        : Number(editing.value);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) {
      setError("Nilai harus bilangan bulat >= 0 (kosongkan Batas Min utk ikut produk induk).");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEmail(row: StockRow) {
    setError(null);
    try {
      await api(`/api/inventory/variant/${row.variantId}`, {
        method: "PATCH",
        body: JSON.stringify({ notifyEmail: !row.notifyEmail }),
      });
      setRows((prev) =>
        prev.map((r) =>
          r.variantId === row.variantId ? { ...r, notifyEmail: !row.notifyEmail } : r
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan toggle.");
    }
  }

  async function openSafetyHistory(row: StockRow) {
    setSafetyHist({ variantId: row.variantId, sku: row.sku });
    setSafetyEntries([]);
    setSafetyLoading(true);
    try {
      const data = await api<{
        entries: Array<{ id: string; note: string | null; stockAfter: number; createdAt: string; user: { username: string } | null }>;
      }>(`/api/inventory/ledger?variantId=${row.variantId}&reason=SAFETY_STOCK_CHANGE&limit=50`);
      setSafetyEntries(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat riwayat cadangan.");
      setSafetyHist(null);
    } finally {
      setSafetyLoading(false);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menandai.");
    } finally {
      setHandlingId(null);
    }
  }

  const badge = (id: TabId) =>
    id === "all" ? counts.all : id === "empty" ? counts.empty : id === "low" ? counts.low : counts.oversells;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Stok Varian</h1>
          <p className="text-sm text-gray-500 mt-1">
            Stok gudang bersama per varian — angka Tersedia memakai effectiveStock() yang sama
            dengan marketplace.
          </p>
          <p className="text-xs text-gray-500 mt-1" title="effectiveStock() = max(0, Fisik − Cadangan)">
            Stok yang tayang di marketplace = Stok fisik − Stok cadangan (buffer). Kalau cadangan
            lebih besar dari stok fisik, stok tayang jadi 0.
          </p>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="flex items-center gap-2 border border-gray-200 bg-white px-3 py-1.5 rounded-md text-sm text-gray-600 font-medium hover:bg-gray-50"
        >
          <RefreshCw size={14} /> Muat Ulang
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              tab === t.id
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {t.label}
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                tab === t.id ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
              }`}
            >
              {fmt(badge(t.id))}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm px-4 py-3 rounded-xl border border-red-100">
          {error}
        </div>
      )}

      {tab !== "oversells" ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="relative max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setQ(qInput.trim());
                }}
                placeholder="Cari SKU / nama varian / produk… (Enter)"
                className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
          </div>

          {loading ? (
            <p className="p-8 text-center text-sm text-gray-500">Memuat…</p>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500">Tidak ada varian di tab ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3 font-semibold">Produk / Varian</th>
                    <th className="px-4 py-3 font-semibold text-right" title="ProductVariant.stock — stok mentah di database">Fisik</th>
                    <th className="px-4 py-3 font-semibold text-right" title="safetyStock — buffer yang tidak dijual. Stok tayang di marketplace = Fisik − Cadangan (min. 0). Klik ikon riwayat untuk melihat siapa mengubahnya.">Cadangan</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Info saja: jumlah activity promosi AKTIF yang mencakup varian. Tidak mengurangi Tersedia (tidak ada konsep reserve di skema).">Promosi</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Qty order aktif yang BELUM memotong stok (belum AWAITING_SHIPMENT) — demand yang akan datang">Pesanan</th>
                    <th className="px-4 py-3 font-semibold text-right" title="effectiveStock() = max(0, Fisik − Cadangan) — fungsi yang sama dengan marketplace">Tersedia</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Belum ada konsep restock terjadwal di skema — selalu 0 di iterasi ini">Akan Datang</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Batas minimum per varian. Kosong = ikut threshold produk induk">Batas Min</th>
                    <th className="px-4 py-3 font-semibold text-center" title="Toggle saja — belum ada provider email, belum ada pengiriman aktif">Email Notif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr key={r.variantId} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800 leading-tight">{r.productName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {r.variantName ?? r.sku} · <span className="font-mono">{r.sku}</span>
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{fmt(r.stock)}</td>
                      <td className="px-4 py-3 text-right">
                        {editing?.variantId === r.variantId && editing.field === "safetyStock" ? (
                          <span className="inline-flex flex-col items-end gap-1">
                            <span className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                value={editing.value}
                                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveEdit();
                                  if (e.key === "Escape") setEditing(null);
                                }}
                                disabled={saving}
                                autoFocus
                                className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right outline-none focus:ring-2 focus:ring-gray-900"
                              />
                              <button
                                onClick={handleSaveEdit}
                                disabled={saving}
                                className="text-xs font-bold text-emerald-600 hover:underline disabled:opacity-50"
                              >
                                Simpan
                              </button>
                            </span>
                            {Number(editing.value) > r.stock && (
                              <span className="text-[11px] font-medium text-amber-600">
                                Cadangan melebihi stok fisik ({fmt(r.stock)}) — stok tayang akan jadi 0.
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {fmt(r.safetyStock)}
                            <button
                              title="Ubah cadangan"
                              onClick={() =>
                                setEditing({ variantId: r.variantId, field: "safetyStock", value: String(r.safetyStock) })
                              }
                              className="text-gray-400 hover:text-gray-700"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              title="Riwayat perubahan cadangan"
                              onClick={() => openSafetyHistory(r)}
                              className="text-gray-400 hover:text-gray-700"
                            >
                              <History size={13} />
                            </button>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.promoActive > 0 ? (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                            {r.promoActive} aktif
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{fmt(r.orderedQty)}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-600">{fmt(r.available)}</td>
                      <td className="px-4 py-3 text-right text-gray-400">0</td>
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
                              className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right outline-none focus:ring-2 focus:ring-gray-900"
                            />
                            <button
                              onClick={handleSaveEdit}
                              disabled={saving}
                              className="text-xs font-bold text-emerald-600 hover:underline disabled:opacity-50"
                            >
                              Simpan
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {r.minStock === null ? (
                              <span className="text-gray-500" title="Mengikuti threshold produk induk">
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
                              className="text-gray-400 hover:text-gray-700"
                            >
                              <Pencil size={13} />
                            </button>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          role="switch"
                          aria-checked={r.notifyEmail}
                          title={r.notifyEmail ? "Nonaktifkan notifikasi" : "Aktifkan notifikasi (toggle saja — belum ada pengiriman email)"}
                          onClick={() => handleToggleEmail(r)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            r.notifyEmail ? "bg-emerald-500" : "bg-gray-200"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                              r.notifyEmail ? "translate-x-4" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {nextCursor && !loading && (
            <div className="p-4 border-t border-gray-100 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="text-sm font-semibold text-gray-700 border border-gray-200 rounded-lg px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
              >
                {loadingMore ? "Memuat…" : "Muat Lebih Banyak"}
              </button>
            </div>
          )}
          <p className="px-4 pb-3 text-[11px] text-gray-400">
            * Mengikuti threshold produk induk. Badge tab = total global (tanpa filter pencarian),
            dihitung fresh tiap buka tab.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <p className="p-8 text-center text-sm text-gray-500">Memuat…</p>
          ) : entries.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500">
              Tidak ada kejadian oversell tercatat (SyncLog kind central_stock_deduct kosong).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3 font-semibold">Produk / Varian (SKU)</th>
                    <th className="px-4 py-3 font-semibold">Toko</th>
                    <th className="px-4 py-3 font-semibold">Waktu</th>
                    <th className="px-4 py-3 font-semibold text-right">Gagal deduct</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        {e.skus.length === 0 ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <ul className="list-disc list-inside text-gray-800">
                            {e.skus.map((s) => (
                              <li key={s} className="font-mono text-xs">{s}</li>
                            ))}
                          </ul>
                        )}
                        {e.message && (
                          <p className="text-xs text-gray-500 mt-1 max-w-md truncate" title={e.message}>
                            {e.message}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-800">{e.accountLabel}</span>
                        <span className="block text-xs text-gray-500">{e.platform}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(e.occurredAt)}</td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">{fmt(e.failedQty)}</td>
                      <td className="px-4 py-3">
                        {e.handledAt ? (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            Sudah ditangani
                          </span>
                        ) : (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                            Belum ditangani
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!e.handledAt && (
                          <button
                            onClick={() => handleMarkHandled(e.id)}
                            disabled={handlingId === e.id}
                            className="text-xs font-semibold border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
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

      {safetyHist && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSafetyHist(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">Riwayat cadangan</h2>
                <p className="text-xs text-gray-500 mt-0.5 font-mono">{safetyHist.sku}</p>
              </div>
              <button
                onClick={() => setSafetyHist(null)}
                className="text-gray-400 hover:text-gray-700"
                title="Tutup"
              >
                <X size={16} />
              </button>
            </div>
            {safetyLoading ? (
              <p className="py-6 text-center text-sm text-gray-500">Memuat…</p>
            ) : safetyEntries.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">
                Belum ada perubahan cadangan tercatat untuk varian ini.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {safetyEntries.map((e) => {
                  const parsed = parseSafetyNote(e.note);
                  return (
                    <li key={e.id} className="border border-gray-100 rounded-lg px-3 py-2 text-sm">
                      <p className="font-semibold text-gray-800">
                        {parsed ? (
                          <>Cadangan {parsed.from} → {parsed.to}</>
                        ) : (
                          e.note ?? "Perubahan cadangan"
                        )}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {e.user?.username ?? "sistem"} · {fmtDate(e.createdAt)} · stok fisik {fmt(e.stockAfter)}
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
