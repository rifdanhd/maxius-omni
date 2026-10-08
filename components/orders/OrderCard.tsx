"use client";

import { useState } from "react";
import { Clock, RefreshCw, MessageCircle, FileText, PackageCheck, Printer, Store, Package } from "lucide-react";
import OrderProgressSteps from "./OrderProgressSteps";
import PrintDropdown from "./PrintDropdown";
import TikTokLogo from "@/components/icons/TikTokLogo";
import ShopeeLogo from "@/components/icons/ShopeeLogo";
import TrackingModal, { type TrackingEvent } from "./TrackingModal";
import { authFetch } from "@/lib/utils/api-client";

export type PrintType = "Label" | "Invoice" | "PackingList";

export type OrderCardItem = {
  name: string;
  variant: string;
  qty: number;
  price: string;
};

export type OrderCardOrder = {
  id: string;
  status: string;
  orderId: string;
  deadline: string;
  storeName: string;
  platform: string;
  productName: string;
  productVariant: string;
  productImage: string | null;
  qty: number;
  price: string;
  totalPrice: string;
  paymentMethod: string;
  buyerName: string;
  buyerPhone: string;
  address: string;
  orderDate: string;
  sellerNote: string | null;
  courier: string;
  trackingNumber: string;
  buyerNote: string | null;
  pickupLocation: string | null;
  fulfillmentStage: "Picking List" | "Packing List" | "Label" | "Invoice" | null;
  shippingDueTime: string | null;
  items: OrderCardItem[];
};

