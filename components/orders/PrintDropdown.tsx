"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Printer, Tag, Receipt, ClipboardList } from "lucide-react";
import type { PrintType } from "./OrderCard";

export type PrintDropdownItem = {
  id: PrintType;
  label: string;
  description?: string;
  icon?: ReactNode;
};

export type DropdownPlacement =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "auto";

function getDefaultIcon(type: PrintType) {
  switch (type) {
    case "Label":
      return <Tag size={15} className="text-indigo-600" />;
    case "Invoice":
      return <Receipt size={15} className="text-emerald-600" />;
    case "PackingList":
      return <ClipboardList size={15} className="text-amber-600" />;
    default:
      return <Printer size={15} className="text-gray-600" />;
  }
}

/**
 * PrintDropdown — dropdown "Cetak" (Label/Invoice/Packing List).
 *
 * Click-to-toggle:
 *  - Buka/tutup lewat klik tombol, klik item, klik di luar, atau tombol Escape.
 *  - Mendukung penempatan 'top-left' (dropup) agar tidak terpotong atau menutupi card pesanan di bawahnya.
 *  - Tampilan rapi dengan ikon indikator & deskripsi dokumen.
 */
export default function PrintDropdown({
  items,
  label,
  onSelect,
  variant = "outline",
  prefixIcon,
  placement = "auto",
}: {
  items: PrintDropdownItem[];
  label: string;
  onSelect: (item: PrintType) => void;
  variant?: "outline" | "filled";
  prefixIcon?: ReactNode;
  placement?: DropdownPlacement;
}) {
  const [open, setOpen] = useState(false);
  const [computedPlacement, setComputedPlacement] = useState<"top-left" | "bottom-left">("bottom-left");
  const containerRef = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);

  const toggle = () => {
    if (!open && containerRef.current) {
      if (placement === "auto") {
        const rect = containerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        if (spaceBelow < 220 && spaceAbove > spaceBelow) {
          setComputedPlacement("top-left");
        } else {
          setComputedPlacement("bottom-left");
        }
      }
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent | MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Tentukan posisi aktual dropdown
  const activePlacement = placement === "auto" ? computedPlacement : placement;

  const placementClasses = (() => {
    switch (activePlacement) {
      case "top-left":
        return "bottom-full mb-1.5 left-0 origin-bottom-left";
      case "top-right":
        return "bottom-full mb-1.5 right-0 origin-bottom-right";
      case "bottom-right":
        return "top-full mt-1.5 right-0 origin-top-right";
      case "bottom-left":
      default:
        return "top-full mt-1.5 left-0 origin-top-left";
    }
  })();

  const buttonClasses =
    variant === "filled"
      ? `flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold hover:bg-indigo-700 transition-all ${
          open ? "ring-2 ring-indigo-400/50 bg-indigo-700" : ""
        }`
      : `flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-semibold transition-all ${
          open
            ? "border-indigo-500 bg-indigo-50/70 text-indigo-700 ring-2 ring-indigo-500/15"
            : "border-gray-200 text-gray-700 bg-white hover:bg-gray-50"
        }`;

  return (
    <div ref={containerRef} className={`relative inline-block ${open ? "z-30" : ""}`}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className={buttonClasses}
      >
        {prefixIcon}
        <span>{label}</span>
        <ChevronDown
          size={14}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute ${placementClasses} min-w-[220px] bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-1.5 animate-in fade-in zoom-in-95 duration-100`}
        >
          <div className="px-2.5 py-1 mb-1 border-b border-gray-100 flex items-center justify-between text-[10px] font-semibold tracking-wider text-gray-400 uppercase">
            <span>Pilihan Cetak</span>
            <Printer size={12} className="text-gray-400" />
          </div>

          <div className="space-y-0.5">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  onSelect(item.id);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-lg transition-colors hover:bg-indigo-50/80 group"
              >
                <div className="w-7 h-7 rounded-md bg-gray-50 flex items-center justify-center shrink-0 border border-gray-100 group-hover:bg-white group-hover:border-indigo-100 transition-colors">
                  {item.icon ?? getDefaultIcon(item.id)}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-gray-800 group-hover:text-indigo-950 leading-snug">
                    {item.label}
                  </span>
                  {item.description && (
                    <span className="text-[10px] text-gray-400 group-hover:text-indigo-600/80 leading-tight">
                      {item.description}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}