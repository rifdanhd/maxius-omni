"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/utils/api-client";
import { Button } from "@/components/ui/button";
import { ErrorFeedback } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status-badge";

type ReviewData = { total: number; reviews: Array<{ id: string; sellerSku: string; reason: string; candidateIds: string[] }>;
  candidates: Array<{ id: string; sku: string; stock: number; safetyStock: number; masterProduct: { name: string } }> };

export function SkuReviewPanel() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await authFetch("/api/inventory/sku-reviews");
        if (!response.ok) throw new Error("Antrean tinjauan SKU belum dapat dimuat.");
        const result = await response.json(); if (!cancelled) setData(result);
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Antrean belum dapat dimuat."); }
    }
    void load(); return () => { cancelled = true; };
  }, [revision]);
  return <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Tinjauan SKU seller">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Tinjauan SKU seller</h2><div className="flex items-center gap-2"><StatusBadge status={data?.total ? "warning" : "ok"} label={data ? `${data.total.toLocaleString("id-ID")} perlu ditinjau` : "Memuat…"} /><Button size="sm" variant="ghost" onClick={() => setRevision((value) => value + 1)}>Perbarui</Button></div></div>
    <p className="text-sm text-muted-foreground">SKU seller yang sama lintas toko memakai satu stok acuan. Stok lama yang berbeda tidak dijumlahkan otomatis.</p>
    {error && <ErrorFeedback error={error} action={<Button variant="outline" onClick={() => setRevision((value) => value + 1)}>Coba lagi</Button>} />}
    {data?.reviews.map((review) => <div key={review.id} className="space-y-3 rounded-md border p-3 text-sm">
      <p className="font-mono font-medium">{review.sellerSku}</p><p className="text-muted-foreground">{review.reason}</p>
      {!review.candidateIds.length && <p className="text-xs text-muted-foreground">Belum ada kandidat SKU master. Buat atau pilih SKU lewat form mapping di halaman ini, lalu perbarui antrean.</p>}
      <label className="block">Pilih SKU master dan stok acuan<select aria-label={`Stok acuan ${review.sellerSku}`} className="mt-1 h-10 w-full rounded border bg-background px-3" value={selected[review.id] ?? ""} onChange={(event) => setSelected((current) => ({ ...current, [review.id]: event.target.value }))}><option value="">Pilih kandidat…</option>{data.candidates.filter((candidate) => review.candidateIds.includes(candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.masterProduct.name} · {candidate.sku} · fisik {candidate.stock.toLocaleString("id-ID")} / disisihkan {candidate.safetyStock.toLocaleString("id-ID")}</option>)}</select></label>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={acknowledged[review.id] ?? false} onChange={(event) => setAcknowledged((current) => ({ ...current, [review.id]: event.target.checked }))} />Saya memilih stok kandidat ini sebagai acuan. Stok kandidat lain tidak ditambahkan; SKU yang tidak lagi punya listing akan diarsipkan.</label>
      <Button size="sm" disabled={saving !== null || !selected[review.id] || !acknowledged[review.id]} onClick={async () => {
        setSaving(review.id); setError(null);
        try {
          const response = await authFetch("/api/inventory/sku-reviews", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reviewId: review.id, variantId: selected[review.id], acknowledge: true }) });
          const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Mapping belum dapat disatukan.");
          setRevision((value) => value + 1);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Mapping belum dapat disatukan."); } finally { setSaving(null); }
      }}>{saving === review.id ? "Menyimpan…" : "Gunakan stok acuan ini"}</Button>
    </div>)}
    {data && !data.total && <p className="text-sm text-muted-foreground">Tidak ada konflik SKU seller yang menunggu peninjauan.</p>}
    {data && data.total > data.reviews.length && <p className="text-xs text-muted-foreground">Menampilkan {data.reviews.length} tinjauan pertama. Antrean berikutnya muncul setelah tinjauan ini diselesaikan.</p>}
  </section>;
}
