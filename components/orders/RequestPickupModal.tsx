"use client";

import { useEffect, useState } from "react";
import {
  X, PackageCheck, Truck, MapPin, StickyNote, Loader2,
  Radio, Warehouse, Clock, AlertCircle,
} from "lucide-react";
import TikTokLogo from "@/components/icons/TikTokLogo";
import { authFetch } from "@/lib/utils/api-client";

export type PickupShipResult = {
  ok: boolean;
  summary?: { success: number; failed: number; total: number };
  results?: Array<{
    orderId: string;
    orderNo: string;
    ok: boolean;
    trackingNumber?: string | null;
    providerName?: string | null;
    error?: string;
  }>;
  error?: string;
};

export type RequestPickupOrder = {
  id: string;
  orderNo: string;
  status: string;
  platform: string;
  storeName: string;
  totalQty: number;
  totalPrice: string;
  buyerName: string;
  courier: string;
  paymentMethod: string;
};

export type PickupSlot = { startTime: number; endTime: number; available: boolean };

function useFetchSlots(orderId: string) {
  const [loading, setLoading] = useState(true);
  const [courier, setCourier] = useState<string | null>(null);
  const [pickupLocation, setPickupLocation] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [sellerNote, setSellerNote] = useState("");
  const [slots, setSlots] = useState<PickupSlot[]>([]);
  const [canPickup, setCanPickup] = useState<boolean | null>(null);
  const [canDropOff, setCanDropOff] = useState<boolean | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("token");

    const loadDetail = async () => {
      try {
        const res = await authFetch(`/api/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const d = await res.json();
        const shipment = d?.shipments?.[0];
        setCourier(shipment?.carrier ?? null);
        setPickupLocation(d?.pickupLocation ?? null);
        setPaymentMethod(d?.paymentMethodName ?? null);
        setSellerNote(d?.sellerNote ?? "");
      } catch {
        /* detail gagal → modal tetap jalan dgn data kartu */
      }
    };

    const loadSlots = async () => {
      try {
        const res = await authFetch(`/api/orders/${orderId}/handover-slots`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        const d = await res.json();
        if (!res.ok || !d?.ok) {
          setSlotsError(d?.error ?? "Opsi penjemputan tidak tersedia.");
          return;
        }
        setCanPickup(Boolean(d.canPickup));
        setCanDropOff(Boolean(d.canDropOff));
        setSlots(
          Array.isArray(d.pickupSlots)
            ? d.pickupSlots.filter((s: PickupSlot) => s.startTime > 0)
            : []
        );
      } catch {
        if (!cancelled) setSlotsError("Gagal memuat opsi penjemputan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    Promise.all([loadDetail(), loadSlots()]);
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return { loading, courier, pickupLocation, paymentMethod, sellerNote, setSellerNote, slots, canPickup, canDropOff, slotsError };
}

function formatSlot(s: { startTime: number; endTime: number }) {
  const fmt = (sec: number) =>
    new Date(sec * 1000).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  return `${fmt(s.startTime)} — ${fmt(s.endTime)}`;
}

export default function RequestPickupModal({
  orders,
  onClose,
  onConfirm,
}: {
  orders: RequestPickupOrder[];
  onClose: () => void;
  onConfirm: (result: PickupShipResult) => void;
}) {
  // Fetch handover slots & detail dari order pertama sebagai representatif.
  const representativeId = orders[0]?.id ?? "";
  const { loading, pickupLocation, sellerNote, setSellerNote, slots, canPickup, canDropOff, slotsError } =
    useFetchSlots(representativeId);

  const [mode, setMode] = useState<"PICKUP" | "DROP_OFF">("PICKUP");
  const [flexible, setFlexible] = useState(true);
  const [pickedSlot, setPickedSlot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const slot = !flexible && pickedSlot !== null ? slots[pickedSlot] : null;
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/orders/fulfillment/pickup", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: orders.map((o) => o.id),
          handover_method: mode,
          ...(slot ? { pickup_slot: { start_time: slot.startTime, end_time: slot.endTime } } : {}),
          seller_note: sellerNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data?.error ?? `Gagal memproses (${res.status})`);
        return;
      }
      onConfirm({
        ok: true,
        summary: data.summary,
        results: data.results,
      });
    } catch {
      setActionError("Terjadi kesalahan jaringan saat mengatur pengiriman.");
    } finally {
      setBusy(false);
    }
  };

  const showDropOffHint = mode === "DROP_OFF" || (canDropOff === false && canPickup === true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-card rounded-2xl max-w-3xl w-full shadow-2xl border border-border overflow-y-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3 bg-muted/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-muted text-foreground flex items-center justify-center">
              <PackageCheck size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground leading-tight">
                Atur Pengiriman ({orders.length})
              </h2>
              <p className="text-xs text-muted-foreground">Jadwalkan pickup atau pengantaran paket ke kurir</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Tabel pesanan */}
          <div>
            <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
              <Truck size={14} className="text-foreground" /> Daftar Pesanan
            </p>
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted border-b border-border">
                      <th className="px-4 py-2.5">Kurir</th>
                      <th className="px-4 py-2.5">No. Pesanan</th>
                      <th className="px-4 py-2.5">Metode Bayar</th>
                      <th className="px-4 py-2.5 text-center">Total Qty</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id} className="border-b border-border last:border-none">
                        <td className="px-4 py-3 text-xs text-foreground font-medium">
                          {order.courier && order.courier !== "-"
                            ? order.courier
                            : loading
                            ? "Memuat..."
                            : "TikTok Shipping"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 bg-primary text-primary-foreground rounded text-[9px] font-bold flex items-center gap-0.5">
                              <TikTokLogo size={8} /> {order.platform}
                            </span>
                            <span className="text-xs font-bold text-foreground">{order.orderNo}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground">{order.paymentMethod}</td>
                        <td className="px-4 py-3 text-xs text-foreground text-center font-semibold">{order.totalQty}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-muted text-foreground text-[10px] font-bold rounded border border-border">
                            {order.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Kurir & mode handover */}
          <div>
            <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
              <Truck size={14} className="text-foreground" /> Kurir & Layanan
            </p>
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-card flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">TikTok Shipping</p>
                  <p className="text-[11px] text-muted-foreground">Kurir ditentukan & resi diterbitkan oleh TikTok</p>
                </div>
                <span className="px-2 py-1 bg-muted text-foreground text-[10px] font-bold rounded-md border border-border">
                  TikTok Shipping
                </span>
              </div>
              <div className="px-4 py-3 border-t border-border bg-card">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Metode Penyerahan Paket
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={canPickup === false}
                    onClick={() => setMode("PICKUP")}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                      mode === "PICKUP"
                        ? "border-primary bg-primary text-primary-foreground shadow-xs"
                        : "border-border text-foreground hover:bg-muted"
                    } ${canPickup === false ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <Truck size={14} /> Request Pickup
                  </button>
                  <button
                    type="button"
                    disabled={canDropOff === false}
                    onClick={() => setMode("DROP_OFF")}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                      mode === "DROP_OFF"
                        ? "border-primary bg-primary text-primary-foreground shadow-xs"
                        : "border-border text-foreground hover:bg-muted"
                    } ${canDropOff === false ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <Warehouse size={14} /> Drop Off
                  </button>
                </div>
                {showDropOffHint && (
                  <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
                    <AlertCircle size={12} /> Drop Off: paket diantar sendiri ke titik penyerahan kurir.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Jadwal pickup */}
          {mode === "PICKUP" && (
            <div>
              <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
                <Clock size={14} className="text-foreground" /> Atur Jadwal Penjemputan
              </p>
              <div className="border border-border rounded-xl overflow-hidden">
                <label className="flex items-start gap-2.5 px-4 py-3 bg-card cursor-pointer hover:bg-muted border-b border-border">
                  <input
                    type="radio"
                    checked={flexible}
                    onChange={() => {
                      setFlexible(true);
                      setPickedSlot(null);
                    }}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">Fleksibel</p>
                    <p className="text-[11px] text-muted-foreground">
                      Kurir menyesuaikan penjemputan — tanpa slot waktu spesifik
                    </p>
                  </div>
                </label>
                {slots.length > 0 ? (
                  slots.map((s, i) => {
                    const label = formatSlot(s);
                    return (
                      <label
                        key={i}
                        className={`flex items-center gap-2.5 px-4 py-3 bg-card cursor-pointer border-b border-border last:border-b-0 ${
                          !s.available ? "opacity-50" : ""
                        }`}
                      >
                        <input
                          type="radio"
                          disabled={!s.available}
                          checked={!flexible && pickedSlot === i}
                          onChange={() => {
                            setFlexible(false);
                            setPickedSlot(i);
                          }}
                          className="mt-0.5"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">{label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {s.available ? "Slot tersedia" : "Slot penuh"}
                          </p>
                        </div>
                      </label>
                    );
                  })
                ) : !loading && !slotsError ? (
                  <div className="px-4 py-3 bg-card text-[12px] text-muted-foreground">
                    Tidak ada slot pickup dari TikTok — gunakan mode Foto / Fleksibel.
                  </div>
                ) : null}
                {slotsError && (
                  <div className="px-4 py-3 bg-muted text-[11px] text-foreground flex items-start gap-1.5">
                    <AlertCircle size={13} className="shrink-0 mt-0.5" />
                    {slotsError}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Lokasi penjemputan */}
          <div>
            <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
              <MapPin size={14} className="text-foreground" /> Lokasi Penjemputan
            </p>
            <div className="border border-border rounded-xl px-4 py-3 bg-card text-sm text-foreground">
              {pickupLocation ?? "Master Warehouse"}
            </div>
          </div>

          {/* Catatan penjual */}
          <div>
            <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
              <StickyNote size={14} className="text-foreground" /> Catatan Penjual
            </p>
            <textarea
              value={sellerNote}
              onChange={(e) => setSellerNote(e.target.value)}
              rows={2}
              placeholder="Catatan untuk kurir / gudang (opsional)"
              className="w-full border border-border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring resize-none"
            />
          </div>

          {actionError && (
            <div className="rounded-xl bg-muted border border-border px-4 py-3 text-xs text-foreground flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              {actionError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-muted border-t border-border flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 shadow-xs"
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Memproses ke TikTok...
              </>
            ) : mode === "PICKUP" ? (
              <>
                <Radio size={14} /> Konfirmasi & Jadwalkan Pickup
              </>
            ) : (
              <>Konfirmasi & Set Drop Off</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
