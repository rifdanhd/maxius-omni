"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/feedback";
import type { ListingStock, MasterStockRow } from "@/lib/inventory/master-stock.types";
import { allocationQuantity, type AllocationMode } from "@/lib/services/stock-allocation.policy";
import { authFetch } from "@/lib/utils/api-client";

export const numberFormat = (value: number) => value.toLocaleString("id-ID");
export const inputClass = "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
export async function inventoryRequest<T>(body: unknown): Promise<T> {
  const response = await authFetch("/api/inventory/master-stock", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Perubahan belum berhasil disimpan.");
  return result as T;
}

export function StockChangeDialog({ rows, warehouses, onClose, onSaved }: {
  rows: MasterStockRow[]; warehouses: Array<{ id: string; name: string; isDefault?: boolean }>; onClose: () => void; onSaved: () => void;
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses.find((warehouse) => warehouse.isDefault)?.id ?? warehouses[0]?.id ?? "");
  const [kind, setKind] = useState<"IN" | "OUT" | "COUNT" | "CORRECTION">("CORRECTION");
  const [quantity, setQuantity] = useState(rows.length === 1 ? String(rows[0].warehouses.find((item) => item.id === warehouseId)?.stock ?? 0) : "");
  const [reserved, setReserved] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const stores = new Set(rows.flatMap((row) => row.listings.map((listing) => listing.accountId))).size;
  const listings = rows.reduce((sum, row) => sum + row.listings.length, 0);
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader><DialogTitle>Ubah stok {rows.length > 1 ? `${rows.length} SKU master` : rows[0]?.sku}</DialogTitle>
        <DialogDescription>Perubahan dicatat di Riwayat Inventori. Stok di gudang lain tetap disimpan.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault(); setSaving(true); setError(null);
        try {
          const qty = Number(quantity);
          if (!quantity.trim() || !Number.isInteger(qty) || qty < 0 || (["IN", "OUT"].includes(kind) && qty === 0)) throw new Error("Masukkan jumlah bulat yang sesuai jenis perubahan.");
          if (reserved.trim() && (!Number.isInteger(Number(reserved)) || Number(reserved) < 0)) throw new Error("Disisihkan harus angka bulat minimal nol.");
          await inventoryRequest({ action: "change", changes: rows.map((row) => ({ variantId: row.id, expectedVersion: row.version,
            warehouseId, kind, quantity: qty, reason, note, requestId,
            ...(reserved.trim() ? { safetyStock: Number(reserved) } : {}) })) });
          onSaved(); onClose();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Gagal menyimpan stok."); }
        finally { setSaving(false); }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Gudang<select required disabled={saving} className={inputClass} value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <label className="text-sm">Jenis perubahan<select disabled={saving} className={inputClass} value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setQuantity(""); }}>
            <option value="IN">Barang masuk (+)</option><option value="OUT">Barang keluar (−)</option><option value="COUNT">Opname (hasil hitung)</option><option value="CORRECTION">Koreksi (angka akhir)</option></select></label>
          <label className="text-sm">{kind === "IN" || kind === "OUT" ? "Jumlah barang" : "Stok fisik akhir"}<input required disabled={saving} type="number" min={kind === "IN" || kind === "OUT" ? 1 : 0} step="1" className={inputClass} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
          <label className="text-sm">Disisihkan di gudang ini<input disabled={saving} type="number" min="0" step="1" placeholder="Tetap seperti sebelumnya" className={inputClass} value={reserved} onChange={(event) => setReserved(event.target.value)} /></label>
        </div>
        <label className="block text-sm">Alasan wajib<input required disabled={saving} maxLength={120} className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Contoh: hasil hitung gudang hari ini" /></label>
        <label className="block text-sm">Catatan<textarea disabled={saving} maxLength={1000} className={`${inputClass} h-20 py-2`} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <div className="rounded-lg border bg-muted/50 p-3 text-sm" role="status">
          <p className="font-medium">Akan dikirim ke {listings} listing di {stores} toko.</p>
          {rows.slice(0, 3).map((row) => {
            const balance = row.warehouses.find((item) => item.id === warehouseId);
            const after = kind === "IN" ? (balance?.stock ?? 0) + Number(quantity || 0) : kind === "OUT" ? (balance?.stock ?? 0) - Number(quantity || 0) : Number(quantity || 0);
            const total = row.stock - (balance?.stock ?? 0) + after;
            const safety = row.safetyStock - (balance?.safetyStock ?? 0) + (reserved.trim() ? Number(reserved) : balance?.safetyStock ?? 0);
            return <p key={row.id} className="mt-1 tabular-nums">{row.sku}: di gudang {numberFormat(total)} − disisihkan {numberFormat(safety)} = bisa dijual {numberFormat(Math.max(0, total - safety))}</p>;
          })}
        </div>
        <FormError>{error}</FormError>
        <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Batal</Button><Button type="submit" disabled={saving || !warehouseId || !reason.trim()}>{saving ? "Menyimpan…" : "Simpan perubahan"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function AllocationDialog({ row, listing, onClose, onSaved }: {
  row: MasterStockRow; listing: ListingStock; onClose: () => void; onSaved: () => void;
}) {
  const [mode, setMode] = useState<AllocationMode>(listing.allocation.mode);
  const [value, setValue] = useState(String(listing.allocation.value));
  const [buffer, setBuffer] = useState(String(listing.allocation.buffer));
  const [scope, setScope] = useState("listing");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const planned = row.listings.map((item) => {
    const affected = scope === "store" ? item.accountId === listing.accountId && item.inheritsAllocation : item.id === listing.id;
    const policy = scope === "inherit" ? listing.defaultAllocation : { mode, value: Number(value || 0), buffer: Number(buffer || 0) };
    return { id: item.id, quantity: affected ? allocationQuantity(row.available, policy, row.listings.length) : item.quantity };
  });
  const quantity = planned.find((item) => item.id === listing.id)?.quantity ?? listing.quantity;
  const total = planned.reduce((sum, item) => sum + item.quantity, 0);
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>Alokasi stok · {listing.store}</DialogTitle><DialogDescription>{row.sku} · Buffer listing dikurangi setelah Disisihkan gudang.</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault(); setSaving(true); setError(null);
      try {
        await inventoryRequest(scope === "inherit" ? { action: "allocation-inherit", listingId: listing.id }
          : { action: "allocation", ...(scope === "store" ? { accountId: listing.accountId } : { listingId: listing.id }), mode, value: Number(value), buffer: Number(buffer) });
        onSaved(); onClose();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Gagal menyimpan alokasi."); } finally { setSaving(false); }
    }}>
      <label className="block text-sm">Berlaku untuk<select className={inputClass} value={scope} disabled={saving} onChange={(event) => {
        const next = event.target.value; setScope(next);
        const policy = next === "listing" ? listing.allocation : listing.defaultAllocation;
        setMode(policy.mode); setValue(String(policy.value)); setBuffer(String(policy.buffer));
      }}><option value="listing">SKU dan listing ini</option><option value="store">Default toko (semua SKU tanpa pengaturan khusus)</option><option value="inherit">Listing ini mengikuti default toko</option></select></label>
      <label className="block text-sm">Aturan alokasi<select className={inputClass} value={mode} disabled={saving || scope === "inherit"} onChange={(event) => setMode(event.target.value as AllocationMode)}><option value="FULL">Stok tampil penuh</option><option value="PERCENT">Persentase</option><option value="FIXED">Jumlah tetap</option><option value="EQUAL">Bagi rata antar listing</option></select></label>
      {(mode === "PERCENT" || mode === "FIXED") && <label className="block text-sm">{mode === "PERCENT" ? "Persentase (%)" : "Batas jumlah"}<input required type="number" min="0" max={mode === "PERCENT" ? 100 : 2147483647} step="1" className={inputClass} value={value} onChange={(event) => setValue(event.target.value)} /></label>}
      <label className="block text-sm">Buffer pengaman listing<input required disabled={saving || scope === "inherit"} type="number" min="0" step="1" className={inputClass} value={buffer} onChange={(event) => setBuffer(event.target.value)} /></label>
      {scope === "store" && !listing.inheritsAllocation && <p className="text-xs text-muted-foreground">Listing ini mempunyai aturan khusus dan tetap memakai aturan tersebut. Default baru berlaku untuk SKU toko yang mengikuti default.</p>}
      <div role="status" className="rounded-md bg-muted p-3 text-sm tabular-nums">Bisa Dijual {numberFormat(row.available)} − buffer {numberFormat(Number(buffer || 0))}; hasil alokasi = <strong>{numberFormat(quantity)}</strong> unit.</div>
      {total > row.available && <p role="alert" className="text-sm text-warning">Total alokasi {numberFormat(total)} melebihi Bisa Dijual {numberFormat(row.available)}. Ada risiko oversell bila beberapa toko menerima pesanan bersamaan.</p>}
      <FormError>{error}</FormError><DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Batal</Button><Button disabled={saving} type="submit">{saving ? "Menyimpan…" : "Simpan alokasi"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
