# Audit sinkronisasi stok — 26 Oktober 2026

Status: **SIAP DIUJI LOKAL**. Validasi memakai database uji terisolasi dan API marketplace mock. Tidak ada commit, push, deployment, migrasi database operasional, atau perubahan stok marketplace sungguhan.

## A. Akar masalah berdasarkan bukti

1. Gate global hanya mengizinkan nilai `STOCK_PUSH_ENABLED=true` secara persis. Variabel ini tidak ditemukan dalam `.env`/`.env.local` lokal dan tidak aktif pada proses audit. Ini cukup untuk melewati pengiriman kedua platform. Default aman tersebut dipertahankan; konfigurasi VPS belum diperiksa.
2. Resolver TikTok sebelumnya memperlakukan identifier numerik sebagai seller SKU, memakai filter pencarian yang tidak didukung, dan dapat memilih hasil pertama. Mapping `channelSku` tidak selalu seller SKU. Pencarian batch juga perlu batas filter dan pagination yang benar.
3. Antrean TikTok tidak meneruskan credential aplikasi dari callback refresh token. Pemilihan gudang tidak memastikan gudang milik SKU sasaran.
4. Respons bisnis parsial TikTok dan Shopee dapat tercatat berhasil walaupun sebagian SKU ditolak. Error autentikasi yang dibungkus hasil batch juga tidak mencapai pembungkus refresh token.
5. Penerimaan antrean dianggap keberhasilan pengiriman oleh durable job. Jalur dispatch langsung dan worker bersaing; retry tertunda dapat membawa nilai lama.
6. Log dry-run/nonaktif masih mengubah metadata percobaan/error, sehingga status tidak menjelaskan apakah stok benar-benar diterima marketplace.
7. Resolver seller SKU Shopee dapat memilih SKU induk sebelum model variasi dan tidak menolak hasil ambigu. Kontrol Shopee pada UI masih dinonaktifkan walaupun adapter tersedia.

Ketiga identifier Dermarket dari laporan pengguna tidak ditemukan pada database lokal yang diaudit. Karena itu pemilik produk, SKU, gudang, scope, dan konfigurasi VPS untuk identifier tersebut belum terbukti. Temuan kode di atas dibuktikan dengan fixture regresi, bukan klaim diagnosis langsung terhadap akun produksi.

## B. Perubahan kode

