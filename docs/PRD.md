# MAXIUS — MASTER PRODUCT & ENGINEERING PROMPT

## 1. ROLE

Kamu bertindak sebagai **Senior Product Engineer + Software Architect** untuk membangun platform **MAXIUS**, sebuah sistem Omnichannel Commerce Management.

Jangan menganggap MAXIUS hanya sebagai dashboard.

**Masalah bisnis utama yang harus diselesaikan adalah STOCK MANAGEMENT.**

Seluruh keputusan arsitektur, database, API, workflow, dan UI harus mendukung tujuan tersebut.

---

# 2. BUSINESS PROBLEM — MASALAH UTAMA

Client memiliki **8 akun marketplace**:

* 4 akun Shopee
* 4 akun TikTok Shop

Saat ini setiap toko berjalan secara terpisah.

Stok produk tersebar di masing-masing marketplace dan tidak memiliki satu sumber stok pusat.

Akibatnya client sering mengalami:

* Selisih stok fisik dengan stok marketplace
* Overselling
* Pesanan masuk tetapi barang ternyata habis
* Pembatalan pesanan
* Stok harus diperbarui manual di banyak toko
* Kesulitan mengetahui stok sebenarnya
* Kesulitan mengetahui variant/motif yang paling laku
* Kesulitan mengetahui toko mana yang menghasilkan omset terbesar
* Risiko kerugian akibat inventory mismatch

### MASALAH PALING PENTING

> **Client sering rugi karena stok tidak sinkron di 8 akun marketplace.**

MAXIUS harus menyelesaikan masalah ini terlebih dahulu.

---

# 3. CORE SOLUTION

MAXIUS harus memiliki konsep:

## CENTRAL INVENTORY

Central Inventory menjadi **Single Source of Truth** untuk stok.

Flow utama:

BARANG DATANG
↓
INPUT KE MAXIUS
↓
CENTRAL INVENTORY
↓
PRODUCT / VARIANT / SKU
↓
SYNC KE 8 MARKETPLACE
↓
CUSTOMER ORDER
↓
MARKETPLACE API / WEBHOOK
↓
MAXIUS ORDER ENGINE
↓
IDENTIFY SKU
↓
RESERVE / DEDUCT STOCK
↓
CENTRAL INVENTORY BERUBAH
↓
SYNC STOCK KE SEMUA CHANNEL
↓
STOCK UPDATED

Jangan membuat setiap marketplace memiliki stok independen sebagai sumber kebenaran.

---

# 4. CONTOH PRODUK NYATA

Gunakan produk berikut sebagai contoh utama saat mendesain sistem:

**Kaos Kaki Ortus Dewasa**

Contoh struktur:

PRODUCT
└── Kaos Kaki Ortus Dewasa
│
├── Sambung
│   ├── Hitam
│   └── Putih
│
└── Pendek
├── Hitam
└── Putih

Setiap kombinasi harus dapat memiliki SKU dan inventory sendiri.

Contoh:

ORT-S-H = Sambung Hitam
ORT-S-P = Sambung Putih
ORT-P-H = Pendek Hitam
ORT-P-P = Pendek Putih

**Catatan:**
SKU final harus mengikuti data marketplace sebenarnya. Jangan mengarang mapping SKU production.

---

# 5. CONTOH CENTRAL STOCK

Misalnya:

Sambung Hitam = 100 pcs

MAXIUS:

Central Stock = 100

Jika:

Shopee Account 1 menjual 10 pcs

Maka:

100 - 10 = 90

Central Stock:

90 pcs

Kemudian MAXIUS harus melakukan stock synchronization ke channel yang terhubung.

Contoh target:

Shopee 1 → 90
Shopee 2 → 90
Shopee 3 → 90
Shopee 4 → 90

TikTok 1 → 90
TikTok 2 → 90
TikTok 3 → 90
TikTok 4 → 90

Tujuannya adalah mencegah marketplace lain tetap menampilkan stok lama.

---

# 6. CONTOH BARANG MASUK

