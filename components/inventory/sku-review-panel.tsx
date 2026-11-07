"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/utils/api-client";
import { Button } from "@/components/ui/button";
import { ErrorFeedback } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status-badge";
import { AlertTriangle, ChevronRight, ListChecks, Loader2, RefreshCw, Wand2 } from "lucide-react";

type ReviewData = {
  total: number;
  reviews: Array<{ id: string; sellerSku: string; reason: string; candidateIds: string[] }>;
  candidates: Array<{ id: string; sku: string; stock: number; safetyStock: number; masterProduct: { name: string } }>;
};

// Kandidat acuan default: tersedia terbesar (fisik − cadangan), tie-break fisik terbesar.
function pickDefaultCandidate(candidates: ReviewData["candidates"]): string {
  let best = candidates[0];
  let bestAvail = -1;
  for (const candidate of candidates) {
    const avail = candidate.stock - candidate.safetyStock;
    if (avail > bestAvail || (avail === bestAvail && candidate.stock > best.stock)) {
      best = candidate;
      bestAvail = avail;
    }
  }
  return best?.id ?? "";
}

type ReviewCardProps = {
  review: ReviewData["reviews"][number];
  candidates: ReviewData["candidates"];
  selected: string;
  acknowledged: boolean;
  saving: boolean;
  error: string | null;
  onSelect: (candidateId: string) => void;
  onAcknowledge: (checked: boolean) => void;
  onSubmit: () => void;
};

function ReviewCard({
  review,
  candidates,
  selected,
  acknowledged,
  saving,
  error,
  onSelect,
  onAcknowledge,
  onSubmit,
}: ReviewCardProps) {
  const bestId = pickDefaultCandidate(candidates);
  const best = candidates.find((candidate) => candidate.id === bestId);
  const chosen = candidates.find((candidate) => candidate.id === selected);
  const others = candidates.filter((candidate) => candidate.id !== selected).length;
  return (
    <div className="rounded-xl border p-4 text-sm shadow-sm">
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
            {best && !selected && (
              <button
                type="button"
                onClick={() => { onSelect(bestId); onAcknowledge(true); }}
                className="ml-auto rounded border border-border px-2 py-0.5 text-[10px] font-semibold text-foreground hover:bg-muted"
              >
                Pilih saran: {best.sku} (stok terbesar)
              </button>
            )}
          </label>
          <select
            aria-label={`Stok acuan ${review.sellerSku}`}
            className="mt-1 h-10 w-full rounded border bg-background px-3 text-sm"
            value={selected}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="">Pilih kandidat…</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.id === bestId ? "★ " : ""}
                {candidate.masterProduct.name} · {candidate.sku} · fisik{" "}
                {candidate.stock.toLocaleString("id-ID")} / cadangan{" "}
                {candidate.safetyStock.toLocaleString("id-ID")}
                {candidate.id === bestId ? " (tersedia terbesar)" : ""}
              </option>
            ))}
          </select>
          {chosen ? (
            // Preview konsekuensi: berubah mengikuti kandidat yang dipilih.
            <p className="rounded-md bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
              {chosen.masterProduct.name} / {chosen.sku} dipakai sebagai acuan (tersedia{" "}
              {Math.max(0, chosen.stock - chosen.safetyStock)}).{" "}
              {others > 0
                ? `${others} kandidat lain tidak dijumlahkan; diarsipkan bila tidak punya listing lagi.`
                : "Tidak ada kandidat lain."}
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground mt-1">
              Pilih satu stok acuan. Stok kandidat lain tidak akan ditambahkan ke stok ini.
            </p>
          )}
        </div>
      )}
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => onAcknowledge(event.target.checked)}
          className="shrink-0"
        />
        <span>
          Saya memilih stok kandidat ini sebagai acuan. Stok kandidat lain tidak ditambahkan; SKU yang tidak lagi punya listing akan diarsipkan.
        </span>
      </label>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          disabled={saving || !selected || !acknowledged}
          onClick={onSubmit}
        >
          {saving ? (
            <RefreshCw className="animate-spin mr-1" size={14} />
          ) : (
            <ChevronRight size={14} className="mr-1" />
          )}
          {saving ? "Menyimpan…" : "Gunakan stok acuan ini"}
        </Button>
        {error && (
          <p className="text-xs text-destructive mt-1">{error}</p>
        )}
      </div>
    </div>
  );
}

