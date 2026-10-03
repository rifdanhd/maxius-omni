"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, AlertTriangle, PackageX, ChevronRight, ClipboardList } from "lucide-react";
import type { StockAlert, StockAlertsResponse } from "@/app/api/stock-alerts/route";
import type { OpnameReminder } from "@/lib/services/opname-reminder.service";
import { authFetch } from "@/lib/utils/api-client";

export default function NotificationBell() {
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [reminder, setReminder] = useState<OpnameReminder | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Polling 60 dtk + saat tab kembali fokus — badge merah selalu segar
  // (fetch sekali saat mount membuat angka basi setelah stok berubah).
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const token = localStorage.getItem("token");
      authFetch("/api/stock-alerts", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : Promise.resolve(null)))
        .then((data: StockAlertsResponse | null) => {
          if (cancelled) {
            return;
          }
          setAlerts(data?.alerts ?? []);
          setReminder(data?.reminder ?? null);
        })
        .catch((e) => {
          console.error(e);
          if (!cancelled) setAlerts([]);
        });
    };
    load();
    const t = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
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
  const reminderDue = Boolean(reminder?.due);
  const badgeCount = alerts.length + (reminderDue ? 1 : 0);
  const hasAlert = badgeCount > 0;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notifikasi"
        className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 border border-gray-200 relative"
      >
        <Bell size={16} />
        {hasAlert && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 ring-2 ring-white text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-bold text-gray-900">Stok Menipis</p>
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-red-100 text-red-700">
              {alerts.length} varian
            </span>
          </div>

          {/* Pengingat opname otomatis (frekuensi di Pengaturan Inventori) */}
          {reminderDue && reminder && (
            <a
              href="/inventory/opname"
              className="flex items-start gap-2 px-4 py-2.5 border-b border-amber-200 bg-amber-50 text-amber-900 text-xs font-semibold hover:bg-amber-100"
            >
              <ClipboardList size={14} className="shrink-0 mt-0.5" />
              <span>
                Pengingat opname stok ({reminder.frequency === "daily" ? "harian" : reminder.frequency === "weekly" ? "mingguan" : "bulanan"})
                {reminder.lastOpnameAt
                  ? ` — terakhir ${new Date(reminder.lastOpnameAt).toLocaleDateString("id-ID")}`
                  : " — belum pernah opname"}
                . Jalankan sekarang →
              </span>
            </a>
          )}

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
            className="block px-4 py-2.5 text-xs font-semibold text-gray-900 bg-gray-50 hover:bg-gray-50 text-center border-t border-gray-100"
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