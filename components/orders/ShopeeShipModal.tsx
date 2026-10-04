"use client";

import { useEffect, useState } from "react";
import { X, PackageCheck, Truck, MapPin, Loader2, Warehouse, Clock, AlertCircle } from "lucide-react";
import ShopeeLogo from "@/components/icons/ShopeeLogo";
import { authFetch } from "@/lib/utils/api-client";
import type { PickupShipResult, RequestPickupOrder } from "./RequestPickupModal";

type TimeSlot = { pickupTimeId: string; date: number; timeText: string | null };
type PickupAddress = { addressId: number; label: string; timeSlots: TimeSlot[] };
type ShippingParameter = {
  ok: boolean;
  error?: string;
  infoNeeded?: { pickup?: string[]; dropoff?: string[]; nonIntegrated?: string[] };
  pickup?: PickupAddress[];
  dropoffBranches?: Array<{ branchId: number; label: string }>;
  dropoffSlugs?: Array<{ slug: string; name: string }>;
};

function formatSlot(s: TimeSlot) {
  const date =
    s.date > 0
      ? new Date(s.date * 1000).toLocaleDateString("id-ID", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      : "Fleksibel";
  return s.timeText ? `${date} · ${s.timeText}` : date;
}

/**
 * ShopeeShipModal — "Atur Pengiriman" untuk order Shopee (via Shopee Open API).
 * Memuat shipping_parameter (alamat penjemputan + slot / cabang drop-off) lalu
 * memanggil /api/orders/fulfillment/shopee-ship. Ringkasan sukses/gagal
 * dilaporkan lewat onConfirm (PickupShipResult) → PickupSuccessModal.
 */
export default function ShopeeShipModal({
  orders,
  onClose,
  onConfirm,
}: {
  orders: RequestPickupOrder[];
  onClose: () => void;
  onConfirm: (result: PickupShipResult) => void;
}) {
  const representativeId = orders[0]?.id ?? "";
  const [loading, setLoading] = useState(true);
  const [paramError, setParamError] = useState<string | null>(null);
  const [param, setParam] = useState<ShippingParameter | null>(null);

  const [mode, setMode] = useState<"PICKUP" | "DROPOFF">("PICKUP");
  const [addressId, setAddressId] = useState<number | null>(null);
  const [pickupTimeId, setPickupTimeId] = useState<string>("");
  const [branchId, setBranchId] = useState<number | null>(null);
  const [slug, setSlug] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await authFetch(`/api/orders/${representativeId}/shipping-parameter`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d: ShippingParameter = await res.json();
        if (cancelled) return;
        if (!res.ok || !d?.ok) {
          setParamError(d?.error ?? `Gagal memuat opsi pengiriman (${res.status}).`);
          return;
        }
        setParam(d);
        const pickupList = d.pickup ?? [];
        const branches = d.dropoffBranches ?? [];
        const slugs = d.dropoffSlugs ?? [];
        const canPickup = pickupList.length > 0;
        const canDropoff = branches.length > 0 || slugs.length > 0;
        setMode(canPickup ? "PICKUP" : canDropoff ? "DROPOFF" : "PICKUP");
        if (pickupList[0]) {
          setAddressId(pickupList[0].addressId);
          setPickupTimeId(pickupList[0].timeSlots[0]?.pickupTimeId ?? "");
        }
        if (branches[0]) setBranchId(branches[0].branchId);
        if (slugs[0]) setSlug(slugs[0].slug);
      } catch {
        if (!cancelled) setParamError("Gagal memuat opsi pengiriman (jaringan).");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [representativeId]);

  const pickupAddresses = param?.pickup ?? [];
  const branches = param?.dropoffBranches ?? [];
  const slugs = param?.dropoffSlugs ?? [];
  const canPickup = pickupAddresses.length > 0;
  const canDropoff = branches.length > 0 || slugs.length > 0;
  const selectedAddress = pickupAddresses.find((a) => a.addressId === addressId) ?? pickupAddresses[0];

  const handleConfirm = async () => {
    if (busy) return;
    if (mode === "PICKUP" && (!addressId || !Number.isFinite(addressId))) {
      setActionError("Pilih alamat penjemputan dulu.");
      return;
    }
    if (mode === "DROPOFF" && !branchId && !slug) {
      setActionError("Pilih cabang / titik drop-off dulu.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/orders/fulfillment/shopee-ship", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: orders.map((o) => o.id),
          method: mode,
          ...(mode === "PICKUP"
            ? { addressId, ...(pickupTimeId ? { pickupTimeId } : {}) }
            : { ...(branchId ? { branchId } : {}), ...(slug ? { slug } : {}) }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data?.error ?? `Gagal memproses (${res.status})`);
        return;
      }
      onConfirm({ ok: true, summary: data.summary, results: data.results });
    } catch {
      setActionError("Terjadi kesalahan jaringan saat mengatur pengiriman.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-card rounded-2xl max-w-3xl w-full shadow-2xl border border-border overflow-y-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3 bg-muted/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-shopee/10 flex items-center justify-center">
              <ShopeeLogo size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground leading-tight">
                Atur Pengiriman Shopee ({orders.length})
              </h2>
              <p className="text-xs text-muted-foreground">
                Booking pickup / drop-off langsung ke Shopee Open API
              </p>
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
          {/* Daftar pesanan */}
          <div>
            <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
              <Truck size={14} className="text-foreground" /> Daftar Pesanan
            </p>
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted border-b border-border">
                      <th className="px-4 py-2.5">No. Pesanan</th>
                      <th className="px-4 py-2.5">Toko</th>
                      <th className="px-4 py-2.5 text-center">Total Qty</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id} className="border-b border-border last:border-none">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 bg-brand-shopee text-brand-shopee-foreground rounded text-[9px] font-bold flex items-center gap-0.5">
                              <ShopeeLogo size={8} /> {order.platform}
                            </span>
                            <span className="text-xs font-bold text-foreground">{order.orderNo}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground">{order.storeName}</td>
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

          {loading && (
            <div className="rounded-xl border border-border bg-muted px-4 py-3 text-xs text-foreground flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Memuat opsi pengiriman dari Shopee...
            </div>
          )}

          {paramError && (
            <div className="rounded-xl bg-muted border border-border px-4 py-3 text-xs text-foreground flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>
                {paramError} — pesanan ini bisa dikirim via Seller Center Shopee bila API tidak
                menyediakan opsi.
              </span>
            </div>
          )}

          {!loading && !paramError && !canPickup && !canDropoff && (
            <div className="rounded-xl bg-muted border border-border px-4 py-3 text-xs text-foreground flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              Shopee tidak menawarkan pickup/drop-off API untuk order ini (non-integrated) —
              kirim via Seller Center Shopee.
            </div>
          )}

          {/* Mode penyerahan */}
          {!loading && !paramError && (canPickup || canDropoff) && (
            <div>
              <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
                <Truck size={14} className="text-foreground" /> Metode Penyerahan Paket
              </p>
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="grid grid-cols-2 gap-2 p-4">
                  <button
                    type="button"
                    disabled={!canPickup}
                    onClick={() => setMode("PICKUP")}
                    className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                      mode === "PICKUP"
                        ? "border-primary bg-primary text-primary-foreground shadow-xs"
                        : "border-border text-foreground hover:bg-muted"
                    } ${!canPickup ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <Truck size={14} /> Request Pickup
                  </button>
                  <button
                    type="button"
                    disabled={!canDropoff}
                    onClick={() => setMode("DROPOFF")}
                    className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                      mode === "DROPOFF"
                        ? "border-primary bg-primary text-primary-foreground shadow-xs"
                        : "border-border text-foreground hover:bg-muted"
                    } ${!canDropoff ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <Warehouse size={14} /> Drop Off
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Alamat + slot pickup */}
          {mode === "PICKUP" && selectedAddress && (
            <div>
              <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
                <MapPin size={14} className="text-foreground" /> Lokasi & Jadwal Penjemputan
              </p>
              <div className="border border-border rounded-xl overflow-hidden divide-y divide-border">
                <div className="px-4 py-3 bg-card">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                    Alamat Penjemputan
                  </label>
                  {pickupAddresses.length > 1 ? (
                    <select
                      value={addressId ?? ""}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        setAddressId(id);
                        const addr = pickupAddresses.find((a) => a.addressId === id);
                        setPickupTimeId(addr?.timeSlots[0]?.pickupTimeId ?? "");
                      }}
                      className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                    >
                      {pickupAddresses.map((a) => (
                        <option key={a.addressId} value={a.addressId}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm text-foreground">{selectedAddress.label}</p>
                  )}
                </div>
                <div className="px-4 py-3 bg-card">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5 flex items-center gap-1.5">
                    <Clock size={12} /> Jadwal Penjemputan
                  </label>
                  {selectedAddress.timeSlots.length > 0 ? (
                    <select
                      value={pickupTimeId}
                      onChange={(e) => setPickupTimeId(e.target.value)}
                      className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                    >
                      {selectedAddress.timeSlots.map((s) => (
                        <option key={s.pickupTimeId} value={s.pickupTimeId}>
                          {formatSlot(s)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Shopee tidak memberi slot waktu — kurir menyesuaikan jadwal penjemputan.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Cabang / titik drop-off */}
          {mode === "DROPOFF" && (branches.length > 0 || slugs.length > 0) && (
            <div>
              <p className="text-xs font-bold text-foreground mb-2 flex items-center gap-1.5">
                <Warehouse size={14} className="text-foreground" /> Titik Drop-off
              </p>
              <div className="border border-border rounded-xl px-4 py-3 bg-card space-y-3">
                {branches.length > 0 && (
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                      Cabang Kurir
                    </label>
                    <select
                      value={branchId ?? ""}
                      onChange={(e) => setBranchId(Number(e.target.value))}
                      className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                    >
                      {branches.map((b) => (
                        <option key={b.branchId} value={b.branchId}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {slugs.length > 0 && (
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
                      Drop Point
                    </label>
                    <select
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none"
                    >
                      {slugs.map((s) => (
                        <option key={s.slug} value={s.slug}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Paket diantar sendiri ke titik penyerahan — resi terbit setelah drop-off.
                </p>
              </div>
            </div>
          )}

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
            disabled={busy || loading || !!paramError || (!canPickup && !canDropoff)}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 shadow-xs"
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Memproses ke Shopee...
              </>
            ) : mode === "PICKUP" ? (
              <>
                <PackageCheck size={14} /> Konfirmasi & Jadwalkan Pickup
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
