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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <PackageCheck size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">
                Atur Pengiriman ({orders.length})
              </h2>
              <p className="text-xs text-gray-500">Jadwalkan pickup atau pengantaran paket ke kurir</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Tabel pesanan */}
          <div>
            <p className="text-xs font-bold text-gray-900 mb-2 flex items-center gap-1.5">
              <Truck size={14} className="text-indigo-600" /> Daftar Pesanan
            </p>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-2.5">Kurir</th>
                      <th className="px-4 py-2.5">No. Pesanan</th>
                      <th className="px-4 py-2.5">Metode Bayar</th>
                      <th className="px-4 py-2.5 text-center">Total Qty</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id} className="border-b border-gray-50 last:border-none">
                        <td className="px-4 py-3 text-xs text-gray-700 font-medium">
                          {order.courier && order.courier !== "-"
                            ? order.courier
                            : loading
                            ? "Memuat..."
                            : "TikTok Shipping"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 bg-black text-white rounded text-[9px] font-bold flex items-center gap-0.5">
                              <TikTokLogo size={8} /> {order.platform}
                            </span>
                            <span className="text-xs font-bold text-gray-900">{order.orderNo}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">{order.paymentMethod}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 text-center font-semibold">{order.totalQty}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] font-bold rounded border border-orange-200">
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
            <p className="text-xs font-bold text-gray-900 mb-2 flex items-center gap-1.5">
              <Truck size={14} className="text-indigo-600" /> Kurir & Layanan
            </p>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-white flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">TikTok Shipping</p>
                  <p className="text-[11px] text-gray-500">Kurir ditentukan & resi diterbitkan oleh TikTok</p>
                </div>
                <span className="px-2 py-1 bg-indigo-50 text-indigo-600 text-[10px] font-bold rounded-md border border-indigo-100">
                  TikTok Shipping
                </span>
              </div>
              <div className="px-4 py-3 border-t border-gray-100 bg-white">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                  Metode Penyerahan Paket
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={canPickup === false}
                    onClick={() => setMode("PICKUP")}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                      mode === "PICKUP"
                        ? "border-indigo-600 bg-indigo-600 text-white shadow-xs"
                        : "border-gray-200 text-gray-700 hover:bg-gray-50"
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
                        ? "border-indigo-600 bg-indigo-600 text-white shadow-xs"
                        : "border-gray-200 text-gray-700 hover:bg-gray-50"
                    } ${canDropOff === false ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <Warehouse size={14} /> Drop Off
                  </button>
                </div>
                {showDropOffHint && (
                  <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1">
                    <AlertCircle size={12} /> Drop Off: paket diantar sendiri ke titik penyerahan kurir.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Jadwal pickup */}
          {mode === "PICKUP" && (
            <div>
              <p className="text-xs font-bold text-gray-900 mb-2 flex items-center gap-1.5">
                <Clock size={14} className="text-indigo-600" /> Atur Jadwal Penjemputan
              </p>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <label className="flex items-start gap-2.5 px-4 py-3 bg-white cursor-pointer hover:bg-gray-50 border-b border-gray-100">
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
                    <p className="text-sm font-medium text-gray-800">Fleksibel</p>
                    <p className="text-[11px] text-gray-500">
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
                        className={`flex items-center gap-2.5 px-4 py-3 bg-white cursor-pointer border-b border-gray-100 last:border-b-0 ${
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
                          <p className="text-sm font-medium text-gray-800">{label}</p>
                          <p className="text-[11px] text-gray-500">
                            {s.available ? "Slot tersedia" : "Slot penuh"}
                          </p>
                        </div>
                      </label>
                    );
                  })
                ) : !loading && !slotsError ? (
                  <div className="px-4 py-3 bg-white text-[12px] text-gray-500">
                    Tidak ada slot pickup dari TikTok — gunakan mode Foto / Fleksibel.
                  </div>
                ) : null}
                {slotsError && (
                  <div className="px-4 py-3 bg-amber-50 text-[11px] text-amber-700 flex items-start gap-1.5">
                    <AlertCircle size={13} className="shrink-0 mt-0.5" />
                    {slotsError}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Lokasi penjemputan */}
          <div>
            <p className="text-xs font-bold text-gray-900 mb-2 flex items-center gap-1.5">
              <MapPin size={14} className="text-indigo-600" /> Lokasi Penjemputan
            </p>
            <div className="border border-gray-200 rounded-xl px-4 py-3 bg-white text-sm text-gray-700">
              {pickupLocation ?? "Master Warehouse"}
            </div>
          </div>

          {/* Catatan penjual */}
          <div>
            <p className="text-xs font-bold text-gray-900 mb-2 flex items-center gap-1.5">
              <StickyNote size={14} className="text-indigo-600" /> Catatan Penjual
            </p>
            <textarea
              value={sellerNote}
              onChange={(e) => setSellerNote(e.target.value)}
              rows={2}
              placeholder="Catatan untuk kurir / gudang (opsional)"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 resize-none"
            />
          </div>

          {actionError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              {actionError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 shadow-xs"
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
