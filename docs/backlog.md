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

## Logging Sync/Import Listing Shopee — Prioritas: Rendah

Diagnosis kegagalan sync dari halaman Produk Marketplace › Shopee tidak bisa
memakai journal atau SyncLog karena alur ini memang tidak menulis keduanya:

- `syncShopeeListings` menangkap error per-akun lalu hanya mengembalikannya di
  `results[].error` (`lib/services/marketplace-shopee.service.ts:301-310`) —
  tidak ada `console.error` dan tidak ada baris SyncLog.
- Route hanya meng-log bila error TOTAL (`app/api/marketplace/shopee/products/
  sync/route.ts:11`); error per-akun tetap membalas HTTP 200 `{ok:true}`.
- Import juga hanya menaruh pesan di `stats.error`
  (`lib/services/marketplace-shopee-import.service.ts:187-189`).
- `SyncLog` pada jalur Shopee hanya ditulis oleh push stok/harga
  (`marketplace-shopee.service.ts:86,93,105,109,115`) — bukan listing sync.
- `SyncJob` adalah antrean push stok, tidak terkait sync listing.

Akibat: penyebab kegagalan live hanya terlihat dari toast UI (yang sebelum fix
pun menelan `error`), sementara `journalctl -u maxius-omni` dan tabel
`SyncLog`/`SyncJob` kosong untuk kasus ini.

Kenapa ditunda: perbaikan Tahap 0 sesuai izin dibatasi ke toast UI saja —
tanpa mengubah service/route/SyncLog.

Keputusan sebelum implementasi:
1. Cukup `console.error("[Shopee] sync listing", {account, error})` ke journal
   (gratis, tanpa migrasi) atau tulis baris `SyncLog` (butuh kind baru mis.
   `listing_sync` + keputusan retensi & isi payload)?
2. Apakah error per-akun juga perlu balas non-200 (atau flag `ok:false`) supaya
   monitoring bisa menghitung kegagalan tanpa mem-parse toast?
3. Untuk import listing: apakah cukup journal, mengingat hasilnya sudah
   terwakili di `ProductMapping.lastSyncedAt` + `StockLedger` reason `INIT`?

## Sinkron Listing Shopee Hanya Status NORMAL — Prioritas: Sedang

Sejak `get_item_list` dikonversi ke GET, `item_status` ikut dikirim di query
dengan default `["NORMAL"]` (`getItemList` di `lib/integrations/shopee.ts`).
Konsekuensi produk (bukan teknis):

- Listing berstatus UNLIST, BANNED, dan REVIEWING tidak ikut tersinkron ke
  katalog master. Sync stok/harga (`syncShopeeListings`) dan import listing
  hanya menjangkau listing NORMAL.
- Shopee menerima satu `item_status` per panggilan — menarik semua status butuh
  satu request per status (NORMAL, UNLIST, BANNED, REVIEWING), masing-masing
  dengan paginasi sendiri.

Keputusan sebelum implementasi:
1. Cukup NORMAL saja (satu-satunya status yang bisa di-push stok/harga), atau
   katalog memang harus memuat semua status?
2. Bila semua status: iterasi `item_status` di loop paginasi
   `syncShopeeListings` + `marketplace-shopee-import.service`, dan hitung ulang
   batas halaman (cap kini 200 halaman per panggilan).

## Sisa P2 PRD §29 (Chat, Customer Analytics, Advanced Reports, Automation) — Prioritas: Rendah

Status Fase D (2026-10-03): semua P1 sudah beres; P2 yang **sudah jadi**: Campaign
(promotions + wizard, ada e2e). Empat P2 berikut sengaja TIDAK dikerjakan tanpa
keputusan produk (jangan diputuskan sepihak implementer):

1. **Unified Chat (§23)** — butuh akses API percakapan terpisah per marketplace
   (Shopee/TikTok), approval + scope berbeda dari API selling. Opsi:
   (a) unified in-app bila API tersedia, (b) cukup deep-link ke aplikasi seller
   masing-masing (murah, tidak unified), (c) tunda sampai ada permintaan dari
   operasional.
2. **Customer Analytics (§22)** — PRD: total customer, repeat, distribution;
   dilarang mengarang data umur/gender. Data lokal dari `Order` (buyer) cukup
   untuk total + repeat rate tanpa API; demografi hanya kalau marketplace API
   menyediakan. Keputusan: cukup versi lokal di dashboard, atau tunda?
3. **Advanced Reports (§20)** — Laporan Penjualan (omset+winning) dan Stok sudah
   ada. "Advanced" (drill-down, ekspor CSV, segmentasi per varian/platform,
   rentang kustom) belum didefinisikan — perlu daftar laporan konkret dulu.
4. **Automation (§29 P2)** — rule otomatis (mis. auto-reprice, auto-restock,
   auto-bump promosi) = high-risk tanpa aturan bisnis yang disepakati.

## Notifikasi Kanal Telegram (§25) — Prioritas: Sedang (setelah demo)

Kanal Dashboard sudah jalan (lonceng notifikasi di header, sumber
`/api/stock-alerts`). Kanal **Telegram** dari PRD belum ada: butuh bot token +
chat id dari pemilik bisnis (aset dari user, bukan kode) dan keputusan event
mana yang dikirim (low stock, sync failed, token expired, store health warning).

## Store Health: Rating/Cancellation Marketplace (§21) — Prioritas: Rendah

Store Health di dashboard kini berbasis fakta DB (status akun/API, token,
sync error) sesuai aturan PRD "jangan mengasumsikan data tersedia". Metrik
rating/cancellation dari marketplace butuh endpoint performa toko per platform
(ketersediaan & izin berbeda tiap platform — perlu dicek per API sebelum
berjanji menampilkannya).
