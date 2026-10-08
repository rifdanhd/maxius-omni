"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
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
  return currency ? `Rp ${n.toLocaleString("id-ID")}` : `Rp ${n.toLocaleString("id-ID")}`;
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

function Card({ title, note, children }: { title: React.ReactNode; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm">
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">{title}</h2>
        {note}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-foreground font-medium ${muted ? "text-muted-foreground" : ""}`}>{value}</span>
    </div>
  );
}

export default function OrderDetailView({ orderId }: { orderId: string }) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/orders/${orderId}`, {
        headers: { },
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
    (async () => {
      await load();
    })();
  }, [load]);

  const p = detail?.payment;

  return (
    <div className="min-h-screen bg-muted font-sans">
      {/* Topbar */}
      <header className="sticky top-0 z-20 bg-card border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/orders"
              className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-sm font-bold text-foreground leading-tight">Detail Pesanan</h1>
              <p className="text-xs text-muted-foreground leading-tight">No. Pesanan: {detail?.orderNo ?? "..."}</p>
            </div>
          </div>
          {detail && (
            <span
              className={`px-3 py-1 rounded-md border text-xs font-bold ${
                detail.status === "AWAITING_SHIPMENT"
                  ? "bg-muted text-foreground border-border"
                  : "bg-muted text-foreground border-border"
              }`}
            >
              {detail.status}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {loading && <div className="py-24 text-center text-muted-foreground">Memuat detail pesanan...</div>}

        {!loading && error && (
          <div className="py-24 text-center">
            <p className="text-foreground mb-4">{error}</p>
            <button
              onClick={load}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary"
            >
              Coba Lagi
            </button>
          </div>
        )}

        {!loading && detail && (
          <div className="grid lg:grid-cols-3 gap-6 items-start">
            {/* Kolom kiri */}
            <div className="lg:col-span-2 space-y-6">
              {/* Badges + Ringkasan pesanan */}
              <Card title="Ringkasan Pesanan">
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-bold">
                    {detail.storeName}
                  </span>
                  <span className="px-3 py-1 rounded-md bg-muted text-foreground text-xs font-semibold">
                    {PLATFORM_LABEL[detail.platform ?? ""] ?? detail.platform ?? "-"}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Metode Pembayaran</p>
                    <p className="text-foreground">{detail.isCod ? "COD (Bayar di Tempat)" : detail.paymentMethodName ?? "-"}</p>
                    <p className="text-muted-foreground text-xs mt-0.5">{formatPrice(detail.amount, detail.currency)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Tanggal Pesanan</p>
                    <p className="text-foreground">{formatDate(detail.orderDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Dibayar</p>
                    <p className="text-foreground">{formatDate(detail.paidTime)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">Kirim Sebelum (SLA)</p>
                    <p className="text-foreground">{formatDate(detail.shippingDueTime)}</p>
                  </div>
                </div>
              </Card>

              {/* Catatan pembeli */}
              {detail.buyerNote && (
                <div className="bg-muted border border-border rounded-xl px-5 py-4">
                  <p className="text-xs font-semibold text-foreground mb-1">Catatan Pembeli</p>
                  <p className="text-sm text-foreground italic">“{detail.buyerNote}”</p>
                </div>
              )}

              {/* Pembeli */}
              <Card
                title="Pembeli"
                note={
                  detail.canViewFullPii ? (
                    <span className="inline-flex items-center gap-1 text-xs text-foreground">
                      <Eye size={12} /> Data penuh (tercatat)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <EyeOff size={12} /> Ditampilkan terpotong
                    </span>
                  )
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <div className="py-1">
                    <p className="text-xs text-muted-foreground">Pembeli</p>
                    <p className="text-sm text-foreground font-medium">{detail.buyer.name ?? "-"}</p>
                  </div>
                  <div className="py-1">
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="text-sm text-foreground break-all">{detail.buyer.email ?? "-"}</p>
                  </div>
                  <div className="py-1">
                    <p className="text-xs text-muted-foreground">Nomor Telepon</p>
                    <p className="text-sm text-foreground">{detail.buyer.phone ?? "-"}</p>
                  </div>
                  <div className="py-1">
                    <p className="text-xs text-muted-foreground">Alamat Pengiriman</p>
                    <p className="text-sm text-foreground">{detail.buyer.address ?? "-"}</p>
                  </div>
                </div>
              </Card>

              {/* Produk */}
              <Card title="Informasi Produk">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="text-left text-xs font-semibold text-muted-foreground border-b border-border">
                        <th className="py-2 pr-2 w-[44px]"></th>
                        <th className="py-2 px-2">Produk</th>
                        <th className="py-2 px-2">Master SKU</th>
                        <th className="py-2 px-2 text-right">Qty</th>
                        <th className="py-2 px-2 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((it) => (
                        <tr key={it.id} className="border-b border-border last:border-none align-top">
                          <td className="py-3 pr-2">
                            {it.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={it.imageUrl} alt={it.productName} className="w-10 h-10 rounded-md object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded-md bg-muted" />
                            )}
                          </td>
                          <td className="py-3 px-2">
                            <p className="text-foreground font-medium">{it.productName}</p>
                            <p className="text-muted-foreground text-xs">
                              {it.variantLabel}
                              {it.price != null && <> · {formatPrice(it.price, detail.currency)}/unit</>}
                            </p>
                          </td>
                          <td className="py-3 px-2 text-muted-foreground font-mono text-xs">
                            {it.masterSku ?? <span className="text-muted-foreground">Belum di-map</span>}
                          </td>
                          <td className="py-3 px-2 text-right text-foreground">{it.qty}</td>
                          <td className="py-3 px-2 text-right text-foreground font-medium">
                            {formatPrice(it.subTotal, detail.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* Kolom kanan */}
            <div className="space-y-6 lg:sticky lg:top-20">
              {/* Pembayaran pembeli */}
              <Card title="Pembayaran Pembeli">
                {!p ? (
                  <p className="text-sm text-muted-foreground">Data pembayaran tidak tersedia.</p>
                ) : (
                  <div className="py-1">
                    <InfoRow label="Subtotal" value={formatPrice(num(p.sub_total), detail.currency)} />
                    <InfoRow
                      label="Diskon Pesanan"
                      value={formatPrice(num(p.platform_discount) + num(p.seller_discount), detail.currency)}
                    />
                    <InfoRow label="Biaya Pengiriman" value={formatPrice(num(p.shipping_fee), detail.currency)} />
                    <InfoRow
                      label="Diskon Pengiriman"
                      value={formatPrice(
                        num(p.shipping_fee_platform_discount) + num(p.shipping_fee_seller_discount) + num(p.shipping_fee_cofunded_discount),
                        detail.currency
                      )}
                    />
                    <InfoRow label="Biaya Lain" value={formatPrice(num(p.tax), detail.currency)} />
                    <div className="border-t border-border mt-1 pt-2 pb-1 flex items-center justify-between flex-wrap gap-3 text-sm font-bold text-foreground">
                      <span>Pembayaran Pembeli</span>
                      <span>{formatPrice(num(p.total_amount), detail.currency)}</span>
                    </div>
                  </div>
                )}
              </Card>

              {/* Pengiriman */}
              <Card title="Rincian Pengiriman">
                {detail.shipments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada paket tercatat.</p>
                ) : (
                  <div className="space-y-3">
                    {detail.shipments.map((s, i) => (
                      <div key={i} className="border border-border rounded-lg px-3 py-2.5">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-foreground text-sm">{s.carrier ?? "Kurir belum ditentukan"}</p>
                          <span className="text-xs font-medium text-muted-foreground">{s.status ?? "-"}</span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-foreground text-xs font-mono">{s.trackingNo ?? "-"}</p>
                          <p className="text-muted-foreground text-xs">{formatDate(s.shippedAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Informasi penjualan (Finance API — belum terintegrasi) */}
              <Card
                title="Informasi Penjualan"
                note={
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Sumber: TikTok Finance API</span>
                }
              >
                <div className="py-1">
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
                <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border">
                  Data Finance belum terintegrasi — akan diambil dari API Finance TikTok (fase terpisah).
                </p>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