Client menerima:

10 lusin kaos kaki.

10 lusin = 120 pcs.

Jika Central Stock sebelumnya:

75 pcs

Maka:

75 + 120 = 195 pcs

MAXIUS harus mencatat inventory movement:

STOCK_IN
+120

Central Stock:

195

Kemudian melakukan synchronization ke marketplace.

---

# 7. SAFETY STOCK / LIMIT STOCK

MAXIUS harus mendukung:

* Actual Stock
* Safety Stock
* Sellable Stock

Contoh:

Actual Stock = 195
Safety Stock = 20

Maka:

Sellable Stock = 175

Marketplace hanya boleh mendapatkan:

175

Sedangkan:

20 pcs

tetap menjadi buffer.

Tujuannya adalah mengurangi risiko overselling akibat delay API, race condition, atau sinkronisasi marketplace.

---

# 8. VARIANT STOCK HARUS TERPISAH

Jangan hanya menyimpan:

Product Stock = 390

MAXIUS harus mengetahui:

Sambung Hitam = 100
Sambung Putih = 80
Pendek Hitam = 120
Pendek Putih = 90

Jika customer membeli:

Sambung Hitam × 5

Maka:

Sambung Hitam:

100 → 95

Bukan hanya:

Total Product:

390 → 385

Variant/SKU adalah unit inventory yang penting.

---

# 9. SKU MAPPING

Marketplace dapat menggunakan SKU yang berbeda.

Contoh:

MASTER SKU
ORT-S-H

Marketplace:

Shopee 1 → SKU-172839
Shopee 2 → ORT-SH-01
TikTok 1 → 928372
TikTok 2 → ORT-BLK-S

Semua mapping tersebut harus menunjuk ke:

MASTER SKU
ORT-S-H

Dengan demikian semua channel tetap terhubung ke satu inventory pusat.

---

# 10. ORDER ENGINE

Semua order dari 8 akun harus masuk ke satu Order Engine.

Sources:

Shopee 1
Shopee 2
Shopee 3
Shopee 4

TikTok 1
TikTok 2
TikTok 3
TikTok 4

↓

UNIFIED ORDER

↓

Identify Marketplace Account

↓

Identify Marketplace Product

↓

Identify Marketplace SKU

↓

Resolve Master SKU

↓

Validate Stock

↓

Reserve / Deduct Stock

↓

Create Inventory Movement

↓

Update Central Inventory

↓

Queue Stock Synchronization

↓

Sync marketplace stock

---

# 11. CONCURRENCY / RACE CONDITION

Ini sangat penting.

Bayangkan stok hanya:

5 pcs.

Pada waktu hampir bersamaan:

Shopee order = 4 pcs

TikTok order = 4 pcs

MAXIUS tidak boleh menghasilkan:

5 - 4 - 4 = -3

Sistem harus memiliki mekanisme:

* Atomic inventory update
* Transaction
* Stock reservation
* Idempotency
* Duplicate order protection
* Queue
* Retry
* Sync lock jika diperlukan

Tujuan:

> Stock tidak boleh menjadi negatif karena dua order diproses bersamaan.

---

# 12. WEBHOOK & ORDER SYNC

Prioritaskan event-driven architecture jika API marketplace mendukung.

Flow:

MARKETPLACE
↓
WEBHOOK
↓
MAXIUS
↓
Validate Event
↓
Check Idempotency
↓
Resolve Order
↓
Resolve SKU
↓
Inventory Transaction
↓
Update Order
↓
Queue Stock Sync

Jangan memproses webhook dua kali.

Jika event yang sama datang dua kali:

Order hanya boleh memengaruhi inventory satu kali.

---

# 13. SYNC ENGINE

Buat Sync Engine terpisah.

Contoh:

Sync Job:

SYNC_STOCK

Target:

TikTok Account 2

SKU:

ORT-S-H

Quantity:

90

Status:

PENDING
↓
PROCESSING
↓
SUCCESS

atau:

FAILED
↓
RETRY
↓
SUCCESS

