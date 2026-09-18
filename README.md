# Maxius Omni — Platform Sinkronisasi Stok Omnichannel

Live di **https://maxius.id/**.

Platform Next.js (App Router) + Prisma untuk mengelola banyak brand yang
punya toko di beberapa marketplace (TikTok Shop, Shopee; slot Tokopedia
disiapkan). Satu stok pusat per varian disinkronkan real-time via webhook —
mencegah oversell (refund/penalti) dan tampilan stok basi (lost sales).

> `docs/PRD.md`, `docs/FLOWS.md`, `docs/dev-notes.md` adalah dokumen
> fase single-brand awal — masih berguna untuk alur inti, tapi konsep
> multi-brand (Business, AppCredential) hanya didokumentasikan di sini
> dan di komentar skema `prisma/schema.prisma`.

## Arsitektur

- **Frontend + backend menyatu**: Next.js 16 App Router (`app/`).
  Halaman di `app/(dashboard)/`, API di `app/api/`, logika DB di `lib/`.
- **Database**: PostgreSQL via Prisma (`@prisma/client` v5.22.0).
  Koneksi memakai `POSTGRES_URL` (format `postgresql://` standar).
- **Auth**: JWT (8 jam) di `localStorage["token"]` + `Authorization: Bearer`
  via `lib/utils/api-client.ts` (client) dan `withAuth` di
  `lib/utils/api.ts` (server). Guard halaman di `(dashboard)/layout.tsx`.
- **Stok**: dilacak per **varian** (`ProductVariant`), satu angka pusat.
  Tiap varian dipetakan ke SKU/ID berbeda per akun marketplace
  (`ProductMapping`) — ID antar platform tidak pernah dianggap sama.
- **Sync**: webhook order (Shopee/TikTok, verifikasi HMAC) → potong stok
  central (`central-stock.service.ts`, idempoten via `StockLedger`) →
  push ke listing lain via antrean batch (`stock-push-queue.service.ts`,
  debounce 8 dtk) + `SyncJob` state machine untuk retry.
- **Multi-brand (fase 1)**: 5 brand = 5 baris `Business`
  (Maxius, Raxen, Kaos Kaki Sport, Den Sport, Geto.bdg).
  1 user akses semua brand via `UserBusiness` (tanpa role granular).
  Brand aktif di `localStorage["activeBusinessId"]`, dikirim otomatis
  sebagai `?businessId=` oleh `authFetch`, divalidasi di `withAuth`
  (`resolveRequestBusiness` → 403 bila bukan haknya).
- **Kredensial app** (`AppCredential`): Shopee `partner_id/key`,
  TikTok `app_key/secret/service_id` per-App, bukan hardcode env.
  Baris `Legacy ENV` (secret null) = baca dari env seperti dulu —
  akun existing otomatis ter-link ke sini saat migrasi.
  Pilih credential ISV Shopee nanti = tambah 1 baris + pakai untuk
  authorize/sync berikutnya, tanpa refactor.

## Proteksi Shopee (penting)

- App "Third-party Partner Platform" (ISV) masih **under review**.
  `SHOPEE_AUTHORIZE_ENABLED` (default `false`) memblokir total endpoint
  authorize + callback Shopee sampai diset `true` manual di env server
  setelah ISV approved.
- UI (`AddMarketplaceModal`, tombol Hubungkan-ulang) meminta konfirmasi
  manual sebelum authorize Shopee apa pun.
- `PlatformAccount.isFrozen` + `frozenReason`: akun dibekukan DITOLAK di
  authorize-ulang, refresh token, push stok, dan webhook (push diabaikan
  + dicatat). Jangan authorize toko yang sedang bersengketa via kode apa pun.

## Menjalankan lokal

