"use client";

import { Archive, ChevronDown, Pencil, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VariantThumbnail } from "@/components/ui/variant-thumbnail";
import { StatusBadge } from "@/components/ui/status-badge";
import { MasterStockListings, stockStatusLabel } from "@/components/inventory/master-stock-listings";
import { numberFormat as fmt } from "@/components/inventory/master-stock-dialogs";
import type { ListingStock, MasterStockRow } from "@/lib/inventory/master-stock.types";

interface MasterStockProductProps {
  variants: MasterStockRow[];
  open: boolean;
  dense: boolean;
  filtered: boolean;
  busy: boolean;
  selected: Set<string>;
  expanded: Set<string>;
  toggle: () => void;
  select: (rows: MasterStockRow[], checked: boolean) => void;
  toggleListing: (id: string) => void;
  edit: (row: MasterStockRow) => void;
  allocate: (row: MasterStockRow, listings: ListingStock[]) => void;
  retry: (row: MasterStockRow, listing: ListingStock) => void;
  syncMany: (row: MasterStockRow, listings: ListingStock[]) => void;
  archive: (row: MasterStockRow) => void;
  message: (message: string) => void;
  refresh: () => void;
}

export function MasterStockProduct({ variants, open, dense, filtered, busy, selected, expanded,
  toggle, select, toggleListing, edit, allocate, retry, syncMany, archive, message, refresh }: MasterStockProductProps) {
  const product = variants[0];
  const checked = variants.every((row) => selected.has(row.id));
  const storeCount = new Set(variants.flatMap((row) => row.listings.map((listing) => listing.accountId))).size;
  const available = variants.reduce((sum, row) => sum + row.available, 0);
  const failed = variants.filter((row) => row.status === "FAILED").length;
  const grid = "@min-[760px]:grid @min-[760px]:grid-cols-[minmax(180px,1fr)_80px_80px_90px_120px] @min-[760px]:items-center @min-[760px]:gap-4";

  return (
    <article className="@container overflow-hidden rounded-xl border border-border bg-card">
      <div data-testid="master-stock-product" className="flex items-start gap-3 p-4 sm:items-center sm:gap-4 sm:p-5">
        <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary sm:mt-0" aria-label={`Pilih semua varian ${product.name}`}
          checked={checked} ref={(element) => {
            if (element) element.indeterminate = !checked && variants.some((row) => selected.has(row.id));
          }} onChange={(event) => select(variants, event.target.checked)} />
        <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" aria-label={`Varian ${product.name}`} aria-expanded={open} aria-controls={`variants-${product.productId}`}
            onClick={toggle} className="group flex min-w-0 flex-1 items-start gap-3 text-left sm:items-center">
            <VariantThumbnail src={product.imageUrl} size={56} alt={product.name} className="rounded-lg" />
            <span className="min-w-0">
              <span className="line-clamp-2 text-sm font-semibold leading-relaxed text-foreground group-hover:text-primary">{product.name}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{fmt(variants.length)} varian{filtered ? " sesuai filter" : ""}</span>
                <span className="inline-flex items-center gap-1"><Store className="size-3" />{storeCount} toko</span>
                {failed > 0 && <span className="text-destructive">{fmt(failed)} varian gagal sinkron</span>}
              </span>
              <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
                {open ? "Tutup varian" : "Lihat varian"}<ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              </span>
            </span>
          </button>
          <div className="flex items-baseline justify-between gap-4 border-t border-border/60 pt-3 sm:block sm:shrink-0 sm:border-0 sm:pl-4 sm:pt-0 sm:text-right">
            <p className="text-xs text-muted-foreground">Bisa dijual <span className="text-muted-foreground/70">· total varian</span></p>
            <p className="text-xl font-semibold tabular-nums tracking-tight text-foreground sm:mt-1">{fmt(available)} <span className="text-xs font-normal text-muted-foreground">unit</span></p>
          </div>
        </div>
      </div>
      {open && (
        <div id={`variants-${product.productId}`} className="border-t border-border">
          <div className={`${grid} hidden bg-muted/40 px-5 py-2.5 text-[11px] font-medium text-muted-foreground`}>
            <span>VARIAN / SKU</span><span className="text-right">DI GUDANG</span><span className="text-right">DISISIHKAN</span><span className="text-right">BISA DIJUAL</span><span className="text-right">AKSI</span>
          </div>
          {variants.map((row) => {
            const sku = !/^\d+(?::\d+)?$/.test(row.sku) ? row.sku : row.listings.find((listing) => listing.sellerSku)?.sellerSku ?? "SKU seller belum tersedia";
            // Atribut marketplace yang menambah info di luar nama/SKU varian pusat.
            const attributes = (row.attributes ?? []).filter((value) => value.toLowerCase() !== (row.variantName ?? "").trim().toLowerCase());
            const listingOpen = expanded.has(row.id);
            return (
              <div key={row.id} className="border-t border-border/70 first:border-t-0">
                <div data-testid="master-stock-row" className={`${selected.has(row.id) ? "bg-primary/[0.03]" : ""} ${dense ? "p-3 @min-[760px]:px-5" : "p-4 @min-[760px]:p-5"}`}>
                  <div className={grid}>
                    <div className="flex min-w-0 items-start gap-3">
                      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" aria-label={`Pilih ${sku}`} checked={selected.has(row.id)} onChange={(event) => select([row], event.target.checked)} />
                      <VariantThumbnail src={row.variantImageUrl} fallbackSrc={product.imageUrl} alt={sku} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{row.variantName && !/^\d+(?::\d+)?$/.test(row.variantName) ? row.variantName : "Varian standar"}</p>
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{sku}</p>
                        {attributes.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Atribut: <span className="text-foreground">{attributes.slice(0, 4).join(" · ")}{attributes.length > 4 ? ` +${attributes.length - 4}` : ""}</span>
                          </p>
                        )}
                        {row.stockReview && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300" title={row.stockReview.reasons.join("; ")}>Stok perlu ditinjau</p>}
                        {row.archived && <StatusBadge status="inactive" label="Arsip / nonaktif" className="mt-1" />}
                        {row.promoActive > 0 && <p className="mt-1 text-xs text-primary">{row.promoActive} promosi aktif</p>}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-3 rounded-lg bg-muted/40 py-3 text-center @min-[760px]:contents">
                      <div className="@min-[760px]:text-right"><p className="text-[11px] text-muted-foreground @min-[760px]:hidden">Di gudang</p><p className="mt-1 text-sm font-medium tabular-nums @min-[760px]:mt-0">{fmt(row.stock)}</p></div>
                      <div className="border-x border-border @min-[760px]:border-0 @min-[760px]:text-right"><p className="text-[11px] text-muted-foreground @min-[760px]:hidden">Disisihkan</p><p className="mt-1 text-sm tabular-nums text-muted-foreground @min-[760px]:mt-0">{fmt(row.safetyStock)}</p></div>
                      <div className="@min-[760px]:text-right"><p className="text-[11px] text-muted-foreground @min-[760px]:hidden">Bisa dijual</p><p className={`mt-1 text-sm font-semibold tabular-nums @min-[760px]:mt-0 ${row.available === 0 ? "text-destructive" : "text-foreground"}`}>{fmt(row.available)}</p></div>
                    </div>
                    <Button size="sm" variant="outline" className="mt-3 w-full @min-[760px]:mt-0 @min-[760px]:w-auto @min-[760px]:justify-self-end" disabled={busy || row.archived} onClick={() => edit(row)}><Pencil className="size-3.5" />Ubah stok</Button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 @min-[760px]:ml-7">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={row.listings.length ? row.status.toLowerCase() : "unlinked"} label={row.listings.length ? stockStatusLabel(row.status) : "Belum mapping"} />
                      {row.pending > 0 && <span className="text-xs text-muted-foreground">{fmt(row.pending)} menunggu diproses</span>}
                    </div>
                    <button type="button" aria-label={`Rincian ${sku}`} aria-expanded={listingOpen} aria-controls={`listings-${row.id}`}
                      onClick={() => toggleListing(row.id)} className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                      Rincian toko<ChevronDown className={`size-3.5 transition-transform ${listingOpen ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                </div>
                {listingOpen && (
                  <div id={`listings-${row.id}`} className="border-t border-border bg-muted/25">
                    <MasterStockListings row={row} busy={busy}
                      allocate={(listings) => allocate(row, listings)}
                      retry={(listing) => retry(row, listing)}
                      syncMany={(listings) => syncMany(row, listings)}
                      message={message} refresh={refresh} />
                    <div className="px-4 pb-3"><Button size="sm" variant="ghost" disabled={busy} onClick={() => archive(row)}><Archive className="size-3" />{row.ownArchived ? "Lepas arsip SKU" : "Arsipkan SKU"}</Button></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