Simpan:

* job ID
* marketplace
* account
* entity
* SKU
* old value
* new value
* status
* retry count
* error message
* timestamp

---

# 14. ERROR HANDLING

Jangan menganggap API selalu berhasil.

Jika:

Central Stock = 90

Tetapi update ke TikTok gagal.

MAXIUS harus:

1. Menyimpan central stock = 90
2. Mencatat sync job FAILED
3. Retry secara otomatis
4. Memberikan notification jika gagal berkali-kali
5. Menampilkan mismatch pada dashboard

Contoh:

STOCK MISMATCH

Central:
90

TikTok 2:
100

Status:
WARNING

Action:
Retry Sync

---

# 15. PRODUCT MANAGEMENT

Product module harus mendukung:

* Product
* Category
* Variant
* SKU
* Marketplace Mapping
* Price
* Stock
* Safety Stock
* Status
* Product Image
* Marketplace Product ID

---

# 16. INVENTORY MANAGEMENT

Inventory adalah modul paling penting.

Minimal:

* Central Stock
* Stock In
* Stock Out
* Stock Adjustment
* Stock Reservation
* Safety Stock
* Sellable Stock
* Inventory Movement
* Stock History
* Stock Mismatch
* Sync Status

Contoh:

Inventory Movement:

STOCK_IN
+120

ORDER
-10

ADJUSTMENT
-2

RETURN
+1

Semua perubahan harus memiliki audit trail.

---

# 17. UNIFIED ORDER MANAGEMENT

Admin harus dapat melihat semua order dari satu dashboard.

Filter:

* Marketplace
* Account
* Order Status
* Payment Status
* Shipping Status
* Product
* Variant
* SKU
* Date

Contoh:

#INV001
Shopee 1
Kaos Kaki Ortus
Sambung Hitam × 2
Rp120.000
Paid
Processing

---

# 18. DASHBOARD

Dashboard bukan fokus utama pertama.

Dashboard hanya menjadi visualisasi dari engine.

Minimal KPI:

* Total Omset
* Total Order
* Product Sold
* Central Stock
* Low Stock
* Stock Mismatch
* Winning Product
* Winning Variant
* Store Performance
* Store Health
* Sync Error

---

# 19. WINNING PRODUCT / VARIANT

MAXIUS harus dapat menentukan:

Produk paling laku.

Dan:

Variant paling laku.

Contoh:

1. Sambung Hitam — 8.421 sold
2. Pendek Hitam — 6.821 sold
3. Sambung Putih — 4.211 sold
4. Pendek Putih — 2.981 sold

Filter:

* Today
* 7 Days
* 30 Days
* This Month
* Custom Range

Dan:

* All Marketplace
* Shopee
* TikTok
* Individual Account

---

# 20. OMSET REPORT

Laporan harus dapat di-breakdown:

Total Omset

↓

Platform

↓

Account

↓

Product

↓

Variant

Contoh:

Shopee:
Rp70M

TikTok:
Rp55M

Kemudian:

Shopee 1:
Rp20M

Shopee 2:
Rp18M

dst.

---

# 21. STORE HEALTH

Tampilkan informasi yang tersedia dari marketplace API.

Contoh:

Shopee 1
Rating 4.9
Healthy

Shopee 2
Rating 4.8
Healthy

Shopee 3
Rating 4.2
Warning

Indikator dapat mencakup:

* Rating
* Cancellation
* Order
* Performance
* Warning
* Account/API status

Jangan mengasumsikan data tersedia jika API marketplace tidak menyediakannya.

---

# 22. CUSTOMER ANALYTICS

Dashboard dapat menampilkan:

* Total customer
* Repeat customer
* Customer distribution
* Demographic information

Tetapi:

**Jangan mengarang data umur/gender.**

Hanya gunakan data yang benar-benar tersedia dan diizinkan oleh marketplace API.

---

# 23. CHAT

Unified Chat:

Shopee 1
Shopee 2
Shopee 3
Shopee 4
TikTok 1
TikTok 2
TikTok 3
TikTok 4

↓

UNIFIED CHAT

Admin dapat melihat percakapan dalam satu interface jika API marketplace mendukung kemampuan tersebut.

Chat bukan prioritas MVP pertama.

---

# 24. CAMPAIGN

Campaign management:

Create Campaign
↓
Select Product
↓
Select Variant
↓
Select Marketplace
↓
Select Account
↓
Configure Promotion
↓
Activate

Campaign juga harus memperhatikan inventory.

Jangan membuat campaign yang menjual stock melebihi sellable inventory.

---

# 25. NOTIFICATION

Minimal notification:

* New Order
* Low Stock
* Stock Mismatch
* Sync Failed
* API Error
* Token Expired
* Store Health Warning
* Inventory Adjustment
* Failed Order Processing

Notification channel awal:

* Dashboard
* Telegram

---

# 26. STORE MANAGEMENT

MAXIUS harus mendukung 8 marketplace accounts.

Structure:

MARKETPLACES
│
├── SHOPEE
│   ├── Account 1
│   ├── Account 2
│   ├── Account 3
│   └── Account 4
│
└── TIKTOK
├── Account 1
├── Account 2
├── Account 3
└── Account 4

Setiap account:

* Platform
* Shop ID
* Account Name
* Connection Status
* API Status
* Last Sync
* Token status
* Error status

Gunakan mekanisme authentication/API resmi marketplace.

---

# 27. DATABASE PRINCIPLE

Minimal entity:

users

marketplace_accounts

products

product_variants

master_skus

sku_mappings

inventory

inventory_movements

inventory_reservations

orders

order_items

sync_jobs

sync_logs

notifications

store_metrics

campaigns

customers

Gunakan relasi yang jelas.

Jangan membuat satu tabel besar yang mencampur semua data.

---

# 28. AUDITABILITY

Setiap perubahan stok harus dapat dilacak.

Contoh:

SKU:
ORT-S-H

Before:
100

Movement:
ORDER

Order:
SP-12345

Quantity:
-10

After:
90

Source:
Shopee Account 1

Timestamp:
...

Admin harus dapat menjawab:

> “Kenapa stok produk ini sekarang tinggal 90?”

---

# 29. MVP PRIORITY

## P0 — WAJIB

1. Authentication
2. Marketplace Account
3. Shopee Integration
4. TikTok Integration
5. Product
6. Variant
7. Master SKU
8. SKU Mapping
9. Central Inventory
10. Stock In
11. Stock Adjustment
12. Order Sync
13. Stock Deduction
14. Stock Reservation
15. Webhook
16. Idempotency
17. Queue
18. Retry
19. Sync Log
20. Stock Mismatch
21. Basic Dashboard

## P1

1. Winning Product
2. Winning Variant
3. Omset
4. Store Health
5. Notifications
6. Low Stock Alert
7. Advanced Inventory History

## P2

1. Unified Chat
2. Campaign
3. Customer Analytics
4. Advanced Reports
5. Automation

---

# 30. DEVELOPMENT PRINCIPLE

Jangan langsung membangun semua halaman.

Urutan development:

PHASE 1
Database + Authentication

↓

PHASE 2
Marketplace Account

↓

PHASE 3
Product + Variant + SKU

↓

PHASE 4
Central Inventory

↓

PHASE 5
Order Engine

↓

PHASE 6
Webhook + Idempotency

↓

PHASE 7
Sync Engine + Queue + Retry

↓

PHASE 8
Dashboard

↓

PHASE 9
Analytics

↓

PHASE 10
Chat + Campaign

---

# 31. ACCEPTANCE CRITERIA — CORE INVENTORY

MAXIUS dianggap berhasil pada fitur inti jika skenario berikut berhasil.

### Scenario 1 — Stock In

Initial:
0

Stock In:
120

Expected:

Central Stock = 120

---

### Scenario 2 — Order

Initial:
120

Shopee order:
10

Expected:

