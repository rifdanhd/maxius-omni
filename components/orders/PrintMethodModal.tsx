"use client";

import { useState } from "react";
import { Printer, X, Loader2, FileText, Layers, AlertCircle } from "lucide-react";
import { printPdfWindow, pdfBlobFromBase64 } from "./printOrders";
import { authFetch } from "@/lib/utils/api-client";

/**
 * PrintMethodModal — "Metode Cetak" ala Desty setelah paket diatur.
 * Label TikTok asli; ringkasan gudang hanya ditambahkan sebagai halaman terpisah.
 * Opsional: menambahkan halaman Picking List.
 */
export default function PrintMethodModal({
  orderIds,
  platform = "TIKTOK_SHOP",
  title = "Cetak Label Pengiriman",
  onClose,
  onDone,
}: {
  orderIds: string[];
  /** Platform order yang dicetak — non-TikTok tidak ditawarkan label resmi TikTok. */
  platform?: string;
  title?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const isTikTok = platform === "TIKTOK_SHOP";
  const [method, setMethod] = useState<"label">("label");
  const [includePickingList, setIncludePickingList] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePrint = async () => {
    if (printing || !isTikTok) return;
    setPrinting(true);
    setError(null);
    try {
      const res = await authFetch("/api/orders/label-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, includePickingList }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `Gagal mencetak label (${res.status})`);
        return;
      }
      if (data.pdfBase64) {
        printPdfWindow(
          URL.createObjectURL(pdfBlobFromBase64(data.pdfBase64)),
          `${title} (${data.count ?? 0})`
        );
      }
      const failedList = (data.failed ?? []) as { orderNo: string; reason: string }[];
      if (failedList.length > 0) {
        const detail = failedList.map((f) => `- ${f.orderNo}: ${f.reason}`).join("\n");
        alert(`Label gabungan: ${data.count ?? 0} berhasil.${detail ? `\n\nOrder yang dilewati (label resmi belum dapat diambil):\n${detail}` : ""}`);
      } else if (!data.pdfBase64) {
        alert("Tidak ada label resmi yang bisa dicetak (order belum di-ship / tanpa paket).");
        return;
      }
      onDone();
    } catch {
      setError("Terjadi kesalahan saat mencetak label.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-overlay/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-card rounded-2xl max-w-lg w-full shadow-2xl border border-border overflow-y-auto flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3 bg-muted/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-muted text-foreground flex items-center justify-center">
              <Printer size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground leading-tight">Metode Cetak</h2>
              <p className="text-xs text-muted-foreground">{orderIds.length > 1 ? `${orderIds.length} paket siap dicetak` : "1 paket siap dicetak"}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Opsi ukuran/kondisi print */}
          <div>
            <p className="text-xs font-bold text-foreground mb-2">Ukuran Label Pengiriman</p>
            <label className={`flex items-start gap-3 border rounded-xl p-4 cursor-pointer transition-colors ${method === "label" ? "border-primary bg-muted/50 ring-2 ring-ring/15" : "border-border hover:bg-muted"}`}>
              <input
                type="radio"
                checked={method === "label"}
                onChange={() => setMethod("label")}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-foreground" />
                  <p className="text-sm font-semibold text-foreground">1 Label (Ukuran A6)</p>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                  {isTikTok
                    ? "Label pengiriman asli dari TikTok Shop. Daftar pengambilan barang dapat disertakan sebagai halaman terpisah."
                    : "Resi resmi Shopee dicetak melalui Seller Center. Untuk daftar isi paket buatan Maxius, tutup modal ini dan pilih Daftar Isi Paket pada menu Cetak pesanan."}
                </p>
              </div>
            </label>
          </div>

          {/* Opsi Picking List */}
          <label className="flex items-start gap-3 border border-border rounded-xl p-4 cursor-pointer hover:bg-muted">
            <input
              type="checkbox"
              checked={includePickingList}
              onChange={(e) => setIncludePickingList(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Layers size={15} className="text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">Sertakan Daftar Pengambilan Barang (Picking List)</p>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Sertakan halaman Picking List per pesanan (daftar barang untuk gudang, per SKU & qty).
              </p>
            </div>
          </label>

          {error && (
            <div className="rounded-xl bg-muted border border-border px-4 py-3 text-xs text-foreground flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-muted border-t border-border flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            disabled={printing}
            className="px-4 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={handlePrint}
            disabled={printing || !isTikTok}
            title={!isTikTok ? "Gunakan Seller Center Shopee untuk resi resmi; daftar isi paket tersedia dari menu Cetak pada pesanan." : undefined}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 shadow-xs"
          >
            {printing ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Menggabungkan label...
              </>
            ) : (
              <>
                <Printer size={14} /> Mulai Cetak
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
