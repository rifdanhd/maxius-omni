"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, ImageIcon, Link2, Search, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-action";
import { notify } from "@/components/ui/notify";
import { authFetch } from "@/lib/utils/api-client";

export type StoreMappingVariant = {
  id: string; sku: string; name?: string | null; stock: number; safetyStock: number;
  masterProduct: { id: string; name: string; imageUrl?: string | null };
};
export type StoreMappingRow = {
  id: string; channelSku: string; sellerSku?: string | null; platformTitle?: string | null;
  imageUrl?: string | null; platformStatus?: string | null; updatedAt?: string;
  /** Atribut varian marketplace (mis. "Biru, XL") — pembeda saat SKU penjual sama. */
  attributes?: string | null;
  account: { id: string; label: string; platform: string } | null;
  variant: StoreMappingVariant | null;
};
type StoreRow = { id: string; name: string; platform: string };
type Status = "split" | "missing" | "unlinked" | "linked" | "single";
type Group = { key: string; sellerSku: string | null; rows: StoreMappingRow[]; status: Status };
const labels: Record<Status, string> = {
  split: "Pusat masih terpisah", missing: "SKU penjual kosong", unlinked: "Belum lengkap", linked: "Sudah satu pusat", single: "Satu toko",
};
const field = "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm";

function groupListings(rows: StoreMappingRow[]): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const sellerSku = row.sellerSku?.trim().toUpperCase() || null;
    const key = sellerSku ? `sku:${sellerSku}` : `missing:${row.id}`;
    const group = groups.get(key) ?? { key, sellerSku, rows: [], status: "single" };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const centers = new Set(group.rows.flatMap((row) => row.variant ? [row.variant.id] : []));
    const stores = new Set(group.rows.map((row) => row.account?.id));
    group.status = !group.sellerSku ? "missing" : centers.size > 1 ? "split"
      : group.rows.some((row) => !row.variant) ? "unlinked" : stores.size > 1 ? "linked" : "single";
    return group;
  }).sort((a, b) => (a.sellerSku ?? a.rows[0]?.platformTitle ?? "").localeCompare(b.sellerSku ?? b.rows[0]?.platformTitle ?? ""));
}

