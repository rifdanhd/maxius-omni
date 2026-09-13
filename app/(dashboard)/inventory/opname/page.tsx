"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";

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

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "PENDING", label: "Pending" },
  { id: "IN_PROGRESS", label: "Dalam Proses" },
  { id: "COMPLETED", label: "Selesai" },
  { id: "CANCELLED", label: "Dibatalkan" },
];

const TAB_BADGE: Record<TabId, string> = {
  PENDING: "bg-amber-100 text-amber-700 border-amber-200",
  IN_PROGRESS: "bg-indigo-100 text-indigo-700 border-indigo-200",
  COMPLETED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
};

const STATUS_BADGE: Record<string, string> = TAB_BADGE;

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "Dalam Proses",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

const fmt = (n: number) => n.toLocaleString("id-ID");
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await authFetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
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
  // Naikkan utk memicu muat ulang (event handler boleh setState; effect tidak
  // boleh setState sinkron — react-hooks/purity & set-state-in-effect).
  const [reloadKey, setReloadKey] = useState(0);

  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Initial load & reload: pola existing (promotions) — async fn di dalam
  // effect + guard cancelled (aturan react-hooks/set-state-in-effect).
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
    return () => {
      cancelled = true;
    };
  }, [activeTab, reloadKey]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stok Opname</h1>
          <p className="mt-1 text-sm text-gray-500">
            Hitung fisik ulang stok gudang & koreksi selisih dengan jejak yang jelas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Muat Ulang
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Buat Stok Opname
          </button>
        </div>
      </div>

      {/* Tabs dgn badge jumlah */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition ${
              activeTab === t.id
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t.label}
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${TAB_BADGE[t.id]}`}
            >
              {counts[t.id] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Daftar opname */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center p-10 text-gray-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            Belum ada stok opname berstatus &ldquo;{STATUS_LABEL[activeTab]}&rdquo;.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Kode</th>
                <th className="px-4 py-3">Produk</th>
                <th className="px-4 py-3">Terhitung</th>
                <th className="px-4 py-3">Selisih</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Dimulai</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{r.code}</div>
                    {r.user?.username && (
                      <div className="text-xs text-gray-500">oleh {r.user.username}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{fmt(r.totalItems)} produk</td>
                  <td className="px-4 py-3 text-gray-700">
                    {fmt(r.countedItems)}/{fmt(r.totalItems)}
                  </td>
                  <td className="px-4 py-3">
                    {r.diffItems > 0 ? (
                      <span className="font-medium text-amber-600">{fmt(r.diffItems)} produk</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-500 border-gray-200"
                      }`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(r.startedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {r.status === "COMPLETED" || r.status === "CANCELLED" ? (
                      <span className="text-xs text-gray-400">
                        {r.status === "COMPLETED"
                          ? `Selesai ${fmtDate(r.finalizedAt)}`
                          : `Batal ${fmtDate(r.cancelledAt)}`}
                      </span>
                    ) : (
                      <button
                        onClick={() => setDetailId(r.id)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        Input Hitung
                      </button>
                    )}
                  </td>
                </tr>
              ))}
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

