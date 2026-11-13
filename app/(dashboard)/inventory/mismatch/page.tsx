"use client";

import { useEffect, useState, useMemo } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Package,
  RefreshCw,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";
import { StatusBadge } from "@/components/ui/status-badge";
import { friendlyError } from "@/lib/ui/feedback";
import { ErrorFeedback, Feedback, TechnicalDetails } from "@/components/ui/feedback";

/* ------------------------------ Types ------------------------------ */

type MismatchRow = {
  id: string;
  channelSku: string;
  newSellable: number;
  status: string;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
  variant: {
    id: string;
    sku: string;
    name: string | null;
    stock: number;
    safetyStock: number;
    centralStock: number;
    productName: string;
  };
  account: { id: string; platform: string; label: string };
  diffVsCentral: number;
  holdReason?: string | null;
};

type FilterId = "mismatch" | "FAILED" | "PENDING" | "SUCCESS" | "all";

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: "mismatch", label: "Perlu Tindakan (Mismatch)" },
  { id: "FAILED", label: "Gagal" },
  { id: "PENDING", label: "Menunggu (Pending)" },
  { id: "SUCCESS", label: "Berhasil" },
  { id: "all", label: "Semua" },
];

const fmt = (n: number) => n.toLocaleString("id-ID");
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";

