# Runbook Deploy — maxius.id (VPS AlmaLinux, systemd)

> Nilai secret **tidak boleh dikirim ke chat** — semua diisi langsung di
> `~/maxius-platform/.env` via SSH. Runbook ini hanya mencatat **nama** env.

## 0. Ringkasan arsitektur

| Komponen | Nilai |
|---|---|
| Proses | `systemd` unit **`maxius-omni.service`** (bukan pm2) |
| Perintah proses | `node node_modules/.bin/next start -p 3000` |
| Port | **3000** (dipaksa unit; jangan set `PORT` lain di `.env`) |
| Domain | `https://maxius.id` (reverse proxy → `127.0.0.1:3000`) |
| Node | ≥ 20.9 (Next 16) — cek `node -v`; disarankan Node 20/22 LTS |
| DB | Postgres (`POSTGRES_URL`) — migrasi sudah *up to date* (5 migration) |
| Deploy | `./deploy.sh` (idempoten; gagal di tengah = aman, ulangi) |

## 1. Prasyarat (sekali saja di VPS)

1. **Repo**: clone **dari remote yang sama** dgn maxius-platform lokal —
   `git clone https://github.com/rifdanhd/maxius-omni.git` ke `/home/maxius/maxius-platform`
   (sesuaikan `WorkingDirectory` unit bila beda).
   `deploy.sh` menolak jalan bila `git remote -v` ≠ repo asal
   (default `EXPECTED_REMOTE=https://github.com/rifdanhd/maxius-omni.git`;
   untuk fork sengaja: set `EXPECTED_REMOTE` di lingkungan deploy).
2. **Node**: `node -v` ≥ 20.9. Kalau pakai nvm, tambahkan path bin node ke `Environment=PATH` di unit.
3. **pm2 dimatikan** (port bentrok):
   ```bash
   pm2 kill            # atau: pm2 delete all && pm2 unstartup
   ```
4. **Env produksi diisi** (lihat checklist §2) — **backup dulu bila sudah ada**,
   lalu `nano .env`, **jangan** kirim nilai ke chat:
   ```bash
   cp .env .env.bak-$(date +%F-%H%M)    # simpan sbg .env.bak-<tanggal-jam>
   nano .env
   ```
5. **Reverse proxy + TLS** sudah menunjuk `127.0.0.1:3000` (nginx/caddy/other) —
   wajib untuk OAuth callback & webhook publik.
6. **Install unit**:
   ```bash
   sudo cp systemd/maxius-omni.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable maxius-omni
   ```
7. **Sudoers SEMPIT** (bukan hak penuh) — hanya restart/status/journal unit ini.
   Ini dipakai `deploy.sh` utk restart + baca journal tanpa password:
   ```bash
   cat <<'EOF' | sudo tee /etc/sudoers.d/maxius-deploy
   maxius ALL=(root) NOPASSWD: /usr/bin/systemctl restart maxius-omni, /usr/bin/systemctl status maxius-omni, /usr/bin/journalctl -u maxius-omni *
   EOF
   sudo chmod 440 /etc/sudoers.d/maxius-deploy
   sudo visudo -cf /etc/sudoers.d/maxius-deploy    # harus "parsed OK"
   ```
   (Sesuaikan nama user `maxius` & path `command -v systemctl` bila beda.)
   Tanpa ini, `deploy.sh` tetap build lalu berhenti minta restart manual —
   dan swap di step 8 juga wajib manual (sudoers di atas sengaja tidak mencakup swapon).
8. **Swap manual** (RAM 1.9GB; `next build` OOM tanpa swap; sudoers sempit tidak
   mencakup `swapon`, jadi buat sekali ini — `deploy.sh` hanya memverifikasi):
   ```bash
   sudo fallocate -l 4096M /swapfile && sudo chmod 600 /swapfile \
     && sudo mkswap /swapfile && sudo swapon /swapfile \
     && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   free -h   # Swap: ~4Gi
   ```

## 2. Checklist env produksi (isi manual di `.env` server)

### Wajib — tanpa ini app tidak boot / fitur inti mati

| Nama | Nilai dari mana | Catatan |
|---|---|---|
| `JWT_SECRET` | generate: `openssl rand -hex 32` | sesi login |
| `PII_ENC_KEY` | generate: `node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'` | wajib **64 hex**; app *melempar saat import* bila kosong |
| `POSTGRES_URL` | string koneksi Postgres produksi | `DATABASE_URL` juga diterima |

