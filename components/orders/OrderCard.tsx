"use client";

import { useState } from "react";
import { Clock, RefreshCw, Pencil, MoreHorizontal, MessageCircle, FileText, PackageCheck, Printer } from "lucide-react";
import OrderProgressSteps from "./OrderProgressSteps";
import PrintDropdown from "./PrintDropdown";
import TikTokLogo from "@/components/icons/TikTokLogo";
import TrackingModal from "./TrackingModal";

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
  onDetail,
  shipping = false,
}: {
  order: OrderCardOrder;
  checked: boolean;
  onToggleChecked: () => void;
  onSync: () => void;
  onPrint: (type: PrintType) => void;
  onShip?: () => void;
  onDetail: () => void;
  shipping?: boolean;
}) {
  const [showTracking, setShowTracking] = useState(false);
  const sla = computeSla(order);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-4 font-sans relative">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 rounded-t-xl">
        <div className="flex items-center gap-4">
          <div className="px-3 py-1 bg-orange-100 text-orange-700 text-xs font-bold rounded-md border border-orange-200">
            {order.status}
          </div>
          <div className="text-sm text-gray-600">
            Nomor Pesanan: <a href="#" className="text-blue-600 font-semibold hover:underline">{order.orderId}</a>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
            <Clock size={14} />
            {order.deadline}
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={onSync}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-blue-600 transition-colors"
          >
            <RefreshCw size={14} /> Sync dari Marketplace
          </button>
          
          <div className="flex items-center gap-2 bg-black text-white px-2.5 py-1 rounded-md text-xs font-semibold shadow-xs">
             <TikTokLogo size={14} />
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
            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
        </div>
        
        <div className="grid grid-cols-12 gap-6 flex-1">
          {/* Product details */}
          <div className="col-span-4 flex gap-4">
            <div className="w-16 h-16 bg-gray-100 rounded-lg shrink-0 border border-gray-200 overflow-hidden">
               <img src={order.productImage || 'https://via.placeholder.com/64'} alt="product" className="w-full h-full object-cover" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 leading-tight mb-1">{order.productName}</h3>
              <p className="text-xs text-gray-500 mb-2">{order.productVariant}</p>
              <p className="text-xs font-medium text-gray-600">Qty: {order.qty} x {order.price}</p>
            </div>
          </div>
          
          {/* Total Qty */}
          <div className="col-span-1">
            <p className="text-xs font-semibold text-gray-900 mb-1">Total Qty</p>
            <p className="text-sm text-gray-700">{order.qty}</p>
          </div>
          
          {/* Total Price */}
          <div className="col-span-2">
            <p className="text-xs font-semibold text-gray-900 mb-1">Total Harga</p>
            <p className="text-sm font-bold text-gray-900">{order.totalPrice}</p>
            <p className="text-[10px] text-gray-500 mt-1">{order.paymentMethod}</p>
          </div>
          
          {/* Address */}
          <div className="col-span-2">
            <p className="text-xs font-semibold text-gray-900 mb-1">Alamat</p>
            <p className="text-xs text-gray-600 mb-1">{order.buyerName} ({order.buyerPhone})</p>
            <p className="text-[10px] text-gray-500 line-clamp-3 leading-tight">{order.address}</p>
          </div>
          
          {/* Date & Note */}
          <div className="col-span-2">
            <div className="mb-3">
               <p className="text-xs font-semibold text-gray-900 mb-1">Tanggal Pesanan</p>
               <p className="text-xs text-gray-600">{order.orderDate}</p>
            </div>
            <div>
               <p className="text-xs font-semibold text-gray-900 mb-1">Catatan Penjual</p>
               <div className="flex items-center gap-2 group cursor-pointer">
                 <p className="text-xs text-gray-600">{order.sellerNote || '-'}</p>
                 <Pencil size={12} className="text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
               </div>
            </div>
          </div>
          
          {/* Courier */}
          <div className="col-span-1">
            <div className="mb-3">
               <p className="text-xs font-semibold text-gray-900 mb-1">Kurir</p>
               <p className="text-xs text-gray-600">{order.courier}</p>
            </div>
            <div>
               <p className="text-xs font-semibold text-gray-900 mb-1">Nomor Resi</p>
               <p className="text-xs text-gray-600">{order.trackingNumber}</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Footer Info */}
      <div className="px-10 py-3 bg-gray-50/50 border-t border-gray-100 flex items-start gap-12">
         <div>
            <p className="text-xs font-semibold text-gray-900 mb-1">Catatan Pembeli</p>
            <p className="text-xs text-gray-600">{order.buyerNote || '-'}</p>
         </div>
         <div>
            <p className="text-xs font-semibold text-gray-900 mb-1">Lokasi Penjemputan</p>
            <p className="text-xs text-gray-600">{order.pickupLocation || '-'}</p>
         </div>
      </div>
      
      {/* Action Bar */}
      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-white rounded-b-xl flex-wrap gap-3">
         {/* Sisi Kiri: Detail, Chat, Cetak, dan Progres Alur Kerja (seperti Desty) */}
         <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={onDetail}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-md text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
               <FileText size={14} /> Detail Pesanan
            </button>
            <button
              disabled
              title="Modul Chat belum tersedia"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-emerald-200 bg-emerald-50/40 rounded-md text-xs font-semibold text-emerald-600 cursor-not-allowed"
            >
               <MessageCircle size={14} className="text-emerald-500" /> Chat Pembeli
            </button>
            <PrintDropdown
               prefixIcon={<Printer size={14} />}
               placement="top-left"
               items={[
                  { id: "Label", label: "Cetak Label", description: "Label pengiriman & resi kurir" },
                  { id: "Invoice", label: "Cetak Invoice", description: "Faktur resmi pesanan pembeli" },
                  { id: "PackingList", label: "Cetak Packing List", description: "Daftar barang untuk gudang" },
               ]}
               label="Cetak"
               onSelect={onPrint}
            />
            {/* Step alur kerja di sebelah Cetak */}
            <div className="ml-1">
               <OrderProgressSteps currentStage={order.fulfillmentStage} />
            </div>
         </div>
         
         {/* Sisi Kanan: Lacak di ujung (seperti Desty) */}
         <div className="flex items-center gap-2.5 ml-auto">
            {onShip && order.status === "AWAITING_SHIPMENT" ? (
              <button
                onClick={onShip}
                disabled={shipping}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 rounded-md text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-xs"
              >
                <PackageCheck size={14} />
                {shipping ? "Mengirim..." : "Kirim Paket"}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setShowTracking(true)}
              className="px-5 py-1.5 bg-[#2a3a8c] hover:bg-[#202e70] text-white rounded-md text-xs font-semibold transition-colors shadow-xs"
            >
              Lacak
            </button>

            {sla && (
               <div
                  className={`px-3 py-1 text-xs font-bold rounded-md ${
                     sla.tone === "urgent"
                        ? "bg-red-600 text-white"
                        : "bg-amber-400 text-amber-950"
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
          onClose={() => setShowTracking(false)}
        />
      )}
    </div>
  );
}
