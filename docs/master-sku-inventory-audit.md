# Audit dan perubahan Stok Varian berbasis SKU master

## Bukti sebelum perubahan

- Halaman lama membaca `ProductVariant`, tetapi importer Shopee membuat satu `MasterProduct` per listing dan menyimpan ID teknis sebagai fallback SKU. Ini membuat stok pusat terlihat seperti kumpulan varian marketplace.
- `ProductMapping` sudah mendukung banyak toko untuk satu varian pusat. Indeks unik `(accountId, variantId)` membatasi satu listing per toko; indeks ini diganti indeks biasa tanpa menghapus mapping lama.
- Badge oversell pada `/api/inventory/stock` menghitung baris `SyncLog kind=central_stock_deduct AND handledAt IS NULL`. Percobaan gagal berulang menaikkan badge tanpa menambah SKU. Endpoint oversells lama berisi log audit, bukan saldo kebutuhan aktif.
- Tab Habis lama tidak memisahkan produk nonaktif/arsip. Tidak ada field arsip per SKU.
- Rumus lama adalah `max(stock - safetyStock, 0)`. Pesanan yang sudah memiliki pemotongan `ORDER` sudah tercermin dalam `stock`.
- Sinkronisasi riwayat tidak memiliki penanda `import_only`; ingest tertentu bisa mencoba memotong stok dari pesanan lama.
- Output VPS yang diberikan menunjukkan 3.612 varian, stok gudang 205.811.142 dan siap jual 205.811.057. Dua puluh baris terbesar masing-masing 888.888 berasal dari produk berlabel impor Shopee. Tidak ada koreksi atau penggabungan jumlah ini secara otomatis.
- Angka oversell 603.154 dan Habis 1.610 belum dihitung ulang langsung di VPS oleh sesi ini. Akses SSH VPS tidak terkonfigurasi.

## Aturan yang dipertahankan

1. `Bisa Dijual = max(Di Gudang - Disisihkan, 0)`; permintaan menunggu tidak dikurangi lagi.
2. StockLedger tetap menjadi jejak perubahan; pemotongan dan pembatalan tetap idempoten per order/SKU.
3. Satu toko gagal tidak membatalkan pengiriman toko lain; debounce, retry dan pembatasan API tetap digunakan.
4. Stok awal SKU Shopee yang benar-benar baru tetap mengikuti laporan platform, atau nol jika platform tidak melaporkannya. Listing tambahan yang cocok SKU master tidak menambah atau menimpa stok pusat.
5. SKU seller dicocokkan dengan trim dan tetap peka huruf besar/kecil. ID marketplace tetap bersifat per toko dan tidak digunakan untuk menyamakan stok lintas platform.

## Perubahan aturan yang dilaporkan

- Tarikan awal dan riwayat eksplisit disimpan sebagai `Order.importOnly=true`. Jalur ini tidak memotong maupun memulihkan stok, termasuk saat statusnya aktif. Data lama tidak diberi label ini berdasarkan tebakan tanggal.
- Menunggu diproses menghitung unit `UNPAID`, `ON_HOLD`, `AWAITING_SHIPMENT`, `PARTIALLY_SHIPPING` yang bukan import_only dan belum memiliki ledger `ORDER` untuk order/SKU itu. Selesai, dibatalkan, dikirim dan log kegagalan tidak dihitung.
- Oversell menghitung jumlah SKU dengan permintaan tersebut melebihi Bisa Dijual, bukan jumlah unit atau log. Tab dibatasi oleh filter dan arsip yang sama dengan tabel.
- Stok fisik per gudang berada di `VariantWarehouseStock`. `ProductVariant.stock/safetyStock` dipertahankan sebagai agregat untuk kompatibilitas kode lama; trigger database menjaga kedua arah. Migrasi menyalin nilai lama ke Gudang utama, bukan mengubahnya.
- Pemotongan operasional mengambil Gudang utama terlebih dahulu, lalu gudang lain menurut ID. `WarehouseOrderAllocation` mencatat asal unit. Pembatalan mengembalikan ke gudang asal; pemotongan lama tanpa catatan gudang kembali ke Gudang utama.
- Default alokasi tetap FULL/100% dan buffer listing nol, sehingga pengiriman lama tidak berubah sampai pengguna memilih aturan lain. Buffer listing dipisahkan dari Disisihkan gudang agar tidak dikurangi dua kali.
- Alokasi FULL: `base`; PERCENT: `floor(base * persen / 100)`; FIXED: `min(base, batas)`; EQUAL: `floor(base / jumlah listing)`, dengan `base=max(Bisa Dijual-buffer listing,0)`. Bagi rata berlaku per listing, bukan per toko. Sisa pembagian tetap di gudang.
- Total alokasi di atas Bisa Dijual menampilkan peringatan risiko oversell; mode FULL pada gudang bersama tetap diperbolehkan sebagaimana perilaku sebelumnya.
- SKU ganda masuk tinjauan. Pengguna memilih stok acuan dan mengakui bahwa jumlah kandidat tidak dijumlahkan. SKU sumber yang tidak lagi memiliki listing diarsipkan, bukan dihapus. Pemindahan ditolak jika SKU sumber memiliki pesanan operasional yang belum terpenuhi.
- Perubahan stok dari halaman baru wajib memiliki versi, alasan, jenis perubahan dan gudang. Konflik versi ditolak agar pengguna meninjau angka terbaru.

