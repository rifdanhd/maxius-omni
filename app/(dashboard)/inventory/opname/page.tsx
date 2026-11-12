"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";
import { ErrorFeedback, FormError } from "@/components/ui/feedback";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/* ------------------------------ Types ------------------------------ */

type VariantLite = {
  id: string;
  sku: string;
  name: string | null;
  stock: number;
  masterProduct: { name: string };
};

type OpnameItem = {
  id: string;
  variantId: string;
  systemStock: number;
  countedStock: number | null;
  variant: { id: string; sku: string; name: string | null; stock: number };
};

type Opname = {
  id: string;
  code: string;
  status: string;
  note: string | null;
  startedAt: string;
  finalizedAt: string | null;
  cancelledAt: string | null;
  user?: { id: string; username: string } | null;
  items: OpnameItem[];
};

type OpnameRow = {
  id: string;
  code: string;
  status: string;
  note: string | null;
  startedAt: string;
  finalizedAt: string | null;
  cancelledAt: string | null;
  user?: { id: string; username: string } | null;
  totalItems: number;
  countedItems: number;
  diffItems: number;
};

type TabId = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

/* ------------------------------ Constants ------------------------------ */

const TABS: Array<{ id: TabId; label: string; emoji: string }> = [
  { id: "IN_PROGRESS", label: "Dalam Proses", emoji: "🔄" },
  { id: "PENDING", label: "Belum Dimulai", emoji: "⏳" },
  { id: "COMPLETED", label: "Selesai", emoji: "✅" },
  { id: "CANCELLED", label: "Dibatalkan", emoji: "❌" },
];

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Belum Dimulai",
  IN_PROGRESS: "Dalam Proses",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: "text-amber-600 bg-amber-50 border-amber-200",
  IN_PROGRESS: "text-blue-600 bg-blue-50 border-blue-200",
  COMPLETED: "text-green-600 bg-green-50 border-green-200",
  CANCELLED: "text-red-600 bg-red-50 border-red-200",
};

const fmt = (n: number) => n.toLocaleString("id-ID");
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

/* ------------------------------ Page ------------------------------ */

