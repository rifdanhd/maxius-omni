"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/feedback";
import { authFetch } from "@/lib/utils/api-client";
import type { StockImportPreview } from "@/lib/services/master-stock-spreadsheet.service";
import { inputClass, inventoryRequest, numberFormat as fmt } from "@/components/inventory/master-stock-dialogs";

export function StockImportDialog({ warehouses, onClose, onSaved }: {
  warehouses: Array<{ id: string; name: string; isDefault?: boolean }>; onClose: () => void; onSaved: () => void;
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses.find((warehouse) => warehouse.isDefault)?.id ?? warehouses[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<StockImportPreview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle>Impor stok SKU master</DialogTitle><DialogDescription>Gunakan file ekspor Excel sebagai template. Pratinjau tidak mengubah stok. Semua perubahan dicatat di Riwayat Inventori.</DialogDescription></DialogHeader>
    <div className="space-y-3"><label className="block text-sm">Gudang<select disabled={busy || completed > 0} className={inputClass} value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setRows(null); }}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label className="block text-sm">File Excel<input type="file" accept=".xlsx" disabled={busy || completed > 0} className={`${inputClass} py-2`} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setRows(null); }} /></label>
      {!rows && <Button variant="outline" disabled={busy || !file || !warehouseId} onClick={async () => {
        if (!file) return; setBusy(true); setError(null);
        try {
          const form = new FormData(); form.set("file", file); form.set("warehouseId", warehouseId);
          const response = await authFetch("/api/inventory/master-stock/spreadsheet", { method: "POST", body: form });
          const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "File belum dapat dibaca."); setRows(result.rows);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "File belum dapat dibaca."); } finally { setBusy(false); }
      }}>{busy ? "Membaca file…" : "Pratinjau impor"}</Button>}
      {rows && <><div className="max-h-56 overflow-auto rounded-md border"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">SKU</th><th className="p-2 text-right">Sebelum</th><th className="p-2 text-right">Sesudah</th></tr></thead><tbody>{rows.slice(0, 30).map((row) => <tr key={row.variantId} className="border-t"><td className="p-2 font-mono text-xs">{row.sku}</td><td className="p-2 text-right tabular-nums">{fmt(row.before)}</td><td className="p-2 text-right tabular-nums">{fmt(row.quantity)}</td></tr>)}</tbody></table></div><p className="text-sm">{fmt(rows.length)} SKU · Akan dikirim ke {fmt(rows.reduce((sum, row) => sum + row.listings, 0))} listing di {new Set(rows.flatMap((row) => row.storeIds)).size} toko. {rows.length > 30 ? "Pratinjau menampilkan 30 baris pertama." : ""}</p>
      <label className="block text-sm">Alasan wajib<input required disabled={busy || completed > 0} maxLength={120} className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} /></label></>}
      {(busy || completed > 0) && rows && <p role="status" className="text-sm tabular-nums">{fmt(completed)} dari {fmt(rows.length)} SKU tersimpan. Impor disimpan per kelompok maksimal 200 SKU.</p>}
      <FormError>{error}</FormError>
    </div><DialogFooter><Button variant="outline" disabled={busy} onClick={() => { if (completed) onSaved(); onClose(); }}>Tutup</Button>{rows && <Button disabled={busy || !rows.length || !reason.trim() || completed === rows.length} onClick={async () => {
      setBusy(true); setError(null);
      try {
        for (let start = completed; start < rows.length; start += 200) {
          await inventoryRequest({ action: "change", changes: rows.slice(start, start + 200).map((row) => ({
            variantId: row.variantId, expectedVersion: row.expectedVersion, warehouseId: row.warehouseId, kind: row.kind,
            quantity: row.quantity, ...(row.safetyStock !== undefined ? { safetyStock: row.safetyStock } : {}), reason, requestId,
          })) });
          setCompleted(Math.min(start + 200, rows.length));
        }
        onSaved(); onClose();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Impor belum selesai. Baris yang sudah tersimpan tetap tercatat; periksa status sebelum melanjutkan."); } finally { setBusy(false); }
    }}>{busy ? "Menyimpan…" : completed ? "Lanjutkan impor" : "Simpan hasil impor"}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