function formatCountdown(ms: number) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}j ${minutes}m`;
}

function computeSla(order: OrderCardOrder): { label: string; tone: "urgent" | "warning" } | null {
  if (order.status !== "AWAITING_SHIPMENT" || !order.shippingDueTime) return null;
  const remaining = new Date(order.shippingDueTime).getTime() - Date.now();
  if (remaining <= 0) return { label: "Melewati batas kirim!", tone: "urgent" };
  const hoursLeft = remaining / 3600000;
  if (hoursLeft <= 6) return { label: `Segera Kirim — ${formatCountdown(remaining)} lagi`, tone: "urgent" };
  if (hoursLeft <= 24) return { label: `Batas kirim ${formatCountdown(remaining)} lagi`, tone: "warning" };
  return null;
}

export default function OrderCard({
  order,
  checked,
  onToggleChecked,
  onSync,
  onPrint,
  onShip,
  onPickup,
  onDetail,
  shipping = false,
}: {
  order: OrderCardOrder;
  checked: boolean;
  onToggleChecked: () => void;
  onSync: () => void;
  onPrint: (type: PrintType) => void;
  onShip?: () => void;
  onPickup?: () => void;
  onDetail: () => void;
  shipping?: boolean;
}) {
  const [showTracking, setShowTracking] = useState(false);
  const [trackingEvents, setTrackingEvents] = useState<TrackingEvent[] | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const sla = computeSla(order);
  const platform = order.platform.trim().toUpperCase().replace(/\s+/g, "_");
  const statusLabel: Record<string, string> = { UNPAID: "Belum Dibayar", ON_HOLD: "Pembayaran Sedang Diperiksa", AWAITING_SHIPMENT: "Perlu Diproses", AWAITING_COLLECTION: "Menunggu Diambil Kurir", IN_TRANSIT: "Dalam Pengiriman", PARTIALLY_SHIPPING: "Dikirim Sebagian", DELIVERED: "Diterima Pembeli", COMPLETED: "Selesai", CANCELLED: "Dibatalkan" };
  const [trackingError, setTrackingError] = useState<string | null>(null);

  // Riwayat tracking di-fetch on-demand saat modal Lacak dibuka (sekali per
  // buka). Riwayat kosong ditampilkan tanpa simulasi.
  const handleOpenTracking = async () => {
    setShowTracking(true);
    setTrackingEvents(null);
    setTrackingError(null);
    setTrackingLoading(true);
    try {
      const res = await authFetch(`/api/orders/${order.id}/tracking`, {
        headers: { },
      });
      const data = await res.json();
      if (res.ok && data?.ok && Array.isArray(data.trackingEvents)) {
        setTrackingEvents(data.trackingEvents as TrackingEvent[]);
      }
      if (!res.ok || !data?.ok) setTrackingError(data?.error ?? "Riwayat pengiriman belum dapat dimuat. Coba buka kembali atau periksa melalui situs kurir.");
    } catch {
      setTrackingError("Gagal memuat riwayat pengiriman. Coba buka kembali.");
    } finally {
      setTrackingLoading(false);
    }
  };

  return (
    <div data-testid="order-card" className="bg-card rounded-xl border border-border shadow-sm mb-4 font-sans relative">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-3 bg-muted/50 rounded-t-xl">
        <div className="flex flex-wrap items-center gap-4">
          <div className="px-3 py-1 bg-muted text-foreground text-xs font-bold rounded-md border border-border">
            {statusLabel[order.status] ?? order.status}
          </div>
          <div className="text-sm text-foreground">
            Nomor Pesanan: <a href={`/orders/detail/${encodeURIComponent(order.id)}`} className="text-foreground font-semibold hover:underline">{order.orderId}</a>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock size={14} />
            {order.deadline}
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          <button 
            onClick={onSync}
            className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw size={14} /> Sync dari Marketplace
          </button>
          
          <div className="flex items-center gap-2 bg-primary text-primary-foreground px-2.5 py-1 rounded-md text-xs font-semibold shadow-xs">
             {platform === "SHOPEE" ? <ShopeeLogo size={14} /> : platform === "TIKTOK_SHOP" ? <TikTokLogo size={14} /> : <Store size={14} />}
             <span>{order.storeName} | {order.platform}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 flex items-start gap-4">
        <div className="pt-1">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleChecked}
            className="w-4 h-4 rounded border-border text-foreground focus:ring-ring"
          />
        </div>
        
        <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-6 flex-1">
          {/* Product details */}
          <div className="col-span-1 sm:col-span-2 xl:col-span-4 min-w-0 flex gap-4">
            <div className="w-16 h-16 bg-muted rounded-lg shrink-0 border border-border overflow-hidden">
               <>{order.productImage ? <img src={order.productImage} alt={order.productName} className="w-full h-full object-cover" /> : <Package size={24} className="mx-auto mt-4 text-muted-foreground" />}</>
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground leading-tight mb-1">{order.productName}</h3>
              <p className="text-xs text-muted-foreground mb-2">{order.productVariant}</p>
              <p className="text-xs font-medium text-foreground">Jumlah (Qty): {order.qty} x {order.price}</p>
            </div>
          </div>
          
          {/* Total Barang */}
          <div className="col-span-1 min-w-0 break-words">
            <p className="text-xs font-semibold text-foreground mb-1">Total Barang</p>
            <p className="text-sm text-foreground">{order.qty}</p>
          </div>
          
          {/* Total Price */}
          <div className="col-span-1 xl:col-span-2 min-w-0 break-words">
            <p className="text-xs font-semibold text-foreground mb-1">Total Harga</p>
            <p className="text-sm font-bold text-foreground">{order.totalPrice}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{order.paymentMethod}</p>
          </div>
          
          {/* Address */}
          <div className="col-span-1 xl:col-span-2 min-w-0 break-words">
            <p className="text-xs font-semibold text-foreground mb-1">Alamat</p>
            <p className="text-xs text-foreground mb-1">{order.buyerName} ({order.buyerPhone})</p>
            <p className="text-[10px] text-muted-foreground line-clamp-3 leading-tight">{order.address}</p>
          </div>
          
          {/* Date & Note */}
          <div className="col-span-1 xl:col-span-2 min-w-0 break-words">
            <div className="mb-3">
               <p className="text-xs font-semibold text-foreground mb-1">Tanggal Pesanan</p>
               <p className="text-xs text-foreground">{order.orderDate}</p>
            </div>
            <div>
               <p className="text-xs font-semibold text-foreground mb-1">Catatan Penjual</p>
               <div className="flex items-center gap-2 group">
                 <p className="text-xs text-foreground">{order.sellerNote || '-'}</p>

               </div>
            </div>
          </div>
          
          {/* Courier */}
          <div className="col-span-1 min-w-0 break-words">
            <div className="mb-3">
               <p className="text-xs font-semibold text-foreground mb-1">Kurir</p>
               <p className="text-xs text-foreground">{order.courier}</p>
            </div>
            <div>
               <p className="text-xs font-semibold text-foreground mb-1">Nomor Resi</p>
               <p className="text-xs text-foreground">{order.trackingNumber}</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Footer Info */}
      <div className="px-5 sm:px-10 py-3 bg-muted/50 border-t border-border flex flex-wrap items-start gap-4 sm:gap-12">
         <div>
            <p className="text-xs font-semibold text-foreground mb-1">Catatan Pembeli</p>
            <p className="text-xs text-foreground">{order.buyerNote || '-'}</p>
         </div>
         <div>
            <p className="text-xs font-semibold text-foreground mb-1">Lokasi Penjemputan</p>
            <p className="text-xs text-foreground">{order.pickupLocation || '-'}</p>
         </div>
      </div>
      
      {/* Action Bar */}
      <div className="px-5 py-3 border-t border-border flex items-center justify-between bg-card rounded-b-xl flex-wrap gap-3">
         {/* Sisi Kiri: Detail, Chat, Cetak, dan Progres Alur Kerja (seperti Desty) */}
         <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={onDetail}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs font-semibold text-foreground hover:bg-muted transition-colors"
            >
               <FileText size={14} /> Detail Pesanan
            </button>
            <button
              disabled
              title="Modul Chat belum tersedia"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border bg-muted/40 rounded-md text-xs font-semibold text-foreground cursor-not-allowed"
            >
               <MessageCircle size={14} className="text-muted-foreground" /> Chat Pembeli
            </button>
            <PrintDropdown
               prefixIcon={<Printer size={14} />}
               placement="top-left"
               items={[
                  { id: "Label", label: platform === "TIKTOK_SHOP" ? "Cetak Resi TikTok" : "Cetak Label Lokal", description: platform === "TIKTOK_SHOP" ? "Dokumen asli dari TikTok Shop" : "Dibuat oleh Maxius; gunakan Seller Center untuk resi resmi" },
                  { id: "Invoice", label: "Cetak Invoice", description: "Ringkasan transaksi dibuat oleh Maxius" },
                  { id: "PackingList", label: "Daftar Isi Paket (Packing List)", description: "Daftar barang untuk gudang" },
               ]}
               label="Cetak"
               onSelect={onPrint}
            />
            {/* Step alur kerja di sebelah Cetak */}
            <div className="ml-1">
               {order.fulfillmentStage && <OrderProgressSteps currentStage={order.fulfillmentStage} />}
            </div>
         </div>
         
         {/* Sisi Kanan: Lacak di ujung (seperti Desty) */}
         <div className="flex items-center gap-2.5 ml-auto">
            {onShip && order.status === "AWAITING_SHIPMENT" ? (
              <button
                onClick={onShip}
                disabled={shipping}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary rounded-md text-xs font-semibold text-primary-foreground hover:bg-primary disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-xs"
              >
                <PackageCheck size={14} />
                {shipping ? "Mengirim..." : "Kirim Paket"}
              </button>
            ) : null}

            {onPickup && order.status === "AWAITING_SHIPMENT" ? (
              <button
                onClick={onPickup}
                disabled={shipping}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary rounded-md text-xs font-semibold text-primary-foreground hover:bg-primary disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-xs"
              >
                <PackageCheck size={14} />
                {shipping ? "Memproses..." : "Atur Pengiriman"}
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleOpenTracking}
              className="px-5 py-1.5 bg-primary hover:bg-primary text-primary-foreground rounded-md text-xs font-semibold transition-colors shadow-xs"
            >
              Lacak
            </button>

            {sla && (
               <div
                  className={`px-3 py-1 text-xs font-bold rounded-md ${
                     sla.tone === "urgent"
                        ? "bg-primary text-primary-foreground"
                        : "bg-primary text-primary-foreground"
                  }`}
               >
                  {sla.label}
               </div>
            )}
         </div>
      </div>

      {showTracking && (
        <TrackingModal
          order={{
            orderId: order.orderId,
            courier: order.courier,
            trackingNumber: order.trackingNumber,
            status: order.status,
            orderDate: order.orderDate,
            buyerName: order.buyerName,
            address: order.address,
            pickupLocation: order.pickupLocation,
          }}
          trackingEvents={trackingEvents}
          loading={trackingLoading}
          error={trackingError}
          onClose={() => setShowTracking(false)}
        />
      )}
    </div>
  );
}