## Model dan batas tampilan

`Customer/Business -> Produk Master -> ProductVariant (SKU Master) -> ProductMapping (listing per toko)`.

`MasterSkuKey` menjaga identitas seller SKU per customer. `SkuMappingReview` menyimpan konflik. Listing memiliki seller SKU dan ID varian platform terpisah; banyak listing di toko yang sama dapat memakai satu SKU master.

Tabel menampilkan total SKU dari seluruh gudang. Filter gudang memilih SKU yang memiliki saldo/rekaman di gudang tersebut; rincian memperlihatkan saldo per gudang dan dialog mengubah gudang yang dipilih. Angka permintaan dan alokasi listing tetap agregat SKU bersama, bukan dibagi ke gudang secara semu.

Status di halaman diperbarui otomatis dari outbox, job dan hasil pengiriman listing. Respons antrean TikTok tidak dianggap sebagai bukti stok sudah diterima marketplace. Persediaan berubah melalui transaksi/webhook, bukan polling UI.

Impor Excel memerlukan pratinjau dan alasan. Versi ekspor yang sudah usang ditolak. File maksimal 5 MB/5.000 SKU; penyimpanan berlangsung per kelompok maksimal 200 SKU dan kemajuan yang sudah commit tetap dilaporkan bila kelompok berikutnya gagal.

## Pemeriksaan VPS tanpa perubahan data

```bash
node --env-file=.env --import tsx scripts/audit-master-inventory.mts --business-id business-default
```

Skrip mendukung schema sebelum dan sesudah migrasi. Output hanya agregat inventori, status pesanan dan informasi brand; token tidak dipilih. Jangan menghapus log lama atau mengoreksi stok 888.888 sebelum hasil audit dan stok fisik dipastikan.

## Migrasi dan handoff

- Migrasi tambahan: `20261025_010000_master_sku_inventory`.
- Jalankan backup dan `prisma migrate deploy` melalui alur `deploy.sh` sebelum menjalankan build baru di VPS.
- Tidak ada reset/fresh migration atau penghapusan produk master dalam perubahan ini.
- Rollback aplikasi harus mempertahankan schema/data tambahan. Bila aturan alokasi khusus sudah digunakan, hentikan push stok sementara sebelum menjalankan binary lama karena binary lama tidak memahami alokasi tersebut.
- Sesi ini menguji database sementara lokal, bukan database VPS atau maxius_dev.

## Hasil verifikasi lokal

- Sembilan suite backend terkait stok, mapping, impor Shopee, sinkron pesanan, opname dan antrean pengiriman lolos. Pengujian SKU master kemudian diperluas dan dijalankan ulang secara langsung.
- Satu SKU di tiga toko menerima satu perubahan; kegagalan satu toko tidak membatalkan dua toko lain. Retry manual hanya mengubah status listing yang dipilih menjadi Menunggu. Kegagalan yang menunggu backoff otomatis tetap menampilkan penyebab kegagalannya.
- Pencocokan seller SKU lintas tiga toko Shopee mempertahankan stok pusat; angka stok listing tambahan tidak ditambahkan atau ditimpa ke gudang. Pencocokan TikTok diuji untuk dua customer dengan SKU sama, serta varian ganda yang masuk tinjauan.
- Perubahan bersamaan dengan versi sama menghasilkan satu commit dan satu konflik. Mapping lintas customer juga ditolak trigger database.
- Ingest riwayat aktif tersimpan sebagai import_only tanpa ledger ORDER; pemotongan lintas dua gudang dan pengembalian ke gudang asal lolos.
- Ekspor/impor Excel diuji untuk versi dan customer. Pembacaan 3.602 SKU dibatasi 50 baris, sekitar 93–216 ms pada database fixture lokal; angka ini bukan tolok ukur VPS.
- Browser fixture lolos pada 320, 390 dan 1.280 piksel: tabel, status listing, alasan wajib, konflik versi, alokasi, filter dan pagination. Tiga E2E aplikasi produksi lokal dengan login/API/database nyata juga lolos: katalog baca saja, barang masuk berikut riwayat, serta dialog/bulk/arsip SKU master.
- Build produksi Next.js 16.4.3 dan TypeScript lolos. Lint file perubahan tidak memiliki error; lint seluruh repo masih memiliki enam error any pada dua skrip lama di luar perubahan ini.
- Tidak ada pengiriman API marketplace nyata atau deployment VPS dalam verifikasi ini; respons platform memakai fixture.
