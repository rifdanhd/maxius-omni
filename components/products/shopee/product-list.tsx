"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal, PackageOpen, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Feedback } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtDate, fmtNumber, mappingHref, mappingLabels, mappingStatus, productTitle, statusLabel, storeName, type ShopeeListingRow } from "./presentation";

function ProductInfo({ row, compact, full = false }: { row: ShopeeListingRow; compact: boolean; full?: boolean }) {
  const title = productTitle(row);
  return <div className="flex min-w-0 items-start gap-3">
    <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-muted-foreground", compact ? "size-8" : "size-10")}>
      {row.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
      ) : <PackageOpen size={18} aria-hidden="true" />}
    </div>
    <div className="min-w-0 flex-1">
      {full ? <h3 className="break-words font-semibold leading-snug">{title}</h3> : <Tooltip><TooltipTrigger asChild><span tabIndex={0} className="line-clamp-2 break-words font-semibold leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring" title={title}>{title}</span></TooltipTrigger>
        <TooltipContent className="max-w-xs">{title}</TooltipContent></Tooltip>}
      <p className="mt-1 text-xs text-muted-foreground">{statusLabel(row.status)}{row.variantCount > 1 && ` · ${fmtNumber(row.variantCount)} varian`}</p>
    </div>
  </div>;
}

function Stock({ row, threshold }: { row: ShopeeListingRow; threshold: number }) {
  const label = row.stockTotal === 0 ? "Habis" : row.stockTotal < threshold ? "Menipis" : null;
  return <div className="flex flex-col items-end gap-1" title={row.variantCount > 1 ? "Total stok seluruh varian produk di toko ini" : "Stok produk di marketplace"}>
    <span className="font-semibold tabular-nums">{fmtNumber(row.stockTotal)}</span>
    {label && <StatusBadge status={label === "Habis" ? "out" : "low"} />}
  </div>;
}

function Mapping({ row }: { row: ShopeeListingRow }) {
  const status = mappingStatus(row);
  return <Link href={status === "failed" ? "/inventory/mismatch" : mappingHref(row)} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <StatusBadge status={status} label={mappingLabels[status]} />
  </Link>;
}

function StoreName({ row }: { row: ShopeeListingRow }) {
  const name = storeName(row.accountLabel);
  return <div className="min-w-0 break-words">
    <p>{name}</p>
    {name === "Nama toko belum diatur" && <Link className="text-xs underline outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/settings/accounts">Periksa toko</Link>}
    <p className="mt-1 break-all text-[11px] text-muted-foreground" title={row.accountId}>ID: {row.accountId}</p>
  </div>;
}

