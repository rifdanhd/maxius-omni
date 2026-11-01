# SKRIPSI BRIEFING — MAXIUS Platform
*Ringkasan fakta sistem & kerangka kerja untuk penyusunan skripsi/tesir*

> Dibuat dari kode, audit, dan dokumentasi terbaru (30 Okt 2026).  
> Dibangun supaya **ChatGPT** (atau penulis lain) bisa menyusun skripsi dengan cepat, tidak perlu nemu data sendiri, dan tetap akurat.

---

## 1. PROFIL SISTEM

| Field | Value |
|---|---|
| **Nama** | Maxius (maxius-platform) |
| **Tujuan** | Omnichannel Commerce Management — menyinkronkan stok 8 akun marketplace (4 Shopee + 4 TikTok Shop) ke Central Inventory |
| **Masalah bisnis** | Stok tidak sinkron → overselling, pesanan batal, kerugian finansial |
| **Stack teknis** | Next.js 16.4.3 (App Router), TypeScript, Prisma v5.22.0, PostgreSQL (lokal) / SQLite (test), Tailwind CSS v4, shadcn/ui, Zustand, Recharts |
| **Arsitektur** | App Router: `app/(dashboard)/*`, `app/api/*`; Components: `@/components/*`; Stores: `@/stores/*`; Context: `@/context/*`; Hooks: `@/hooks/*`; Lib: `@/lib/*` |
| **Database** | Prisma schema dengan 36 model: User, UserBusiness, PlatformAccount, MasterProduct, ProductVariant, MasterSkuKey, SkuMappingReview, ProductMapping, PlatformSkuMapping, InventoryWarehouse, VariantWarehouseStock, StockLedger, InventoryMovement, StockOpname, StockOpnameItem, SyncJob, SyncLog, StockOutbox, ReturnRequest, ReturnItem, ReturnAuditLog, SalesLog, Shipment, ShipmentTrackingEvent, PromotionActivity, PromotionActivityItem, PromotionAuditLog, BundleItem, AppCredential, Business, InventorySetting |
| **Fase development** | PHASE 1–10 (database → auth → marketplace → product → variant → master SKU → SKU mapping → central inventory → order engine → webhook → sync engine → dashboard → analytics → chat/campaign) |
| **Status terkini** | Commit `3d38663` (fix: clarify store stock controls and restore order cards). Build & lint lulus. 37 suite Playwright test lulus. SIAP DIUJI LOKAL (tetapi belum diuji live).

---

## 2. ALUR INVENTARIS UTAMA (dari PRD §4–§34)

```
BARANG DATANG
    ↓ ADMIN INPUT STOCK
CENTRAL INVENTORY
    ↓ PRODUCT / VARIANT / SKU
    ↓ 8 MARKETPLACE (Shopee + TikTok)
    ↓ CUSTOMER ORDER
    ↓ WEBHOOK / API
    ↓ ORDER ENGINE
    ↓ RESOLVE SKU → IDENTIFY MASTER SKU
    ↓ VALIDATE STOCK
    ↓ RESERVE / DEDUCT STOCK
    ↓ INVENTORY MOVEMENT
    ↓ CENTRAL STOCK UPDATED
    ↓ QUEUE STOCK SYNC
    ↓ SHOPEE + TIKTOK UPDATED
    ↓ SYNC LOG
    ↓ NOTIFICATION
    ↓ DASHBOARD / REPORT
```

---

## 3. ENTITAS DATABASE KUNCI (dari PRD §27 & schema)

