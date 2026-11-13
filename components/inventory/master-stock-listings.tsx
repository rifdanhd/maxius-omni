"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Info,
  Loader2,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VariantThumbnail } from "@/components/ui/variant-thumbnail";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageState } from "@/components/ui/feedback";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ShopeeLogo from "@/components/icons/ShopeeLogo";
import TikTokLogo from "@/components/icons/TikTokLogo";
import { authFetch } from "@/lib/utils/api-client";
import type { ListingStock, MasterStockRow } from "@/lib/inventory/master-stock.types";
import { numberFormat as fmt } from "@/components/inventory/master-stock-dialogs";

export const stockStatusLabel = (status: string) =>
  status === "DISABLED" ? "Push nonaktif" : status === "SUCCESS" ? "Sinkron" : status === "FAILED" ? "Gagal" : "Menunggu";

/** Nama listing: judul marketplace → SKU seller → channel SKU. */
export const listingName = (listing: ListingStock) =>
  listing.platformTitle?.trim() || listing.sellerSku?.trim() || listing.channelSku;

/** ID varian dipendekkan untuk tabel; ID penuh tetap tersedia lewat title & menu salin. */
export const shortVariantId = (value: string) => (value.length > 8 ? `…${value.slice(-8)}` : value);

/** Mismatch = angka yang tampil di marketplace beda dengan hasil hitung alokasi. */
export const isListingMismatch = (listing: ListingStock) =>
  listing.platformStock !== null && listing.platformStock !== listing.quantity;

const FILTERS = [
  { id: "all", label: "Semua" },
  { id: "mismatch", label: "Mismatch" },
  { id: "baseline", label: "Belum baseline" },
  { id: "pushoff", label: "Push nonaktif" },
] as const;
type ListingFilter = (typeof FILTERS)[number]["id"];

const platformLogo = (platform: string, size: number) =>
  platform === "SHOPEE" ? <ShopeeLogo size={size} /> : <TikTokLogo size={size - 2} />;

const control =
  "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors";