### Shopee (live)

| Nama | Nilai dari mana | Catatan |
|---|---|---|
| `SHOPEE_PARTNER_ID` | Shopee Open Platform Console (App) | partner **live** |
| `SHOPEE_PARTNER_KEY` | Console | jangan pakai test partner utk live |
| `SHOPEE_REDIRECT_URI` | `https://maxius.id/api/auth/shopee/callback` | **harus persis** terdaftar di Console + cocok dg route app |
| `SHOPEE_AUTHORIZE_ENABLED` | `true` | tombol "Hubungkan" di UI |

### TikTok

| Nama | Nilai dari mana | Catatan |
|---|---|---|
| `TIKTOK_APP_KEY` | TikTok Partner Center | |
| `TIKTOK_APP_SECRET` | Partner Center | |
| `TIKTOK_REDIRECT_URI` | `https://maxius.id/api/auth/tiktok/callback` | **menggantikan** nilai lama `...vercel.app` (yang lama salah) |
| `TIKTOK_REDIRECT_URL` | — | alias cadangan; `TIKTOK_REDIRECT_URI` menang bila keduanya ada |
| `WEBHOOK_BASE_URL` | `https://maxius.id` | **referensi konfigurasi console** — tidak dibaca kode app |

### Opsional

| Nama | Nilai | Catatan |
|---|---|---|
| `OPENAI_API_KEY` | — | fitur copy produk |
| `SHOPEE_API_BASE` / `SHOPEE_AUTH_BASE` | default live | hanya utk sandbox (§8) — jangan campur dgn nilai live |
| `SHOPEE_ORDER_RATE_MAX` / `_WINDOW_MS` / `SHOPEE_ORDER_MAX_PAGES` / `_DETAIL_BATCH` / `_SYNC_DAYS` | default 30 / 10000 / 10 / 50 / 30 | guard A5, tak perlu diubah |
| `SYNC_RETRY_DISABLED` | `true` | kill-switch auto-retry (debug) |

### URL yang harus dipasang di console seller (setelah deploy)

- **Shopee** Open Console → Push config → callback:
  `https://maxius.id/api/webhooks/shopee` (Verify & Save; signature = partner key live).
- **TikTok** Partner Center → webhook URL:
  `https://maxius.id/api/webhooks/tiktok`.

## 3. Urutan deploy aman (yang dijalankan `./deploy.sh`)

> **Sebelum jalankan:** push SEMUA commit (F0–F3) dari mesin lokal dulu —
> `git push origin main`. `deploy.sh` menolak bila di clone VPS ada commit yang
> belum ada di remote (drift), remote bukan repo asal, atau branch ≠ `main`.

1. **Preflight `.env`** — nama env wajib dicek (nilai tidak dicetak);
   gagal = berhenti sebelum build. Deteksi: nilai `vercel.app`/`ngrok` yang basi,
   `PORT` ≠ 3000, pm2 masih hidup.
1c. **Preflight git** — `git remote origin` **wajib** repo asal maxius-omni
   (HTTPS vs SSH dinormalisasi dulu; remote lain → ditolak) dan branch = `main`
   (detached HEAD → ditolak).
2. **Swap dibuat SEBELUM build** (`/swapfile` 4GB, ditambah ke `/etc/fstab`) —
   RAM 1.9GB, `next build` bisa OOM tanpa swap. (Bila belum ada & sudoers sempit
   tidak mencakup swapon → gagal dengan instruksi; buat manual — prasyarat §1 step 8.)
3. `git fetch` → **tolak bila ada commit lokal belum di-push** (drift;
   perintah `git push` ditampilkan) → `git pull --ff-only`
   → 4. `npm ci` (postinstall = `prisma generate`)
   → 5. **`pg_dump` backup DB** ke `backups/pre-deploy-<timestamp>.sql.gz`
   (rotasi 5 terakhir; dump gagal = migrate DIBATALKAN; lewati hanya `SKIP_BACKUP=1`)
   → 6. `prisma migrate deploy` (gagal di sini = build tidak jalan; aman)
   → 7. `next build` → 8. `systemctl restart maxius-omni`
   → 9. health check `127.0.0.1:3000` (30× retry) → 10. cek log `[SyncRetry]`.

Gagal kapan pun → perbaiki lalu jalankan `./deploy.sh` lagi (semua langkah idempoten).

## 4. Perintah