| File | Perubahan |
| --- | --- |
| `lib/services/stock-push.policy.ts` | Gate bersama untuk server, brand, toko, platform dan akun beku; alasan nonaktif eksplisit. |
| `lib/services/inventory-settings.service.ts` | Boolean divalidasi ketat dan setting brand disalin saat membuat setting dari template. |
| `prisma/schema.prisma` | Menambah kontrol push per akun, mempertahankan perubahan flag brand sebelumnya. |
| `prisma/migrations/20261026_010000_account_stock_push_enabled/migration.sql` | Migrasi aditif flag akun, default true; belum diterapkan pada database operasional. |
| `lib/services/sync.service.ts` | Guard mapping/tenant/metadata, dry-run, outcome eksplisit, serta pilihan menunggu hasil aktual. |
| `lib/services/sync-log.util.ts` | Dry-run/nonaktif menjaga metadata pengiriman; snapshot stok hanya diperbarui setelah sukses. |
| `lib/services/stock-push-error.ts` | Pesan aman tanpa token/URL sensitif dan penjelasan skema belum siap. |
| `lib/services/stock-push-queue.service.ts` | Gate diperiksa saat flush, credential aplikasi diteruskan, quantity dihitung ulang, revisi antrean dan retry lama dikendalikan. |
| `lib/services/sync-job.service.ts` | Menunggu delivery; mapping job diverifikasi; disabled/deferred tetap PENDING tanpa menghabiskan retry kegagalan. |
| `lib/services/central-stock.service.ts` | Jalur pengiriman melalui klaim durable job, target tenant sesuai master. |
| `lib/integrations/tiktok-stock.ts` | Resolver SKU/product/seller yang tepat, validasi gudang dan quantity, respons parsial per SKU. |
| `lib/integrations/tiktokShop.ts` | Stock API memakai resolver tersebut, credential eksplisit dan timeout. |
| `lib/integrations/shopee.ts` | Target item/model tepat, seller SKU ambigu ditolak, respons sukses/gagal diperiksa per model. |
| `lib/services/marketplace-shopee.service.ts` | Gate adapter, refresh autentikasi batch, pesan aman. |
| `lib/services/rate-limit.policy.ts` | HTTP 429/5xx dan timeout dikenali sebagai transient. |
| `lib/services/stock-allocation.policy.ts` | Menolak konfigurasi nonfinite/negatif dan persentase di atas 100. |
| `lib/services/master-stock.service.ts` | Status nonaktif beserta alasan; tidak dihitung sebagai kegagalan API. |
| `lib/inventory/master-stock.types.ts` | Tipe status DISABLED dan blockedReason. |
| `components/inventory/master-stock-listings.tsx` | Menampilkan Push nonaktif beserta sebabnya. |
| `app/api/inventory/settings/route.ts` | Menyediakan status gate server tanpa secret. |
| `app/(dashboard)/inventory/settings/page.tsx` | Kontrol brand/platform, banner gate server dan kontrol Shopee yang tersedia. |
| `app/api/stores/route.ts` | Mengekspos flag push toko. |
| `app/api/stores/[id]/route.ts` | PATCH flag boolean dengan scope tenant; DELETE tidak diubah. |
| `components/settings/StoreIntegration.tsx` | Kontrol push per toko dan penyimpanan melalui PATCH. |
| `e2e/backend-regressions.spec.ts` | Registrasi regresi kontrak, batas waktu suite berat dan preload pelindung jaringan. |
| `scripts/lib/deny-marketplace-network.mts` | Memblokir native fetch eksternal pada runner backend agar fixture tidak lolos ke marketplace. |
| `scripts/test-stock-sync-contract.integration.mts` | Pengujian alur gudang, gate, alokasi, tenant, identifier, payload, refresh, error parsial, queue dan logging. |
| `scripts/test-stock-sync-ui.mts` | Fixture browser komponen aktual, lebar 390/1280, toggle toko/platform dan alasan nonaktif. |
| `scripts/test-stock-push-gate.integration.mts` | Mempertahankan skenario sebelumnya, membuktikan pengiriman mock aktual ketika gate aktif. |
| `scripts/test-stock-push-queue.integration.mts` | Fixture mapping sah, retry lama dan gate yang berubah sebelum flush. |
| `scripts/test-inventory-settings.integration.mts` | Fixture mapping dan alasan skip sesuai kebijakan. |
| `scripts/test-phase-a-acceptance.integration.mts` | Fixture mapping sah, polling job terbaru dan pembersihan antrean uji. |
| `scripts/test-phase-b-shopee.integration.mts` | Fixture mapping sah untuk adapter dan worker Shopee. |

Perubahan lokal pengguna pada dashboard, mapping page, master-stock page, OrderDetailView, OrdersPage, RUNBOOK-DEPLOY dan label-merge dipertahankan. Migrasi flag brand `20261025_140638_add_stock_push_enabled_column` sudah ada sebelum pekerjaan ini dan dipertahankan.

## C. Validasi yang benar-benar dijalankan

| Perintah/check | Hasil |
| --- | --- |
| `node node_modules/@playwright/test/cli.js test -c playwright.backend.config.ts` | Seluruh 37 suite lulus, sekitar 3,3 menit. |
| Runner backend yang sama dengan filter contract/queue/Shopee/gate setelah guard terakhir | 5 suite lulus, sekitar 53,5 detik. |
| `node --import tsx scripts/test-stock-sync-ui.mts` | Lulus 390 dan 1280 px, tanpa error browser/overflow pada fixture. |
| `npx tsc --noEmit` | Lulus. |
| `npm run build` | Lulus; 116 halaman berhasil dihasilkan, termasuk route API terkait. |
| ESLint terarah pada file sinkronisasi/API/UI/test yang disentuh | Lulus. |
| `npm run lint` | Gagal: 7 error di luar perubahan tugas ini, ditambah warning lama. |
| `npx prisma generate` dan `npx prisma validate` | Lulus. |
| `git diff --check` | Lulus. |

Error lint yang tersisa: `components/orders/OrderDetailView.tsx:249` (render memakai Date.now), lima `no-explicit-any` pada `scripts/test-multi-brand-isolation.mts`, dan satu pada `scripts/test-reviewer-product-copy.mts:66`. File tersebut tidak diperbaiki sebagai bagian pekerjaan sinkronisasi.

Cakupan regresi mencakup global/brand/toko/platform gate, frozen, dry-run tanpa mutasi metadata/request, keempat mode alokasi, buffer, input invalid, tenant berbeda, mapping hilang/berubah, numeric SKU ID, seller SKU, ambigu/mismatch/not found, product ID bukan SKU ID, gudang per SKU, payload kedua platform, HTTP error/rate limit, code sukses dengan penolakan bisnis, refresh token saat write, partial batch, job pending/gagal, serta retry lama sesudah nilai baru. Full browser E2E terhadap aplikasi dan akun marketplace nyata tidak dijalankan.