function MappingReview({ group, stores, variants, onSaved }: {
  group: Group; stores: StoreRow[]; variants: StoreMappingVariant[]; onSaved: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [targetId, setTargetId] = useState("");
  const [query, setQuery] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const target = variants.find((variant) => variant.id === targetId);
  const chosen = group.rows.filter((row) => selected.includes(row.id));
  const moving = chosen.filter((row) => row.variant?.id !== targetId);
  const currentIds = new Set(group.rows.flatMap((row) => row.variant ? [row.variant.id] : []));
  const available = variants.filter((variant) => [variant.sku, variant.name, variant.masterProduct.name].some((value) => value?.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => Number(currentIds.has(b.id)) - Number(currentIds.has(a.id)));
  const visibleStores = stores.filter((store) => ["TIKTOK_SHOP", "SHOPEE", "TOKOPEDIA"].includes(store.platform) || group.rows.some((row) => row.account?.id === store.id));
  for (const row of group.rows) {
    if (row.account && !visibleStores.some((store) => store.id === row.account!.id)) visibleStores.push({ id: row.account.id, name: row.account.label, platform: row.account.platform });
  }

  async function save() {
    if (!target || !acknowledge || !moving.length || chosen.length > 250 || saving) return;
    const preview = moving.map((row) => `${row.account?.label ?? "Toko"} · ${row.sellerSku || row.channelSku}: ${row.variant?.sku ?? "belum terhubung"} → ${target.sku}`).join("\n");
    if (!await confirmAction(`${preview}\n\n${moving.length} listing akan memakai ${target.masterProduct.name} / ${target.sku} untuk pesanan berikutnya. Stok sumber dan pusat tidak dijumlahkan atau ditimpa. Pesanan lama tetap utuh. Penyimpanan ini tidak mengirim stok ke marketplace.`, { title: "Simpan hubungan produk?", confirmText: "Simpan hubungan" })) return;
    setSaving(true); setMessage(null);
    try {
      const response = await authFetch("/api/inventory/mappings/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerSku: group.sellerSku, variantId: target.id, acknowledge,
          listings: chosen.map((row) => ({ id: row.id, variantId: row.variant?.id ?? null, updatedAt: row.updatedAt })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Hubungan belum tersimpan.");
      notify("success", `${result.updated} hubungan tersimpan. Jumlah stok dan pesanan lama tidak diubah.`);
      setSelected([]); setAcknowledge(false);
      setMessage(`${result.updated} hubungan tersimpan. Jumlah stok tidak diubah.`);
      try { await onSaved(); } catch { setMessage("Hubungan tersimpan. Muat ulang halaman untuk melihat data terbaru."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Penyimpanan gagal."); }
    finally { setSaving(false); }
  }

  return <div className="space-y-5 border-t border-border bg-muted/20 p-3 sm:p-5">
    <div className="space-y-1"><h3 className="text-sm font-semibold">1. Bandingkan dan pilih listing</h3><p className="text-xs leading-relaxed text-muted-foreground">Centang barang yang sama. Detail warna, ukuran, dan isi paket marketplace belum tersimpan di mapping; periksa listing asli di toko sebelum memilih.</p></div>
    <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {visibleStores.map((store) => {
        const rows = group.rows.filter((row) => row.account?.id === store.id);
        return <section key={store.id} className="min-w-0 rounded-xl border border-border bg-card">
          <h4 className="flex items-center gap-2 border-b border-border px-3 py-3 text-sm font-semibold"><Store className="size-4 shrink-0" />{store.name}</h4>
          {!rows.length ? <p className="p-3 text-xs leading-relaxed text-muted-foreground">Belum ditemukan SKU penjual ini di data toko. Ini belum memastikan barangnya tidak dijual di toko tersebut.</p> :
            <div className="max-h-96 space-y-3 overflow-y-auto p-3">{rows.map((row) => <label key={row.id} className={`block cursor-pointer rounded-lg border p-3 ${selected.includes(row.id) ? "border-primary bg-primary/5" : "border-border"}`}>
              <div className="flex items-start gap-2">
                <input type="checkbox" aria-label={`Pilih ${store.name} ${row.channelSku}`} checked={selected.includes(row.id)} disabled={saving || !row.updatedAt}
                  onChange={(event) => { setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id)); setAcknowledge(false); }} className="mt-1 size-4 shrink-0 accent-primary" />
                <div className="min-w-0 flex-1">
                  {row.imageUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={row.imageUrl} alt="" loading="lazy" className="mb-2 size-16 rounded-lg bg-muted object-cover" />
                    : <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><ImageIcon className="size-5 shrink-0" />Foto toko belum tersedia</div>}
                  <p className="break-words text-sm font-medium">{row.platformTitle || row.variant?.masterProduct.name || "Nama produk belum tersedia"}</p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">SKU penjual: <strong className="text-foreground">{row.sellerSku || "Belum tersimpan"}</strong></p>
                  {row.attributes && <p className="mt-1 break-words text-xs text-muted-foreground">Atribut: <strong className="text-foreground">{row.attributes}</strong></p>}
                  <p className="mt-1 break-words text-xs text-muted-foreground">Varian pusat: {row.variant?.name || row.variant?.sku || "Belum terhubung"}</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">SKU pusat: {row.variant?.sku || "—"}</p>
                  <details className="mt-2 text-xs text-muted-foreground"><summary>Detail marketplace</summary><p className="mt-1 break-all">ID SKU: {row.channelSku}</p><p>Status: {row.platformStatus || "Belum diketahui"}</p></details>
                </div>
              </div>
            </label>)}</div>}
        </section>;
      })}
    </div>
    <div className="grid gap-4 rounded-xl border border-border bg-card p-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <h4 className="text-sm font-semibold">2. Pilih satu varian pusat</h4>
        <input className={field} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama produk, varian, atau SKU pusat" aria-label="Cari varian pusat antar toko" />
        <select className={field} aria-label="Varian pusat tujuan" value={targetId} disabled={saving} onChange={(event) => { setTargetId(event.target.value); setAcknowledge(false); }}>
          <option value="">Pilih varian pusat…</option>
          {available.map((variant) => <option key={variant.id} value={variant.id}>{currentIds.has(variant.id) ? "Saat ini · " : ""}{variant.masterProduct.name} / {variant.name || variant.sku} · {variant.sku}</option>)}
          {target && !available.some((variant) => variant.id === target.id) && <option value={target.id}>{target.masterProduct.name} / {target.sku}</option>}
        </select>
        {target && <p className="rounded-lg bg-muted p-3 text-sm leading-relaxed"><strong>{target.masterProduct.name} / {target.sku}</strong><br />Stok fisik pusat tetap {target.stock.toLocaleString("id-ID")}, cadangan {target.safetyStock.toLocaleString("id-ID")}. Pilihan ini tidak membuktikan jumlah stok fisik sudah benar.</p>}
      </div>
      <div className="min-w-0 space-y-3">
        <h4 className="text-sm font-semibold">3. Tinjau sebelum disimpan</h4>
        <p className="text-sm text-muted-foreground">{chosen.length} listing dipilih · {target ? moving.length : 0} hubungan akan berubah.</p>
        {target && chosen.length > 0 && <ul aria-label="Preview perubahan hubungan" className="max-h-48 space-y-2 overflow-y-auto text-xs">{chosen.map((row) => <li key={row.id} className="break-words rounded-lg bg-muted p-2"><strong>{row.account?.label}</strong> · {row.sellerSku || row.channelSku}{row.attributes ? ` · ${row.attributes}` : ""}<br />{row.variant?.sku || "Belum terhubung"} → {target.sku}{row.variant?.id === target.id ? " (tetap)" : ""}</li>)}</ul>}
        <label className="flex items-start gap-2 text-sm leading-relaxed"><input type="checkbox" checked={acknowledge} disabled={saving || !chosen.length || !target} onChange={(event) => setAcknowledge(event.target.checked)} className="mt-1 size-4 shrink-0 accent-primary" />Saya sudah memeriksa barang, warna, ukuran, dan isi paket pada listing yang dipilih.</label>
        <p className="text-xs leading-relaxed text-muted-foreground">Jumlah stok dan pesanan lama tidak diubah. Pengiriman stok ke marketplace tetap mengikuti pengaturan sinkronisasi saat ada perubahan stok berikutnya.</p>
        {chosen.length > 250 && <p role="alert" className="text-sm text-destructive">Pilih maksimal 250 listing per penyimpanan.</p>}
        <Button disabled={saving || !target || !acknowledge || !moving.length || chosen.length > 250} onClick={() => void save()} className="w-full sm:w-auto"><Link2 className="size-4" />{saving ? "Menyimpan…" : "Tinjau & simpan hubungan"}</Button>
        {message && <p role="status" className="rounded-lg border border-border bg-muted p-3 text-sm leading-relaxed">{message}</p>}
      </div>
    </div>
  </div>;
}

export function StoreMappingPanel({ mappings, stores, variants, onSaved }: {
  mappings: StoreMappingRow[]; stores: StoreRow[]; variants: StoreMappingVariant[]; onSaved: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<Status | "all">("split");
  const [query, setQuery] = useState("");
  const [storeId, setStoreId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);
  const groups = useMemo(() => groupListings(mappings), [mappings]);
  const counts = groups.reduce((result, group) => { result[group.status]++; return result; }, { split: 0, missing: 0, unlinked: 0, linked: 0, single: 0 });
  const search = query.trim().toLowerCase();
  const visible = groups.filter((group) => (filter === "all" || group.status === filter)
    && (!storeId || group.rows.some((row) => row.account?.id === storeId))
    && (!search || [group.sellerSku, ...group.rows.flatMap((row) => [row.platformTitle, row.channelSku, row.account?.label, row.variant?.sku, row.variant?.masterProduct.name])].some((value) => value?.toLowerCase().includes(search))));

  return <section aria-label="Satukan produk antar toko" className="min-w-0 space-y-4">
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-semibold">Satukan produk antar toko</h2>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">Bandingkan listing dengan SKU penjual yang sama, lalu pilih satu varian pusat. Jumlah stok tidak digabung.</p>
      <details className="mt-2 text-xs leading-relaxed text-muted-foreground"><summary className="cursor-pointer">Contoh dan cara pengelompokan</summary><p className="mt-2">Contoh: GRIP-RAKET di dua toko mengarah ke pusat berbeda. Periksa barang dan variannya, centang listing yang sama, lalu pilih pusat yang benar. Huruf besar/kecil dan spasi di ujung SKU diabaikan saat pengelompokan; data SKU asli tetap utuh.</p></details>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Filter kelompok SKU">
        {(["split", "missing", "unlinked", "linked", "single", "all"] as const).map((status) => <button type="button" key={status} aria-pressed={filter === status} onClick={() => { setFilter(status); setLimit(25); setExpanded(null); }} className={`rounded-lg border px-3 py-2 text-xs font-medium ${filter === status ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>
          {status === "all" ? "Semua" : labels[status]} <span className="ml-1 tabular-nums">{status === "all" ? groups.length : counts[status]}</span>
        </button>)}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <label className="relative min-w-0"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><input className={`${field} pl-9`} aria-label="Cari SKU penjual antar toko" placeholder="Cari SKU penjual atau nama produk…" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(25); }} /></label>
        <select className={field} aria-label="Kelompok yang ada di toko" value={storeId} onChange={(event) => { setStoreId(event.target.value); setLimit(25); }}><option value="">Semua toko</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">SKU kosong diperiksa per listing. Filter toko tetap menampilkan pasangan dari toko lain.</p>
    </div>
    {!visible.length && <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Tidak ada kelompok pada filter ini. Pilih filter lain atau ubah pencarian.</p>}
    {visible.slice(0, limit).map((group) => <article key={group.key} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <button type="button" aria-expanded={expanded === group.key} className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setExpanded((current) => current === group.key ? null : group.key)}>
        {group.status === "linked" ? <Check className="size-5 shrink-0 text-primary" /> : <AlertTriangle className="size-5 shrink-0 text-warning" />}
        <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{group.sellerSku || group.rows[0]?.platformTitle || "Listing tanpa SKU penjual"}</span><span className="mt-1 block text-xs text-muted-foreground">{labels[group.status]} · {group.rows.length} listing · {new Set(group.rows.map((row) => row.account?.id)).size} toko · {new Set(group.rows.flatMap((row) => row.variant ? [row.variant.id] : [])).size} varian pusat</span></span>
        <ChevronRight className={`size-4 shrink-0 transition-transform ${expanded === group.key ? "rotate-90" : ""}`} />
      </button>
      {expanded === group.key && <MappingReview key={group.key} group={group} stores={stores} variants={variants} onSaved={onSaved} />}
    </article>)}
    {visible.length > limit && <Button variant="outline" onClick={() => setLimit((value) => value + 25)}>Tampilkan 25 kelompok berikutnya</Button>}
  </section>;
}