```bash
cd ~/maxius-platform
./deploy.sh                    # deploy branch main
DEPLOY_BRANCH=staging ./deploy.sh
SKIP_MIGRATE=1 ./deploy.sh     # lewati migrasi
SKIP_BACKUP=1 ./deploy.sh      # lewati pg_dump (TIDAK disarankan)
SWAP_MB=2048 ./deploy.sh       # swap lebih kecil
EXPECTED_REMOTE=https://github.com/<org>/maxius-omni.git ./deploy.sh   # fork sah
```

## 5. Verifikasi pasca-deploy

```bash
sudo systemctl status maxius-omni
sudo journalctl -u maxius-omni -n 100 --no-pager
sudo journalctl -u maxius-omni -n 200 --no-pager | grep -F '[SyncRetry]'
curl -I https://maxius.id/
pm2 jlist        # harus kosong ([]) — pm2 tidak boleh pegang port
```
(Perintah di atas tercakup sudoers sempit §1 step 7 — tanpa prompt password.)

## 6. Rollback

```bash
cd ~/maxius-platform
git log --oneline -5           # pilih sha lama
git checkout <sha>             # atau: git reset --hard <sha>
SKIP_BACKUP=1 ./deploy.sh      # kode lama; backup ulang tidak perlu
```
Migrasi **tidak di-rollback** (forward-only) — kalau perlu, tambahkan migration baru.

### Restore data dari backup pg_dump (darurat)

Backup otomatis: `backups/pre-deploy-*.sql.gz` (5 terakhir). Restore **menimpa**
data sesuai isi dump — hentikan app dulu:

```bash
cd ~/maxius-platform
sudo systemctl stop maxius-omni

# (opsional) buang data lama supaya identik dgn dump — DESTRUKTIF:
# psql "$POSTGRES_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'

gunzip -c backups/pre-deploy-<timestamp>.sql.gz | psql "$POSTGRES_URL"
sudo systemctl start maxius-omni
sudo journalctl -u maxius-omni --since "-5 min" | grep -F '[SyncRetry]'
```

## 7. Instrumentation auto-retry di bawah systemd

- `instrumentation.ts register()` dipanggil Next **sekali per proses saat `next start`**.
  Syarat terpenuhi di unit: `NEXT_RUNTIME=nodejs` (default) dan
  `NODE_ENV=production` → timer `processDueSyncJobs` tiap **30 detik** aktif.
- **Tidak ada crontab & tidak ada worker kedua** — tick in-process; aman karena
  claim atomik di `sync-job.service` (tick tumpang-tindih/re-register tidak dobel).
- Crash → `Restart=always` → proses baru → register ulang → timer baru.
  `globalThis.__maxiusSyncRetryTimer` mencegah timer ganda dalam 1 proses.
- Verifikasi: baris `[SyncRetry] auto-retry SyncJob aktif (tiap 30dtk)` di journal.
  Uji keras: `sudo systemctl kill -s SIGKILL maxius-omni` → lihat status kembali
  `active` + log `[SyncRetry]` muncul lagi.
- Kill-switch: `Environment=SYNC_RETRY_DISABLED=true` di unit (komentar disediakan).

## 8. Smoke test F3 di VPS

Prasyarat: deploy hijau + `SHOPEE_REDIRECT_URI` sudah `maxius.id` (OAuth kini bisa
dari production — masalah OAuth-lokal tidak relevan lagi).

### Opsi UTAMA — order live dengan akun pembeli lain (jalur utama validasi)

Ini **satu-satunya** validasi jalur production sungguhan (DB, domain, webhook,
signature live) — kerjakan ini dulu; sandbox (di bawah) hanya cadangan bila
tersendat.

Self-purchase dari akun toko yang sama biasanya **diblokir/dicurigai Shopee**
→ beli dari **akun pembeli lain** (akun pribadi, tanpa kaitan ke toko).

Checklist (identik utk opsi utama & cadangan):
1. **Sync** — order muncul (manual: tombol sinkron; otomatis: push) → kartu order ada.
2. **Deduct** — stok varian −qty, ledger `ORDER` **1×**; sync ulang → tidak berubah.
3. **Status** — `READY_TO_SHIP` → tab *Siap Dikirim*; `SHIPPED` → *Dikirim* (stok tetap).
4. **Label lokal** — pilih order → `Cetak (1)` → *Cetak Label* → jendela print
   brand **Shopee**, alamat, isi paket, barcode resi.