export function MasterStockListings({ row, busy, allocate, retry, syncMany, message, refresh }: {
  row: MasterStockRow;
  busy: boolean;
  allocate: (listings: ListingStock[]) => void;
  retry: (listing: ListingStock) => void;
  syncMany: (listings: ListingStock[]) => void;
  message: (text: string) => void;
  refresh: () => void;
}) {
  const [filter, setFilter] = useState<ListingFilter>("all");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pushOff, setPushOff] = useState<Record<string, boolean>>({});
  const [pushSaving, setPushSaving] = useState<string | null>(null);

  const stores = useMemo(
    () => [...new Map(row.listings.map((listing) => [listing.accountId, listing.store])).entries()],
    [row.listings]
  );

  const visible = row.listings.filter((listing) => {
    if (storeFilter !== "all" && listing.accountId !== storeFilter) return false;
    if (filter === "mismatch") return isListingMismatch(listing);
    if (filter === "baseline") return listing.disabledCode === "BASELINE";
    if (filter === "pushoff") return Boolean(listing.disabledCode);
    return true;
  });

  const groups = useMemo(() => {
    const map = new Map<string, { accountId: string; store: string; platform: string; listings: ListingStock[] }>();
    for (const listing of visible) {
      const group = map.get(listing.accountId) ?? { accountId: listing.accountId, store: listing.store, platform: listing.platform, listings: [] };
      group.listings.push(listing);
      map.set(listing.accountId, group);
    }
    return [...map.values()].sort((a, b) => a.store.localeCompare(b.store, "id"));
  }, [visible]);

  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(
      [...new Set(row.listings.map((listing) => listing.accountId))].length > 1
        ? [...new Set(row.listings.map((listing) => listing.accountId))]
        : []
    )
  );

  const baselineCount = row.listings.filter((listing) => listing.disabledCode === "BASELINE").length;
  const totalAllocated = row.listings.reduce((sum, listing) => sum + listing.quantity, 0);
  const chosen = row.listings.filter((listing) => selected.has(listing.id));
  const mismatchCount = row.listings.filter(isListingMismatch).length;

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCollapsed(accountId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  async function copyId(listing: ListingStock) {
    const value = listing.platformSkuId ?? listing.channelSku;
    try {
      await navigator.clipboard.writeText(value);
      message("ID varian disalin.");
    } catch {
      message("Pilih teks ID dan salin secara manual.");
    }
  }

  async function togglePush(group: { accountId: string; store: string; listings: ListingStock[] }) {
    const current = pushOff[group.accountId] ?? group.listings[0]?.pushEnabled ?? true;
    const next = !current;
    setPushSaving(group.accountId);
    try {
      const response = await authFetch(`/api/stores/${encodeURIComponent(group.accountId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockPushEnabled: next }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) throw new Error(result?.error ?? "Pengaturan push toko belum tersimpan.");
      setPushOff((state) => ({ ...state, [group.accountId]: next }));
      message(`Push stok ${group.store} ${next ? "diaktifkan" : "dinonaktifkan"}.`);
      refresh();
    } catch (cause) {
      message(cause instanceof Error ? cause.message : "Pengaturan push toko gagal disimpan.");
    } finally {
      setPushSaving(null);
    }
  }

  return (
    <div className="min-w-0 space-y-3 p-4 md:p-5">
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {row.warehouses.map((warehouse) => (
          <span key={warehouse.id} className="rounded border bg-background p-2">
            {warehouse.name}: <strong className="tabular-nums">{fmt(warehouse.stock)}</strong> fisik · {fmt(warehouse.safetyStock)} disisihkan
          </span>
        ))}
      </div>

      {/* Satu banner untuk semua listing — bukan diulang per kartu. */}
      {baselineCount > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          <Info aria-hidden="true" className="size-4 shrink-0" />
          <p className="min-w-0 flex-1">
            {fmt(baselineCount)} listing belum punya baseline stok terkonfirmasi. Push stok ditahan untuk brand ini sampai baseline dikonfirmasi.
          </p>
          <Button size="sm" variant="outline" asChild>
            <a href="/inventory/settings">Konfirmasi baseline</a>
          </Button>
        </div>
      )}

      {totalAllocated > row.available && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          <p className="min-w-0 flex-1 tabular-nums">
            Total alokasi <strong>{fmt(totalAllocated)}</strong> &gt; Bisa Dijual <strong>{fmt(row.available)}</strong> — oversell berisiko bila beberapa toko menerima pesanan bersamaan.
          </p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => allocate(row.listings)}>
            Atur alokasi
          </Button>
        </div>
      )}

      {!row.listings.length && (
        <PageState title="Belum ada listing terhubung" description="Hubungkan SKU ini melalui Mapping Stok." />
      )}

      {row.listings.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((item) => {
              const count = item.id === "mismatch" ? mismatchCount
                : item.id === "baseline" ? baselineCount
                  : item.id === "pushoff" ? row.listings.filter((listing) => listing.disabledCode).length
                    : row.listings.length;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`${control} ${filter === item.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}
                >
                  {item.label}
                  <span className="tabular-nums opacity-70">{fmt(count)}</span>
                </button>
              );
            })}
            {stores.length > 1 && (
              <select
                aria-label="Filter toko pada rincian"
                value={storeFilter}
                onChange={(event) => setStoreFilter(event.target.value)}
                className="min-h-8 rounded-full border border-border bg-background px-3 text-xs"
              >
                <option value="all">Semua toko</option>
                {stores.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            )}
          </div>

          {chosen.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <span className="font-medium text-foreground">{fmt(chosen.length)} listing dipilih</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => syncMany(chosen)}>
                <RefreshCw className="size-3" />Sinkron ulang terpilih
              </Button>
              <Button size="sm" disabled={busy} onClick={() => allocate(chosen)}>Atur alokasi terpilih</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Batal pilih</Button>
            </div>
          )}

          {visible.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Tidak ada listing yang cocok dengan filter ini.
            </p>
          )}

          {groups.map((group) => {
            // Saat filter aktif, grup selalu terbuka agar hasil filter tidak tersembunyi.
            const isCollapsed = filter === "all" && storeFilter === "all" && collapsed.has(group.accountId);
            const pushing = pushSaving === group.accountId;
            const pushOn = pushOff[group.accountId] ?? group.listings[0]?.pushEnabled ?? true;
            return (
              <section key={group.accountId} className="overflow-hidden rounded-lg border border-border bg-background">
                {/* Header per toko: identitas jelas, aksi tingkat toko. */}
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(group.accountId)}
                    aria-expanded={!isCollapsed}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {platformLogo(group.platform, 18)}
                    <span className="truncate text-sm font-semibold text-foreground">{group.store}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmt(group.listings.length)} listing</span>
                    <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isCollapsed ? "" : "rotate-180"}`} />
                  </button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => syncMany(group.listings)}>
                    <RefreshCw className="size-3" />Sinkron semua
                  </Button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={pushOn}
                    aria-label={`${pushOn ? "Nonaktifkan" : "Aktifkan"} push stok ${group.store}`}
                    disabled={pushing}
                    onClick={() => void togglePush(group)}
                    className={`${control} ${pushOn ? "border-success/40 bg-success/10 text-success" : "border-border bg-background text-muted-foreground"} disabled:opacity-60`}
                  >
                    {pushing ? <Loader2 className="size-3 animate-spin" /> : null}
                    Push {pushing ? "menyimpan…" : pushOn ? "aktif" : "nonaktif"}
                  </button>
                </div>

                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                          <th scope="col" className="w-8 px-3 py-2" aria-label="Pilih" />
                          <th scope="col" className="px-2 py-2 text-left font-medium">Nama listing / SKU</th>
                          <th scope="col" className="px-2 py-2 text-right font-medium">Tampil di marketplace</th>
                          <th scope="col" className="px-2 py-2 text-right font-medium">Dikirim</th>
                          <th scope="col" className="px-2 py-2 text-left font-medium">Terakhir sinkron</th>
                          <th scope="col" className="px-2 py-2 text-left font-medium">Status</th>
                          <th scope="col" className="w-10 px-2 py-2 text-right font-medium" aria-label="Aksi" />
                        </tr>
                      </thead>
                      <tbody>
                        {group.listings.map((listing) => {
                          const mismatch = isListingMismatch(listing);
                          const variantId = listing.platformSkuId ?? listing.channelSku;
                          return (
                            <tr key={listing.id} className={`border-b border-border/60 last:border-b-0 ${selected.has(listing.id) ? "bg-primary/[0.04]" : ""}`}>
                              <td className="px-3 py-2 align-top">
                                <input
                                  type="checkbox"
                                  className="mt-0.5 size-4 accent-primary"
                                  aria-label={`Pilih listing ${listingName(listing)} di ${listing.store}`}
                                  checked={selected.has(listing.id)}
                                  onChange={() => toggleSelected(listing.id)}
                                />
                              </td>
                              <td className="px-2 py-2 align-top">
                                <div className="flex items-center gap-2 min-w-0">
                                  <VariantThumbnail src={listing.imageUrl} fallbackSrc={row.imageUrl} size={32} alt={listingName(listing)} />
                                  <div className="min-w-0">
                                    <p className="line-clamp-2 font-medium text-foreground">{listingName(listing)}</p>
                                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                      <span title={variantId}>
                                        ID <code className="break-all">{shortVariantId(variantId)}</code>
                                      </span>
                                      <button
                                        type="button"
                                        className="inline-flex size-6 items-center justify-center rounded hover:bg-muted"
                                        aria-label={`Salin ID ${listing.store}`}
                                        onClick={() => void copyId(listing)}
                                      >
                                        <Copy className="size-3" aria-hidden="true" />
                                      </button>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button type="button" className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted" aria-label="Cara angka Dikirim dihitung">
                                            <Info className="size-3" aria-hidden="true" />
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                          max(0, Bisa Dijual {fmt(row.available)} − buffer {fmt(listing.allocation.buffer)})
                                          {listing.allocation.mode === "PERCENT" ? ` × ${listing.allocation.value}%`
                                            : listing.allocation.mode === "EQUAL" ? ` ÷ ${Math.max(1, row.listings.length)} listing`
                                              : listing.allocation.mode === "FIXED" ? ` (maks ${fmt(listing.allocation.value)} unit)` : " × 100%"}
                                        </TooltipContent>
                                      </Tooltip>
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-right align-top tabular-nums">
                                {listing.platformStock === null ? <span className="text-muted-foreground">Belum diketahui</span> : fmt(listing.platformStock)}
                              </td>
                              <td className="px-2 py-2 text-right align-top font-medium tabular-nums">{fmt(listing.quantity)}</td>
                              <td className="px-2 py-2 align-top text-xs text-muted-foreground">
                                {listing.lastSyncedAt ? new Date(listing.lastSyncedAt).toLocaleString("id-ID") : "belum pernah"}
                              </td>
                              <td className="px-2 py-2 align-top">
                                <div className="flex flex-col items-start gap-1">
                                  {/* Push nonaktif ditampilkan di header toko + banner baseline, bukan diulang per baris. */}
                                  {listing.status !== "DISABLED" && (
                                    <StatusBadge status={listing.status.toLowerCase()} label={stockStatusLabel(listing.status)} />
                                  )}
                                  {mismatch && (
                                    <StatusBadge status="mismatch" label={`${fmt(listing.platformStock ?? 0)} vs ${fmt(listing.quantity)}`} />
                                  )}
                                  {listing.error && <span className="break-words text-xs text-destructive">{listing.error}</span>}
                                  {listing.blockedReason && listing.disabledCode !== "BASELINE" && !listing.error && (
                                    <span className="text-xs text-muted-foreground">{listing.blockedReason}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-right align-top">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="icon" variant="ghost" aria-label={`Aksi untuk ${listingName(listing)} di ${listing.store}`}>
                                      <MoreHorizontal className="size-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-52">
                                    <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                                      {listing.store}
                                    </DropdownMenuLabel>
                                    <DropdownMenuItem onSelect={() => allocate([listing])}>Atur alokasi</DropdownMenuItem>
                                    <DropdownMenuItem disabled={busy} onSelect={() => retry(listing)}>
                                      <RefreshCw className="size-3.5" />Sinkron ulang
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={() => void copyId(listing)}>
                                      <Copy className="size-3.5" />Salin ID
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
