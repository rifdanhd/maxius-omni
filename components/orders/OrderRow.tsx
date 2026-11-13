"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock, Copy, PackageCheck, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VariantThumbnail } from "@/components/ui/variant-thumbnail";
import { notify } from "@/components/ui/notify";
import type { PrintType } from "./OrderCard";

/**
 * Kolom tabel pesanan ala Shopee Seller Centre / TikTok Shop Seller Center:
 * Produk | Total | Status | Pengiriman | Aksi.
 * Dipakai bersama oleh header kolom di page.tsx agar lebar selalu sejajar.
 */
export const ORDER_GRID =
  "md:grid md:grid-cols-[minmax(0,2.4fr)_minmax(90px,0.9fr)_minmax(110px,1.1fr)_minmax(140px,1.3fr)_150px] md:gap-4";

export type CardOrder = {
  id: string;
  status: string;
  orderId: string;
  deadline: string; // tanggal pesanan (terformat)
  storeName: string;
  platform: string; // nama tampilan: "Shopee" | "TikTok Shop" | ...
  productName: string;
  productVariant: string;
  productImage: string | null;
  qty: number;
  price: string;
  totalPrice: string;
  paymentMethod: string;
  buyerName: string;
  courier: string;
  trackingNumber: string;
  shippingDueTime: string | null;
  items: { name: string; variant: string; qty: number; price: string }[];
};

type Tone = "neutral" | "info" | "warning" | "success" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info-subtle text-info",
  warning: "bg-warning-subtle text-warning",
  success: "bg-success-subtle text-success",
  danger: "bg-destructive/10 text-destructive",
};

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  UNPAID: { label: "Belum Dibayar", tone: "neutral" },
  ON_HOLD: { label: "Pembayaran Diperiksa", tone: "info" },
  AWAITING_SHIPMENT: { label: "Perlu Diproses", tone: "warning" },
  PARTIALLY_SHIPPING: { label: "Sebagian Dikirim", tone: "info" },
  PROCESSED: { label: "Telah Diproses", tone: "info" },
  AWAITING_COLLECTION: { label: "Menunggu Diambil Kurir", tone: "info" },
  IN_TRANSIT: { label: "Dalam Pengiriman", tone: "info" },
  DELIVERED: { label: "Terkirim", tone: "success" },
  COMPLETED: { label: "Selesai", tone: "success" },
  CANCELLED: { label: "Dibatalkan", tone: "danger" },
};

const PLATFORM_DOT: Record<string, string> = {
  Shopee: "bg-orange-500",
  "TikTok Shop": "bg-foreground",
  Tokopedia: "bg-green-600",
};

/** Info batas kirim — hanya relevan untuk pesanan yang masih harus diproses. */
function dueInfo(iso: string | null, status: string): { text: string; urgent: boolean } | null {
  if (!iso || status !== "AWAITING_SHIPMENT") return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { text: "Batas kirim terlewat", urgent: true };
  const hours = ms / 3_600_000;
  if (hours < 24) return { text: `Kirim dalam ${Math.max(1, Math.floor(hours))} jam`, urgent: true };
  const date = new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return { text: `Kirim sebelum ${date}`, urgent: false };
}

