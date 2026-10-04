"use client";

import { useState } from "react";
import { X, Truck, Copy, Check, ExternalLink, MapPin, Clock } from "lucide-react";

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

export type TrackingEvent = {
  actionCode: number | null;
  description: string;
  eventTime: string;
};

// Label ID utk actionCode yang sudah dikenal (sandbox TAHAP 0/3: 20101).
// Kode lain → fallback description asli TikTok (Inggris) sampai diverifikasi.
const EVENT_LABELS_ID: Record<number, string> = {
  20101: "Seller menyiapkan paket",
};

function eventLabel(ev: TrackingEvent): string {
  if (ev.actionCode !== null && EVENT_LABELS_ID[ev.actionCode]) {
    return EVENT_LABELS_ID[ev.actionCode];
  }
  return ev.description || "Pembaruan paket";
}

const EVENT_TIME_FMT = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : EVENT_TIME_FMT.format(d);
}

export default function TrackingModal({
  order,
  trackingEvents,
  loading = false,
  error = null,
  onClose,
}: {
  order: TrackingModalData;
  // Riwayat nyata dari /api/orders/[id]/tracking (ShipmentTrackingEvent).
  // Riwayat kosong tidak boleh digantikan dengan kejadian pengiriman simulasi.
  trackingEvents?: TrackingEvent[] | null;
  loading?: boolean;
  error?: string | null;
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

  const hasRealEvents = !!trackingEvents && trackingEvents.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-card rounded-2xl max-w-lg w-full shadow-2xl border border-border overflow-y-auto flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3 bg-muted/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-muted text-foreground flex items-center justify-center">
              <Truck size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground leading-tight">
                Lacak Pengiriman
              </h2>
              <p className="text-xs text-muted-foreground">
                No. Pesanan: <span className="font-semibold text-foreground">{order.orderId}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Tracking Info Card */}
          <div className="bg-muted rounded-xl p-4 border border-border/80">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Kurir & Layanan
                </p>
                <p className="text-sm font-bold text-foreground">
                  {order.courier && order.courier !== "-" ? order.courier : "Kurir Belum Ditentukan"}
                </p>
              </div>

              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Nomor Resi
                </p>
                {hasTracking ? (
                  <div className="flex items-center gap-1.5 justify-end">
                    <span className="font-mono text-sm font-bold text-foreground">
                      {order.trackingNumber}
                    </span>
                    <button
                      onClick={handleCopy}
                      title="Salin Resi"
                      className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {copied ? <Check size={14} className="text-foreground" /> : <Copy size={14} />}
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-foreground bg-muted border border-border px-2 py-0.5 rounded font-medium">
                    Belum Diterbitkan
                  </span>
                )}
              </div>
            </div>

            {order.pickupLocation && (
              <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin size={13} className="shrink-0 text-muted-foreground" />
                <span>Lokasi Gudang: <span className="font-medium text-foreground">{order.pickupLocation}</span></span>
              </div>
            )}
          </div>

          {/* Timeline Tracking */}
          <div>
            <p className="text-xs font-bold text-foreground mb-3 flex items-center gap-1.5">
              <Clock size={14} className="text-foreground" />
              Status & Riwayat Pengiriman
            </p>

            {hasRealEvents ? (
              <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-muted">
                {trackingEvents!.map((ev, idx) => {
                  const label = eventLabel(ev);
                  const translated = label !== ev.description;
                  return (
                    <div key={`${ev.eventTime}-${idx}`} className="relative">
                      <div className="absolute -left-6 top-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border-2 bg-muted-foreground border-border text-primary-foreground shadow-xs">
                        <Check size={10} strokeWidth={3} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-foreground">{label}</p>
                        <p className="text-[11px] leading-tight mt-0.5 text-muted-foreground">
                          {formatEventTime(ev.eventTime)}
                          {translated ? ` — ${ev.description}` : ""}
                          {ev.actionCode !== null ? ` · kode ${ev.actionCode}` : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground" role={error ? "alert" : undefined}>
                {loading ? "Memuat riwayat pengiriman…" : error ?? "Belum ada riwayat pengiriman dari kurir. Status pesanan saja tidak memastikan paket sudah diambil atau diterima pembeli."}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-muted border-t border-border flex items-center justify-between flex-wrap gap-3">
          {hasTracking ? (
            <a
              href={`https://cekresi.com/?noresi=${encodeURIComponent(order.trackingNumber)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-foreground hover:text-foreground flex items-center gap-1.5 hover:underline"
            >
              <span>Cek di Web Kurir</span>
              <ExternalLink size={13} />
            </a>
          ) : (
            <span className="text-[11px] text-muted-foreground">Resi otomatis update saat paket di-ship</span>
          )}

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-card border border-border rounded-lg text-xs font-semibold text-foreground hover:bg-muted transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