```bash
# 1. Postgres lokal + ENV (jangan pernah isi POSTGRES_URL production di sini)
createdb maxius_dev
# .env (gitignored): POSTGRES_URL="postgresql://<user>@localhost:5432/maxius_dev"

# 2. Migrasi + seed fondasi (5 brand, admin, kredensial Legacy ENV)
npx prisma migrate dev
npx tsx scripts/seed-production.mts

# 3. Jalan
npm run dev        # http://localhost:3000 (admin/admin123)
npm run build      # verifikasi production
npx tsc --noEmit   # cek tipe
```

## Env vars

| Var | Wajib | Keterangan |
| --- | ----- | ---------- |
| `POSTGRES_URL` | ya | `postgresql://...` (bukan URL accelerate) |
| `JWT_SECRET` | ya | secret JWT |
| `PII_ENC_KEY` | ya | AES-256-GCM untuk PII pembeli |
| `TIKTOK_APP_KEY` / `TIKTOK_APP_SECRET` | ya | kredensial legacy TikTok (dipakai bila akun menunjuk Legacy ENV) |
| `TIKTOK_SERVICE_ID` | opsional | service_id OAuth seller resmi |
| `TIKTOK_REDIRECT_URI` | ya | callback TikTok terdaftar |
| `SHOPEE_PARTNER_ID` / `SHOPEE_PARTNER_KEY` | bila pakai Shopee | kredensial legacy Shopee |
| `SHOPEE_REDIRECT_URI` | bila pakai Shopee | callback Shopee terdaftar |
| `SHOPEE_API_BASE` / `SHOPEE_AUTH_BASE` | opsional | override (sandbox) |
| `SHOPEE_AUTHORIZE_ENABLED` | — | `true` HANYA setelah ISV approved (default false = blokir) |

## Deploy (VPS)

```bash
git pull origin main
npm install            # postinstall: prisma generate
npx prisma migrate deploy   # JANGAN db push / migrate dev ke production
npm run build
pm2 restart all        # / systemctl sesuai setup
```

Rollback skema: `npx prisma migrate resolve --rolled-back <nama_migrasi>`
lalu `migrate deploy` ulang (detail per milestone di bawah).

## Migrasi multi-brand (M1–M3)

- `.../multi_brand_phase1` (DDL): tabel `AppCredential`, `UserBusiness`;
  kolom `PlatformAccount.appCredentialId/appCredential?`,
  `isFrozen` + `frozenReason`. Additive-only.
- `.../multi_brand_phase1_data` (data, idempotent): rename Business
  `business-default` → "Maxius" (id tetap, FK tak tersentuh); insert 4
  brand (id deterministik `business-*`); seed 2 kredensial Legacy ENV;
  arahkan akun existing ke kredensialnya; link semua user × semua brand.
  Rollback data: hapus baris `business-*` baru + kredensial legacy +
  `UserBusiness` (jangan hapus `business-default`), lalu resolve migrasi.

## Testing

- `npx playwright test` — 7 spec di `e2e/` (butuh Postgres lokal +
  `npm run dev`; seed SQL via `psql`, bukan sqlite).
- `npx tsx scripts/test-*.integration.mts` — acceptance per fase
  (DB temp per-file, `"business-default"` sebagai brand uji).
- `npx tsx scripts/e2e-stock-push-sandbox.mts` — push stok vs sandbox
  TikTok asli (butuh kredensial sandbox).

## Struktur penting

- `app/page.tsx` — landing publik; dashboard di `/dashboard`.
- `app/(dashboard)/` — inventory, products, orders, promotions (TikTok),
  market, settings/accounts (Connected Accounts per brand + kolom
  frozen/sync terakhir).
- `components/layout/BrandSwitcher.tsx` — dropdown brand di topbar.
- `lib/services/business-scope.service.ts` — SATU-SATUNYA pola scoping
  (`businessWhere`, `assertSameBrand`, `resolveRequestBusiness`).
- `lib/services/app-credential.service.ts` — resolver kredensial per-App,
  flag authorize, guard frozen, webhook multi-secret.
- `lib/integrations/{shopee,tiktokShop}.ts` — client API (kredensial
  sebagai param opsional di ekor; default env).
