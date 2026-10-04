"use client";

import { useEffect, useState } from "react";
import { History, PackageOpen, Pencil, RefreshCw, Search, X } from "lucide-react";
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
    field: "safetyStock" | "minStock" | "stock";
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
    <div className="p-4 md:p-8">
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

      {error && (
        <div className="mb-4 bg-muted text-foreground text-sm px-4 py-3 rounded-xl border border-border">
          {error}
        </div>
      )}

      {tab !== "oversells" ? (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border">
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
          </div>

          {loading ? (
            <p className="p-4 md:p-8 text-center text-sm text-muted-foreground">Memuat…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 md:p-8 text-center text-sm text-muted-foreground">{q.trim() || tab !== "all" ? <><span>Tidak ada variasi yang cocok dengan pencarian atau tab.</span><button className="block mx-auto mt-2 underline" onClick={() => { setQ(""); setTab("all"); }}>Hapus Pencarian dan Filter</button></> : <>Belum ada variasi stok pusat. <a href="/products" className="underline">Tambahkan produk di Produk Master</a>, lalu hubungkan produk toko melalui Mapping.</>}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Produk / Varian</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Stok fisik yang dicatat di gudang. Klik pensil untuk mengoreksi jumlah total; pembaruan toko mengikuti pengaturan inventori.">Fisik</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Stok yang disisihkan dan tidak ditawarkan ke toko. Klik riwayat untuk memeriksa perubahan.">Cadangan</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Info saja: jumlah activity promosi AKTIF yang mencakup varian. Tidak mengurangi Tersedia (tidak ada konsep reserve di skema).">Promosi</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Qty order aktif yang BELUM memotong stok (belum AWAITING_SHIPMENT) — demand yang akan datang">Pesanan</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Target stok jual: fisik dikurangi cadangan, minimal 0.">Tersedia</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Belum ada konsep restock terjadwal di skema — selalu 0 di iterasi ini">Stok Masuk Terjadwal (Belum Tersedia)</th>
                    <th className="px-4 py-3 font-semibold text-right" title="Batas minimum per varian. Kosong = ikut threshold produk induk">Batas Min</th>
                    <th className="px-4 py-3 font-semibold text-center" title="Toggle saja — belum ada provider email, belum ada pengiriman aktif">Email (Belum Tersedia)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.variantId} className="hover:bg-muted">
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
                        {editing?.variantId === r.variantId && editing.field === "stock" ? (
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
                            <span className="text-[11px] text-muted-foreground">
                              Tersimpan &amp; di-push ke marketplace
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-end gap-1">
                            {fmt(r.stock)}
                            <button
                              title="Atur stok fisik langsung"
                              onClick={() =>
                                setEditing({ variantId: r.variantId, field: "stock", value: String(r.stock) })
                              }
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Pencil size={13} />
                            </button>
                          </span>
                        )}
                      </td>
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
                            {Number(editing.value) > r.stock && (
                              <span className="text-[11px] font-medium text-foreground">
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
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              title="Riwayat perubahan cadangan"
                              onClick={() => openSafetyHistory(r)}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <History size={13} />
                            </button>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.promoActive > 0 ? (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-foreground">
                            {r.promoActive} aktif
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{fmt(r.orderedQty)}</td>
                      <td className="px-4 py-3 text-right font-bold text-foreground">{fmt(r.available)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">0</td>
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
                      <td className="px-4 py-3 text-center">
                        <button
                          role="switch"
                          disabled
                          aria-checked={r.notifyEmail}
                          title="Pengiriman notifikasi email belum tersedia."
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            r.notifyEmail ? "bg-muted-foreground" : "bg-muted"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 rounded-full bg-card shadow transition-transform ${
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
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-foreground">
                            Sudah ditangani
                          </span>
                        ) : (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-foreground">
                            Belum ditangani
                          </span>
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
                <h2 className="text-base font-bold text-foreground">Riwayat cadangan</h2>
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
                Belum ada perubahan cadangan tercatat untuk varian ini.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {safetyEntries.map((e) => {
                  const parsed = parseSafetyNote(e.note);
                  return (
                    <li key={e.id} className="border border-border rounded-lg px-3 py-2 text-sm">
                      <p className="font-semibold text-foreground">
                        {parsed ? (
                          <>Cadangan {parsed.from} → {parsed.to}</>
                        ) : (
                          e.note ?? "Perubahan cadangan"
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
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
