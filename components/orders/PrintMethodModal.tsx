"use client";

import { useState } from "react";
import { Printer, X, Loader2, FileText, Layers, AlertCircle } from "lucide-react";
import { printPdfWindow, pdfBlobFromBase64 } from "./printOrders";
import { authFetch } from "@/lib/utils/api-client";

/**
 * PrintMethodModal — "Metode Cetak" ala Desty setelah paket diatur.
 * Opsi cetak "1 Label": satu lembar berisi label resmi TikTok di atas dan
 * tabel ringkasan produk (dibuat lokal dari OrderItem/ProductVariant) di bawah.
 * Opsional: menambahkan halaman Picking List.
 */
export default function PrintMethodModal({
  orderIds,
  title = "Cetak Label Pengiriman",
  onClose,
  onDone,
}: {
  orderIds: string[];
  title?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<"label">("label");
  const [includePickingList, setIncludePickingList] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePrint = async () => {
    if (printing) return;
    setPrinting(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/orders/label-pack", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Printer size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-tight">Metode Cetak</h2>
              <p className="text-xs text-gray-500">{orderIds.length > 1 ? `${orderIds.length} paket siap dicetak` : "1 paket siap dicetak"}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Opsi ukuran/kondisi print */}
          <div>
            <p className="text-xs font-bold text-gray-900 mb-2">Ukuran Label Pengiriman</p>
            <label className={`flex items-start gap-3 border rounded-xl p-4 cursor-pointer transition-colors ${method === "label" ? "border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/15" : "border-gray-200 hover:bg-gray-50"}`}>
              <input
                type="radio"
                checked={method === "label"}
                onChange={() => setMethod("label")}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-indigo-600" />
                  <p className="text-sm font-semibold text-gray-900">1 Label (Ukuran A6)</p>
                </div>
                <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                  Label kurir resmi TikTok di bagian atas + tabel ringkasan produk
                  (nama, varian, seller SKU, qty) yang dibuat dari data pesanan di bagian bawah.
                </p>
              </div>
            </label>
          </div>

          {/* Opsi Picking List */}
          <label className="flex items-start gap-3 border border-gray-200 rounded-xl p-4 cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              checked={includePickingList}
              onChange={(e) => setIncludePickingList(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Layers size={15} className="text-gray-500" />
                <p className="text-sm font-semibold text-gray-800">Unduh dengan Picking List</p>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                Sertakan halaman Picking List per pesanan (daftar barang untuk gudang, per SKU & qty).
              </p>
            </div>
          </label>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            disabled={printing}
            className="px-4 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={handlePrint}
            disabled={printing}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 shadow-xs"
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