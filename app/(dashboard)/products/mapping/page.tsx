"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/utils/api-client";
import { Plus, Trash2, RefreshCw, History, Save, X, Link2, Boxes, SlidersHorizontal, AlertTriangle, PackagePlus, Link as LinkIcon } from "lucide-react";

type Store = { id: string; name: string; platform: string; status: string };
type Variant = {
  id: string;
  sku: string;
  stock: number;
  safetyStock: number;
  masterProduct: { id: string; name: string };
};
type Mapping = {
  id: string;
  channelSku: string;
  account: { id: string; platform: string; label: string } | null;
  variant: Variant | null;
};
type LedgerEntry = {
  id: string;
  changeQty: number;
  reason: string;
  referenceId: string | null;
  note: string | null;
  stockAfter: number;
  createdAt: string;
  variant: { sku: string; masterProduct: { name: string } } | null;
  account: { label: string; platform: string } | null;
  user: { username: string } | null;
};

const formatPlatform = (p: string) =>
  p === "TIKTOK_SHOP" ? "TikTok Shop" : p === "SHOPEE" ? "Shopee" : p || "-";

const effectiveStock = (v: Variant | null) =>
  v ? Math.max(0, v.stock - v.safetyStock) : 0;

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await authFetch(path, {
    ...opts,
    headers: {
      
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Gagal (${res.status})`);
  return data as T;
}

type OrphanSku = {
  channelSku: string;
  accountId: string;
  accountLabel: string | null;
  platform: string | null;
  qty: number;
  orderCount: number;
  sampleProductName: string | null;
  lastSeenAt: string | null;
  existingMappingId: string | null;
};

const emptyForm = {
  accountId: "",
  channelSku: "",
  useNewVariant: false,
  variantId: "",
  newProductName: "",
  sku: "",
  stock: "",
  safetyStock: "",
};

export default function ProductMappingPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [tab, setTab] = useState<"mapping" | "varian" | "riwayat">("mapping");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [repoint, setRepoint] = useState<Record<string, string>>({});
  const [repointSaving, setRepointSaving] = useState<string | null>(null);
  const [adjustVariant, setAdjustVariant] = useState<Variant | null>(null);
  const [adjustForm, setAdjustForm] = useState({ newStock: "", note: "" });
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [orphans, setOrphans] = useState<OrphanSku[]>([]);
  const [orphansLoaded, setOrphansLoaded] = useState(false);
  const [mapMode, setMapMode] = useState<Record<string, "existing" | "new">>({});
  const [mapTarget, setMapTarget] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState<Record<string, string>>({});
  const [mapSaving, setMapSaving] = useState<string | null>(null);
  const [stockInVariant, setStockInVariant] = useState<Variant | null>(null);
  const [stockInForm, setStockInForm] = useState({ qty: "", note: "" });
  const [stockInSaving, setStockInSaving] = useState(false);

  const loadAll = useCallback(async () => {
    const [m, v, storesRes] = await Promise.all([
      api<{ mappings: Mapping[] }>("/api/inventory/mappings"),
      api<{ variants: Variant[] }>("/api/inventory/variants"),
      api<Store[]>("/api/stores"),
    ]);
    setMappings(m.mappings ?? []);
    setVariants(v.variants ?? []);
    setStores(Array.isArray(storesRes) ? storesRes : []);
  }, []);

  const loadLedger = useCallback(async () => {
    const r = await api<{ entries: LedgerEntry[] }>("/api/inventory/ledger?limit=50");
    setLedger(r.entries ?? []);
  }, []);

  const loadOrphans = useCallback(async () => {
    const r = await api<{ orphans: OrphanSku[] }>("/api/inventory/orphan-skus");
    setOrphans(r.orphans ?? []);
    setOrphansLoaded(true);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadAll();
        await loadLedger();
        await loadOrphans();
      } catch (e) {
        console.error(e);
        setError(e instanceof Error ? e.message : "Gagal memuat data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAll, loadLedger, loadOrphans]);

  async function handleCreateMapping() {
    setError(null);
    if (!form.accountId || !form.channelSku.trim()) {
      setError("Pilih toko dan isi channel SKU.");
      return;
    }
    if (!form.useNewVariant && !form.variantId) {
      setError("Pilih varian target, atau aktifkan mode 'Varian baru'.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/inventory/mappings", {
        method: "POST",
        body: JSON.stringify({
          accountId: form.accountId,
          channelSku: form.channelSku.trim(),
          variantId: form.useNewVariant ? undefined : form.variantId,
          newProductName: form.useNewVariant ? form.newProductName.trim() || undefined : undefined,
          sku: form.useNewVariant ? form.sku.trim() || undefined : undefined,
          stock: form.useNewVariant ? Number(form.stock) || 0 : undefined,
          safetyStock: form.useNewVariant ? Number(form.safetyStock) || 0 : undefined,
        }),
      });
      setForm(emptyForm);
      await loadAll();
      await loadLedger();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan mapping.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRepoint(id: string, variantId: string) {
    setRepointSaving(id);
    setError(null);
    try {
      await api(`/api/inventory/mappings/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ variantId }),
      });
      setRepoint((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengubah variasi target.");
    } finally {
      setRepointSaving(null);
    }
  }

  async function handleDelete(id: string, channelSku: string) {
    if (!confirm(`Hapus mapping SKU "${channelSku}"? Listing ini akan berdiri sendiri (tidak lagi gabung stok).`)) return;
    setError(null);
    try {
      await api(`/api/inventory/mappings/${id}`, { method: "DELETE" });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus mapping.");
    }
  }

  async function handleMapOrphan(o: OrphanSku) {
    const mode = mapMode[o.channelSku] ?? "existing";
    setError(null);
    if (mode === "existing" && !mapTarget[o.channelSku]) {
      setError("Pilih varian target dulu untuk SKU ini.");
      return;
    }
    if (mode === "new" && !newName[o.channelSku]?.trim()) {
      setError("Isi nama produk master baru untuk SKU ini.");
      return;
    }
    setMapSaving(o.channelSku);
    try {
      await api(`/api/inventory/orphan-skus/map`, {
        method: "POST",
        body: JSON.stringify(
          mode === "existing"
            ? { accountId: o.accountId, channelSku: o.channelSku, mode, variantId: mapTarget[o.channelSku] }
            : { accountId: o.accountId, channelSku: o.channelSku, mode, newProductName: newName[o.channelSku].trim(), platformTitle: o.sampleProductName ?? undefined }
        ),
      });
      setMapMode((p) => { const n = { ...p }; delete n[o.channelSku]; return n; });
      setMapTarget((p) => { const n = { ...p }; delete n[o.channelSku]; return n; });
      setNewName((p) => { const n = { ...p }; delete n[o.channelSku]; return n; });
      await Promise.all([loadAll(), loadOrphans(), loadLedger()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mapping SKU.");
    } finally {
      setMapSaving(null);
    }
  }

  function openAdjust(v: Variant) {
    setAdjustVariant(v);
    setAdjustForm({ newStock: String(v.stock), note: "" });
  }

  async function handleStockIn() {
    if (!stockInVariant) return;
    const qty = Math.floor(Number(stockInForm.qty));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Isi jumlah barang masuk (bilangan bulat > 0).");
      return;
    }
    setStockInSaving(true);
    setError(null);
    try {
      await api("/api/inventory/stock-in", {
        method: "POST",
        body: JSON.stringify({
          variantId: stockInVariant.id,
          qty,
          note: stockInForm.note.trim() || undefined,
        }),
      });
      setStockInVariant(null);
      setStockInForm({ qty: "", note: "" });
      await loadAll();
      await loadLedger();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mencatat barang masuk.");
    } finally {
      setStockInSaving(false);
    }
  }

  async function handleAdjust() {
    if (!adjustVariant) return;
    const newStock = Math.floor(Number(adjustForm.newStock));
    if (!Number.isFinite(newStock) || newStock < 0) {
      setError("Isi stok baru yang valid (bilangan bulat >= 0).");
      return;
    }
    setAdjustSaving(true);
    setError(null);
    try {
      await api(`/api/inventory/variants/${adjustVariant.id}/adjust`, {
        method: "POST",
        body: JSON.stringify({
          newStock,
          note: adjustForm.note.trim() || "Sesuaikan stok manual",
        }),
      });
      setAdjustVariant(null);
      setAdjustForm({ newStock: "", note: "" });
      await loadAll();
      await loadLedger();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyesuaikan stok.");
    } finally {
      setAdjustSaving(false);
    }
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Hubungkan Produk &amp; Stok (Mapping Stok Terpusat)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hubungkan produk di tiap toko ke satu variasi stok pusat (sku_master). Produk yang belum
            dihubungkan tetap berdiri sendiri. Stok yang bisa dijual (Stok Efektif) =
            stok total − stok cadangan (Stok Aman).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setTab("riwayat"); loadLedger().catch((e: unknown) => setError(e instanceof Error ? e.message : "Gagal memuat riwayat.")); }}
            className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <History size={16} /> Riwayat Stok
          </button>
          <button
            onClick={() => { Promise.all([loadAll(), loadLedger(), loadOrphans()]).catch((e: unknown) => setError(e instanceof Error ? e.message : "Gagal memuat ulang.")); }}
            className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <RefreshCw size={16} /> Muat Ulang
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">{error}</div>
      )}

      {/* Tab — daftar panjang (ribuan baris) dipisah jadi 3 tampilan */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="flex items-center overflow-x-auto px-4">
          {(
            [
              { id: "mapping", label: "Hubungan Produk (Mapping)", count: mappings.length },
              { id: "varian", label: "Variasi Pusat (sku_master)", count: variants.length },
              { id: "riwayat", label: "Riwayat Stok", count: ledger.length },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              data-testid={`mapping-tab-${t.id}`}
              onClick={() => { setTab(t.id); if (t.id === "riwayat") loadLedger().catch((e: unknown) => setError(e instanceof Error ? e.message : "Gagal memuat riwayat.")); }}
              className={`whitespace-nowrap px-4 py-3 text-sm font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
                tab === t.id ? "border-primary text-foreground" : "border-transparent text-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                    tab === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === "mapping" && (
        <>
      {/* Tambah Mapping */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Plus size={16} className="text-foreground" />
          <h2 className="font-semibold text-foreground">Hubungkan Produk (Tambah Mapping)</h2>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">Toko</label>
            <select
              value={form.accountId}
              onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
              className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
            >
              <option value="">— pilih toko —</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({formatPlatform(s.platform)})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">Kode Produk di Toko (Channel SKU)</label>
            <input
              type="text"
              value={form.channelSku}
              onChange={(e) => setForm((f) => ({ ...f, channelSku: e.target.value }))}
              placeholder="mis. TTS3-BLK-A"
              className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={!form.useNewVariant}
                onChange={() => setForm((f) => ({ ...f, useNewVariant: !f.useNewVariant }))}
                className="accent-primary"
              />
              Pakai varian yang sudah ada
            </label>
          </div>

          {!form.useNewVariant ? (
            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">Variasi Pusat Tujuan (Varian Target)</label>
              <select
                value={form.variantId}
                onChange={(e) => setForm((f) => ({ ...f, variantId: e.target.value }))}
                className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
              >
                <option value="">— pilih varian —</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.masterProduct.name} / {v.sku} (stok {v.stock})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">Nama Produk Baru</label>
                <input
                  type="text"
                  value={form.newProductName}
                  onChange={(e) => setForm((f) => ({ ...f, newProductName: e.target.value }))}
                  placeholder="mis. Kaos kaki polos hitam"
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">Kode Variasi (SKU)</label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                  placeholder="pakai channel SKU bila kosong"
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">Stok Awal</label>
                  <input
                    type="number"
                    min="0"
                    value={form.stock}
                    onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">Stok Cadangan (Stok Aman)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.safetyStock}
                    onChange={(e) => setForm((f) => ({ ...f, safetyStock: e.target.value }))}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                  />
                </div>
              </div>
            </>
          )}

          <div className="md:col-span-3 flex justify-end">
            <button
              onClick={handleCreateMapping}
              disabled={saving}
              className="flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-60 transition-colors"
            >
              <Link2 size={16} /> {saving ? "Menyimpan..." : "Simpan Hubungan (Mapping)"}
            </button>
          </div>
        </div>
      </div>

      {/* SKU Order Belum Ter-mapping (orphan) — detect & tag saja, aksi manual */}
      {orphansLoaded && orphans.length > 0 && (
        <div className="bg-muted border border-border rounded-xl shadow-sm" data-testid="orphan-panel">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <AlertTriangle size={16} className="text-foreground" />
            <h2 className="font-semibold text-foreground">
              Kode Produk Pesanan Belum Terhubung (SKU) ({orphans.length})
            </h2>
            <span className="text-xs text-muted-foreground">
              — muncul di order ({orphans.reduce((s, o) => s + o.qty, 0)} pcs) tapi belum punya varian stok pusat. Analytics belum menampilkan nama produknya.
            </span>
          </div>
          <div className="divide-y divide-border">
            {orphans.map((o) => {
              const mode = mapMode[o.channelSku] ?? "existing";
              return (
                <div key={`${o.accountId}|${o.channelSku}`} className="p-4" data-testid={`orphan-row-${o.channelSku}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-foreground">{o.channelSku}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-foreground font-semibold">{o.qty} pcs</span>
                        <span className="text-xs text-muted-foreground">{o.orderCount} order</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 truncate max-w-[480px]">
                        {o.sampleProductName ?? "(nama listing tidak tersedia)"} · {o.accountLabel ?? "-"}
                        {o.existingMappingId ? " · hubungan sudah ada — gunakan Ganti Varian/aksi di bawah untuk melengkapi data pesanan lama (Backfill)" : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setMapMode((p) => ({ ...p, [o.channelSku]: "existing" }))}
                        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium ${mode === "existing" ? "border-primary bg-card text-foreground" : "border-border bg-card text-foreground"}`}
                      >
                        <LinkIcon size={13} /> Ke varian ada
                      </button>
                      <button
                        onClick={() => {
                          setMapMode((p) => ({ ...p, [o.channelSku]: "new" }));
                          setNewName((p) => ({ ...p, [o.channelSku]: p[o.channelSku] ?? o.sampleProductName ?? "" }));
                        }}
                        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium ${mode === "new" ? "border-primary bg-card text-foreground" : "border-border bg-card text-foreground"}`}
                      >
                        <PackagePlus size={13} /> Buat master baru
                      </button>
                    </div>
                  </div>

                  {mode === "existing" ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        value={mapTarget[o.channelSku] ?? ""}
                        onChange={(e) => setMapTarget((p) => ({ ...p, [o.channelSku]: e.target.value }))}
                        className="border border-border rounded-md px-3 py-1.5 text-sm outline-none max-w-[320px]"
                      >
                        <option value="">— pilih varian —</option>
                        {variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.masterProduct.name} / {v.sku} (stok {v.stock})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleMapOrphan(o)}
                        disabled={mapSaving === o.channelSku || !mapTarget[o.channelSku]}
                        className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary disabled:opacity-50"
                      >
                        {mapSaving === o.channelSku ? "Menyimpan..." : "Hubungkan & Lengkapi Pesanan Lama (Mapping + Backfill)"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={newName[o.channelSku] ?? ""}
                        onChange={(e) => setNewName((p) => ({ ...p, [o.channelSku]: e.target.value }))}
                        placeholder="Nama produk master baru"
                        className="border border-border rounded-md px-3 py-1.5 text-sm outline-none max-w-[360px]"
                      />
                      <button
                        onClick={() => handleMapOrphan(o)}
                        disabled={mapSaving === o.channelSku || !newName[o.channelSku]?.trim()}
                        className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary disabled:opacity-50"
                      >
                        {mapSaving === o.channelSku ? "Menyimpan..." : "Buat Produk Pusat & Hubungkan (Master + Mapping)"}
                      </button>
                      <span className="text-xs text-muted-foreground">Stok awal 0 — isi lewat “Sesuaikan Stok” setelah ini.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Daftar Mapping */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Boxes size={16} className="text-foreground" />
          <h2 className="font-semibold text-foreground">Daftar Hubungan Produk (Mapping) ({mappings.length})</h2>
        </div>
        {loading ? (
          <div className="p-4 md:p-8 text-center text-muted-foreground">Memuat mapping...</div>
        ) : mappings.length === 0 ? (
          <div className="p-4 md:p-8 text-center text-muted-foreground">Belum ada hubungan produk (Mapping). Pilih toko dan variasi pusat melalui formulir di atas.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="px-6 py-3">Toko</th>
                  <th className="px-6 py-3">Kode Produk di Toko (Channel SKU)</th>
                  <th className="px-6 py-3">Produk / Variasi Pusat (sku_master)</th>
                  <th className="px-6 py-3">Stok</th>
                  <th className="px-6 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-6 py-3">
                      <div className="font-medium text-foreground">{m.account?.label ?? "-"}</div>
                      <div className="text-xs text-muted-foreground">{formatPlatform(m.account?.platform ?? "")}</div>
                    </td>
                    <td className="px-6 py-3 font-mono text-foreground">{m.channelSku}</td>
                    <td className="px-6 py-3">
                      {m.variant ? (
                        <>
                          <div className="font-medium text-foreground">{m.variant.masterProduct.name}</div>
                          <div className="text-xs text-muted-foreground">varian {m.variant.sku}</div>
                        </>
                      ) : (
                        <span className="text-xs text-foreground">belum ter-mapping</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      {m.variant ? (
                        <>
                          <div className="text-foreground">{effectiveStock(m.variant)}</div>
                          {m.variant.safetyStock > 0 && (
                            <div className="text-xs text-muted-foreground">
                              total {m.variant.stock} − aman {m.variant.safetyStock}
                            </div>
                          )}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-3 text-right whitespace-nowrap">
                      {repoint[m.id] !== undefined ? (
                        <span className="inline-flex items-center gap-2">
                          <select
                            value={repoint[m.id]}
                            onChange={(e) => setRepoint((p) => ({ ...p, [m.id]: e.target.value }))}
                            className="border border-border rounded-md px-2 py-1.5 text-xs outline-none max-w-[220px]"
                          >
                            <option value="">— pilih —</option>
                            {variants.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.masterProduct.name} / {v.sku}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleRepoint(m.id, repoint[m.id])}
                            disabled={!repoint[m.id] || repointSaving === m.id}
                            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                          >
                            <Save size={14} />
                          </button>
                          <button
                            onClick={() => setRepoint((p) => { const n = { ...p }; delete n[m.id]; return n; })}
                            className="rounded-md border border-border px-2 py-1.5 text-xs text-foreground"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <button
                            onClick={() => setRepoint((p) => ({ ...p, [m.id]: variants[0]?.id ?? "" }))}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                            title="Ganti variasi pusat yang dihubungkan (Varian Target)"
                          >
                            Ganti Varian
                          </button>
                          <button
                            onClick={() => handleDelete(m.id, m.channelSku)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                          >
                            <Trash2 size={14} />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </>
      )}

      {tab === "varian" && (
        <>
      {/* Daftar Varian (sku_master) + Sesuaikan Stok */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Boxes size={16} className="text-foreground" />
          <h2 className="font-semibold text-foreground">Daftar Variasi Pusat (sku_master)</h2>
        </div>
        {stockInVariant && (
          <div className="p-6 border-b border-border bg-muted/50">
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Barang Masuk: {stockInVariant.masterProduct.name} / {stockInVariant.sku}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Stok sekarang {stockInVariant.stock}. Isi JUMLAH MASUK (bukan stok total) — stok baru
              = stok sekarang + qty, tercatat di Riwayat Stok dengan alasan STOCK_IN.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_auto] gap-3 items-end">
              <div>
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">Jumlah Masuk</label>
                <input
                  type="number"
                  min="1"
                  value={stockInForm.qty}
                  onChange={(e) => setStockInForm((f) => ({ ...f, qty: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">Catatan</label>
                <input
                  type="text"
                  value={stockInForm.note}
                  onChange={(e) => setStockInForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="mis. PO-2026-091, terima 2 lusin"
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleStockIn}
                  disabled={stockInSaving}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-60 transition-colors"
                >
                  <Save size={15} /> {stockInSaving ? "Menyimpan..." : "Catat"}
                </button>
                <button
                  onClick={() => setStockInVariant(null)}
                  className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          </div>
        )}
        {adjustVariant && (
          <div className="p-6 border-b border-border bg-muted/50">
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Sesuaikan Stok: {adjustVariant.masterProduct.name} / {adjustVariant.sku}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Stok sekarang {adjustVariant.stock} (efektif {effectiveStock(adjustVariant)}). Isi
              angka stok fisik hasil pengecekan — selisih akan dicatat otomatis di Riwayat Stok.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-3 items-end">
              <div>
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">Stok Baru</label>
                <input
                  type="number"
                  min="0"
                  value={adjustForm.newStock}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, newStock: e.target.value }))}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">Catatan</label>
                <input
                  type="text"
                  value={adjustForm.note}
                  onChange={(e) => setAdjustForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="mis. hasil stock opname gudang"
                  className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAdjust}
                  disabled={adjustSaving}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-60 transition-colors"
                >
                  <Save size={15} /> {adjustSaving ? "Menyimpan..." : "Simpan"}
                </button>
                <button
                  onClick={() => setAdjustVariant(null)}
                  className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          </div>
        )}
        {loading ? (
          <div className="p-4 md:p-8 text-center text-muted-foreground">Memuat varian...</div>
        ) : variants.length === 0 ? (
          <div className="p-4 md:p-8 text-center text-muted-foreground">Belum ada variasi stok pusat. Buat melalui Produk Master atau pilih mode variasi baru pada formulir Hubungkan Produk.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="px-6 py-3">Produk</th>
                  <th className="px-6 py-3">SKU</th>
                  <th className="px-6 py-3">Stok</th>
                  <th className="px-6 py-3">Stok Aman</th>
                  <th className="px-6 py-3">Stok Efektif</th>
                  <th className="px-6 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.id} className="border-t border-border">
                    <td className="px-6 py-3 font-medium text-foreground">{v.masterProduct.name}</td>
                    <td className="px-6 py-3 font-mono text-foreground">{v.sku}</td>
                    <td className="px-6 py-3 text-foreground">{v.stock}</td>
                    <td className="px-6 py-3 text-foreground">{v.safetyStock}</td>
                    <td className="px-6 py-3 text-foreground">{effectiveStock(v)}</td>
                    <td className="px-6 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => { setStockInVariant(v); setStockInForm({ qty: "", note: "" }); }}
                          className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                          title="Catat barang masuk (restock fisik) — +qty, bukan angka absolut"
                        >
                          <PackagePlus size={14} /> Barang Masuk
                        </button>
                        <button
                          onClick={() => openAdjust(v)}
                          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                          title="Set stok fisik hasil pengecekan"
                        >
                          <SlidersHorizontal size={14} /> Sesuaikan Stok
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </>
      )}

      {/* Riwayat Stok */}
      {tab === "riwayat" && (
        <div className="bg-card border border-border rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <History size={16} className="text-foreground" />
              <h2 className="font-semibold text-foreground">Riwayat Perubahan Stok (stock_ledger)</h2>
            </div>
            <button onClick={() => loadLedger().catch((e: unknown) => setError(e instanceof Error ? e.message : "Gagal memuat riwayat."))} className="text-xs font-medium text-foreground hover:underline">
              Muat ulang
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="px-6 py-3">Waktu</th>
                  <th className="px-6 py-3">Produk / Varian</th>
                  <th className="px-6 py-3">Perubahan</th>
                  <th className="px-6 py-3">Alasan</th>
                  <th className="px-6 py-3">Stok Setelah</th>
                  <th className="px-6 py-3">Catatan</th>
                  <th className="px-6 py-3">Oleh</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-6 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString("id-ID")}
                    </td>
                    <td className="px-6 py-3 text-foreground">
                      {e.variant ? `${e.variant.masterProduct.name} / ${e.variant.sku}` : "-"}
                    </td>
                    <td className="px-6 py-3 font-medium">
                      <span className={e.changeQty < 0 ? "text-foreground" : "text-foreground"}>
                        {e.changeQty > 0 ? "+" : ""}{e.changeQty}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-foreground">{e.reason ?? "-"}</td>
                    <td className="px-6 py-3 text-foreground">{e.stockAfter}</td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">{e.note ?? "-"}</td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">{e.user?.username ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ledger.length === 0 && (
              <div className="p-4 md:p-8 text-center text-muted-foreground">Belum ada mutasi stok.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