function PrintMenu({ onPrint }: { onPrint: (type: PrintType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const items: { id: PrintType; label: string }[] = [
    { id: "Label" as PrintType, label: "Cetak Label" },
    { id: "Invoice" as PrintType, label: "Cetak Invoice" },
    { id: "PackingList" as PrintType, label: "Cetak Packing List" },
  ];

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" size="sm" className="w-full justify-between gap-1.5" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="flex items-center gap-1.5">
          <Printer size={14} /> Cetak
        </span>
        <ChevronDown size={14} />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-border bg-card py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
              onClick={() => {
                setOpen(false);
                onPrint(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Props = {
  order: CardOrder;
  checked: boolean;
  onToggleChecked: () => void;
  onPrint: (type: PrintType) => void;
  onPickup: () => void;
  onDetail: () => void;
  shipping?: boolean;
  /** Dipertahankan agar kompatibel dengan pemanggilan OrderCard lama. */
  onSync?: unknown;
};

export default function OrderRow({ order, checked, onToggleChecked, onPrint, onPickup, onDetail, shipping = false }: Props) {
  const status = STATUS_META[order.status] ?? { label: order.status, tone: "neutral" as Tone };
  const due = dueInfo(order.shippingDueTime, order.status);
  const extraItems = order.items.length - 1;
  const needsShipping = order.status === "AWAITING_SHIPMENT";
  const hasTracking = !!order.trackingNumber && order.trackingNumber.trim() !== "" && order.trackingNumber.trim() !== "-";

  const copyOrderNo = async () => {
    try {
      await navigator.clipboard.writeText(order.orderId);
      notify("success", "Nomor pesanan disalin.");
    } catch {
      notify("error", "Tidak bisa menyalin nomor pesanan.");
    }
  };

  return (
    <article className={`border-b border-border last:border-b-0 ${checked ? "bg-primary/5" : "bg-card"}`}>
      {/* Header pesanan: toko, pembeli, nomor, tanggal */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border"
          checked={checked}
          onChange={onToggleChecked}
          aria-label={`Pilih pesanan ${order.orderId}`}
        />
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <span className={`h-2 w-2 rounded-full ${PLATFORM_DOT[order.platform] ?? "bg-muted-foreground"}`} aria-hidden />
          {order.platform} · {order.storeName}
        </span>
        <span>
          Pembeli: <span className="font-medium text-foreground">{order.buyerName}</span>
        </span>
        <span className="flex items-center gap-1">
          No. Pesanan <span className="font-medium text-foreground">{order.orderId}</span>
          <button type="button" onClick={copyOrderNo} className="rounded p-0.5 hover:bg-muted" aria-label="Salin nomor pesanan">
            <Copy size={12} />
          </button>
        </span>
        <span className="ml-auto">{order.deadline}</span>
      </div>

      {/* Isi pesanan */}
      <div className={`flex flex-col gap-3 px-4 py-3 ${ORDER_GRID}`}>
        <div className="flex min-w-0 gap-3">
          <VariantThumbnail src={order.productImage} size={56} alt={order.productName} />
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-medium text-foreground">{order.productName}</p>
            <p className="truncate text-xs text-muted-foreground">{order.productVariant}</p>
            <p className="text-xs text-muted-foreground">
              {order.price ? `${order.price} × ` : "× "}
              {order.items[0]?.qty ?? order.qty}
              {extraItems > 0 && <span className="ml-2 font-medium text-primary">+{extraItems} produk lain</span>}
            </p>
          </div>
        </div>

        <div className="text-sm">
          <p className="font-semibold text-foreground">{order.totalPrice}</p>
          <p className="text-xs text-muted-foreground">{order.qty} barang</p>
        </div>

        <div>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[status.tone]}`}>
            {status.label}
          </span>
        </div>

        <div className="min-w-0 text-xs">
          <p className="truncate font-medium text-foreground">{order.courier}</p>
          <p className="truncate text-muted-foreground">{hasTracking ? order.trackingNumber : "Resi belum tersedia"}</p>
          {due && (
            <p className={`mt-1 flex items-center gap-1 font-medium ${due.urgent ? "text-destructive" : "text-muted-foreground"}`}>
              <Clock size={12} /> {due.text}
            </p>
          )}
        </div>

        <div className="flex flex-row gap-2 md:flex-col">
          {needsShipping ? (
            <Button size="sm" className="flex-1 gap-1.5 md:flex-none" onClick={onPickup} disabled={shipping}>
              <PackageCheck size={14} /> Atur Pengiriman
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="flex-1 gap-1.5 md:flex-none" onClick={() => onPrint("Label" as PrintType)} disabled={!hasTracking && order.status !== "PROCESSED"}>
              <Printer size={14} /> Cetak Label
            </Button>
          )}
          <div className="flex flex-1 gap-2 md:flex-none">
            <div className="flex-1">
              <PrintMenu onPrint={onPrint} />
            </div>
            <Button size="sm" variant="ghost" onClick={onDetail}>
              Detail
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}