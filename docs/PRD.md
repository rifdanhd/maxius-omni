# Product Requirements Document (PRD)
## Maxius Platform — Dashboard Sinkronisasi Stok Omnichannel

| Field | Value |
|---|---|
| **Nama Produk** | Maxius.id (Maxius Platform) |
| **Versi Dokumen** | 1.0 |
| **Tanggal** | 08 September 2026 |
| **Status** | In Development (MVP) |
| **Target Pengguna** | Seller/e-commerce merchant Indonesia |

---

## 1. Ringkasan Eksekutif

Maxius Platform adalah dashboard omnichannel untuk seller Indonesia yang mengelola toko di beberapa marketplace (Shopee, TikTok Shop, Tokopedia). Masalah utama yang diselesaikan: **inkonsistensi stok antar marketplace** yang menyebabkan oversell (refund/penalty) atau stok stale (kehilangan penjualan).

Platform ini menyediakan single source of truth untuk stok, otomatisasi sinkronisasi real-time via webhook, dan manajemen pesanan terpusat.

---

## 2. Masalah & Solusi

### 2.1 Masalah

| # | Masalah | Dampak |
|---|---|---|
| 1 | Stok tidak sinkron antar marketplace | Oversell → refund, penalty dari marketplace |
| 2 | Stok ditampilkan rendah/zero padahal ada | Lost sales, buyer beralih ke kompetitor |
| 3 | Pesanan dari berbagai marketplace dikelola manual | Lambat, rentan human error |
| 4 | Tidak ada audit trail perubahan stok | Sulit telusuri penyebab discrepancy |
| 5 | Data buyer (PII) tidak terproteksi | Risiko compliance, keamanan data |

### 2.2 Solusi

- **Central Stock Management**: Satu tempat kelola stok, otomatis terpush ke semua marketplace.
- **Webhook-Driven Sync**: Stok update real-time saat pesanan masuk/keluar, bukan polling.
- **Stock Ledger**: Audit trail lengkap untuk setiap perubahan stok.
- **Order Consolidation**: Semua pesanan dari semua toko di satu dashboard.
- **PII Protection**: Enkripsi AES-256-GCM untuk data sensitif buyer, masking di UI, retensi 90 hari.

---

## 3. Target Pengguna

| Persona | Kebutuhan |
|---|---|
| **Seller Multichannel** | Kelola stok & pesanan dari Shopee + TikTok + Tokopedia dalam satu tempat |
| **Admin/Tim Operasional** | Proses pesanan, cetak label, monitor SLA pengiriman |
| **Owner/Bisnis** | Dashboard analitik GMV, penjualan, performa toko |

---

## 4. Fitur Utama

### 4.1 Authentication & Authorization

| ID | Fitur | Status |
|---|---|---|
| AUTH-01 | Login dengan JWT + bcrypt | ✅ Done |
| AUTH-02 | User management (admin) | ✅ Done |
| AUTH-03 | Flag `canViewFullPii` untuk akses data sensitif | ✅ Done |
| AUTH-04 | Role-based access (3 tier) | ⏳ Deferred |

### 4.2 Dashboard

| ID | Fitur | Status |
|---|---|---|
| DASH-01 | Action cards: pesanan baru, siap kirim, stok rendah, oversell | ✅ Done |
| DASH-02 | Business analytics: GMV, unit sold, completed orders | ✅ Done |
| DASH-03 | Period-over-period comparison (7 hari rolling) | ✅ Done |
| DASH-04 | Top stores & top products | ✅ Done |
| DASH-05 | Panduan awal (onboarding) | ✅ Done |

### 4.3 Order Management