| Entitas | Keterangan |
|---|---|
| `users` | Akun sistem |
| `marketplace_accounts` | Shopee/TikTok accounts terhubung |
| `products` | Produk induk (parent) |
| `product_variants` | Varian warna/ukuran |
| `master_skus` | Master SKU internal |
| `sku_mappings` | Mapping ke SKU masing-masing marketplace |
| `inventory` | Central stok (stok aktual, safety stock, sellable stock) |
| `inventory_movements` | Audit trail: STOCK_IN, STOCK_OUT, ADJUSTMENT, RETURN |
| `inventory_reservations` | Reserve stock untuk order |
| `orders` | Order dari marketplace |
| `order_items | Item dalam order |
| `sync_jobs` | Durable job: proses sync stok ke marketplace |
| `sync_logs` | Log detail setiap operasi sync |
| `notifications` | Notifikasi: low stock, sync failed, dsb |
| `store_metrics` | Metrik toko per platform |
| `campaigns` | Kampanye promosi |
| `customers` | Data customer (opsional, belum fully implement) |

**Prinsip utama:** Setiap perubahan stok harus memiliki audit trail di `inventory_movements` dengan source, quantity change, timestamp.

---

## 4. ALUR SYNC STOK KE MARKETPLACE (dari audit §B & §E)

1. **Stock In** → `inventory_movements.STOCK_IN` → `central_stock` bertambah → `sync_jobs` dibuat (PENDING)
2. **Sync Job diproses** → `sync.service.ts` → cek gate (server, brand, toko, platform, akun) → panggil marketplace API (TikTok `update-inventory`, Shopee `update_stock`)
3. **Sukses** → `sync_log` disimpan, `sync_job` → SUCCESS, `central_stock` tetep tidak berubah (sudah berubah di step 1)
4. **Gagal** → `sync_log` disimpan dengan error, `sync_job` → FAILED → retry otomatis (batas 3x) → jika habis → `mismatch` marker permanen di UI
5. **Safety stock** → `sellable_stock = max(0, central_stock - safety_stock)` → marketplace hanya boleh menampilkan sellable stock

---

## 5. KONFLIK STOK & HANDLING (dari PRD §11 & §29 & audit)

- **Race condition:** Dua order datang bersamaan → harus **atomic transaction** dengan `SELECT FOR UPDATE` (digunakan di `stock-push.policy.ts:2.1`)
- **Duplicate webhook:** Order event diterima dua kali → idempotency check → inventory deducted hanya sekali
- **Sync failure:** Central stock tetap benar, tapi marketplace belum update → `sync_job FAILED` → mismatch marker di dashboard → retry manual
- **Safety stock:** `sellable = max(0, actual - safety)` → mencegah overselling akibat delay API

---

## 6. SKU MAPPING & VARIAN (dari PRD §9 & §8)

- **Master SKU:** Identitas internal (contoh: `ORT-S-H` = Sambung Hitam)
- **Platform SKU Setiap Marketplace Berbeda:**
  - Shopee 1 → `SKU-172839`
  - Shopee 2 → `ORT-SH-01`
  - TikTok 1 → `928372`
  - TikTok 2 → `ORT-BLK-S`
- **Semua mapping menunjuk ke Master SKU** → satu inventory pusat
- **Variant stock dipisah:** `Sambung Hitam = 100`, `Sambung Putih = 80`, dan seterusnya (bukan total 390)

---

## 7. ARsitektur SYNC JOB & RETRY (dari audit §B & dev-notes)

| Status | Keterangan |
|---|---|
| `PENDING` | Menunggu di antrean |
| `PROCESSING` | Sedang diproses |
| `SUCCESS` | Selesai sukses |
| `FAILED` | Gagal, bisa di-retry |
| `MISMATCH` | Job FAILED + retryCount >= batas → marker permanen di UI |

**Durable job pattern:** Setiap ledger insert dibuat dalam 1 DB transaction, lalu worker claim event dengan `SKIP LOCKED`, buat `SyncJob`, lalu proses di luar transaction (retry outside transaction, baca live stock).

---

## 8. KPI & DASHBOARD (dari PRD §18–§25 & dashboard-kpi.service)

| KPI | Definisi |
|---|---|
| **Total Omset** | Rupiah total terjual |
| **Total Order** | Jumlah order |
| **Product Sold** | Produk terjual |
| **Central Stock** | Stok pusat saat ini |
| **Low Stock** | Stok di bawah safety stock |
| **Stock Mismatch** | Selisih stok aplikasi ↔ marketplace |
| **Winning Product** | Produk paling laku |
| **Winning Variant** | Varian paling laku |
| **Store Health** | Rating/cancellation dari marketplace API |
| **Sync Error** | Error sinkronisasi 7 hari terakhir |

---

## 9. FITUR BELUM DIKERJAKAN (dari backlog.md & PRD §29 P2)

| Fitur | Prioritas | Catatan |
|---|---|---|
| Unified Chat | Rendah | Butuh API marketplace & keputusan produk |
| Customer Analytics | Rendah | Data lokal cukup untuk total+repeat; demografi butuh API |
| Advanced Reports | Rendah | Belum didefinisikan laporan konkret |
| Automation | Rendah | Rule otomatis high-risk tanpa aturan bisnis |
| Notifikasi Telegram | Sedang | Butuh bot token & chat id dari pemilik |
| Store Health Rating/Cancellation | Rendah | Butuh endpoint performa per platform |
| Sinkron Listing Shopee UNLIST/BANNED | Sedang | Sekarang cuma NORMAL |

---

## 10. METODOLOGI PENULISAN SKRIPSI (diarahkan ke ChatGPT)

**Prompt utama untuk ChatGPT:**
> "Saya sedang menulis skripsi/tesir tentang sistem **Maxius** — platform omnichannel commerce management yang menyinkronkan stok 8 akun marketplace (4 Shopee + 4 TikTok Shop) ke central inventory. Gunakan dokumen lengkap ini sebagai referensi teknis. Buat bab-bab standar skripsi S1 Teknik Informatika: Pendahuluan (latar belakang, masalah, tujuan), Tinjauan Pustaka (arkitektur e-commerce, inventory management, concurrency control), Deskripsi Sistem (architecture, database schema, flow), Implementasi (teknologi, fitur kunci), Hasil Uji Coba (test suite, kpi), dan Pembahasan (kontribusi, batasan, pekerjaan selanjutnya). Semua faktur data harus berdasarkan kodenya di repository maxius-platform, bukan karangan bebas."

**Lampiran yang disertakan:**
- `docs/PRD.md` — Master Prompt & spesifikasi lengkap
- `docs/stock-sync-audit-20261026.md` — Audit terbaru 26 Okt 2026
- `docs/backlog.md` — Daftar fitur pending & keputusan
- `docs/FLOWS.md` — Flow diagram authentication & webhook
- `docs/master-sku-inventory-audit.md` — Audit SKU master & varian
- `docs/dev-notes.md` — Catatan pengembangan & infra
- `package.json` — Versi stack
- `prisma/schema.prisma` — Model database (36 model)
- `scripts/` — 40+ file uji coba (Playwright, contract, integration)

---

## 11. GLOSSARI TERMEN UTAMA

| Term | Definisi |
|---|---|
| **Central Inventory** | Single Source of Truth untuk stok seluruh marketplace |
| **Master SKU** | Identitas internal produk (tidak pernah berubah) |
| **Platform SKU / Channel SKU** | SKU setiap marketplace (berbeda-beda, di-map ke Master SKU) |
| **PlatformAccount** | Setiap akun terhubung di Shopee/TikTok |
| **Sync Job** | Durable job: proses sinkron stok ke marketplace |
| **Stock Ledger** | Catatan perubahan stok per SKU per warehouse |
| **Inventory Movement** | Audit trail: STOCK_IN, STOCK_OUT, ADJUSTMENT, RETURN |
| **Safety Stock** | Buffer stok untuk mencegah overselling |
| **Sellable Stock** | `max(0, central_stock - safety_stock)` — yang marketplace boleh lihat |
| **Stock Mismatch** | Selisih stok aplikasi ≠ stok marketplace →butuh tindakan |
| **Idempotency** | Event yang sama diterima dua kali → hanya diproses sekali |
| **SELECT FOR UPDATE** | DB query kunci untuk mencegah race condition |
| **Durable Outbox** | Pattern: ledger insert + outbox event dalam 1 tx, worker claim dengan SKIP LOCKED |

---

## 12. KONTEN SIAP KUOTI UNTUK CHATGPT

```
BAB I: PENDAHULUAN
- Latar belakang: perusahaan memiliki 8 akun marketplace, stok tidak sinkron → kerugian
- Masalah utama: inventory mismatch → overselling, pesanan dibatalkan
- Tujuan penelitian: merancang/mengevaluasi sistem central inventory untuk sinkronisasi stok omnichannel

