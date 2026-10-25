"use client";

import { Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageState } from "@/components/ui/feedback";
import ShopeeLogo from "@/components/icons/ShopeeLogo";
import TikTokLogo from "@/components/icons/TikTokLogo";
import type { ListingStock, MasterStockRow } from "@/lib/inventory/master-stock.types";
import { numberFormat as fmt } from "@/components/inventory/master-stock-dialogs";

export const stockStatusLabel = (status: string) => status === "SUCCESS" ? "Sinkron" : status === "FAILED" ? "Gagal" : "Menunggu";
export function MasterStockListings({ row, busy, allocate, retry, message }: {
  row: MasterStockRow; busy: boolean; allocate: (listing: ListingStock) => void;
  retry: (listing: ListingStock) => void; message: (text: string) => void;
}) {
  return <div className="sticky left-0 w-[calc(100vw-3rem)] max-w-full space-y-3 p-4 sm:pl-16 xl:w-full">
    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">{row.warehouses.map((warehouse) => <span key={warehouse.id} className="rounded border bg-background p-2">{warehouse.name}: <strong className="tabular-nums">{fmt(warehouse.stock)}</strong> fisik · {fmt(warehouse.safetyStock)} disisihkan</span>)}</div>
    {row.allocationWarning && <p role="alert" className="rounded border border-warning/30 bg-warning/10 p-3 text-xs text-warning">Total alokasi listing melebihi Bisa Dijual. Ada risiko oversell bila beberapa toko menerima pesanan bersamaan.</p>}
    {!row.listings.length && <PageState title="Belum ada listing terhubung" description="Hubungkan SKU ini melalui Mapping Stok." />}
    <div className="grid gap-2 xl:grid-cols-2">{row.listings.map((listing) => <div key={listing.id} className="space-y-2 rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2">{listing.platform === "SHOPEE" ? <ShopeeLogo size={20} /> : <TikTokLogo size={18} />}<span className="truncate font-medium">{listing.store}</span></div><StatusBadge status={listing.status.toLowerCase()} label={stockStatusLabel(listing.status)} /></div>
      <p className="text-xs">Tampil di marketplace: <strong className="tabular-nums">{listing.platformStock === null ? "Belum diketahui" : fmt(listing.platformStock)}</strong> · Terakhir sinkron {listing.lastSyncedAt ? new Date(listing.lastSyncedAt).toLocaleString("id-ID") : "belum pernah"}</p>
      <p className="text-xs tabular-nums">max(0, Bisa Dijual {fmt(row.available)} − buffer {fmt(listing.allocation.buffer)}) {listing.allocation.mode === "PERCENT" ? `× ${listing.allocation.value}%` : listing.allocation.mode === "EQUAL" ? `÷ ${row.listings.length} listing (dibulatkan turun)` : listing.allocation.mode === "FIXED" ? `dibatasi ${fmt(listing.allocation.value)} unit` : "× 100%"} = <strong>{fmt(listing.quantity)} dikirim</strong></p>
      {listing.error && <p className="break-words text-xs text-destructive">{listing.error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">ID varian: <code className="break-all">{listing.platformSkuId ?? listing.channelSku}</code><button type="button" className="inline-flex size-8 items-center justify-center rounded hover:bg-muted" aria-label={`Salin ID ${listing.store}`} onClick={() => { void navigator.clipboard.writeText(listing.platformSkuId ?? listing.channelSku).then(() => message("ID varian disalin.")).catch(() => message("Pilih teks ID dan salin secara manual.")); }}><Copy className="size-3" /></button></span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => allocate(listing)}>Atur alokasi</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => retry(listing)}><RefreshCw className="size-3" />Sinkron ulang</Button></div></div>
    </div>)}</div>
  </div>;
}