## D. Kontrak API dan konfigurasi

Resolver TikTok menggunakan Inventory Search 202309 untuk `sku_ids`/`product_ids`, Search Products 202502 untuk seller SKU dan pagination, lalu Update Inventory 202309 dengan product ID, SKU ID serta warehouse ID terverifikasi. Produk bukan pengganti SKU. `data.errors` harus diperiksa walaupun top-level code berhasil. Rujukan: [Update Inventory](https://partner.tiktokshop.com/docv2/page/update-inventory), [Search Products 202502](https://partner.tiktokshop.com/docv2/page/search-products-202502), [Inventory Search](https://partner.tiktokshop.com/docv2/page/inventory-search), serta OAS lokal skill TikTok. Halaman resmi Shopee update_stock mengembalikan HTTP 403 saat audit; fixture memvalidasi kontrak v2 dalam repository, bukan penerimaan endpoint live.

Pengiriman memerlukan seluruh gate aktif: environment persis `true`, brand aktif, toko aktif, platform aktif, dan akun tidak dibekukan. Brand/toko default true; global yang tidak diatur tetap nonaktif. Nilai platform mengikuti setting tersimpan. Settings dibaca ulang, bukan menunggu TTL cache. Tidak ada environment atau gate produksi yang diaktifkan.

Audit database operasional lokal dilakukan read-only: kolom brand sudah tersedia, kolom akun baru belum tersedia. Migrasi aditif perlu diterapkan melalui prosedur deployment yang berwenang sebelum menjalankan kode baru terhadap database tersebut. Hanya database uji sementara yang dimigrasikan dalam pekerjaan ini. Tidak ada output secret.

## E. Cara verifikasi berikutnya

1. Ulangi runner backend di atas pada PostgreSQL lokal terisolasi; preload jaringan dan fixture memastikan tidak ada stock write nyata.
2. Pada fixture, perubahan stok masuk gudang membuat durable job, memverifikasi pemilik master/mapping/account, lalu memanggil API mock kedua marketplace.
3. Periksa log `dry_run`/`skipped_disabled` tanpa perubahan snapshot; `deferred` berarti belum terkirim; SUCCESS hanya setelah respons bisnis diterima. PENDING pada job nonaktif bukan sukses delivery.
4. Hitung `tersedia = max(0, stock - safetyStock)`; `basis = max(0, tersedia - buffer)`. FULL mengirim basis; PERCENT membulatkan ke bawah persentase basis; FIXED membatasi ke jumlah tetap; EQUAL membagi jumlah listing sesuai kebijakan yang sudah ada. Aturan ledger/pengurangan stok historis tidak diubah.
5. Cocokkan product/SKU/model/warehouse sasaran dengan payload mock. TikTok quantity di luar 0–99.999 ditolak, tidak dipotong diam-diam. Gudang marketplace nol/lebih dari satu ditolak sampai ada alokasi eksplisit.
6. Screenshot fixture tersedia pada `.next-e2e/qa/stock-sync-settings-390.png` dan `stock-sync-settings-1280.png`.
7. Verifikasi live merupakan pekerjaan terpisah, hanya setelah persetujuan eksplisit, migrasi terkontrol, pemeriksaan credential/scope, serta pemilihan satu listing uji dengan quantity yang disepakati. Tidak dilakukan pada sesi ini.

## F. Risiko dan pekerjaan tersisa

- Identifier Dermarket dari VPS tidak ada lokal; mapping produksi mungkin perlu koreksi berdasarkan respons resmi toko, tidak boleh ditebak.
- Credential/scope, shop cipher, hak aplikasi, gudang remote dan konfigurasi VPS belum diverifikasi live.
- Multiwarehouse marketplace membutuhkan kebijakan alokasi eksplisit; sekarang ditolak aman, bukan memakai gudang pertama.
- Seller SKU Shopee tanpa pasangan item/model membutuhkan scan katalog lengkap untuk memastikan tidak ambigu; mapping ID terverifikasi lebih efisien.
- Pengujian mock tidak membuktikan throughput/rate limit nyata atau urutan delivery lintas banyak proses produksi.
- Migrasi akun baru belum diterapkan pada database operasional. Lint global masih terhalang error di luar cakupan.

## G. Status

**SIAP DIUJI LOKAL**, belum dinyatakan siap produksi. Kode, fixture dan build lulus; batas validasi live serta migrasi operasional dinyatakan di atas.
