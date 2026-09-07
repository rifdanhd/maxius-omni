# Dev Notes — Maxius Platform

## SLA Alert Testing Status (Tahap 1)

Alert SLA "Segera Kirim" pada `OrderCard` saat ini baru teruji dengan **data seed manual**.

**Alasan:**
Order sandbox TikTok punya `shippingDueTime` seragam (~2 hari dari waktu buat).
Threshold `< 6j` (urgent, merah) dan `< 24j` (warning, kuning) tidak terpicu oleh data asli sandbox karena deadline masih jauh (> 40 jam).

**Yang perlu diverifikasi begitu ada order dari akun produksi asli (bukan blocker sekarang):**
- `shippingDueTime` yang dikembalikan oleh API TikTok production (pastikan format epoch tetap valid).
- Threshold `< 6 jam` / `< 24 jam` terasa wajar untuk ritme operasional fulfillment tim.
- `computeSla` di `components/orders/OrderCard.tsx:10–20` menggunakan waktu local `Date.now()` — pastikan clock server dan client sinkron.

**Bug yang sudah diperbaiki:**
- Sentinel `+058657-07-26T07:43:20.000Z` dari sandbox (max uint64) → ditolak oleh guard di `toDate()` (`lib/services/order-sync.service.ts`), disimpan sebagai `null`.

## PII, Enkripsi, Retensi & Detail Modal (Tahap 4)

**Keputusan pemilik (admin tunggal, 2026-09-07):**
- Flag sederhana `User.canViewFullPii Boolean @default(true)` (BUKAN role 3-tingkat — diputuskan tunda).
  - `true` → list tetap ter-mask; hanya modal detail (`GET /api/orders/:id`) menampilkan nama/HP/alamat asli, dan setiap reveal dicatat ke `PiiAccessLog` (action `READ_ORDER_DETAIL`).
  - `false` → semua tampilan ter-mask, tanpa log.
  - Legacy JWT (tanpa klaim) → default `true`.
- Enkripsi AES-256-GCM app-layer (`lib/services/crypto.service.ts`) untuk `recipientPhone` & `recipientAddress` Order. Kunci = `PII_ENC_KEY` (32-byte hex) di `.env`. Ciphertext format `iv.tag.ciphertext` base64 (`.` separator); `decryptPii` fallback raw bila bukan ciphertext, `null` bila invalid.
- `recipientName` plaintext (di-mask saat render). Email pembeli di-mask dengan `maskName` (local part) bila berupa nama; email proxy TikTok (`...@scs2.tiktok.com`) TIDAK di-mask ulang karena sudah anonim oleh platform.
- Masking (`lib/pii.ts`): nama `a***`, HP `0812****4212` (4 awal/4 akhir), alamat — 2 segmen terakhir koma (kota & provinsi) ditambah prefix `…`.
- Retensi: `scripts/anonymize-pii.mjs` null-kan PII (recipientName/Phone/Address, buyerName, buyerEmail, buyerNote) pada order DELIVERED/COMPLETED lebih dari 90 hari (`PII_RETENTION_DAYS`, default 90) + log `ANONYMIZE`. Jalankan via cron. `--apply` untuk eksekusi; default dry-run.
- Kolom tidak pernah keluar di response list: `recipientPhone`, `recipientAddress`, `paymentJson`, `buyerNote`. `buyerName` selalu masked di list.

**Detail modal (`components/orders/OrderDetailModal.tsx`) — layout referensi Desty:**
- Header: No. Pesanan, status badge, badge toko+platform, Metode Pembayaran (+amount), Toko, Tanggal Pesanan, Kirim Sebelum (SLA), Catatan Pembeli (bila ada).
- Bagian Pembeli: nama/HP/alamat (masked kecuali berhak), email as-is.
- Informasi Pengiriman: dari tabel `Shipment` (diisi saat sync dari `packages` TikTok via `externalId`; unik `(accountId, orderId, externalId)`; carrier = shipping_provider/name, resi = tracking_number, status = package_status, default `PACKAGED`).
- Informasi Produk: Master SKU internal dari `ProductVariant.sku` (BUKAN channelSku), variasi = `sku_name`, qty, harga, subtotal.
- Informasi Penjualan: **placeholder "belum terintegrasi"** — sumber TikTok Finance API (GET Statements 202309, GET Transactions by Order 202501, Unsettled 202507). Ini fase terpisah.
- Pembayaran Pembeli: dari `payment` object TikTok yang disimpan mentah di `Order.paymentJson` (JSON string) — sub_total, diskon, biaya kirim, tax, total_amount.

**Live API ground truth (sandbox 2026-09-07):**
- Akun berisi data: `SANDBOX_ID7680596707423979285` (17 order AWAITING_SHIPMENT). Akun `SANDBOX_ID7681339185006888725` kosong (0 order).
- Order = `recipient_address` (BUKAN buyer_address; TikTok sudah mask nama `a***`, HP `(+86)1***`), `packages` (BUKAN package_list; sebelum ship hanya `{id}`), `payment_method_name`, `buyer_message`, `line_items` tanpa qty (1 line = 1 pcs), `payment` (10 field numerik string).
- Order detail TikTok API (`get_order_detail`) → 36009009 (path invalid); semua field sudah ada di `orders/search` — tidak perlu endpoint terpisah.
- Finance breakdown sisi penjual (service/affiliate fee, settlement, refund) TIDAK ada di order object.

## Konfigurasi & Infra
- DB SQLite asli: `prisma/dev.db`. `file:./dev.db` di-resolve RELATIF terhadap direktori `prisma/schema.prisma` (bukan CWD). Klien @prisma/client dari mana pun (next dev / node script) membaca `prisma/dev.db`.
- Root `dev.db` (0 byte) yang pernah ada adalah residual tooling yang membuka URL relatif terhadap CWD — TIDAK dipakai apa pun, sudah DIHAPUS. Tercegah tercipta ulang via `.gitignore` (`*.db`). Jangan buat/isi `./dev.db` di root.
- Catatan lama `.env` (`backend/prisma/dev.db`) sudah diperbarui; itu peninggalan layout monorepo lama.
- `npx prisma migrate dev` TIDAK berfungsi non-interactive; pakai migration manual `prisma/migrations/<ts>_<nama>/migration.sql` + `npx prisma migrate deploy` + `npx prisma generate`.
- Setelah `prisma generate`, restart dev server (klien Prisma ter-load di memori saat startup; pakai STALE schema sampai restart). Gejala: `Unknown argument buyerNote`.
