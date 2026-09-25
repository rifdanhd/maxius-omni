# Backlog — Maxius Platform

Item deferred/known-limitation yang ditunda sampai kondisinya material.
Setiap entri: konteks, kenapa ditunda, dan keputusan yang harus dibuat
produk/bisnis sebelum implementasi (jangan diputuskan sepihak implementer).

## Tab TikTok Salah Klasifikasi Produk Unmapped — Prioritas: Tinggi — SELESAI (Batch 4, `0e21bcc`)

Sejak `ProductMapping.variantId` boleh NULL (unmapped), listing TikTok tetap
menampilkan mapping tanpa varian (benar — harus tetap bisa di-map), tetapi
`tabOf()` menghitung `variantStock` dengan fallback `?? 0`. Kombinasi
`platformStatus = ACTIVE` + `platformStock = NULL` + `variant = NULL` membuat
produk unmapped jatuh ke tab **"out" (Stok habis)**.

Risiko: admin bisa salah asumsi barang habis padahal cuma belum di-mapping →
restock/restock-quantity keliru, dan listing yang butuh tindakan mapping jadi
tersembunyi di tab yang salah.

Root cause (bukan sekadar gejala tab): caller mengirim
`variantStock: m.variant?.stock ?? 0` — "tidak ada data" diubah jadi fakta
"stok 0", lalu `platformStock ?? variantStock` menghasilkan 0 → `<= 0` → "out".

Keputusan desain (dipilih 2026-09-25): **Opsi 1 — tab baru khusus unmapped.**

- `tabOf()`: `variantStock === null` → tab **`unmapped` ("Belum Terhubung")**
  dicek paling awal, sebelum `status` — jadi tidak lagi tercampur ke
  "attention" (FREEZE / belum pernah sync) dan tidak dihitung dari stok tanpa
  sumber.
- Listing campur (banyak SKU per `platformProductId`): 1 SKU unmapped →
  seluruh listing masuk "Belum Terhubung", supaya tidak disembunyikan di tab
  lain. Varian mapped di dalamnya tetap memakai tab statusnya sendiri.
- Scope dikerjakan: `TIKTOK_TABS` + `TIKTOK_TAB_LABELS` + `tabOf()` + `counts`
  di `lib/services/marketplace-tiktok.service.ts`, `TabKey` + label tab di
  `app/(dashboard)/products/marketplace/tiktok/page.tsx`. Filter route &
  payload `tabs` ikut otomatis (diturunkan dari `TIKTOK_TABS`).
- Trade-off yang diterima: unmapped dengan status FREEZE/PENDING/failed kini
  tampil di "Belum Terhubung", bukan di tab statusnya (aksi pertama = mapping).
- Test: `scripts/test-null-variant.mts` bagian "Batch 4" (8 assertion,
  dibuktikan merah dulu → hijau).

Flag sisa (belum dikerjakan, butuh keputusan kalau material):

1. Kolom **Stok** masih `platformStock ?? variant.stock ?? 0` (display-only,
   keputusan Batch 1): unmapped tanpa `platformStock` tampil `0` — makna
   "belum ada data" vs "habis" masih samar di kolom, walau tab sudah benar.
2. Tab listing non-unmapped masih diambil dari **mapping pertama** dalam grup
   (pre-existing): listing dengan 1 SKU FREEZE + 1 SKU ACTIVE bisa menampilkan
   tab FREEZE saja — aturan "ada yang unmapped" baru menambal kasus unmapped.
3. `tabOf()` masih menerima param `lastSyncedAt` yang tidak dipakai (dead
   param, sengaja tidak dihapus agar diff tetap fokus).
4. Dua konsep "belum ter-mapping" berdampingan di UI: panel discovery
   (`getTikTokUnmapped` = SKU di TikTok tanpa baris mapping) vs tab baru
   ("Belum Terhubung" = mapping ada, `variantId` NULL). Perlu keputusan produk
   kalau membingungkan admin.

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