async function api<T>(path: string): Promise<T> {
  const res = await authFetch(path, { headers: { "Content-Type": "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

// Cooldown anti spam-klik per job (module scope — bukan state render).
const lastRetryAttempt = new Map<string, number>();
function retryCooldownOk(id: string): boolean {
  const now = Date.now();
  const last = lastRetryAttempt.get(id) ?? 0;
  if (now - last < 2000) return false;
  lastRetryAttempt.set(id, now);
  return true;
}

/* ------------------------------ Page ------------------------------ */

export default function SyncMismatchPage() {
  const [filter, setFilter] = useState<FilterId>("mismatch");
  const [rows, setRows] = useState<MismatchRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [selectedForRetry, setSelectedForRetry] = useState<Set<string>>(new Set());
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const p = new URLSearchParams({ status: filter, limit: "50" });
        if (q) p.set("q", q);
        const data = await api<{ rows: MismatchRow[]; nextCursor: string | null }>(
          `/api/sync-jobs?${p.toString()}`
        );
        if (cancelled) return;
        setRows(data.rows);
        setNextCursor(data.nextCursor);
        setError(null);
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
  }, [filter, q, reloadKey]);

  // Statistik ringkas berdasarkan data rows yang ada
  const stats = useMemo(() => {
    const failed = rows.filter((r) => r.status === "FAILED").length;
    const pending = rows.filter((r) => r.status === "PENDING").length;
    const mismatch = rows.filter(
      (r) => r.status === "FAILED" || (r.status === "PENDING" && r.retryCount >= 1)
    ).length;
    return { failed, pending, mismatch, total: rows.length };
  }, [rows]);

  async function retryJob(id: string) {
    if (retrying.has(id) || !retryCooldownOk(id)) return;
    setRetrying((prev) => new Set(prev).add(id));
    setNotice(null);
    try {
      const res = await authFetch(`/api/sync-jobs/${id}/retry`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        job?: { status: string };
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const st = data.job?.status ?? "?";
      setNotice({
        kind: st === "SUCCESS" ? "ok" : "err",
        text:
          st === "SUCCESS"
            ? "Pembaruan diterima marketplace. Periksa data toko jika masih ada perbedaan."
            : `Percobaan selesai, status pembaruan: ${st}.`,
      });
      setReloadKey((k) => k + 1);
    } catch (e) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : "Retry gagal." });
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function retrySelected() {
    const ids = [...selectedForRetry];
    if (ids.length === 0) return;
    setBulkRetrying(true);
    setSelectedForRetry(new Set());
    let success = 0;
    let failed = 0;
    for (const id of ids) {
      if (!retryCooldownOk(id)) continue;
      try {
        const res = await authFetch(`/api/sync-jobs/${id}/retry`, { method: "POST" });
        const data = (await res.json().catch(() => ({}))) as { job?: { status: string } };
        if (res.ok && data.job?.status === "SUCCESS") success += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setBulkRetrying(false);
    setReloadKey((k) => k + 1);
    setNotice({
      kind: failed === 0 ? "ok" : "err",
      text: `Bulk retry selesai: ${success} berhasil, ${failed} gagal.`,
    });
  }

  const retryableRows = rows.filter((r) => !r.holdReason && (r.status === "FAILED" || (r.status === "PENDING" && r.retryCount > 0)));
  const allRetryableSelected = retryableRows.length > 0 && retryableRows.every((r) => selectedForRetry.has(r.id));

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const p = new URLSearchParams({ status: filter, limit: "50", cursor: nextCursor });
      if (q) p.set("q", q);
      const data = await api<{ rows: MismatchRow[]; nextCursor: string | null }>(
        `/api/sync-jobs?${p.toString()}`
      );
      setRows((prev) => [...prev, ...data.rows]);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat halaman berikutnya.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      {/* Header Halaman */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Masalah Pengiriman Stok (Stok Mismatch)
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Pantau pembaruan stok yang gagal dikirim atau sedang menunggu percobaan ulang; mulai dengan membaca pesan gagal dan toko tujuan, lalu pilih Coba Lagi setelah penyebabnya ditangani. Halaman ini tidak membandingkan stok aktual toko dengan stok gudang.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-muted"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span>Muat Ulang</span>
        </button>
      </div>

      {/* Kartu Ringkasan Status */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3.5 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 shadow-xs">
          <div className="rounded-xl bg-rose-500/15 p-2.5 text-rose-600 dark:text-rose-400">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">
              {loading ? "…" : fmt(stats.mismatch)}
            </div>
            <p className="text-xs font-medium text-muted-foreground">Perlu Tindakan di halaman ini</p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 shadow-xs">
          <div className="rounded-xl bg-amber-500/15 p-2.5 text-amber-600 dark:text-amber-400">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">
              {loading ? "…" : fmt(stats.pending)}
            </div>
            <p className="text-xs font-medium text-muted-foreground">Menunggu Percobaan Ulang Otomatis</p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-xl border border-border/80 bg-card p-4 shadow-xs">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">
              {loading ? "…" : fmt(stats.total)}
            </div>
            <p className="text-xs font-medium text-muted-foreground">Total Catatan Sinkron Dimuat</p>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                filter === f.id
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "border border-border bg-card text-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative w-full lg:w-72">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Cari produk / SKU / kode toko…"
            className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-9 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
          />
          {qInput && (
            <button
              type="button"
              onClick={() => setQInput("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Aksi massal retry untuk item yang gagal */}
      {retryableRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allRetryableSelected}
              onChange={() => {
                if (allRetryableSelected) setSelectedForRetry(new Set());
                else setSelectedForRetry(new Set(retryableRows.map((r) => r.id)));
              }}
              className="w-4 h-4 rounded border-border accent-primary"
              aria-label="Pilih semua item yang bisa dicoba lagi"
            />
            <label className="text-xs font-medium text-foreground cursor-pointer">
              Pilih semua yang bisa dicoba lagi ({fmt(retryableRows.length)})
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${selectedForRetry.size > 0 ? "text-foreground" : "text-muted-foreground"}`}>
              {selectedForRetry.size} dipilih
            </span>
            <button
              type="button"
              onClick={retrySelected}
              disabled={bulkRetrying || selectedForRetry.size === 0}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                selectedForRetry.size > 0
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  : "border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
              }`}
            >
              {bulkRetrying ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
              {bulkRetrying ? "Mencoba lagi semua…" : "Coba Lagi Terpilih"}
            </button>
          </div>
        </div>
      )}
      {/* Notifikasi Hasil Retry */}
      {notice && (
        <Feedback
          className="mb-4"
          variant={notice.kind === "ok" ? "success" : "error"}
          title={notice.kind === "ok" ? "Sinkron selesai" : "Sinkron belum berhasil"}
          description={notice.kind === "ok" ? notice.text : friendlyError(notice.text)}
          details={notice.kind === "err" ? notice.text : undefined}
        />
      )}

      {error && <ErrorFeedback error={error} className="mb-4" />}

      {/* Tabel Data Mismatch */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-sm">Memuat data sinkronisasi stok…</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="font-semibold text-foreground">
                Tidak ada pembaruan stok yang tercatat pada pencarian/filter ini.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ini bukan konfirmasi stok aktual semua toko.
              </p>
              <button
                type="button"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                onClick={() => {
                  setQInput("");
                  setQ("");
                  setFilter("mismatch");
                }}
              >
                Hapus Pencarian dan Filter
              </button>
            </div>
          ) : (
            <table className="w-full min-w-[950px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3.5">Produk / Varian</th>
                  <th className="px-4 py-3.5">Kode Toko (Channel SKU)</th>
                  <th className="px-4 py-3.5">Akun / Marketplace</th>
                  <th className="px-4 py-3.5 text-right">Target Stok Jual Pusat</th>
                  <th className="px-4 py-3.5 text-right">Angka yang Dikirim</th>
                  <th className="px-4 py-3.5 text-center">Percobaan Ulang</th>
                  <th className="px-4 py-3.5">Error Terakhir</th>
                  <th className="px-4 py-3.5">Status &amp; Waktu</th>
                  <th className="px-4 py-3.5 text-right">Aksi</th>
                  <th className="px-4 py-3.5 text-center" scope="col">
                    {retryableRows.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allRetryableSelected}
                        onChange={() => {
                          if (allRetryableSelected) setSelectedForRetry(new Set());
                          else setSelectedForRetry(new Set(retryableRows.map((r) => r.id)));
                        }}
                        className="w-4 h-4 rounded border-border accent-primary"
                        aria-label="Pilih semua item yang bisa dicoba lagi"
                      />
                    )}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((r) => {
                  const isRetryingThis = retrying.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      className="transition-colors hover:bg-muted/40"
                    >
                      {/* Produk / Varian */}
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-foreground">{r.variant.productName}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{r.variant.name || r.variant.sku}</span>
                          <span>·</span>
                          <span className="font-mono font-medium">SKU {r.variant.sku}</span>
                        </div>
                      </td>

                      {/* Channel SKU */}
                      <td className="px-4 py-3.5 font-mono text-xs text-foreground">
                        <span className="rounded bg-muted/70 px-2 py-1">{r.channelSku}</span>
                      </td>

                      {/* Akun Marketplace */}
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-foreground">{r.account.label}</div>
                        <span
                          className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
                            r.account.platform === "TIKTOK_SHOP"
                              ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                              : "bg-orange-500/10 text-orange-700 dark:text-orange-300"
                          }`}
                        >
                          {r.account.platform === "TIKTOK_SHOP" ? "TikTok Shop" : r.account.platform}
                        </span>
                      </td>

                      {/* Target Stok Jual Pusat */}
                      <td className="px-4 py-3.5 text-right font-semibold text-foreground">
                        {fmt(r.variant.centralStock)}
                      </td>

                      {/* Angka yang Dikirim */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="font-semibold text-foreground">{fmt(r.newSellable)}</div>
                        {r.diffVsCentral !== 0 && (
                          <div className="mt-0.5 text-xs text-rose-600 dark:text-rose-400 font-medium">
                            selisih {r.diffVsCentral > 0 ? "+" : "−"}{fmt(Math.abs(r.diffVsCentral))} vs central
                          </div>
                        )}
                      </td>

                      {/* Percobaan Ulang */}
                      <td className="px-4 py-3.5 text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            r.retryCount >= r.maxRetries
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {r.retryCount}/{r.maxRetries}
                        </span>
                      </td>

                      {/* Error Terakhir */}
                      <td className="max-w-[280px] px-4 py-3.5">
                        {r.lastError ? (
                          <div className="space-y-1">
                            <p className="text-xs text-foreground leading-relaxed">
                              {friendlyError(
                                r.lastError,
                                "Pembaruan belum diterima marketplace. Periksa koneksi, lalu coba lagi."
                              )}
                            </p>
                            <TechnicalDetails value={r.lastError} />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {r.status === "PENDING" && !r.holdReason && r.nextRetryAt && (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                            <Clock className="h-3 w-3" />
                            <span>retry otomatis {fmtDate(r.nextRetryAt)}</span>
                          </div>
                        )}
                      </td>

                      {/* Status & Waktu */}
                      <td className="whitespace-nowrap px-4 py-3.5 text-xs text-muted-foreground">
                        {r.holdReason ? <span className="mb-1 inline-flex rounded-full bg-muted px-2 py-1 font-medium text-foreground">Ditahan</span> : <StatusBadge status={r.status} className="mb-1" />}
                        {r.holdReason && <p className="max-w-56 whitespace-normal text-xs leading-relaxed">{r.holdReason}</p>}
                        <div>{fmtDate(r.updatedAt)}</div>
                      </td>

                      {/* Checkbox pilihan massal */}
                      <td className="whitespace-nowrap px-4 py-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={selectedForRetry.has(r.id)}
                          onChange={() => {
                            setSelectedForRetry((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.id)) next.delete(r.id);
                              else next.add(r.id);
                              return next;
                            });
                          }}
                          className="w-4 h-4 rounded border-border accent-primary"
                          aria-label={`Pilih ${r.variant.productName} untuk retry massal`}
                          disabled={!!r.holdReason || !(r.status === "FAILED" || (r.status === "PENDING" && r.retryCount > 0))}
                        />
                      </td>

                      {/* Aksi Retry */}
                      <td className="whitespace-nowrap px-4 py-3.5 text-right">
                        {!r.holdReason && (r.status === "FAILED" || (r.status === "PENDING" && r.retryCount > 0)) ? (
                          <button
                            type="button"
                            onClick={() => retryJob(r.id)}
                            disabled={isRetryingThis}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isRetryingThis ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Mencoba…</span>
                              </>
                            ) : (
                              <>
                                <RotateCw className="h-3.5 w-3.5" />
                                <span>Coba Lagi (Retry)</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
        {/* Tombol Muat Lebih Banyak */}
        {nextCursor && (
          <div className="border-t border-border/60 p-4 text-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-muted disabled:opacity-50"
            >
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{loadingMore ? "Memuat…" : "Muat Lebih Banyak"}</span>
            </button>
          </div>
        )}
    </div>
  );
}