| ID | Fitur | Status |
|---|---|---|
| ORD-01 | Order list dengan tab (all/unpaid/new/ready/shipped/completed/cancelled/returns) | ✅ Done |
| ORD-02 | Search, sort, date-range filter, pagination | ✅ Done |
| ORD-03 | Order detail modal dengan PII masking | ✅ Done |
| ORD-04 | Cetak label, invoice, packing list (manual & bulk) | ✅ Done |
| ORD-05 | Ambil official shipping label dari TikTok | ✅ Done |
| ORD-06 | Merge bulk label ke satu PDF (A6) | ✅ Done |
| ORD-07 | Ship package (TikTok fulfillment: PICKUP/DROP_OFF/self) | ✅ Done |
| ORD-08 | SLA alerts: urgent (<6h), warning (<24h) | ✅ Done |
| ORD-09 | Async tracking number polling | ✅ Done |

### 4.4 Central Stock Sync (Core)

| ID | Fitur | Status |
|---|---|---|
| STK-01 | Master Product → Product Variant → Platform SKU Mapping | ✅ Done |
| STK-02 | Stock tracked per variant (single source of truth) | ✅ Done |
| STK-03 | Safety stock buffer (`effectiveStock`) | ✅ Done |
| STK-04 | Stock ledger (audit trail) dengan reason codes | ✅ Done |
| STK-05 | Idempotent stock deduction/restore on order status changes | ✅ Done |
| STK-06 | Push stock update ke marketplace (fire-and-forget) | ✅ Done |
| STK-07 | SyncLog untuk retry tracking | ✅ Done |
| STK-08 | Queue-based batching untuk rate limit | ⏳ Planned (scale) |

### 4.5 Marketplace Integration

| ID | Marketplace | Status |
|---|---|---|
| INT-01 | TikTok Shop (API + Webhook) | ✅ Done |
| INT-02 | Shopee (Webhook stub) | 🔧 Stub |
| INT-03 | Tokopedia | ⏳ Planned |
| INT-04 | TikTok OAuth authorize/callback | ✅ Done |

### 4.6 Inventory Management

| ID | Fitur | Status |
|---|---|---|
| INV-01 | Inventory settings | ✅ Done |
| INV-02 | Stock opname (manual adjustment) | ✅ Done |
| INV-03 | History (via ledger) | ✅ Done |

### 4.7 WMS (Warehouse Management)

| ID | Fitur | Status |
|---|---|---|
| WMS-01 | Inbound | 🔧 Placeholder |
| WMS-02 | Outbound | 🔧 Placeholder |
| WMS-03 | Warehouse | 🔧 Placeholder |
| WMS-04 | Racks | 🔧 Placeholder |

### 4.8 PII Compliance

| ID | Fitur | Status |
|---|---|---|
| PII-01 | AES-256-GCM encryption untuk phone & address | ✅ Done |
| PII-02 | Masking: nama, HP, alamat, email | ✅ Done |
| PII-03 | PiiAccessLog audit trail | ✅ Done |
| PII-04 | Retensi 90 hari + anonymization cron | ✅ Done |

### 4.9 Analytics

| ID | Fitur | Status |
|---|---|---|
| ANL-01 | 7-day rolling revenue/units/completed orders | ✅ Done |
| ANL-02 | GMV (excl. cancelled) | ✅ Done |
| ANL-03 | Top stores & top products | ✅ Done |

### 4.10 Other Modules (Placeholder)

| Modul | Status |
|---|---|
| Promotions | 🔧 Placeholder |
| Chat | 🔧 Placeholder |
| Customers | 🔧 Placeholder |
| Reports (sales/stock) | 🔧 Placeholder |
| Logs | 🔧 Placeholder |
| Market | 🔧 Placeholder |
| Apps/API Connections | 🔧 Placeholder |
| Education | 🔧 Placeholder |

---

## 5. Arsitektur & Tech Stack

### 5.1 Tech Stack

| Layer | Teknologi |
|---|---|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript 5 (strict) |
| **Database** | SQLite (via Prisma ORM v5.22) |
| **Styling** | Tailwind CSS v4 |
| **Charts** | Recharts 3.10 |
| **Icons** | Lucide React |
| **Auth** | JWT + bcryptjs |
| **PDF** | pdf-lib + jsbarcode |
| **API Integration** | TikTok Shop Open API (custom client + vendored SDK) |

