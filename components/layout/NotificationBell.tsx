"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, AlertTriangle, PackageX, ChevronRight } from "lucide-react";
import type { StockAlert } from "@/app/api/stock-alerts/route";

export default function NotificationBell() {
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    fetch("/api/stock-alerts", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.resolve(null)))
      .then((data) => setAlerts(data?.alerts ?? []))
      .catch((e) => {
        console.error(e);
        setAlerts([]);
      });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const outCount = alerts.filter((a) => a.severity === "out").length;
  const hasAlert = alerts.length > 0;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 border border-gray-200 relative"
      >
        <Bell size={16} />
        {hasAlert && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {alerts.length > 9 ? "9+" : alerts.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-bold text-gray-900">Stok Menipis</p>
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700">
              {alerts.length} varian
            </span>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                Semua stok aman.
              </p>
            ) : (
              alerts.map((a) => (
                <a
                  key={a.variantId}
                  href="/products"
                  className="flex items-start gap-3 px-4 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors"
                >
                  <span
                    className={`mt-0.5 shrink-0 ${
                      a.severity === "out" ? "text-red-500" : "text-amber-500"
                    }`}
                  >
                    {a.severity === "out" ? <PackageX size={16} /> : <AlertTriangle size={16} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold text-gray-800 truncate">
                      {a.productName}
                    </span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">
                      {a.variantSku} · Sisa {a.effectiveStock} stok
                      {a.safetyStock > 0 ? ` (buffer ${a.safetyStock})` : ""}
                    </span>
                  </span>
                  <ChevronRight size={14} className="text-gray-300 shrink-0 mt-1" />
                </a>
              ))
            )}
          </div>

          <a
            href="/products"
            className="block px-4 py-2.5 text-xs font-semibold text-indigo-600 bg-gray-50 hover:bg-indigo-50 text-center border-t border-gray-100"
          >
            {outCount > 0
              ? `Lihat ${outCount} varian stok habis di Produk Master`
              : "Lihat semua di Produk Master"}
          </a>
        </div>
      )}
    </div>
  );
}