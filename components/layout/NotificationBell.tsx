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
      authFetch("/api/stock-alerts", {
        headers: { },
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
        className="size-11 sm:size-8 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted border border-border relative"
      >
        <Bell size={16} />
        {hasAlert && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full bg-destructive ring-2 ring-ring text-destructive-foreground text-[9px] font-bold flex items-center justify-center animate-pulse">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-16 flex max-h-[calc(100dvh-5rem)] flex-col bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:max-h-[calc(100dvh-6rem)]">
          <div className="px-4 py-3 border-b border-border flex shrink-0 items-center justify-between gap-2">
            <p className="text-sm font-bold text-foreground">Notifikasi</p>
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-destructive-subtle text-destructive">
              {alerts.length} peringatan stok
            </span>
          </div>

          {/* Pengingat opname otomatis (frekuensi di Pengaturan Inventori) */}
          {reminderDue && reminder && (
            <a
              href="/inventory/opname"
              className="flex items-start gap-2 px-4 py-2.5 border-b border-warning bg-warning-subtle text-warning text-xs font-semibold hover:bg-warning-subtle"
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

          <div className="min-h-0 max-h-80 overflow-y-auto overscroll-contain">
            {alerts.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Semua stok aman.
              </p>
            ) : (
              alerts.map((a) => (
                <a
                  key={a.variantId}
                  href="/inventory"
                  className="flex items-start gap-3 px-4 py-2.5 border-b border-border hover:bg-muted transition-colors"
                >
                  <span
                    className={`mt-0.5 shrink-0 ${
                      a.severity === "out" ? "text-destructive" : "text-warning"
                    }`}
                  >
                    {a.severity === "out" ? <PackageX size={16} /> : <AlertTriangle size={16} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold text-foreground truncate">
                      {a.productName}
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      {a.variantSku} · Sisa {a.effectiveStock} stok
                      {a.safetyStock > 0 ? ` (buffer ${a.safetyStock})` : ""}
                    </span>
                  </span>
                  <ChevronRight size={14} className="text-muted-foreground shrink-0 mt-1" />
                </a>
              ))
            )}
          </div>

          <a
            href="/inventory"
            className="block shrink-0 px-4 py-2.5 text-xs font-semibold text-foreground bg-muted hover:bg-muted text-center border-t border-border"
          >
            {outCount > 0
              ? `Lihat ${outCount} varian stok habis di Inventori`
              : "Lihat semua di Inventori"}
          </a>
        </div>
      )}
    </div>
  );
}