### 5.2 Data Model (Prisma)

```
User
  └── canViewFullPii (Boolean)

Business
  └── PlatformAccount[] (SHOPEE | TOKOPEDIA | TIKTOK_SHOP)
        └── appKey, accessToken, refreshToken, shopCipher, externalShopId

MasterProduct (threshold)
  └── ProductVariant[] (sku, stock, safetyStock)
        └── ProductMapping[] (variant ⇄ channelSku per account)

Order → OrderItem[]
  └── PlatformOrderMapping (externalOrderId, rawStatus, lastWebhookUpdateTime)
  └── Shipment (carrier, trackingNo)

SalesLog | SyncLog | PiiAccessLog | StockLedger
```

### 5.3 Stock Sync Flow

```
Marketplace Webhook → Verify HMAC → Idempotency Check
  → Deduct/Restore Stock (ProductVariant.stock)
  → Write StockLedger (audit trail)
  → Push Updated Stock to Other Marketplaces (fire-and-forget)
  → Log SyncLog (success/error)
```

---

## 6. Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | Latency webhook processing | < 2 detik |
| NFR-02 | Idempotency | Webhook retry tidak double-deduct |
| NFR-03 | Audit trail | Setiap perubahan stok tercatat di ledger |
| NFR-04 | PII encryption | AES-256-GCM, key di env |
| NFR-05 | PII retention | Anonymize setelah 90 hari |
| NFR-06 | Scalability | Dirancang untuk puluhan ribu SKU |
| NFR-07 | Rate limit handling | Queue-based batching (planned) |

---

## 7. Milestone & Roadmap

### Phase 1: MVP (Current) ✅
- [x] Auth & user management
- [x] Central stock sync (Master → Variant → Mapping)
- [x] TikTok Shop integration (API + webhook)
- [x] Order management (list, detail, print, ship)
- [x] SLA alerts
- [x] PII encryption & masking
- [x] Basic analytics dashboard
- [x] Stock ledger & audit trail

### Phase 2: Marketplace Expansion
- [ ] Shopee API integration (bukan stub)
- [ ] Tokopedia API integration
- [ ] Multi-marketplace webhook handling

### Phase 3: Scale & Performance
- [ ] Queue-based stock update batching
- [ ] Rate limit handling per marketplace
- [ ] Database optimization (SQLite → PostgreSQL migration path)
- [ ] Real-time stock broadcast (WebSocket/SSE)

### Phase 4: Advanced Features
- [ ] Role-based access control (3 tier)
- [ ] Finance breakdown (TikTok Finance API)
- [ ] WMS module (inbound/outbound/warehouse/racks)
- [ ] Promotions, Chat, Customers modules
- [ ] Reports (sales/stock) detailed
- [ ] Mobile responsive / PWA

---

## 8. Risks & Mitigations

| Risiko | Dampak | Mitigasi |
|---|---|---|
| SQLite tidak cocok untuk production high-volume | Performance bottleneck | Rencana migrasi ke PostgreSQL di Phase 3 |
| TikTok API sandbox ≠ production | Fitur tidak jalan di production | Verifikasi field response dengan akun production |
| Rate limit marketplace | Stock update gagal | Queue-based batching + retry (planned) |
| Webhook downtime | Stok tidak sinkron | Fallback polling (planned), stock ledger untuk reconciliation |
| PII breach | Compliance violation | AES-256-GCM + masking + retention + access log |

---

## 9. Success Metrics

| Metric | Target |
|---|---|
| Stock accuracy (oversell rate) | < 0.1% |
| Webhook processing latency | < 2 detik |
| Time to fulfill order | Berkurang 50% dari baseline |
| User adoption | 100% pesanan diproses via dashboard |

---

## 10. Lampiran

- **Database Schema**: `prisma/schema.prisma`
- **Dev Notes**: `docs/dev-notes.md`
- **Agent Guidelines**: `AGENTS.md`
- **Seed Data**: `prisma/seed.js` (admin user + 8 accounts + 4 products)
