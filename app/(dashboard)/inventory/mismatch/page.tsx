"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Search } from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";

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
};

type FilterId = "mismatch" | "FAILED" | "PENDING" | "SUCCESS" | "all";

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: "mismatch", label: "Mismatch" },
  { id: "FAILED", label: "Gagal" },
  { id: "PENDING", label: "Pending" },
  { id: "SUCCESS", label: "Berhasil" },
  { id: "all", label: "Semua" },
];

const STATUS_BADGE: Record<string, string> = {
  FAILED: "bg-muted text-foreground border-border",
  PENDING: "bg-muted text-foreground border-border",
  PROCESSING: "bg-muted text-foreground border-border",
  SUCCESS: "bg-muted text-foreground border-border",
};

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
  // Retry manual per-baris: id job yang sedang diproses (disable tombol).
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
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

  async function retryJob(id: string) {
    // Debounce UI: abaikan klik <2 dtk setelah percobaan sebelumnya utk job sama.
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
            ? "Retry berhasil — stok tersalurkan ke marketplace."
            : `Retry selesai, status job: ${st}.`,
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
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stok Mismatch</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Push stok ke marketplace yang gagal (FAILED) atau sudah retry tapi masih pending.
            Stok central tidak pernah berubah karena kegagalan ini — yang perlu retry hanya baris di sini.
          </p>
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Muat Ulang
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
              filter === f.id
                ? "border-border bg-muted text-foreground"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Cari produk / SKU / channelSku…"
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm focus:border-ring focus:outline-none"
          />
        </div>
      </div>

      {notice && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            notice.kind === "ok"
              ? "border-border bg-muted text-foreground"
              : "border-border bg-muted text-foreground"
          }`}
        >
          {notice.text}
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Tidak ada job pada filter ini. {filter === "mismatch" && "Semua push stok tersalurkan — tidak ada mismatch."}
          </div>
        ) : (
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Produk / Varian</th>
                <th className="px-4 py-3">Channel SKU</th>
                <th className="px-4 py-3">Akun / Marketplace</th>
                <th className="px-4 py-3 text-right">Stok Central</th>
                <th className="px-4 py-3 text-right">Gagal di-Push</th>
                <th className="px-4 py-3 text-center">Retry</th>
                <th className="px-4 py-3">Error Terakhir</th>
                <th className="px-4 py-3">Gagal Terakhir</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{r.variant.productName}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.variant.name || r.variant.sku} · SKU {r.variant.sku}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{r.channelSku}</td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{r.account.label}</div>
                    <div className="text-xs text-muted-foreground">{r.account.platform}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">
                    {fmt(r.variant.centralStock)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-medium text-foreground">{fmt(r.newSellable)}</span>
                    {r.diffVsCentral !== 0 && (
                      <div className="text-xs text-muted-foreground">
                        selisih {r.diffVsCentral > 0 ? "+" : "−"}{fmt(Math.abs(r.diffVsCentral))} vs central
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-foreground">
                    {r.retryCount}/{r.maxRetries}
                  </td>
                  <td className="max-w-[280px] px-4 py-3">
                    <div className="truncate text-xs text-foreground" title={r.lastError ?? ""}>
                      {r.lastError ?? "—"}
                    </div>
                    {r.status === "PENDING" && r.nextRetryAt && (
                      <div className="text-xs text-muted-foreground">retry otomatis {fmtDate(r.nextRetryAt)}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    <span
                      className={`mb-1 inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        STATUS_BADGE[r.status] ?? "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      {r.status}
                    </span>
                    <div>{fmtDate(r.updatedAt)}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {r.status === "FAILED" || (r.status === "PENDING" && r.retryCount > 0) ? (
                      <button
                        onClick={() => retryJob(r.id)}
                        disabled={retrying.has(r.id)}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary disabled:opacity-50"
                      >
                        {retrying.has(r.id) ? "Retrying…" : "Retry"}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {nextCursor && (
        <div className="mt-4 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {loadingMore ? "Memuat…" : "Muat Lebih Banyak"}
          </button>
        </div>
      )}
    </div>
  );
}
