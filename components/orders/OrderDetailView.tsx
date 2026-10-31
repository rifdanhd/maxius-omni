"use client";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageState } from "@/components/ui/feedback";
import { friendlyError } from "@/lib/ui/feedback";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  Mail,
  MapPin,
  Package,
  Phone,
  Receipt,
  StickyNote,
  Store,
  Truck,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";

type DetailItem = {
  id: string;
  imageUrl: string | null;
  productName: string;
  variantLabel: string;
  masterSku: string | null;
  channelSku: string;
  qty: number;
  price: number | null;
  subTotal: number | null;
};

type DetailShipment = {
  carrier: string | null;
  trackingNo: string | null;
  status: string | null;
  shippedAt: string | null;
};

type DetailData = {
  orderNo: string;
  status: string;
  rawStatus: string;
  storeName: string;
  platform: string | null;
  orderDate: string | null;
  paidTime: string | null;
  shippingDueTime: string | null;
  rtsSlaTime: string | null;
  ttsSlaTime: string | null;
  paymentMethodName: string | null;
  isCod: boolean | null;
  currency: string | null;
  buyerNote: string | null;
  amount: number | null;
  canViewFullPii: boolean;
  buyer: {
    name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    nameMasked: boolean;
  };
  items: DetailItem[];
  shipments: DetailShipment[];
  payment: Record<string, number | string | null> | null;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function formatPrice(value: number | string | null | undefined, currency?: string | null) {
  if (value == null) return "-";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "-";
  const curr = currency?.trim() || "Rp";
  return curr === "IDR" || curr === "Rp" ? `Rp ${n.toLocaleString("id-ID")}` : `${curr} ${n.toLocaleString("id-ID")}`;
}

function num(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

const PLATFORM_LABEL: Record<string, string> = {
  TIKTOK_SHOP: "TikTok Shop",
  SHOPEE: "Shopee",
  TOKOPEDIA: "Tokopedia",
};

type TabId = "produk" | "pembayaran" | "pengiriman" | "penjualan";

/* ───────────────────────── Komponen kecil ───────────────────────── */

function InfoRow({ label, value, muted, negative }: { label: string; value: string; muted?: boolean; negative?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 text-right font-medium ${muted ? "text-muted-foreground" : negative ? "text-destructive" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

function SideCard({ icon: Icon, title, note, children }: { icon: LucideIcon; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon size={15} className="text-muted-foreground" aria-hidden="true" />
          {title}
        </h2>
        {note}
      </div>
      <div className="min-w-0 px-4 py-4 [overflow-wrap:anywhere]">{children}</div>
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Salin nomor pesanan"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard tidak tersedia */
        }
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Tersalin" : "Salin"}
    </button>
  );
}

type Step = { label: string; time: string | null; done: boolean };

function VerticalTimeline({ steps }: { steps: Step[] }) {
  const lastDone = steps.reduce((acc, s, i) => (s.done ? i : acc), -1);
  return (
    <ol>
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1;
        const isCurrent = i === lastDone;
        return (
          <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast && <span aria-hidden="true" className={`absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5 ${steps[i + 1].done ? "bg-primary" : "bg-border"}`} />}
            <span
              className={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold ${
                s.done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
              } ${isCurrent ? "ring-4 ring-primary/20" : ""}`}
            >
              {s.done ? <Check size={13} /> : i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={`text-sm ${s.done ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.time ? formatDate(s.time) : "-"}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────────────────────── Halaman ───────────────────────── */

export default function OrderDetailView({ orderId }: { orderId: string }) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("produk");
  const [drawerItem, setDrawerItem] = useState<DetailItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/orders/${orderId}`, {
        headers: {},
      });
      if (!res.ok) throw new Error(`Terjadi kesalahan saat memuat detail (${res.status})`);
      setDetail((await res.json()) as DetailData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan saat memuat detail.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await authFetch(`/api/orders/${orderId}`, {
          headers: {},
        });
        if (cancelled) return;
        if (!res.ok) throw new Error(`Terjadi kesalahan saat memuat detail (${res.status})`);
        const data = (await res.json()) as DetailData;
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Terjadi kesalahan saat memuat detail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // Tutup drawer dengan tombol Esc.
  useEffect(() => {
    if (!drawerItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerItem(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerItem]);

  const p = detail?.payment;

  // Timeline: tiga langkah awal dari data waktu yang tersedia, langkah akhir dari teks status.
  const firstShipment = detail?.shipments[0];
  const statusText = `${detail?.status ?? ""} ${detail?.rawStatus ?? ""}`.toLowerCase();
  const isFinished = /selesai|complete|deliver|diterima/.test(statusText);
  const steps: Step[] = detail
    ? [
        { label: "Dipesan", time: detail.orderDate, done: !!detail.orderDate },
        { label: "Dibayar", time: detail.paidTime, done: !!detail.paidTime || detail.isCod === true },
        { label: "Dikirim", time: firstShipment?.shippedAt ?? null, done: !!firstShipment?.shippedAt || isFinished },
        { label: "Selesai", time: null, done: isFinished },
      ]
    : [];

  const totalQty = detail?.items.reduce((acc, it) => acc + it.qty, 0) ?? 0;
  const itemsSubtotal = detail?.items.reduce((acc, it) => acc + num(it.subTotal), 0) ?? 0;
  const dueMs = detail?.shippingDueTime ? new Date(detail.shippingDueTime).getTime() : NaN;
  const overdue = Number.isFinite(dueMs) && dueMs < Date.now() && !(steps[2]?.done ?? false);

  const tabs: Array<{ id: TabId; label: string; count?: number; icon: LucideIcon }> = detail
    ? [
        { id: "produk", label: "Produk", count: detail.items.length, icon: Package },
        { id: "pembayaran", label: "Pembayaran", icon: CreditCard },
        { id: "pengiriman", label: "Pengiriman", count: detail.shipments.length, icon: Truck },
        { id: "penjualan", label: "Informasi Penjualan", icon: Receipt },
      ]
    : [];

  return (
    <div className="min-h-screen bg-muted font-sans">
      {/* Topbar */}
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="mx-auto flex min-h-14 max-w-[1400px] items-center justify-between gap-3 px-4 py-2">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Link
              href="/orders"
              aria-label="Kembali ke daftar pesanan"
              className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted md:size-9"
            >
              <ArrowLeft size={18} />
            </Link>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
              <Link href="/orders" className="hidden text-muted-foreground hover:text-foreground hover:underline sm:inline">
                Pesanan
              </Link>
              <ChevronRight size={14} className="hidden shrink-0 text-muted-foreground sm:block" />
              <span className="truncate font-semibold text-foreground">Detail Pesanan</span>
              {detail && (
                <>
                  <ChevronRight size={14} className="hidden shrink-0 text-muted-foreground md:block" />
                  <span className="hidden truncate font-mono text-xs text-muted-foreground md:inline">{detail.orderNo}</span>
                </>
              )}
            </nav>
          </div>
          {detail && (
            <div className="flex shrink-0 items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-[11px] leading-none text-muted-foreground">Total Pembayaran</p>
                <p className="mt-1 text-sm font-bold leading-none text-foreground">{formatPrice(detail.amount, detail.currency)}</p>
              </div>
              <StatusBadge status={detail.status} />
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-5 md:py-6">
        {loading && (
          <div className="grid animate-pulse grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
            <div className="space-y-4">
              <div className="h-56 rounded-xl border border-border bg-card" />
              <div className="h-40 rounded-xl border border-border bg-card" />
            </div>
            <div className="h-[460px] rounded-xl border border-border bg-card" />
          </div>
        )}

        {!loading && error && (
          <PageState
            variant="error"
            title="Pesanan belum dapat dimuat"
            description={friendlyError(error)}
            details={error}
            action={
              <button onClick={load} className="rounded-md border border-border px-4 py-2">
                Coba lagi
              </button>
            }
          />
        )}

        {!loading && detail && (
          <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-6">
            {/* ───────── Sidebar kiri: ringkasan tetap terlihat ───────── */}
            <aside className="min-w-0 space-y-4 lg:sticky lg:top-20">
              <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <div className="border-b border-border px-4 py-4">
                  <p className="text-xs text-muted-foreground">No. Pesanan</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-sm font-bold text-foreground">{detail.orderNo}</span>
                    <CopyButton text={detail.orderNo} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
                      <Store size={12} aria-hidden="true" />
                      {detail.storeName}
                    </span>
                    <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
                      {PLATFORM_LABEL[detail.platform ?? ""] ?? detail.platform ?? "-"}
                    </span>
                    {detail.isCod && <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">COD</span>}
                  </div>
                </div>

                {/* SLA kirim */}
                <div className={`flex items-start gap-3 border-b border-border px-4 py-3 ${overdue ? "bg-destructive-subtle" : "bg-muted/40"}`}>
                  {overdue ? (
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                  ) : (
                    <Clock size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className={`text-xs ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                      {overdue ? "Lewat batas kirim (SLA)" : "Kirim sebelum (SLA)"}
                    </p>
                    <p className={`text-sm font-semibold ${overdue ? "text-destructive" : "text-foreground"}`}>{formatDate(detail.shippingDueTime)}</p>
                  </div>
                </div>

                <div className="px-4 py-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status Pesanan</p>
                  <VerticalTimeline steps={steps} />
                </div>

                <div className="space-y-0.5 border-t border-border bg-muted/40 px-4 py-3">
                  <InfoRow label="Pembayaran" value={detail.isCod ? "COD (Bayar di Tempat)" : detail.paymentMethodName ?? "-"} />
                  <InfoRow label="Item" value={`${detail.items.length} produk · ${totalQty} pcs`} />
                </div>
              </section>

              {/* Pembeli */}
              <SideCard
                icon={User}
                title="Pembeli"
                note={
                  detail.canViewFullPii ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-foreground">
                      <Eye size={11} /> Data penuh (tercatat)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <EyeOff size={11} /> Ditampilkan terpotong
                    </span>
                  )
                }
              >
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
                      {(detail.buyer.name ?? "?").charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{detail.buyer.name ?? "-"}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Phone size={11} /> {detail.buyer.phone ?? "-"}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 break-all text-xs text-muted-foreground">
                        <Mail size={11} className="shrink-0" /> {detail.buyer.email ?? "-"}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3">
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                      <MapPin size={12} /> Alamat Pengiriman
                    </p>
                    <p className="text-sm leading-relaxed text-foreground">{detail.buyer.address ?? "-"}</p>
                  </div>
                  {detail.buyerNote && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted px-3 py-2.5">
                      <StickyNote size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground">Catatan Pembeli</p>
                        <p className="mt-0.5 text-sm italic text-foreground">“{detail.buyerNote}”</p>
                      </div>
                    </div>
                  )}
                </div>
              </SideCard>
            </aside>

            {/* ───────── Konten utama bertab ───────── */}
            <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div role="tablist" aria-label="Rincian pesanan" className="flex gap-1 overflow-x-auto border-b border-border px-2">
                {tabs.map(({ id, label, count, icon: Icon }) => {
                  const active = tab === id;
                  return (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(id)}
                      className={`relative inline-flex min-h-12 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm font-medium transition-colors ${
                        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon size={15} aria-hidden="true" />
                      {label}
                      {count != null && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                          {count}
                        </span>
                      )}
                      {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t-full bg-primary" />}
                    </button>
                  );
                })}
              </div>

              {/* Produk */}
              {tab === "produk" && (
                <div>
                  <ul className="divide-y divide-border">
                    {detail.items.map((it) => (
                      <li key={it.id}>
                        <button
                          type="button"
                          onClick={() => setDrawerItem(it)}
                          className="group flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/40 md:px-5"
                        >
                          {it.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.imageUrl} alt={it.productName} className="size-16 shrink-0 rounded-lg border border-border object-cover" />
                          ) : (
                            <div className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                              <Package size={20} aria-hidden="true" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold leading-snug text-foreground">{it.productName}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">Variasi: {it.variantLabel || "-"}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>
                                Master SKU:{" "}
                                {it.masterSku ? (
                                  <span className="font-mono text-foreground">{it.masterSku}</span>
                                ) : (
                                  <span className="rounded bg-destructive-subtle px-1.5 py-0.5 font-semibold text-destructive">Belum di-map</span>
                                )}
                              </span>
                              <span>
                                SKU Toko: <span className="font-mono text-foreground">{it.channelSku || "-"}</span>
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">
                                {it.price != null ? formatPrice(it.price, detail.currency) : "-"} × {it.qty}
                              </p>
                              <p className="mt-1 text-sm font-bold text-foreground">{formatPrice(it.subTotal, detail.currency)}</p>
                            </div>
                            <ChevronRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3 text-sm md:px-5">
                    <span className="text-muted-foreground">Subtotal produk ({totalQty} pcs)</span>
                    <span className="font-bold text-foreground">{formatPrice(itemsSubtotal, detail.currency)}</span>
                  </div>
                </div>
              )}

              {/* Pembayaran */}
              {tab === "pembayaran" && (
                <div className="p-4 md:p-6">
                  {!p ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Data pembayaran tidak tersedia.</p>
                  ) : (
                    <div className="mx-auto max-w-xl">
                      <div className="divide-y divide-border">
                        <InfoRow label="Subtotal" value={formatPrice(num(p.sub_total), detail.currency)} />
                        <InfoRow
                          label="Diskon Pesanan"
                          value={formatPrice(num(p.platform_discount) + num(p.seller_discount), detail.currency)}
                          negative={num(p.platform_discount) + num(p.seller_discount) > 0}
                        />
                        <InfoRow label="Biaya Pengiriman" value={formatPrice(num(p.shipping_fee), detail.currency)} />
                        <InfoRow
                          label="Diskon Pengiriman"
                          value={formatPrice(
                            num(p.shipping_fee_platform_discount) + num(p.shipping_fee_seller_discount) + num(p.shipping_fee_cofunded_discount),
                            detail.currency
                          )}
                          negative={num(p.shipping_fee_platform_discount) + num(p.shipping_fee_seller_discount) + num(p.shipping_fee_cofunded_discount) > 0}
                        />
                        <InfoRow label="Biaya Lain" value={formatPrice(num(p.tax), detail.currency)} />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3">
                        <span className="text-sm font-bold text-foreground">Pembayaran Pembeli</span>
                        <span className="text-xl font-bold text-foreground">{formatPrice(num(p.total_amount), detail.currency)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Pengiriman */}
              {tab === "pengiriman" && (
                <div className="p-4 md:p-6">
                  {detail.shipments.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Belum ada paket tercatat.</p>
                  ) : (
                    <ol className="mx-auto max-w-xl space-y-5">
                      {detail.shipments.map((s, i) => (
                        <li key={i} className="relative flex gap-3">
                          {i < detail.shipments.length - 1 && <span aria-hidden="true" className="absolute left-[13px] top-8 h-[calc(100%+0.25rem)] w-px bg-border" />}
                          <span className={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ${i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                            <Truck size={13} />
                          </span>
                          <div className="min-w-0 flex-1 rounded-xl border border-border p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-foreground">{s.carrier ?? "Kurir belum ditentukan"}</p>
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{s.status ?? "-"}</span>
                            </div>
                            <p className="mt-1.5 font-mono text-xs text-foreground">{s.trackingNo ?? "-"}</p>
                            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock size={11} /> {formatDate(s.shippedAt)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* Informasi penjualan (Finance API — belum terintegrasi) */}
              {tab === "penjualan" && (
                <div className="p-4 md:p-6">
                  <div className="mx-auto max-w-xl">
                    <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Sumber: TikTok Finance API</p>
                    <div className="divide-y divide-border">
                      <InfoRow label="Subtotal" value="-" muted />
                      <InfoRow label="Refund" value="-" muted />
                      <InfoRow label="Diskon Penjual" value="-" muted />
                      <InfoRow label="Total Faktur" value="-" muted />
                      <InfoRow label="Biaya Pengiriman Final" value="-" muted />
                      <InfoRow label="Biaya Layanan" value="-" muted />
                      <InfoRow label="Biaya Affiliate" value="-" muted />
                      <InfoRow label="Total Penjualan" value="-" muted />
                      <InfoRow label="Penyelesaian Pembayaran" value="-" muted />
                    </div>
                    <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                      Data Finance belum terintegrasi — akan diambil dari API Finance TikTok (fase terpisah).
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* ───────── Drawer rincian produk ───────── */}
      {drawerItem && detail && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Rincian produk pesanan">
          <button type="button" aria-label="Tutup rincian" className="absolute inset-0 bg-foreground/30" onClick={() => setDrawerItem(null)} />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Rincian Produk</h2>
              <button
                type="button"
                aria-label="Tutup"
                onClick={() => setDrawerItem(null)}
                className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {drawerItem.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={drawerItem.imageUrl} alt={drawerItem.productName} className="aspect-square w-full rounded-xl border border-border object-cover" />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
                  <Package size={36} aria-hidden="true" />
                </div>
              )}
              <div>
                <p className="text-base font-semibold leading-snug text-foreground">{drawerItem.productName}</p>
                <p className="mt-1 text-sm text-muted-foreground">Variasi: {drawerItem.variantLabel || "-"}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-muted px-3 py-2.5">
                  <p className="text-[11px] text-muted-foreground">Harga</p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">{formatPrice(drawerItem.price, detail.currency)}</p>
                </div>
                <div className="rounded-xl bg-muted px-3 py-2.5">
                  <p className="text-[11px] text-muted-foreground">Qty</p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">{drawerItem.qty}</p>
                </div>
                <div className="rounded-xl bg-muted px-3 py-2.5">
                  <p className="text-[11px] text-muted-foreground">Subtotal</p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">{formatPrice(drawerItem.subTotal, detail.currency)}</p>
                </div>
              </div>
              <div className="divide-y divide-border rounded-xl border border-border">
                <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Master SKU</span>
                  {drawerItem.masterSku ? (
                    <span className="font-mono text-foreground">{drawerItem.masterSku}</span>
                  ) : (
                    <span className="rounded bg-destructive-subtle px-1.5 py-0.5 text-xs font-semibold text-destructive">Belum di-map</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">SKU Toko</span>
                  <span className="break-all font-mono text-foreground">{drawerItem.channelSku || "-"}</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Toko</span>
                  <span className="text-foreground">{detail.storeName}</span>
                </div>
              </div>
              {!drawerItem.masterSku && (
                <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive-subtle px-4 py-3">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                  <p className="text-xs text-destructive">SKU ini belum dihubungkan ke stok pusat, sehingga stok tidak ikut terpotong otomatis.</p>
                </div>
              )}
            </div>
            <div className="border-t border-border px-5 py-4">
              <Link
                href="/products/mapping"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Buka Mapping Stok <ArrowUpRight size={14} />
              </Link>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}