BAB II: TINJauan PUSTAKA
- E-commerce inventory management concurrency
- Webhook & idempotency pattern
- Database pattern: audit trail, SELECT FOR UPDATE
- Sync job & durable outbox pattern

BAB III: DESKRIPSI SISTEM MAXIUS
- Arsitektur aplikasi (Next.js 16, App Router, Prisma, Tailwind)
- Schema database (36 model Prisma, relasi kunci)
- Alur inventory: dari barang masuk hingga sync ke marketplace
- Fitur kunci: stock reservation, safety stock, variant stock pisah, sku mapping, sync job dengan retry

BAB IV: IMPLEMENTASI TEKNIS
- Teknologi stack & versi
- Fitur utama yang sudah dibangun (stages 1–2 dari overnight security progress)
- Fitur yang masih pending (stages 3–5, backlog items)
- Contoh kasus: produk "Kaos Kaki Ortus Dewasa" dari contoh PRD

BAB V: HASIL UJI COBA & VERIFIKASI
- 37 suite Playwright test lulus
- Build Next.js 16.4.3 lulus (116 halaman)
- npx tsc --noEmit lulus
- ESLint lulus (7 error lama, bukan tugas ini)
- PCB EE3 contract tests: 5 suite lulus (~53 detik)
- Browser E2E fixture: lulus 390px & 1280px, tanpa error overflow
- Real PostgreSQL integration: masih pending (butuh isolasi & non-destructive)

BAB VI: PENCAKAPAN & KONTRIBUSI
- Kontribusi: central inventory architecture, sync engine, SKU mapping, mismatch detection
- Batasan: belum diuji live (VPS/production), belum migrasi aditif account_stock_push_enabled
- Pekerjaan selanjutnya: deploy VPS, migrasi database, verifikasi live, dan fitur backlog

BAB VII: DAFTAR PUSTAKA & LAMPIRAN
- Lampirkan seluruh dokumen di atas
- Kode sumber: https://github.com/maxius/maxius-platform (atau path lokal)
```

---

## 13. CARA MENGGUNAKAN DOKUMEN INI

1. **Copy seluruh isi ke ChatGPT** dengan prompt: *"Buat skripsi S1 tentang Maxius menggunakan dokumen ini sebagai referensi teknis."*
2. **ChatGPT akan menghasilkan** 7 bab lengkap dengan semua teknis tertera (tidak perlu nemu data lagi).
3. **Edit sedikit** sesuai manajer pembimbing (format universitas, tambah/kurang bab sesuai kebutuhan).
4. **Tambah laporan praktik** dari pengujian yang sudah Anda jalankan (`npm run build`, Playwright suite, dll) sebagai bagian *Hasil Uji Coba*.

---
*Catatan: Dokumentasi ini dibuat otomatis dari codebase maxius-platform (30 Okt 2026). Semua versi kode, test result, dan konfigurasi sudah mencerminkan state terbaru.*