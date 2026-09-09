"use client";

import { useState } from "react";
import { X, Truck, Copy, Check, ExternalLink, MapPin, Package, Clock } from "lucide-react";

export type TrackingModalData = {
  orderId: string;
  courier: string;
  trackingNumber: string;
  status: string;
  orderDate: string;
  buyerName: string;
  address: string;
  pickupLocation?: string | null;
};

export default function TrackingModal({
  order,
  onClose,
}: {
  order: TrackingModalData;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const hasTracking =
    order.trackingNumber &&
    order.trackingNumber !== "-" &&
    order.trackingNumber.trim() !== "";

  const handleCopy = () => {
    if (!hasTracking) return;
    navigator.clipboard.writeText(order.trackingNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getTimeline = () => {
    const isShipped = [
      "AWAITING_COLLECTION",
      "IN_TRANSIT",
      "DELIVERED",
      "COMPLETED",
      "SHIPPED",
    ].includes(order.status);
    const isDelivered = ["DELIVERED", "COMPLETED"].includes(order.status);

    return [
      {
        title: "Pesanan Dibuat",
        desc: `Pesanan berhasil dibuat pada ${order.orderDate}`,
        done: true,
      },
      {
        title: "Pembayaran Dikonfirmasi",
        desc: "Pembayaran telah diverifikasi oleh marketplace",
        done: true,
      },
      {
        title: "Paket Diatur & Resi Terbit",
        desc: hasTracking
          ? `Nomor resi ${order.trackingNumber} berhasil dibuat (${order.courier})`
          : "Menunggu penerbitan resi dan pengemasan pesanan",
        done: hasTracking,
      },
      {
        title: "Penjemputan / Dalam Pengiriman",
        desc: isShipped
          ? `Paket dalam penanganan pihak kurir ${order.courier}`
          : "Menunggu penjemputan kurir di gudang",
        done: isShipped,
      },
      {
        title: "Pesanan Diterima",
        desc: isDelivered
          ? "Paket telah diterima oleh pembeli"
          : "Paket sedang menuju alamat penerima",
        done: isDelivered,
      },
    ];
  };

  const timeline = getTimeline();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Truck size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">
                Lacak Pengiriman
              </h2>
              <p className="text-xs text-gray-500">
                No. Pesanan: <span className="font-semibold text-gray-700">{order.orderId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Tracking Info Card */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/80">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                  Kurir & Layanan
                </p>
                <p className="text-sm font-bold text-gray-900">
                  {order.courier && order.courier !== "-" ? order.courier : "Kurir Belum Ditentukan"}
                </p>
              </div>

              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                  Nomor Resi
                </p>
                {hasTracking ? (
                  <div className="flex items-center gap-1.5 justify-end">
                    <span className="font-mono text-sm font-bold text-indigo-600">
                      {order.trackingNumber}
                    </span>
                    <button
                      onClick={handleCopy}
                      title="Salin Resi"
                      className="p-1 hover:bg-indigo-50 rounded text-gray-500 hover:text-indigo-600 transition-colors"
                    >
                      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-medium">
                    Belum Diterbitkan
                  </span>
                )}
              </div>
            </div>

            {order.pickupLocation && (
              <div className="mt-3 pt-3 border-t border-gray-200/60 flex items-center gap-1.5 text-xs text-gray-500">
                <MapPin size={13} className="shrink-0 text-gray-400" />
                <span>Lokasi Gudang: <span className="font-medium text-gray-700">{order.pickupLocation}</span></span>
              </div>
            )}
          </div>

          {/* Timeline Tracking */}
          <div>
            <p className="text-xs font-bold text-gray-900 mb-3 flex items-center gap-1.5">
              <Clock size={14} className="text-indigo-600" />
              Status & Riwayat Pengiriman
            </p>

            <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200">
              {timeline.map((step, idx) => (
                <div key={idx} className="relative">
                  <div
                    className={`absolute -left-6 top-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                      step.done
                        ? "bg-emerald-500 border-white text-white shadow-xs"
                        : "bg-white border-gray-300 text-gray-400"
                    }`}
                  >
                    {step.done ? <Check size={10} strokeWidth={3} /> : idx + 1}
                  </div>
                  <div>
                    <p
                      className={`text-xs font-semibold ${
                        step.done ? "text-gray-900" : "text-gray-400"
                      }`}
                    >
                      {step.title}
                    </p>
                    <p
                      className={`text-[11px] leading-tight mt-0.5 ${
                        step.done ? "text-gray-500" : "text-gray-400"
                      }`}
                    >
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          {hasTracking ? (
            <a
              href={`https://cekresi.com/?noresi=${encodeURIComponent(order.trackingNumber)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5 hover:underline"
            >
              <span>Cek di Web Kurir</span>
              <ExternalLink size={13} />
            </a>
          ) : (
            <span className="text-[11px] text-gray-400">Resi otomatis update saat paket di-ship</span>
          )}

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
