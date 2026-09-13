# Backlog — Maxius Platform

Item deferred/known-limitation yang ditunda sampai kondisinya material.
Setiap entri: konteks, kenapa ditunda, dan keputusan yang harus dibuat
produk/bisnis sebelum implementasi (jangan diputuskan sepihak implementer).

## Ingest Refund/Return TikTok — Prioritas: Rendah

MAXIUS belum punya cara mendeteksi refund yang terjadi setelah order dikirim
(TikTok tidak mengubah `Order.status` saat refund; refund adalah objek terpisah
di sisi TikTok yang tidak di-ingest). Akibatnya order yang di-refund tetap
terhitung sebagai omset di Dashboard KPI dan Omset/Winning Report.

Status: ditunda sampai (a) refund mulai terjadi nyata di operasional, atau
(b) volume order naik signifikan sehingga risiko ini jadi material.
Data saat investigasi (2026-09-13): 0 kejadian refund; reason ledger
`ORDER_REFUNDED` terdefinisi tapi tidak pernah ditulis alur mana pun;
klausa exclude `REFUNDED`/`RETURNED` di `sales-report.service.ts` bersifat
defensif/no-op.

Keputusan bisnis yang harus dibuat dulu sebelum implementasi (keputusan
produk, bukan teknis):
1. Refund penuh: exclude order dari omset di periode order asli atau periode
   refund terjadi?
2. Refund parsial: perlu model nilai refund (kolom baru) atau cukup exclude
   total order?

Scope teknis kalau dikerjakan: ingest webhook/poll TikTok Return API →
update `Order.status` atau tulis StockLedger reason `ORDER_REFUNDED` via
`restoreStockForCanceledOrder()`. Ini task kelas PHASE A (menyentuh mutasi +
skema status), bukan sekadar fix report.
