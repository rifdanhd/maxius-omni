# Preview arsip — belum dieksekusi

Bisnis: `business-default`. Sumber wajib: `SHOPEE:1929797459`.
Backup PostgreSQL terverifikasi: `/home/maxis/maxius-omni/backups/maxius-before-archive-preview-shopee1929797459-20261105.dump`.

19 master, 19 varian, 19 ledger. Setiap kandidat memiliki 0 mapping, 0 item order, dan 0 relasi bundle pada saat preview 5 November 2026.

| SKU | Nama produk | Stok dipertahankan |
|---|---|---:|
| 57268048019:0 | 12V/24V CAR HORN BREAK MODULE | 469 |
| 57868052585:0 | 12V-24V REVERSE ALARM SIREN | 992 |
| 57268048000:0 | 1 Meter 100cm Luggage Tie, Quality Rubber, Multipurpose Motorcycle Luggage Tie | 88885 |
| 57868052506:0 | 1 Pair Universal Car Motorcycle Bicycle Tire Pressure Indicator Valve Caps | 6584 |
| 53568056824:0 | 1pcs Mini Rearview Mirror Additional Blind Spot Mirror Car | 9936 |
| 57268047998:0 | 2-Leg RGB 12-Volt LED Brake Light for Motorcycles and Cars RGB RUNNINGSenja with Flashing Brakes | 9990 |
| 57268048010:0 | 7 COLOR RGB FLASHING LIGHTS FOR MOTORCYCLE, CAR, BICYCLE, LED LIGHTS USB CHARGER, RGB AIRCRAFT MODEL | 8957 |
| 57268047947:0 | Carrera PENGKILAP Ban 200ml Semir Ban motor Mobil Carrera | 9968 |
| 57868052499:0 | CHANEL 12V-24V 8 Channel MANUAL and Automatic Tank Module | 987 |
| 51618043670:0 | H4 HEADLIGHT HI/LO 3-SIDED 12V/24V TRUCK/BUS PERSONAL CAR | 995 |
| 57868052507:0 | H6 laser Gun Plus Universal AC DC Hi Low 2-Color Automatic Motorcycle HeadlightSenja | 7854 |
| 57868052538:0 | LED STROBE RUNNING TEXT LIGHT WIFI GLASS 140CM 24 5-ROWVOLT | 125 |
| 57868052519:0 | MATA SQL 2-Eye 2-Color Laser Spotlight 12V/24V | 888 |
| 57868052582:0 | MINI CONTROLLER RGB MOTION MODULE RGB CAR VARIATIONS /MOTOR | 9990 |
| 57868052544:0 | Min Plus 4 Inch Reversible Screwdriver with Yellow Handle | 9999 |
| 57868052536:0 | RGB USB Motorcycle Car Airplane Flashing Light USB Charger LED Light | 9477 |
| 51618043676:0 | SCANIA 12V AIR HORN 24V AIR HORN HINO SCANIA 12VOLT - 24VOLT | 9999 |
| 57868052500:0 | SOFT MOCROFIBER CLOTH, MULTIPURPOSE SOFT CLOTH 30CM | 9529 |
| 50818052606:0 | Universal 12Volt Car Rear Spoiler Led Lights | 10000 |

Rencana setelah preview diterima: di dalam satu transaksi, kunci dan validasi ulang daftar ID yang sama, bisnis, sumber, jumlah 19/19 dan seluruh relasi. Batalkan bila ada perubahan. Ubah hanya MasterProduct.isActive menjadi false, status menjadi archived, dan ProductVariant.isArchived menjadi true. Jangan mengubah stok, ledger, akun, mapping atau pesanan.

Reversibel: simpan snapshot per ID saat apply. Status sebelum preview seluruhnya MasterProduct.status=active, isActive=true, ProductVariant.isArchived=false. Pemulihan hanya mengembalikan tiga field tersebut untuk ID dalam snapshot, setelah validasi bahwa status belum berubah lagi. Bukan restore seluruh database produksi.

Den Sport, Demo, Dermarket, serta seluruh akun TikTok dan Shopee klien tidak menjadi target operasi ini.