5. **Tracking** — resi tampil (dari `Shipment.trackingNo`) → tombol *Lacak*.
6. **Nol panggilan TikTok** — DevTools Network filter `tiktok` = kosong selama 1-5;
   journal tidak ada log `[TikTok]` utk akun Shopee.

### Opsi CADANGAN — Shopee Sandbox + Test Order (hanya bila opsi utama tersendat)

Sandbox punya **Test Order** resmi (tanpa uang, tanpa pembeli).

> ⚠️ **NILAI SANDBOX TIDAK BOLEH DICAMPUR dgn `.env` PRODUKSI.**
> Kombinasi setengah jalan (mis. `SHOPEE_API_BASE` sandbox + `SHOPEE_PARTNER_ID`
> live, atau partner test dipakai utk live) membuat signature/host salah
> → semua request Shopee 401/403 dan push webhook berhenti diam-diam.
> Syarat: **ke-4 nilai di bawah berganti bersamaan** saat mulai, dan
> **ke-4 nilai dikembalikan bersamaan** saat selesai — tidak ada kondisi di tengah.

**Backup `.env` sebelum menyentuh apa pun, dan tahu cara mengembalikannya:**

```bash
cd ~/maxius-platform
cp .env .env.bak-sandbox-$(date +%F-%H%M)     # backup dulu (catat namanya)
nano .env                                      # ganti 4 nilai ke sandbox, SEKALIGUS

# ...jalankan smoke sandbox (langkah di bawah)...

# KEMBALIKAN ke produksi:
mv .env.bak-sandbox-<tanggal-jam> .env        # restore = file original kembali utuh
SKIP_BUILD=1 SKIP_MIGRATE=1 ./deploy.sh       # restart baca .env hasil restore
# (alternatif manual: sunting balik 4 nilai ke live — hanya bila tak ada backup)
```

Konfigurasi khusus sandbox — **ganti 4 nilai ini di `.env` server** (partner test ≠ live):

| Nama | Nilai sandbox |
|---|---|
| `SHOPEE_API_BASE` | `https://openplatform.sandbox.test-stable.shopee.sg` |
| `SHOPEE_AUTH_BASE` | `https://open.sandbox.test-stable.shopee.com/auth` |
| `SHOPEE_PARTNER_ID` / `SHOPEE_PARTNER_KEY` | **Test** partner dari Console (Tools/App) — test ID hanya berlaku di sandbox |
| `SHOPEE_REDIRECT_URI` | `https://maxius.id/api/auth/shopee/callback` (daftarkan domain di config app sandbox) |

Langkah:
1. Open Platform Console → **Test Account (Sandbox v2)** → buat test shop →
   *Login Seller Center* (pakai akun sandbox, **bukan** akun live).
2. Authorize test shop ke app: tombol Hubungkan di app (pakai `SHOPEE_AUTH_BASE` sandbox) → pilih test shop.
3. Console → **Tools → Test Order** → *Create Test Order* (pilih shop, item, shipping).
4. Smoke sync → deduct → status (langkah checklist di atas).
5. Sandbox Seller Center → *Arrange Shipment* → **tracking number otomatis** (status PROCESSED).
   Console → Test Order → tombol **Pickup** → `SHIPPED`, **Deliver** → `TO_CONFIRM_RECEIVE`
   (pakai ini utk cek tab *Dikirim* + label lokal + tracking).
6. Push manual: Console → **Push** → Test Callback URL `https://maxius.id/api/webhooks/shopee`
   → Verify & Save → **Push Test Data**. (Verifikasi signature menerima test partner key
   — `SHOPEE_PARTNER_KEY` sandbox ikut sebagai kandidat secret.)
7. Setelah selesai: **kembalikan `.env` dari backup** (`mv .env.bak-sandbox-… .env`)
   — ke-4 nilai live pulih serentak, nol risiko campur — lalu
   `SKIP_BUILD=1 SKIP_MIGRATE=1 ./deploy.sh` (restart saja; build tidak perlu ulang).

Catatan: sandbox = **test shop**, jadi data order bukan Geto.bdg asli —
pakai **hanya** utk uji jalur teknis; validasi production = **opsi utama di atas**.

### Setelah smoke hijau

Lanjut F5 sisanya: pasang URL webhook di console (§2), pastikan
`TIKTOK_REDIRECT_URI` sudah `maxius.id`, lalu final check checklist §5.
