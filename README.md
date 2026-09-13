# Dashboard Sinkronisasi Stok (Shopee + TikTok Shop)

Prototipe full-stack: frontend React + backend Node/Express + login, buat
latihan sebelum disambungkan ke API Shopee/TikTok Shop yang asli.

## Struktur folder

```
stock-sync-project/
├── backend/     Express API + auth + logika sinkronisasi stok
└── frontend/    React + Vite, dashboard + halaman login
```

## Cara menjalankan

### 1. Jalankan backend

```bash
cd backend
npm install
npm run dev
```

Backend jalan di `http://localhost:4000`.

### 2. Jalankan frontend (di terminal terpisah)

```bash
cd frontend
npm install
npm run dev
```

Frontend jalan di `http://localhost:5173`. Buka di browser.

### 3. Login

- Username: `admin`
- Password: `admin123`

Ganti kredensial ini di `backend/data/store.js` sebelum dipakai serius.

## Cara kerja sinkronisasi stok (8 akun, konsep Produk Master)

Sistem ini sekarang punya 8 akun (5 Shopee + 3 TikTok Shop) dan konsep
**Produk Master**: satu produk fisik (misal "Kaos kaki polos hitam") punya
SATU angka stok pusat, tapi bisa terdaftar dengan **kode SKU yang berbeda**
di tiap akun — persis seperti kondisi nyata, karena tiap listing marketplace
punya SKU sendiri-sendiri.

Mapping "akun X pakai SKU Y untuk produk Z" disimpan di
`backend/data/store.js` (lihat field `mappings` pada tiap `masterProducts`).
Baik form "Simulasikan penjualan" di dashboard, maupun endpoint webhook
(`/api/webhooks/{account-id}`), sama-sama memanggil fungsi `recordSale()` di
`backend/data/syncService.js`, yang:

1. Mencari produk master mana yang cocok dengan kombinasi `accountId` + `channelSku`
2. Mengurangi stok pusat produk itu
3. Mencatat log yang bilang "tersinkron ke N listing lain"

Coba simulasikan order dari marketplace lewat terminal (ganti `{account-id}`
dengan salah satu dari: `shopee-1` s/d `shopee-5`, `tiktok-1` s/d `tiktok-3`):

```bash
curl -X POST http://localhost:4000/api/webhooks/tiktok-3 \
  -H "Content-Type: application/json" \
  -d '{"channelSku":"TTS3-BLK-A","qty":2}'
```

Dashboard akan otomatis menampilkan perubahan stok dalam beberapa detik
(polling tiap 5 detik). Halaman **Produk Master** (menu sidebar) menampilkan
tiap produk beserta SKU-nya di semua akun — klik baris produk untuk expand.

## Langkah berikutnya untuk hubungkan ke API asli

1. Daftar developer account di Shopee Open Platform dan TikTok Shop Partner
   Center, buat aplikasi, dan dapatkan API key/secret.
2. Ganti isi `backend/data/store.js` dari data in-memory ke database asli
   (Postgres, MySQL, MongoDB, dll) supaya data tidak hilang saat server
   restart.
3. Di `backend/routes/webhooks.js`, tambahkan verifikasi signature yang
   dikirim tiap platform, supaya bukan sembarang orang bisa memanggil
   endpoint ini.
4. Di `backend/data/syncService.js`, pada bagian komentar `TODO`, tambahkan
   pemanggilan API "update stock" ke platform lain (misalnya kalau order
   masuk dari Shopee, panggil TikTok Shop API untuk update stok, dan
   sebaliknya).
5. Daftarkan URL webhook backend kamu (setelah di-deploy ke server publik,
   bukan localhost) di dashboard developer masing-masing platform.

## Catatan keamanan

- `JWT_SECRET` di `backend/middleware/auth.js` pakai nilai default untuk
  development. Sebelum deploy, set environment variable `JWT_SECRET` ke nilai
  acak yang panjang.
- Data saat ini disimpan di memory (`backend/data/store.js`) dan akan hilang
  setiap server restart. Ini untuk mempermudah belajar/prototyping.
