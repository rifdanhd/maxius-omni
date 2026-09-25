# Backlog — Maxius Platform

Item deferred/known-limitation yang ditunda sampai kondisinya material.
Setiap entri: konteks, kenapa ditunda, dan keputusan yang harus dibuat
produk/bisnis sebelum implementasi (jangan diputuskan sepihak implementer).

## Tab TikTok Salah Klasifikasi Produk Unmapped — Prioritas: Tinggi

Sejak `ProductMapping.variantId` boleh NULL (unmapped), listing TikTok tetap
menampilkan mapping tanpa varian (benar — harus tetap bisa di-map), tetapi
`tabOf()` menghitung `variantStock` dengan fallback `?? 0`. Kombinasi
`platformStatus = ACTIVE` + `platformStock = NULL` + `variant = NULL` membuat
produk unmapped jatuh ke tab **"out" (Stok habis)**.

Risiko: admin bisa salah asumsi barang habis padahal cuma belum di-mapping →
restock/restock-quantity keliru, dan listing yang butuh tindakan mapping jadi
tersembunyi di tab yang salah. Produk unmapped seharusnya beda kategori dari
"attention" (perlu tindakan mapping), bukan "out".

Status: ditunda — logic `tabOf()` sengaja TIDAK diubah saat null-variant
refactor (Batch 1, commit `a2e02d7`) supaya perubahan perilaku tidak
menyelinap di commit mekanis.

Keputusan desain yang harus dibuat dulu sebelum implementasi:
1. Tambah kategori tab baru khusus unmapped (butuh update filter + counts di
   `listTikTokProducts` + tab bar di UI), atau
2. Ubah logic `tabOf()`: `variant = NULL` → paksa kategori tertentu tanpa
   kategori baru (lebih murah, tapi "unmapped" jadi kecampur makna dengan
   "attention").

Scope teknis kalau dikerjakan: `tabOf()` + `counts` di
`lib/services/marketplace-tiktok.service.ts` (baris 524-537, 683-692) dan tab
bar di `app/(dashboard)/products/marketplace/tiktok/page.tsx`.

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
