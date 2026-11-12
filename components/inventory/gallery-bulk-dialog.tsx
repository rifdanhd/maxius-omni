"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorFeedback } from "@/components/ui/feedback";
import { authFetch } from "@/lib/utils/api-client";

type Result = { row: number; sku: string; ok: boolean; message: string };

export function GalleryBulkDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const rows = text.split(/\r?\n/).filter((line) => line.trim()).map((line) => { const [sku, ...url] = line.trim().split(/\s+/); return { sku, url: url.join(" ") }; });
  async function save() {
    setBusy(true); setError(null); setResults([]);
    try {
      const response = await authFetch("/api/products/gallery/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Gambar belum dapat disimpan.");
      setResults(data.results); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Gambar belum dapat disimpan."); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4" role="dialog" aria-modal="true" aria-labelledby="bulk-gallery-title"><section className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl"><h2 id="bulk-gallery-title" className="text-lg font-bold">Tambah Gambar Massal</h2><p className="mt-2 text-sm text-muted-foreground">Tempel dua kolom dari Excel: SKU pusat dan URL gambar. Satu gambar per baris, maksimal 100 baris. Gambar ditambahkan ke galeri pusat; foto utama lama tetap dipakai. Perubahan ini tidak mengirim gambar ke marketplace.</p><label className="mt-4 block text-sm font-medium">SKU pusat dan URL gambar<textarea autoFocus disabled={busy} value={text} onChange={(event) => { setText(event.target.value); setResults([]); }} placeholder={"KAOS-HITAM\thttps://contoh.com/hitam.jpg\nKAOS-PUTIH\thttps://contoh.com/putih.jpg"} className="mt-2 min-h-40 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs" /></label><p className="mt-2 text-xs text-muted-foreground">{rows.length} baris. SKU yang tidak ditemukan atau ambigu akan dilewati dan ditampilkan sebagai gagal.</p>{error && <ErrorFeedback error={error} className="mt-3" />}{results.length > 0 && <div role="status" className="mt-3 space-y-2"><p className="text-sm font-semibold">{results.filter((row) => row.ok).length} baris berhasil · {results.filter((row) => !row.ok).length} gagal</p>{results.filter((row) => !row.ok).map((row) => <p key={row.row} className="text-sm text-destructive">Baris {row.row} ({row.sku}): {row.message}</p>)}</div>}<div className="mt-4 flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Tutup</Button><Button disabled={busy || !rows.length || rows.length > 100 || results.length > 0} onClick={() => void save()}>{busy ? "Menambahkan…" : `Tambahkan ${rows.length} gambar`}</Button></div></section></div>;
}