function RowActions({ row, busy, onDetail, onSync }: { row: ShopeeListingRow; busy: boolean; onDetail: (row: ShopeeListingRow, trigger: HTMLButtonElement | null) => void; onSync: (rows: ShopeeListingRow[]) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <Button ref={trigger} variant="ghost" size="icon" className="size-11 md:size-9" aria-label={`Aksi ${productTitle(row)}`}><MoreHorizontal /></Button>
  </DropdownMenuTrigger><DropdownMenuContent align="end">
    <DropdownMenuItem onSelect={() => onDetail(row, trigger.current)}>Lihat detail</DropdownMenuItem>
    <DropdownMenuItem asChild><Link href={mappingHref(row)}>Atur mapping</Link></DropdownMenuItem>
    <DropdownMenuItem disabled={busy || !row.platformProductId} onSelect={() => onSync([row])}><RefreshCw size={14} />Sinkron produk ini</DropdownMenuItem>
    {!row.platformProductId && <p className="max-w-56 px-2 py-1 text-xs text-muted-foreground">Perbarui data toko untuk melengkapi ID produk.</p>}
  </DropdownMenuContent></DropdownMenu>;
}

type ProductListProps = {
  rows: ShopeeListingRow[];
  selected: Set<string>;
  onToggleRow: (key: string) => void;
  onToggleAll: () => void;
  sort: string;
  onSort: (sort: string) => void;
  density: string;
  threshold: number;
  busy: boolean;
  onDetail: (row: ShopeeListingRow, trigger: HTMLButtonElement | null) => void;
  onSync: (rows: ShopeeListingRow[]) => void;
};

export function ShopeeProductList({ rows, selected, onToggleRow, onToggleAll, sort, onSort, density, threshold, busy, onDetail, onSync }: ProductListProps) {
  const compact = density === "compact";
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.key));
  const someSelected = rows.some((row) => selected.has(row.key));
  const cell = cn("px-4 align-top", compact ? "py-2" : "py-4");
  const columns = [
    { label: "Informasi Produk", field: "name", width: "min-w-[280px] w-[28%]" },
    { label: "SKU", field: "sku", width: "min-w-32" },
    { label: "Stok", field: "stock", width: "min-w-28 text-right" },
    { label: "Status Mapping", field: "mapping", width: "min-w-40" },
    { label: "Toko", field: "account", width: "min-w-40" },
    { label: "Sinkron terakhir", field: "updated", width: "min-w-44" },
  ];
  return <>
    <div className="hidden max-h-[65dvh] overflow-auto rounded-b-xl md:block" tabIndex={0} role="region" aria-label="Daftar produk Shopee, dapat digulir" data-testid="shopee-table-scroll">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Produk Shopee, stok dan hubungan dengan katalog pusat</caption>
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 w-14 min-w-14 border-b border-border bg-muted px-4 py-3">
              <Checkbox aria-label="Pilih semua produk di halaman ini" checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={onToggleAll} />
            </th>
            {columns.map(({ label, field, width }, index) => {
              const active = sort.startsWith(`${field}_`);
              const ascending = sort.endsWith("_asc");
              const Icon = active ? ascending ? ArrowUp : ArrowDown : ArrowUpDown;
              return <th key={field} aria-sort={active ? ascending ? "ascending" : "descending" : "none"} className={cn("sticky top-0 z-20 border-b border-border bg-muted px-4 py-2 font-semibold", width, index === 0 && "left-14 z-30")}>
                <Button variant="ghost" size="sm" className={cn("-mx-2 text-foreground", field === "stock" && "float-right")} onClick={() => onSort(`${field}_${active && ascending ? "desc" : "asc"}`)}>{label}<Icon aria-hidden="true" className="size-3.5" /></Button>
              </th>;
            })}
            <th className="sticky top-0 z-20 border-b border-border bg-muted px-3"><span className="sr-only">Aksi</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <tr key={row.key} data-testid="shopee-product-row" className="group border-b border-border last:border-0 hover:bg-muted/50">
            <td className={cn(cell, "sticky left-0 z-10 w-14 min-w-14 bg-card group-hover:bg-muted")}><Checkbox aria-label={`Pilih ${productTitle(row)}`} checked={selected.has(row.key)} onCheckedChange={() => onToggleRow(row.key)} /></td>
            <td className={cn(cell, "sticky left-14 z-10 max-w-xs bg-card group-hover:bg-muted")}><ProductInfo row={row} compact={compact} /></td>
            <td className={cn(cell, "break-all font-mono text-xs")}>{row.variantCount > 1 ? `${fmtNumber(row.variantCount)} SKU` : row.channelSku ?? "-"}</td>
            <td className={cn(cell, "text-right")}><Stock row={row} threshold={threshold} /></td>
            <td className={cell}><Mapping row={row} /></td>
            <td className={cell}><StoreName row={row} /></td>
            <td className={cn(cell, "text-xs text-muted-foreground")}>{fmtDate(row.lastSyncedAt)}</td>
            <td className={cn(cell, "px-2")}><RowActions row={row} busy={busy} onDetail={onDetail} onSync={onSync} /></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="space-y-3 p-3 md:hidden">
      <label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox aria-label="Pilih semua produk di halaman ini" checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={onToggleAll} />Pilih semua di halaman ini</label>
      {rows.map((row) => <article key={row.key} data-testid="shopee-product-card" aria-label={productTitle(row)} className={cn("rounded-lg border border-border bg-card", compact ? "p-3" : "p-4")}>
        <div className="mb-3 flex items-start gap-2">
          <div className="flex size-11 shrink-0 items-center justify-center"><Checkbox aria-label={`Pilih ${productTitle(row)}`} checked={selected.has(row.key)} onCheckedChange={() => onToggleRow(row.key)} /></div>
          <div className="min-w-0 flex-1 pt-1"><ProductInfo row={row} compact={compact} /></div>
          <RowActions row={row} busy={busy} onDetail={onDetail} onSync={onSync} />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3"><Mapping row={row} /><div className="text-right"><p className="text-xs text-muted-foreground">Stok</p><Stock row={row} threshold={threshold} /></div></div>
        <div className="mt-3 border-t border-border pt-3 text-xs"><StoreName row={row} /><p className="mt-2 break-all text-muted-foreground">SKU: {row.variantCount > 1 ? `${fmtNumber(row.variantCount)} SKU` : row.channelSku ?? "-"}</p><p className="mt-1 text-muted-foreground">Sinkron terakhir: {fmtDate(row.lastSyncedAt)}</p></div>
      </article>)}
    </div>
  </>;
}

export function ShopeeProductDetail({ row, onClose, threshold, returnFocus }: { row: ShopeeListingRow | null; onClose: () => void; threshold: number; returnFocus: HTMLButtonElement | null }) {
  return <Dialog open={Boolean(row)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus?.focus(); }}>
    <DialogHeader><DialogTitle>Detail produk</DialogTitle><DialogDescription>Ringkasan produk dan statusnya di toko Shopee.</DialogDescription></DialogHeader>
    {row && <div className="space-y-4 text-sm">
      <ProductInfo row={row} compact={false} full />
      <div className="flex items-start justify-between gap-3"><Mapping row={row} /><Stock row={row} threshold={threshold} /></div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3">
        <dt className="text-muted-foreground">Toko</dt><dd><StoreName row={row} /></dd>
        <dt className="text-muted-foreground">ID produk</dt><dd className="break-all font-mono">{row.platformProductId ?? "Belum tersedia"}</dd>
        <dt className="text-muted-foreground">SKU</dt><dd className="break-all">{row.channelSku ?? `${fmtNumber(row.variantCount)} SKU per varian`}</dd>
        <dt className="text-muted-foreground">Jumlah varian</dt><dd>{fmtNumber(row.variantCount)}</dd>
        <dt className="text-muted-foreground">Sinkron terakhir</dt><dd>{fmtDate(row.lastSyncedAt)}</dd>
      </dl>
      {row.variantCount > 1 && <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">Stok yang ditampilkan adalah total seluruh varian, bukan stok tiap varian.</p>}
      {mappingStatus(row) === "failed" && <Feedback variant="error" title="Gagal sinkron" description="Pembaruan stok ke marketplace belum terselesaikan; periksa kegagalannya di Stok Mismatch." />}
      <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link href={mappingHref(row)}>Atur mapping</Link></Button>{mappingStatus(row) === "failed" && <Button variant="outline" asChild><Link href="/inventory/mismatch">Periksa kegagalan</Link></Button>}</div>
    </div>}
  </DialogContent></Dialog>;
}
