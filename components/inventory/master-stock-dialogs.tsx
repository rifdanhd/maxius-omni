"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/feedback";
import type { ListingStock, MasterStockRow } from "@/lib/inventory/master-stock.types";
import { allocationQuantity, type AllocationMode, type AllocationPolicy } from "@/lib/services/stock-allocation.policy";
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

type AllocationScope = "selection" | "variant" | "store" | "inherit";

const MODE_HINT: Record<AllocationMode, string> = {
  FULL: "Setiap listing menampilkan Bisa Dijual penuh. Berisiko oversell bila SKU dipakai di banyak listing.",
  EQUAL: "Bisa Dijual dibagi jumlah listing SKU ini, dibulatkan ke bawah — total antar listing mendekati stok.",
  PERCENT: "Persentase dari Bisa Dijual setelah buffer. Pakai bila ingin menyisakan ruang untuk toko lain.",
  FIXED: "Batas maksimum unit untuk listing ini, tidak pernah melebihi Bisa Dijual.",
};

export function AllocationDialog({ row, listings, onClose, onSaved }: {
  row: MasterStockRow; listings: ListingStock[]; onClose: () => void; onSaved: () => void;
}) {
  const primary = listings[0];
  const [mode, setMode] = useState<AllocationMode>(listings[0]?.allocation.mode ?? "FULL");
  const [value, setValue] = useState(String(listings[0]?.allocation.value ?? 100));
  const [buffer, setBuffer] = useState(String(listings[0]?.allocation.buffer ?? 0));
  const [scope, setScope] = useState<AllocationScope>("selection");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policy: AllocationPolicy = { mode, value: Number(value || 0), buffer: Number(buffer || 0) };
  let preview: number | null = null;
  try {
    preview = allocationQuantity(row.available, policy, row.listings.length);
  } catch {
    preview = null;
  }

  const selectedIds = new Set(listings.map((listing) => listing.id));
  const targetedIds = new Set(
    scope === "variant" ? row.listings.map((listing) => listing.id)
      : scope === "store" ? row.listings.filter((listing) => listing.accountId === primary?.accountId && listing.inheritsAllocation).map((listing) => listing.id)
        : listings.map((listing) => listing.id)
  );
  const planned = row.listings.map((listing) => ({
    id: listing.id,
    quantity: scope === "inherit" ? listing.quantity : targetedIds.has(listing.id) ? preview ?? listing.quantity : listing.quantity,
  }));
  const thisTotal = planned.filter((item) => selectedIds.has(item.id)).reduce((sum, item) => sum + item.quantity, 0);
  const otherTotal = planned.filter((item) => !selectedIds.has(item.id)).reduce((sum, item) => sum + item.quantity, 0);
  const total = thisTotal + otherTotal;
  const overstack = total > row.available;
  const quantity = planned.find((item) => item.id === primary?.id)?.quantity ?? 0;
  const scopeCount = scope === "variant" ? row.listings.length : listings.length;

  async function save() {
    if (!primary || preview === null) return;
    setSaving(true); setError(null);
    try {
      if (scope === "store") {
        await inventoryRequest({ action: "allocation", accountId: primary.accountId, mode, value: Number(value), buffer: Number(buffer) });
      } else if (scope === "inherit") {
        for (const listing of listings) await inventoryRequest({ action: "allocation-inherit", listingId: listing.id });
      } else {
        const targets = scope === "variant" ? row.listings : listings;
        for (const listing of targets) {
          await inventoryRequest({ action: "allocation", listingId: listing.id, mode, value: Number(value), buffer: Number(buffer) });
        }
      }
      onSaved(); onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menyimpan alokasi.");
    } finally {
      setSaving(false); setConfirmOpen(false);
    }
  }

  if (!primary) return null;

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Alokasi stok · {listings.length > 1 ? `${listings.length} listing dipilih` : primary.store}
            </DialogTitle>
            <DialogDescription>
              {row.sku} · {listings.length > 1 ? listingSummary(listings) : "Atur berapa unit yang dikirim ke listing ini."}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            if (preview === null) { setError("Angka alokasi atau buffer tidak valid."); return; }
            if (overstack && !confirmOpen) { setConfirmOpen(true); return; }
            void save();
          }}>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Berlaku untuk</legend>
              <RadioOption
                name="scope" checked={scope === "selection"} disabled={saving}
                onChange={() => setScope("selection")}
                title={listings.length > 1 ? `Hanya ${listings.length} listing yang dipilih` : "Hanya listing ini"}
                description="Aturan hanya mengubah listing yang dipilih, listing lain tidak tersentuh."
              />
              <RadioOption
                name="scope" checked={scope === "variant"} disabled={saving}
                onChange={() => setScope("variant")}
                title={`Semua listing SKU ini (${row.listings.length})`}
                description="Berlaku untuk seluruh listing SKU ini di semua toko, termasuk yang belum dipilih."
              />
              <RadioOption
                name="scope" checked={scope === "store"} disabled={saving}
                onChange={() => setScope("store")}
                title="Default toko"
                description={`Berlaku untuk SKU lain di toko ${primary.store} yang mengikuti default.`}
              />
              <RadioOption
                name="scope" checked={scope === "inherit"} disabled={saving}
                onChange={() => setScope("inherit")}
                title="Ikuti default toko"
                description="Hapus aturan khusus listing yang dipilih dan kembali ke default toko."
              />
            </fieldset>

            <div>
              <label className="block text-sm" htmlFor="allocation-mode">Aturan alokasi</label>
              <select
                id="allocation-mode"
                className={inputClass}
                value={mode}
                disabled={saving || scope === "inherit"}
                onChange={(event) => setMode(event.target.value as AllocationMode)}
              >
                <option value="FULL">Stok tampil penuh (100%)</option>
                <option value="EQUAL">Bagi rata antar listing</option>
                <option value="PERCENT">Persentase</option>
                <option value="FIXED">Jumlah tetap</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">{MODE_HINT[mode]}</p>
            </div>

            {(mode === "PERCENT" || mode === "FIXED") && (
              <label className="block text-sm">
                {mode === "PERCENT" ? "Persentase (%)" : "Batas jumlah (unit)"}
                <input required disabled={saving || scope === "inherit"} type="number" min="0"
                  max={mode === "PERCENT" ? 100 : 2147483647} step="1" className={inputClass}
                  value={value} onChange={(event) => setValue(event.target.value)} />
                <span className="mt-1 block text-xs text-muted-foreground">
                  {mode === "PERCENT" ? "0–100% dari Bisa Dijual setelah buffer." : "Tidak pernah melebihi Bisa Dijual setelah buffer."}
                </span>
              </label>
            )}

            <label className="block text-sm">
              Buffer pengaman listing (unit)
              <input required disabled={saving || scope === "inherit"} type="number" min="0" step="1"
                className={inputClass} value={buffer} onChange={(event) => setBuffer(event.target.value)} />
              <span className="mt-1 block text-xs text-muted-foreground">Unit yang disisihkan sebagai cadangan, mis. 5.</span>
            </label>

            {scope === "store" && !primary.inheritsAllocation && (
              <p className="text-xs text-muted-foreground">
                Listing ini punya aturan khusus dan tetap memakainya. Default baru berlaku untuk SKU toko yang mengikuti default.
              </p>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border bg-muted/50 p-3 text-sm tabular-nums">
              <dt className="text-muted-foreground">Stok fisik</dt>
              <dd className="text-right font-medium">{numberFormat(row.stock)}</dd>
              <dt className="text-muted-foreground">Disisihkan gudang</dt>
              <dd className="text-right">{numberFormat(row.safetyStock)}</dd>
              <dt className="text-muted-foreground">Bisa Dijual</dt>
              <dd className="text-right font-medium">{numberFormat(row.available)}</dd>
              <dt className="border-t border-border pt-1 text-muted-foreground">
                {listings.length > 1 ? `${listings.length} listing dipilih` : "Listing ini"}
              </dt>
              <dd className="border-t border-border pt-1 text-right">{numberFormat(thisTotal)}</dd>
              <dt className="text-muted-foreground">Listing lain ({row.listings.length - listings.length})</dt>
              <dd className="text-right">{numberFormat(otherTotal)}</dd>
              <dt className={`font-medium ${overstack ? "text-destructive" : "text-foreground"}`}>
                Total dialokasikan {overstack && <span aria-hidden="true">⚠</span>}
              </dt>
              <dd className={`text-right font-semibold ${overstack ? "text-destructive" : "text-foreground"}`}>{numberFormat(total)}</dd>
            </dl>

            <p className="text-xs text-muted-foreground">
              Hasil untuk {listings.length > 1 ? "listing utama" : "listing ini"}: <strong className="text-foreground">{numberFormat(quantity)}</strong> unit dikirim
              {scope !== "selection" && ` · berlaku untuk ${numberFormat(scopeCount)} listing`}.
            </p>

            {overstack && (
              <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="tabular-nums">
                  Total alokasi {numberFormat(total)} &gt; Bisa Dijual {numberFormat(row.available)} — oversell berisiko bila beberapa toko menerima pesanan bersamaan.
                </p>
                <Button type="button" size="sm" variant="outline" onClick={() => setMode("EQUAL")}>
                  Bagi rata otomatis
                </Button>
              </div>
            )}

            <FormError>{error}</FormError>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Batal</Button>
              <Button type="submit" disabled={saving || preview === null}
                className={overstack ? "bg-warning text-background shadow-xs hover:bg-warning/90" : undefined}>
                {saving ? "Menyimpan…" : overstack ? "Simpan tetap" : "Simpan alokasi"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open) setConfirmOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Simpan alokasi yang berisiko oversell?</AlertDialogTitle>
            <AlertDialogDescription>
              Total alokasi {numberFormat(total)} melebihi Bisa Dijual {numberFormat(row.available)}. Bila semua toko menerima pesanan bersamaan, stok bisa terjual lebih dari yang tersedia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Periksa lagi</AlertDialogCancel>
            <AlertDialogAction
              className="bg-warning text-background hover:bg-warning/90"
              onClick={(event) => { event.preventDefault(); void save(); }}
            >
              Ya, simpan tetap
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RadioOption({ name, checked, disabled, onChange, title, description }: {
  name: string; checked: boolean; disabled: boolean; onChange: () => void; title: string; description: string;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${checked ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      <input type="radio" name={name} className="mt-1 size-4 accent-primary" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function listingSummary(listings: ListingStock[]) {
  const stores = [...new Set(listings.map((listing) => listing.store))];
  return stores.length === 1
    ? `${stores[0]} · ${listings.length} listing`
    : `${stores.length} toko · ${listings.length} listing`;
}