/* ------------------------------ Create modal ------------------------------ */

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
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api<{ variants: VariantLite[] }>(
        `/api/inventory/opname/variants?q=${encodeURIComponent(q)}`
      )
        .then((d) => setVariants(d.variants))
        .catch((e) => {
          console.error("[StockOpname] load varian gagal:", e);
          setError(e instanceof Error ? e.message : "Gagal memuat produk.");
        })
        .finally(() => setLoading(false));
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">Buat Stok Opname</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Stok sistem akan di-SNAPSHOT saat opname dibuat — selisih dihitung terhadap snapshot ini.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari produk / SKU…"
            className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          {loading ? (
            <div className="flex items-center justify-center p-6 text-gray-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
            </div>
          ) : variants.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">Tidak ada produk cocok.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {variants.map((v) => {
                const isSel = selected.has(v.id);
                return (
                  <li key={v.id}>
                    <label className="flex cursor-pointer items-center gap-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(v)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-gray-900">
                          {v.masterProduct.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {v.name || v.sku} · SKU {v.sku}
                        </div>
                      </div>
                      <div className="text-sm text-gray-700">Stok: {fmt(v.stock)}</div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Catatan (opsional)
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Mis. hitung fisik gudang utama"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </label>

          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
          <span className="text-sm text-gray-600">{selected.size} produk dipilih</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Batal
            </button>
            <button
              onClick={submit}
              disabled={submitting || selected.size === 0}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Buat Opname
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Count modal ------------------------------ */

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
          new Map(o.items.filter((i) => i.countedStock !== null).map((i) => [i.variantId, String(i.countedStock)]))
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Input Hitung Fisik — {opname?.code ?? "…"}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Isi kolom &ldquo;Hasil Hitung&rdquo; dengan angka hasil hitung fisik di gudang.
                Selisih dihitung otomatis terhadap snapshot stok sistem.
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {result && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <div className="font-semibold">Opname selesai.</div>
                <div>
                  {result.adjusted > 0
                    ? `${result.adjusted} produk dikoreksi stoknya (tercatat di Riwayat Inventori).`
                    : "Tidak ada selisih — stok tidak diubah."}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div>{error}</div>
            </div>
          )}

          {!opname ? (
            <div className="flex items-center justify-center p-10 text-gray-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat…
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Produk</th>
                  <th className="px-3 py-2 text-right">Stok Sistem</th>
                  <th className="px-3 py-2 text-right">Hasil Hitung</th>
                  <th className="px-3 py-2 text-right">Selisih</th>
                </tr>
              </thead>
              <tbody>
                {opname.items.map((i) => {
                  const raw = counts.get(i.variantId) ?? "";
                  const n = raw === "" ? null : Number(raw);
                  const diff = n === null || Number.isNaN(n) ? null : n - i.systemStock;
                  return (
                    <tr key={i.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-gray-900">
                          {i.variant.name || i.variant.sku}
                        </div>
                        <div className="text-xs text-gray-500">SKU {i.variant.sku}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-700">
                        {fmt(i.systemStock)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {closed ? (
                          <span className="text-gray-700">{fmt(i.countedStock ?? 0)}</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            value={raw}
                            onChange={(e) => setCount(i.variantId, e.target.value)}
                            placeholder="—"
                            className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm focus:border-blue-500 focus:outline-none"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {diff === null ? (
                          <span className="text-gray-400">—</span>
                        ) : diff === 0 ? (
                          <span className="text-emerald-600">Cocok</span>
                        ) : diff > 0 ? (
                          <span className="font-medium text-emerald-600">+{fmt(diff)}</span>
                        ) : (
                          <span className="font-medium text-red-600">−{fmt(-diff)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!closed && opname && (
          <div className="border-t border-gray-200 px-6 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
              <span>
                Terhitung {fmt(stats.counted)}/{fmt(stats.total)} produk
                {stats.diff > 0 && (
                  <span className="ml-2 font-medium text-amber-600">
                    · {fmt(stats.diff)} selisih
                  </span>
                )}
              </span>
              {!allCounted && (
                <span className="text-xs text-amber-600">
                  Semua produk harus terhitung sebelum bisa difinalisasi.
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={cancel}
                disabled={cancelling || saving || finalizing}
                className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Batalkan Opname
              </button>
              <div className="flex gap-2">
                <button
                  onClick={save}
                  disabled={saving || finalizing || counts.size === 0}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                  Simpan Hitungan
                </button>
                <button
                  onClick={finalize}
                  disabled={finalizing || saving || !allCounted}
                  title={allCounted ? "" : "Lengkapi semua hasil hitung dulu"}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {finalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                  Finalisasi & Koreksi Stok
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
