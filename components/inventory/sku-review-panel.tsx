"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/utils/api-client";
import { Button } from "@/components/ui/button";
import { ErrorFeedback } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status-badge";
import { AlertTriangle, ChevronRight, RefreshCw } from "lucide-react";

type ReviewData = {
  total: number;
  reviews: Array<{ id: string; sellerSku: string; reason: string; candidateIds: string[] }>;
  candidates: Array<{ id: string; sku: string; stock: number; safetyStock: number; masterProduct: { name: string } }>;
};

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
        const result = await response.json();
        if (!cancelled) setData(result);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Antrean belum dapat dimuat.");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [revision]);

  if (!data) {
    return (
      <section className="rounded-lg border bg-card p-4" aria-label="Tinjauan SKU seller">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Tinjauan SKU seller</h2>
          <Button size="sm" variant="ghost" disabled>
            Memuat…
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Sedang memuat antrean tinjauan SKU seller…
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Tinjauan SKU seller">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <AlertTriangle size={16} className="text-warning" /> Tinjauan SKU seller
        </h2>
        <div className="flex items-center gap-2">
          <StatusBadge
            status={data.total ? "warning" : "ok"}
            label={
              data.total
                ? `${data.total.toLocaleString("id-ID")} perlu ditinjau`
                : "Tidak ada yang perlu ditinjau"
            }
          />
          <Button size="sm" variant="ghost" onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw size={14} className="mr-1" /> Perbarui
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        SKU seller yang sama dipakai lintas toko akan memakai satu stok acuan. Stok lama yang berbeda tidak dijumlahkan otomatis.
      </p>
      {error && (
        <ErrorFeedback
          error={error}
          action={
            <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
              Coba lagi
            </Button>
          }
        />
      )}
      {data.total === 0 && (
        <div className="rounded-lg border bg-muted p-4 text-center">
          <p className="text-sm text-muted-foreground">Tidak ada konflik SKU seller yang menunggu peninjauan.</p>
          <p className="text-xs text-muted-foreground mt-1">Semua SKU seller sudah terhubung ke stok pusat.</p>
        </div>
      )}
      {data.reviews.map((review) => {
        const candidates = data.candidates.filter((c) =>
          review.candidateIds.includes(c.id)
        );
        const isSaving = saving === review.id;
        const buttonLabel = isSaving ? "Menyimpan…" : "Gunakan stok acuan ini";
        const buttonIcon = isSaving ? (
          <RefreshCw className="animate-spin mr-1" size={14} />
        ) : (
          <ChevronRight size={14} className="mr-1" />
        );

        return (
          <div key={review.id} className="rounded-xl border p-4 text-sm shadow-sm">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <p className="font-mono font-medium">{review.sellerSku}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {review.reason}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {review.candidateIds.length} kandidat stok
              </p>
            </div>
            {!candidates.length && (
              <div className="rounded-md border bg-muted/50 p-3 mb-3">
                <p className="text-xs text-muted-foreground">
                  Belum ada kandidat SKU master. Buat atau pilih SKU lewat form mapping di halaman ini, lalu perbarui antrean.
                </p>
              </div>
            )}
            {candidates.length > 0 && (
              <div className="space-y-2 mb-3">
                <label className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Pilih SKU master dan stok acuan
                  </span>
                </label>
                <select
                  aria-label={`Stok acuan ${review.sellerSku}`}
                  className="mt-1 h-10 w-full rounded border bg-background px-3 text-sm"
                  value={selected[review.id] ?? ""}
                  onChange={(event) =>
                    setSelected((current) => ({ ...current, [review.id]: event.target.value }))
                  }
                >
                  <option value="">Pilih kandidat…</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.masterProduct.name} · {candidate.sku} · fisik{" "}
                      {candidate.stock.toLocaleString("id-ID")} / cadangan{" "}
                      {candidate.safetyStock.toLocaleString("id-ID")}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Pilih satu stok acuan. Stok kandidat lain tidak akan ditambahkan ke stok ini.
                </p>
              </div>
            )}
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={acknowledged[review.id] ?? false}
                onChange={(event) =>
                  setAcknowledged((current) => ({ ...current, [review.id]: event.target.checked }))
                }
                className="shrink-0"
              />
              <span>
                Saya memilih stok kandidat ini sebagai acuan. Stok kandidat lain tidak ditambahkan; SKU yang tidak lagi punya listing akan diarsipkan.
              </span>
            </label>
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                disabled={isSaving || !selected[review.id] || !acknowledged[review.id]}
                onClick={async () => {
                  setSaving(review.id);
                  setError(null);
                  try {
                    const response = await authFetch("/api/inventory/sku-reviews", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        reviewId: review.id,
                        variantId: selected[review.id],
                        acknowledge: true,
                      }),
                    });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error ?? "Mapping belum dapat disatukan.");
                    setRevision((value) => value + 1);
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : "Mapping belum dapat disatukan.");
                  } finally {
                    setSaving(null);
                  }
                }}
              >
                {buttonIcon} {buttonLabel}
              </Button>
              {error && (
                <p className="text-xs text-destructive mt-1">{error}</p>
              )}
            </div>
          </div>
        );
      })}
      {data.total > data.reviews.length && (
        <p className="text-xs text-muted-foreground">
          Menampilkan {data.reviews.length} tinjauan pertama. Antrean berikutnya muncul setelah tinjauan ini diselesaikan.
        </p>
      )}
    </section>
  );
}