Central Stock = 110

---

### Scenario 3 — Another Marketplace

Initial:
110

TikTok order:
20

Expected:

Central Stock = 90

---

### Scenario 4 — Variant

Sambung Hitam:
100

Order Sambung Hitam:
5

Expected:

Sambung Hitam = 95

Variant lain tidak berubah.

---

### Scenario 5 — Safety Stock

Actual:
100

Safety:
10

Expected:

Sellable:
90

---

### Scenario 6 — Concurrent Order

Stock:
5

Order A:
4

Order B:
4

Expected:

Only one transaction succeeds completely according to available inventory.

Stock must never become:

-1
-2
-3

---

### Scenario 7 — Duplicate Webhook

Same order event received twice.

Expected:

Inventory is deducted only once.

---

### Scenario 8 — Sync Failure

Central:
90

Marketplace:
100

Sync fails.

Expected:

Central remains 90.

Sync job:

FAILED

Retry:

PENDING

Dashboard:

STOCK MISMATCH

---

# 32. IMPORTANT PRODUCT PRINCIPLE

Selalu ingat:

## MAXIUS = CENTRAL INVENTORY FIRST

Bukan:

Dashboard First.

Bukan:

Chat First.

Bukan:

Campaign First.

Bukan:

Analytics First.

Tetapi:

**INVENTORY → ORDER → SYNC → ANALYTICS**

Karena masalah client adalah:

> **RUGI KARENA STOK TIDAK TERKONTROL DI 8 TOKO.**

Semua fitur lain harus mendukung penyelesaian masalah tersebut.

---

# 33. BUSINESS FLOW FINAL

BARANG DATANG
↓
ADMIN INPUT STOCK
↓
CENTRAL INVENTORY
↓
PRODUCT / VARIANT / SKU
↓
8 MARKETPLACE
↓
CUSTOMER ORDER
↓
WEBHOOK / API
↓
ORDER ENGINE
↓
RESOLVE SKU
↓
CHECK INVENTORY
↓
RESERVE STOCK
↓
DEDUCT STOCK
↓
INVENTORY MOVEMENT
↓
CENTRAL STOCK UPDATED
↓
QUEUE STOCK SYNC
↓
SHOPEE + TIKTOK UPDATED
↓
SYNC LOG
↓
NOTIFICATION
↓
DASHBOARD / REPORT

---

# 34. INFRASTRUCTURE

Initial deployment:

Domain:
maxius.id

Estimated domain:
Rp300.000 / year

Hosting:
VPS

Estimated:
Rp87.000 / month

Architecture harus disiapkan agar dapat berkembang ketika jumlah marketplace/account/order meningkat.

---

# 35. FINAL INSTRUCTION TO AI AGENT

Sebelum menulis kode:

1. Pahami business problem.
2. Identifikasi dependency antar fitur.
3. Buat database architecture.
4. Buat inventory architecture.
5. Buat order lifecycle.
6. Buat SKU mapping strategy.
7. Buat sync strategy.
8. Buat webhook/idempotency strategy.
9. Buat queue/retry strategy.
10. Baru implementasikan UI.

Jika ada fitur yang terlihat bagus tetapi tidak membantu menyelesaikan masalah inventory, **jangan jadikan prioritas**.

Jangan over-engineer.

Bangun MVP yang stabil terlebih dahulu.

Setiap implementasi harus mempertimbangkan:

* Data consistency
* Inventory accuracy
* Idempotency
* Concurrency
* API failure
* Retry
* Audit trail
* Security
* Scalability
* Observability

### THE MOST IMPORTANT REQUIREMENT

> **MAXIUS harus memastikan bahwa penjualan dari salah satu dari 8 akun marketplace dapat memengaruhi Central Inventory dengan benar dan perubahan tersebut dapat disinkronkan kembali ke marketplace lainnya.**

Jika requirement ini belum aman dan reliable, jangan lanjut menganggap fitur analytics/chat/campaign sebagai prioritas.

## END OF MASTER PROMPT
