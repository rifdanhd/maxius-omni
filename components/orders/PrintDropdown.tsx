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
      return <Tag size={15} className="text-foreground" />;
    case "Invoice":
      return <Receipt size={15} className="text-foreground" />;
    case "PackingList":
      return <ClipboardList size={15} className="text-foreground" />;
    default:
      return <Printer size={15} className="text-foreground" />;
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
      ? `flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-semibold hover:bg-primary transition-all ${
          open ? "ring-2 ring-ring/50 bg-primary" : ""
        }`
      : `flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs font-semibold transition-all ${
          open
            ? "border-ring bg-muted/70 text-foreground ring-2 ring-ring/15"
            : "border-border text-foreground bg-card hover:bg-muted"
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
          className={`absolute ${placementClasses} min-w-[220px] bg-card border border-border rounded-xl shadow-xl z-50 p-1.5 animate-in fade-in zoom-in-95 duration-100`}
        >
          <div className="px-2.5 py-1 mb-1 border-b border-border flex items-center justify-between flex-wrap gap-3 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            <span>Pilihan Cetak</span>
            <Printer size={12} className="text-muted-foreground" />
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
                className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left rounded-lg transition-colors hover:bg-muted/80 group"
              >
                <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0 border border-border group-hover:bg-card group-hover:border-border transition-colors">
                  {item.icon ?? getDefaultIcon(item.id)}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-foreground group-hover:text-foreground leading-snug">
                    {item.label}
                  </span>
                  {item.description && (
                    <span className="text-[10px] text-muted-foreground group-hover:text-foreground leading-tight">
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