"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";
import type { OrderFinance } from "@/lib/types/order-finance";

function formatAmount(value: string | null, currency: string) {
  if (value === null) return "-";
  const [whole, fraction] = value.split(".");
  const sign = whole.startsWith("-") ? "−" : "";
  const digits = whole.replace(/^-/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${currency === "IDR" ? "Rp" : currency} ${digits}${fraction ? `,${fraction}` : ""}`;
}

export default function OrderFinancePanel({ orderId, platform }: { orderId: string; platform: string | null }) {
  const [result, setResult] = useState<OrderFinance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (platform !== "TIKTOK_SHOP") return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const response = await authFetch(`/api/orders/${encodeURIComponent(orderId)}/finance`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(response.status === 404 ? "Pesanan tidak ditemukan." : "Rincian Finance belum berhasil dimuat. Coba lagi.");
        if (!controller.signal.aborted) setResult(data as OrderFinance);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Rincian Finance belum berhasil dimuat.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [orderId, platform, attempt]);

  if (platform !== "TIKTOK_SHOP") {
    return <p className="p-6 text-sm text-muted-foreground">Rincian Finance ini tersedia untuk pesanan TikTok Shop.</p>;
  }
  const amounts = result?.amounts;
  const rows: Array<[string, string | null]> = amounts ? [
    ["Subtotal sebelum diskon", amounts.subtotal],
    ["Refund sebelum diskon", amounts.refundSubtotal],
    ["Diskon penjual", amounts.sellerDiscount],
    ["Pengembalian diskon penjual", amounts.sellerDiscountRefund],
    ["Total penjualan bersih", amounts.revenue],
    ["Biaya pengiriman final", amounts.shippingCost],
    ["Total biaya dan pajak", amounts.feesAndTaxes],
    ["Rincian: biaya transaksi", amounts.transactionFee],
    ["Rincian: komisi affiliate kreator", amounts.affiliateCommission],
    ["Rincian: komisi affiliate iklan", amounts.affiliateAdsCommission],
    ["Rincian: komisi affiliate partner", amounts.affiliatePartnerCommission],
    ["Rincian: komisi platform", amounts.platformCommission],
    ["Rincian: komisi dinamis", amounts.dynamicCommission],
    ["Nilai settlement", amounts.settlement],
  ] : [];

  return (
    <div className="p-4 md:p-6" aria-busy={loading}>
      <div className="mx-auto max-w-xl">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Rincian penjualan</p>
          <button type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Perbarui
          </button>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status"><Loader2 size={16} className="animate-spin" /> Mengambil rincian Finance TikTok…</p>
        ) : error ? (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        ) : result ? (
          <>
            {result.status === "ready" && result.currency && (
              <>
                <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Sumber: TikTok Finance API</p>
                <div className="divide-y divide-border">
                  {rows.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={`text-right font-medium ${value?.startsWith("-") ? "text-destructive" : "text-foreground"}`}>{formatAmount(value, result.currency!)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <p role="status" className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{result.message}</p>
            {result.fetchedAt && <p className="mt-2 text-[11px] text-muted-foreground">Diperbarui: {new Date(result.fetchedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p>}
          </>
        ) : null}
      </div>
    </div>
  );
}