export function SkuReviewPanel() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [bulk, setBulk] = useState<{ done: number; total: number; failed: number } | null>(null);
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

  const candidatesByReview = useMemo(() => {
    const map = new Map<string, ReviewData["candidates"]>();
    for (const review of data?.reviews ?? []) {
      map.set(
        review.id,
        (data?.candidates ?? []).filter((c) => review.candidateIds.includes(c.id))
      );
    }
    return map;
  }, [data]);

  const readyIds = useMemo(
    () =>
      (data?.reviews ?? [])
        .filter((review) => {
          const candidates = candidatesByReview.get(review.id) ?? [];
          return candidates.length > 0 && (selected[review.id] ?? "") && (acknowledged[review.id] ?? false);
        })
        .map((review) => review.id),
    [data, selected, acknowledged, candidatesByReview]
  );

  async function resolveOne(reviewId: string, variantId: string): Promise<string | null> {
    try {
      const response = await authFetch("/api/inventory/sku-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, variantId, acknowledge: true }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) return result?.error ?? "Mapping belum dapat disatukan.";
      return null;
    } catch {
      return "Mapping belum dapat disatukan.";
    }
  }

  async function applyAll() {
    if (!data || bulk) return;
    const queue = readyIds
      .map((id) => ({ id, variantId: selected[id] }))
      .filter((item) => Boolean(item.variantId));
    if (queue.length === 0) return;
    setError(null);
    setErrors({});
    setBulk({ done: 0, total: queue.length, failed: 0 });
    let failed = 0;
    const failureMessages: Record<string, string> = {};
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index];
      setSaving(item.id);
      const message = await resolveOne(item.id, item.variantId);
      if (message) {
        failed += 1;
        failureMessages[item.id] = message;
      }
      setSaving(null);
      setBulk({ done: index + 1, total: queue.length, failed });
    }
    setErrors(failureMessages);
    setBulk(null);
    setRevision((value) => value + 1);
  }

  function selectDefaults() {
    if (!data) return;
    const nextSelected: Record<string, string> = { ...selected };
    const nextAcknowledged: Record<string, boolean> = { ...acknowledged };
    for (const review of data.reviews) {
      const candidates = candidatesByReview.get(review.id) ?? [];
      if (!candidates.length) continue;
      nextSelected[review.id] = pickDefaultCandidate(candidates);
      nextAcknowledged[review.id] = true;
    }
    setSelected(nextSelected);
    setAcknowledged(nextAcknowledged);
  }

  if (!data) {
    return (
      <section className="rounded-lg border bg-card p-4" aria-label="Tinjauan SKU seller">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold flex items-center gap-2">
            <AlertTriangle size={16} className="text-warning" /> Tinjauan SKU seller
          </h2>
          <Button size="sm" variant="ghost" disabled>
            <Loader2 className="animate-spin mr-1" size={14} /> Memuat…
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Sedang memuat antrean tinjauan SKU seller…
        </p>
      </section>
    );
  }

  const pending = data.total > 0;

  return (
    <section className="rounded-lg border bg-card p-4" aria-label="Tinjauan SKU seller">
      {/* Header kompak — selalu tampil, antrean disembunyikan sampai dibuka */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <AlertTriangle size={16} className={pending ? "text-warning" : "text-muted-foreground"} /> Tinjauan SKU seller
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            status={pending ? "warning" : "ok"}
            label={
              pending
                ? `${data.total.toLocaleString("id-ID")} perlu ditinjau`
                : "Tidak ada yang perlu ditinjau"
            }
          />
          <Button size="sm" variant="ghost" onClick={() => setRevision((value) => value + 1)} title="Muat ulang antrean">
            <RefreshCw size={14} className="mr-1" /> Perbarui
          </Button>
          {pending && (
            <Button size="sm" variant={expanded ? "outline" : "default"} onClick={() => setExpanded((value) => !value)}>
              <ListChecks size={14} className="mr-1" />
              {expanded ? "Tutup antrean" : "Selesaikan antrean"}
            </Button>
          )}
        </div>
      </div>

      {!pending && !error && (
        <p className="mt-2 text-sm text-muted-foreground">
          Semua SKU seller sudah terhubung ke stok pusat.
        </p>
      )}

      {expanded && pending && (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            SKU seller yang sama dipakai lintas toko akan memakai satu stok acuan. Stok lama yang berbeda tidak dijumlahkan otomatis.
          </p>

          {error && (
            <div className="mt-3">
              <ErrorFeedback
                error={error}
                action={
                  <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
                    Coba lagi
                  </Button>
                }
              />
            </div>
          )}

          {/* Toolbar bulk */}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
            <Button
              size="sm"
              variant="outline"
              disabled={Boolean(bulk)}
              onClick={selectDefaults}
            >
              <Wand2 size={14} className="mr-1" /> Pilih acuan otomatis ({(data.reviews ?? []).filter((review) => (candidatesByReview.get(review.id) ?? []).length > 0).length})
            </Button>
            <Button
              size="sm"
              disabled={Boolean(bulk) || readyIds.length === 0}
              onClick={() => { void applyAll(); }}
            >
              {bulk ? (
                <Loader2 className="animate-spin mr-1" size={14} />
              ) : (
                <ListChecks size={14} className="mr-1" />
              )}
              Terapkan semua ({readyIds.length})
            </Button>
            {bulk && (
              <p className="text-xs text-muted-foreground">
                Menyimpan {bulk.done}/{bulk.total}
                {bulk.failed > 0 ? ` · ${bulk.failed} gagal` : ""}…
              </p>
            )}
          </div>

          {data.reviews.length > 0 && (
            <div className="mt-3 max-h-[24rem] space-y-3 overflow-y-auto pr-1">
              {data.reviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  candidates={candidatesByReview.get(review.id) ?? []}
                  selected={selected[review.id] ?? ""}
                  acknowledged={acknowledged[review.id] ?? false}
                  saving={saving === review.id}
                  error={errors[review.id] ?? null}
                  onSelect={(candidateId) => {
                    setSelected((current) => ({ ...current, [review.id]: candidateId }));
                    setErrors((current) => ({ ...current, [review.id]: "" }));
                  }}
                  onAcknowledge={(checked) =>
                    setAcknowledged((current) => ({ ...current, [review.id]: checked }))
                  }
                  onSubmit={async () => {
                    setSaving(review.id);
                    setErrors((current) => ({ ...current, [review.id]: "" }));
                    const message = await resolveOne(review.id, selected[review.id]);
                    setSaving(null);
                    if (message) {
                      setErrors((current) => ({ ...current, [review.id]: message }));
                    } else {
                      setRevision((value) => value + 1);
                    }
                  }}
                />
              ))}
            </div>
          )}

          {data.total > data.reviews.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              Menampilkan {data.reviews.length} tinjauan pertama. Antrean berikutnya muncul setelah tinjauan ini diselesaikan.
            </p>
          )}
        </>
      )}
    </section>
  );
}
