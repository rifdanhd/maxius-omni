"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";

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
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">{title}</h2>
        {note}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`text-gray-900 font-medium ${muted ? "text-gray-400" : ""}`}>{value}</span>
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
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
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
    <div className="min-h-screen bg-gray-100 font-sans">
      {/* Topbar */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/orders"
              className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-sm font-bold text-gray-900 leading-tight">Detail Pesanan</h1>
              <p className="text-xs text-gray-500 leading-tight">No. Pesanan: {detail?.orderNo ?? "..."}</p>
            </div>
          </div>
          {detail && (
            <span
              className={`px-3 py-1 rounded-md border text-xs font-bold ${
                detail.status === "AWAITING_SHIPMENT"
                  ? "bg-orange-50 text-orange-700 border-orange-200"
                  : "bg-gray-100 text-gray-700 border-gray-200"
              }`}
            >
              {detail.status}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {loading && <div className="py-24 text-center text-gray-500">Memuat detail pesanan...</div>}

        {!loading && error && (
          <div className="py-24 text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={load}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700"
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
                  <span className="px-3 py-1 rounded-md bg-black text-white text-xs font-bold">
                    {detail.storeName}
                  </span>
                  <span className="px-3 py-1 rounded-md bg-gray-100 text-gray-700 text-xs font-semibold">
                    {PLATFORM_LABEL[detail.platform ?? ""] ?? detail.platform ?? "-"}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">Metode Pembayaran</p>
                    <p className="text-gray-900">{detail.isCod ? "COD (Bayar di Tempat)" : detail.paymentMethodName ?? "-"}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{formatPrice(detail.amount, detail.currency)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">Tanggal Pesanan</p>
                    <p className="text-gray-900">{formatDate(detail.orderDate)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">Dibayar</p>
                    <p className="text-gray-900">{formatDate(detail.paidTime)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">Kirim Sebelum (SLA)</p>
                    <p className="text-gray-900">{formatDate(detail.shippingDueTime)}</p>
                  </div>
                </div>
              </Card>

              {/* Catatan pembeli */}
              {detail.buyerNote && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
                  <p className="text-xs font-semibold text-amber-700 mb-1">Catatan Pembeli</p>
                  <p className="text-sm text-gray-800 italic">“{detail.buyerNote}”</p>
                </div>
              )}

              {/* Pembeli */}
              <Card
                title="Pembeli"
                note={
                  detail.canViewFullPii ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                      <Eye size={12} /> Data penuh (tercatat)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <EyeOff size={12} /> Ditampilkan terpotong
                    </span>
                  )
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <div className="py-1">
                    <p className="text-xs text-gray-500">Pembeli</p>
                    <p className="text-sm text-gray-900 font-medium">{detail.buyer.name ?? "-"}</p>
                  </div>
                  <div className="py-1">
                    <p className="text-xs text-gray-500">Email</p>
                    <p className="text-sm text-gray-900 break-all">{detail.buyer.email ?? "-"}</p>
                  </div>
                  <div className="py-1">
                    <p className="text-xs text-gray-500">Nomor Telepon</p>
                    <p className="text-sm text-gray-900">{detail.buyer.phone ?? "-"}</p>
                  </div>
                  <div className="py-1">
                    <p className="text-xs text-gray-500">Alamat Pengiriman</p>
                    <p className="text-sm text-gray-900">{detail.buyer.address ?? "-"}</p>
                  </div>
                </div>
              </Card>

              {/* Produk */}
              <Card title="Informasi Produk">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="text-left text-xs font-semibold text-gray-500 border-b border-gray-100">
                        <th className="py-2 pr-2 w-[44px]"></th>
                        <th className="py-2 px-2">Produk</th>
                        <th className="py-2 px-2">Master SKU</th>
                        <th className="py-2 px-2 text-right">Qty</th>
                        <th className="py-2 px-2 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((it) => (
                        <tr key={it.id} className="border-b border-gray-50 last:border-none align-top">
                          <td className="py-3 pr-2">
                            {it.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={it.imageUrl} alt={it.productName} className="w-10 h-10 rounded-md object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded-md bg-gray-100" />
                            )}
                          </td>
                          <td className="py-3 px-2">
                            <p className="text-gray-900 font-medium">{it.productName}</p>
                            <p className="text-gray-400 text-xs">
                              {it.variantLabel}
                              {it.price != null && <> · {formatPrice(it.price, detail.currency)}/unit</>}
                            </p>
                          </td>
                          <td className="py-3 px-2 text-gray-500 font-mono text-xs">
                            {it.masterSku ?? <span className="text-gray-400">Belum di-map</span>}
                          </td>
                          <td className="py-3 px-2 text-right text-gray-900">{it.qty}</td>
                          <td className="py-3 px-2 text-right text-gray-900 font-medium">
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
                  <p className="text-sm text-gray-500">Data pembayaran tidak tersedia.</p>
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
                    <div className="border-t border-gray-200 mt-1 pt-2 pb-1 flex items-center justify-between text-sm font-bold text-gray-900">
                      <span>Pembayaran Pembeli</span>
                      <span>{formatPrice(num(p.total_amount), detail.currency)}</span>
                    </div>
                  </div>
                )}
              </Card>

              {/* Pengiriman */}
              <Card title="Rincian Pengiriman">
                {detail.shipments.length === 0 ? (
                  <p className="text-sm text-gray-500">Belum ada paket tercatat.</p>
                ) : (
                  <div className="space-y-3">
                    {detail.shipments.map((s, i) => (
                      <div key={i} className="border border-gray-100 rounded-lg px-3 py-2.5">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-gray-900 text-sm">{s.carrier ?? "Kurir belum ditentukan"}</p>
                          <span className="text-xs font-medium text-gray-500">{s.status ?? "-"}</span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-gray-900 text-xs font-mono">{s.trackingNo ?? "-"}</p>
                          <p className="text-gray-400 text-xs">{formatDate(s.shippedAt)}</p>
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
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Sumber: TikTok Finance API</span>
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
                <p className="text-[11px] text-gray-400 mt-2 pt-2 border-t border-gray-100">
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