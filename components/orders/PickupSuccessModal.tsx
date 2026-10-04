"use client";

import { CheckCircle2, XCircle, Printer, X, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { PickupShipResult } from "./RequestPickupModal";

/**
 * PickupSuccessModal — layar sukses setelah "Atur Pengiriman" selesai.
 * Mendukung single & multi-order: menampilkan ringkasan sukses/gagal per pesanan,
 * dan tombol "Cetak Label" yang membuka modal "Metode Cetak".
 */
export default function PickupSuccessModal({
  result,
  onClose,
  onPrintLabels,
}: {
  result: PickupShipResult;
  onClose: () => void;
  onPrintLabels: (successfulOrderIds: string[]) => void;
}) {
  const [showFailed, setShowFailed] = useState(false);

  const summary = result.summary;
  const successCount = summary?.success ?? (result.ok ? 1 : 0);
  const failedCount = summary?.failed ?? (result.ok ? 0 : 1);
  const results = result.results ?? [];
  const failedItems = results.filter((r) => !r.ok);
  const successfulOrderIds = results.filter((r) => r.ok).map((r) => r.orderId);
  const hasMixed = successCount > 0 && failedCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card rounded-2xl max-w-lg w-full shadow-2xl border border-border">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3 bg-muted/50">
          <h2 className="text-base font-bold text-foreground">
            {successCount > 0 ? "Pengiriman Berhasil Diatur" : "Pengiriman Gagal"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Ikon centang / gagal */}
          <div className="flex flex-col items-center text-center space-y-3">
            {successCount > 0 ? (
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <CheckCircle2 size={36} className="text-foreground" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <XCircle size={36} className="text-foreground" />
              </div>
            )}

            <div>
              {successCount > 0 ? (
                <p className="text-sm text-foreground">
                  Berhasil mengatur pengiriman untuk{" "}
                  <span className="font-bold text-foreground">{successCount} pesanan</span>
                </p>
              ) : (
                <p className="text-sm text-foreground">Semua pesanan gagal diproses.</p>
              )}
              {hasMixed && (
                <p className="text-xs text-foreground mt-1">
                  {failedCount} pesanan gagal — lihat detail di bawah.
                </p>
              )}
            </div>
          </div>

          {/* Detail per pesanan */}
          {results.length > 0 && (
            <div className="bg-muted rounded-xl border border-border p-4 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Ringkasan Per Pesanan
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {results.map((r) => (
                  <div
                    key={r.orderId}
                    className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                      r.ok ? "bg-muted text-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {r.ok ? (
                      <CheckCircle2 size={13} className="shrink-0 text-muted-foreground" />
                    ) : (
                      <XCircle size={13} className="shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-semibold">{r.orderNo}</span>
                    <span className="ml-auto text-[10px]">
                      {r.ok ? (
                        r.trackingNumber ? `Resi: ${r.trackingNumber}` : "Terkirim"
                      ) : (
                        <span title={r.error}>{r.error?.slice(0, 40)}{r.error && r.error.length > 40 ? "..." : ""}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daftar gagal (expandable) */}
          {failedItems.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => setShowFailed((v) => !v)}
                className="w-full px-4 py-3 bg-muted flex items-center gap-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
              >
                <AlertCircle size={14} />
                <span>{failedItems.length} pesanan gagal</span>
                <span className="ml-auto">
                  {showFailed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
              </button>
              {showFailed && (
                <div className="px-4 py-3 bg-card border-t border-border space-y-2">
                  {failedItems.map((r) => (
                    <div key={r.orderId} className="flex items-start gap-2 text-xs">
                      <span className="font-semibold text-foreground shrink-0">{r.orderNo}:</span>
                      <span className="text-foreground">{r.error ?? "Kesalahan tidak diketahui"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-muted border-t border-border flex items-center justify-center gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted"
          >
            Tutup
          </button>
          {successCount > 0 && (
            <button
              onClick={() => onPrintLabels(successfulOrderIds)}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary flex items-center gap-2 shadow-xs"
            >
              <Printer size={14} /> Cetak Label
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