export default function StockOpnamePage() {
  const [activeTab, setActiveTab] = useState<TabId>("IN_PROGRESS");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<OpnameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const [{ counts: c }, { opnames }] = await Promise.all([
          api<{ counts: Record<string, number> }>("/api/inventory/opname?counts=1"),
          api<{ opnames: OpnameRow[] }>(
            `/api/inventory/opname?status=${encodeURIComponent(activeTab)}`
          ),
        ]);
        if (cancelled) return;
        setCounts(c);
        setRows(opnames);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          console.error("[StockOpname] load gagal:", e);
          setError(e instanceof Error ? e.message : "Gagal memuat data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [activeTab, reloadKey]);

  // Summary totals across all tabs
  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stok Opname</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Hitung fisik barang di gudang dan koreksi selisih stok. Setelah buat opname, pilih
            variasi → masukkan hasil hitung → Selesaikan &amp; Koreksi Stok.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Muat Ulang
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Buat Stok Opname
          </button>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex flex-col items-start rounded-xl border p-4 text-left transition hover:shadow-sm ${
              activeTab === t.id
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            <span className="text-lg">{t.emoji}</span>
            <span className="mt-2 text-2xl font-bold text-foreground">
              {counts[t.id] ?? 0}
            </span>
            <span className="mt-0.5 text-xs text-muted-foreground">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab filter bar */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition ${
              activeTab === t.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                activeTab === t.id
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {counts[t.id] ?? 0}
            </span>
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-muted-foreground">
          {totalAll} total opname
        </span>
      </div>

      {error && <ErrorFeedback error={error} className="rounded-xl" />}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 p-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">Memuat data opname…</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
            <Package className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium text-foreground">
                Belum ada opname berstatus &ldquo;{STATUS_LABEL[activeTab]}&rdquo;
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeTab === "IN_PROGRESS" || activeTab === "PENDING"
                  ? "Mulai dari tombol Buat Stok Opname di atas."
                  : "Pilih tab lain untuk melihat opname yang sudah ada."}
              </p>
            </div>
            {(activeTab === "IN_PROGRESS" || activeTab === "PENDING") && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                Buat Stok Opname
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3.5">Kode / Operator</th>
                <th className="px-5 py-3.5">Catatan</th>
                <th className="px-5 py-3.5 text-center">Progres</th>
                <th className="px-5 py-3.5 text-center">Selisih</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Waktu</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const pct =
                  r.totalItems > 0 ? Math.round((r.countedItems / r.totalItems) * 100) : 0;
                return (
                  <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-foreground">{r.code}</div>
                      {r.user?.username && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          oleh {r.user.username}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {r.note ? (
                        <span className="line-clamp-2">{r.note}</span>
                      ) : (
                        <span className="italic text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground">
                          {fmt(r.countedItems)}/{fmt(r.totalItems)} produk
                        </span>
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-center">
                      {r.diffItems > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          {fmt(r.diffItems)} selisih
                        </span>
                      ) : r.status === "COMPLETED" ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                          <CheckCircle2 className="h-3 w-3" /> Cocok
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOR[r.status] ?? "text-foreground bg-muted border-border"}`}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-muted-foreground">
                      <div>Mulai: {fmtDate(r.startedAt)}</div>
                      {r.finalizedAt && (
                        <div className="text-green-600">Selesai: {fmtDate(r.finalizedAt)}</div>
                      )}
                      {r.cancelledAt && (
                        <div className="text-red-500">Batal: {fmtDate(r.cancelledAt)}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      {r.status === "COMPLETED" || r.status === "CANCELLED" ? (
                        <button
                          onClick={() => setDetailId(r.id)}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                        >
                          Lihat Detail
                        </button>
                      ) : (
                        <button
                          onClick={() => setDetailId(r.id)}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                        >
                          Input Hitung
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            setDetailId(id);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {detailId && (
        <CountModal
          opnameId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

/* ------------------------------ Create Modal ------------------------------ */

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (opnameId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [variants, setVariants] = useState<VariantLite[]>([]);
  const [selected, setSelected] = useState<Map<string, VariantLite>>(new Map());
  const [note, setNote] = useState("");
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoadingVariants(true);
      api<{ variants: VariantLite[] }>(
        `/api/inventory/opname/variants?q=${encodeURIComponent(q)}`
      )
        .then((d) => setVariants(d.variants))
        .catch((e) => {
          console.error("[StockOpname] load varian gagal:", e);
          setError(e instanceof Error ? e.message : "Gagal memuat produk.");
        })
        .finally(() => setLoadingVariants(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const toggle = (v: VariantLite) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(v.id)) next.delete(v.id);
      else next.set(v.id, v);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Map(variants.map((v) => [v.id, v])));
  };

  const clearAll = () => setSelected(new Map());

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { opname } = await api<{ opname: Opname }>("/api/inventory/opname", {
        method: "POST",
        body: JSON.stringify({ variantIds: [...selected.keys()], note }),
      });
      onCreated(opname.id);
    } catch (e) {
      console.error("[StockOpname] create gagal:", e);
      setError(e instanceof Error ? e.message : "Gagal membuat opname.");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-foreground">Buat Stok Opname</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Stok sistem dicatat sebagai snapshot saat opname dibuat. Selisih dihitung terhadap
              snapshot ini.
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search + list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Search bar */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari produk atau SKU…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-9 text-sm focus:border-ring focus:outline-none"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Select all / clear */}
          {variants.length > 0 && (
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{variants.length} variasi ditemukan</span>
              <div className="flex gap-3">
                <button
                  onClick={selectAll}
                  className="font-medium text-primary hover:underline"
                >
                  Pilih Semua
                </button>
                {selected.size > 0 && (
                  <button
                    onClick={clearAll}
                    className="font-medium text-muted-foreground hover:text-foreground"
                  >
                    Hapus Pilihan
                  </button>
                )}
              </div>
            </div>
          )}

          {loadingVariants ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
            </div>
          ) : variants.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Package className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {q
                  ? "Tidak ada variasi yang cocok dengan pencarian."
                  : "Tidak ada variasi tersedia. Tambahkan produk di Produk Master."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {variants.map((v) => {
                const isSel = selected.has(v.id);
                return (
                  <li key={v.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-muted/50 ${isSel ? "bg-primary/5" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(v)}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-foreground">
                          {v.masterProduct.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {v.name && v.name !== v.sku ? `${v.name} · ` : ""}SKU&nbsp;
                          <span className="font-mono">{v.sku}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-sm font-medium text-foreground">
                        {fmt(v.stock)} pcs
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Note */}
          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-medium text-foreground">
              Catatan <span className="font-normal text-muted-foreground">(opsional)</span>
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Mis. hitung fisik gudang utama"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none"
            />
          </label>

          {error && <ErrorFeedback error={error} className="mt-3" />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
                {selected.size} dipilih
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              {selected.size === 0 ? "Belum ada yang dipilih" : "variasi akan dihitung"}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Batal
            </button>
            <button
              onClick={submit}
              disabled={submitting || selected.size === 0}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Buat Opname
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Count Modal ------------------------------ */

function CountModal({
  opnameId,
  onClose,
  onChanged,
}: {
  opnameId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [opname, setOpname] = useState<Opname | null>(null);
  const [counts, setCounts] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ adjusted: number; skipped: number } | null>(null);

  useEffect(() => {
    api<{ opname: Opname }>(`/api/inventory/opname/${opnameId}/detail`)
      .then(({ opname: o }) => {
        setOpname(o);
        setCounts(
          new Map(
            o.items
              .filter((i) => i.countedStock !== null)
              .map((i) => [i.variantId, String(i.countedStock)])
          )
        );
      })
      .catch((e) => {
        console.error("[StockOpname] detail gagal:", e);
        setError(e instanceof Error ? e.message : "Gagal memuat opname.");
      });
  }, [opnameId]);

  const setCount = (variantId: string, value: string) => {
    setCounts((prev) => {
      const next = new Map(prev);
      if (value === "") next.delete(variantId);
      else next.set(variantId, value);
      return next;
    });
  };

  const stats = useMemo(() => {
    if (!opname) return { counted: 0, diff: 0, total: 0 };
    let counted = 0;
    let diff = 0;
    for (const i of opname.items) {
      const raw = counts.get(i.variantId);
      if (raw !== undefined && raw !== "") {
        counted++;
        if (Number(raw) !== i.systemStock) diff++;
      }
    }
    return { counted, diff, total: opname.items.length };
  }, [opname, counts]);

  const allCounted = opname !== null && stats.counted === stats.total;
  const pct = stats.total > 0 ? Math.round((stats.counted / stats.total) * 100) : 0;

  const save = async () => {
    if (!opname) return;
    setSaving(true);
    setError(null);
    try {
      const payload = [...counts.entries()]
        .filter(([, v]) => v !== "")
        .map(([variantId, v]) => ({ variantId, countedStock: Number(v) }));
      const { opname: fresh } = await api<{ opname: Opname }>(
        `/api/inventory/opname/${opnameId}`,
        { method: "PATCH", body: JSON.stringify({ counts: payload }) }
      );
      setOpname(fresh);
    } catch (e) {
      console.error("[StockOpname] simpan hitungan gagal:", e);
      setError(e instanceof Error ? e.message : "Gagal menyimpan hitungan.");
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    setFinalizing(true);
    setError(null);
    try {
      const r = await api<{ adjusted: number; skipped: number; opname: Opname }>(
        `/api/inventory/opname/${opnameId}`,
        { method: "POST", body: JSON.stringify({ action: "finalize" }) }
      );
      setResult({ adjusted: r.adjusted ?? 0, skipped: r.skipped ?? 0 });
      setOpname(r.opname);
      onChanged();
    } catch (e) {
      console.error("[StockOpname] finalisasi gagal:", e);
      setError(e instanceof Error ? e.message : "Gagal finalisasi.");
    } finally {
      setFinalizing(false);
    }
  };

  const cancel = async () => {
    setCancelling(true);
    setError(null);
    try {
      await api(`/api/inventory/opname/${opnameId}`, {
        method: "POST",
        body: JSON.stringify({ action: "cancel" }),
      });
      onChanged();
      onClose();
    } catch (e) {
      console.error("[StockOpname] batal gagal:", e);
      setError(e instanceof Error ? e.message : "Gagal membatalkan.");
      setCancelling(false);
    }
  };

  const closed = opname?.status === "COMPLETED" || opname?.status === "CANCELLED";

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl">
        {/* Header */}
        <div className="border-b border-border px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">
                  Input Hitung Fisik
                </h2>
                <span className="font-mono text-sm text-muted-foreground">
                  {opname?.code ?? "…"}
                </span>
                {opname && (
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOR[opname.status] ?? "bg-muted"}`}
                  >
                    {STATUS_LABEL[opname.status] ?? opname.status}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Isi kolom &ldquo;Hasil Hitung&rdquo; dengan angka hasil hitung fisik di gudang.
                Selisih dihitung otomatis terhadap snapshot stok sistem.
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Progress bar */}
          {opname && !closed && (
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Terhitung{" "}
                  <span className="font-semibold text-foreground">
                    {fmt(stats.counted)}/{fmt(stats.total)}
                  </span>{" "}
                  produk
                  {stats.diff > 0 && (
                    <span className="ml-2 font-semibold text-amber-600">
                      · {fmt(stats.diff)} selisih
                    </span>
                  )}
                </span>
                <span className="font-semibold text-foreground">{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${
                    pct === 100 ? "bg-green-500" : "bg-primary"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Success result */}
          {result && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
              <div>
                <div className="font-semibold text-green-800">Opname selesai &amp; stok dikoreksi!</div>
                <div className="mt-0.5 text-green-700">
                  {result.adjusted > 0
                    ? `${result.adjusted} produk stoknya dikoreksi (tercatat di Riwayat Inventori).`
                    : "Tidak ada selisih — stok sudah sesuai, tidak ada perubahan."}
                </div>
              </div>
            </div>
          )}

          {error && <ErrorFeedback error={error} className="mb-4" />}

          {!opname ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-sm">Memuat detail opname…</span>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="pb-3 pr-3">Produk / SKU</th>
                  <th className="px-3 pb-3 text-right">Stok Sistem</th>
                  <th className="px-3 pb-3 text-right">Hasil Hitung</th>
                  <th className="pl-3 pb-3 text-right">Selisih</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {opname.items.map((i) => {
                  const raw = counts.get(i.variantId) ?? "";
                  const n = raw === "" ? null : Number(raw);
                  const diff = n === null || Number.isNaN(n) ? null : n - i.systemStock;
                  return (
                    <tr key={i.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-3">
                        <div className="font-medium text-foreground">
                          {i.variant.name || i.variant.sku}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                          SKU {i.variant.sku}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-medium text-foreground">
                        {fmt(i.systemStock)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {closed ? (
                          <span className="font-medium text-foreground">
                            {fmt(i.countedStock ?? 0)}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            value={raw}
                            onChange={(e) => setCount(i.variantId, e.target.value)}
                            placeholder="—"
                            className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-right text-sm focus:border-ring focus:outline-none"
                          />
                        )}
                      </td>
                      <td className="pl-3 py-3 text-right">
                        {diff === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : diff === 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                            <CheckCircle2 className="h-3 w-3" /> Cocok
                          </span>
                        ) : diff > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                            +{fmt(diff)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                            −{fmt(-diff)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {!closed && opname && (
          <div className="border-t border-border px-6 py-4">
            {!allCounted && (
              <p className="mb-3 text-xs text-muted-foreground">
                ⚠️ Lengkapi hasil hitung <strong>semua</strong> variasi sebelum menerapkan koreksi
                stok ({stats.total - stats.counted} tersisa).
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={cancel}
                disabled={cancelling || saving || finalizing}
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                {cancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Batalkan Opname
              </button>
              <div className="flex gap-2">
                <button
                  onClick={save}
                  disabled={saving || finalizing || counts.size === 0}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ClipboardList className="h-4 w-4" />
                  )}
                  Simpan Hitungan
                </button>
                <button
                  onClick={finalize}
                  disabled={finalizing || saving || !allCounted}
                  title={allCounted ? "" : "Lengkapi semua hasil hitung dulu"}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {finalizing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ClipboardCheck className="h-4 w-4" />
                  )}
                  Selesaikan &amp; Koreksi Stok
                </button>
              </div>
            </div>
          </div>
        )}

        {/* View-only footer for closed opname */}
        {closed && (
          <div className="border-t border-border px-6 py-4 text-center">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-6 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Tutup
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
