# Rencana Fitur: Buat Discount Activity (DIRECT_DISCOUNT) dari Maxius.id

> STATUS: **Tahap 1–4 SELESAI + E2E sandbox PASS (10 Sep 2026).**
> Tersisa: link navigasi sidebar + endpoint `/deactivate` resmi (dipakai manual via integrasi
> saat pembersihan zombie) + panel riwayat audit di halaman monitoring.
> Prinsip: ini fitur WRITE yang mengubah harga jual nyata — setiap keputusan mengutamakan
> "aman gagal" (fail-safe) di atas "lengkap fitur".

---

## HASIL VERIFIKASI SANDBOX (10 Sep 2026 — mengisi §1.3 & §1.4)

| Probe | Hasil |
|---|---|
| Lead time begin_time | `+3 jam` dan `+4 jam` DITERIMA sandbox → 26 jam BUKAN aturan platform (artefak kategori) — validasi Maxius ≥ +2 jam aman |
| Attach DIRECT_DISCOUNT | Gagal `36009004` beruntun: `quantity_limit` WAJIB, `quantity_per_user` WAJIB (keduanya default `-1`), dan `activity_id` WAJIB di BODY (bukan hanya path) — ketiganya sudah diperbaiki di integrasi; attach OK `total_count:1` |
| Error HTTP non-2xx | Body TikTok memuat code/message/request_id — `callApi` kini melempar `TikTokApiError` terstruktur (sebelumnya pesan hilang jadi "HTTP 400") |
| Get by ID pasca-create | `products[].discount` = string % ("15"), quantity -1/-1 → dasar verifikasi G5 |
| Deactivate activity kosong | OK — zombie (attach gagal) jadi `DEACTIVATED` |
| Skenario UNVERIFIED riil | Create sukses → attach gagal → audit `UNVERIFIED` + alert banner; dibersihkan via deactivate, pesan audit dianotasi RESOLVED |

Skenario E2E via API (akun sandbox `...9285`, produk RIKI ter-mapping):
negatif G1 (tanpa harga) → block; G4 tanpa "BUAT" → 400 tanpa jejak audit; G2 96% tanpa
confirm → 400 + pesan dampak; lead time <2 jam → 400; happy path 15% → `SUCCESS`, audit
benar, Get by ID cocok. Zero-write preview terverifikasi (audit tetap 0 sebelum create).

---

## 0. Rekomendasi Ringkas (untuk keputusan cepat)

| Aspek | Rekomendasi | Alasan |
|---|---|---|
| Activity type pertama | **DIRECT_DISCOUNT** saja | Paling sederhana (config = persen per produk); FIXED_PRICE/FLASHSALE butuh harga absolut + validasi harga kompleks; SHIPPING_DISCOUNT beda domain (ongkir, product_level SHOP) |
| Scope produk iterasi 1 | **Batch antar-produk (PRODUCT level), hard cap 300 SKU/call** | Sudah cukup untuk kebutuhan riil; VARIATION ditunda karena struktur item-nya belum tervalidasi runtime (nota KNOWN GAP ingest) |
| Kapan produk di-attach | **Dua langkah**: create activity (tanpa produk) → attach via PUT products | `discount` memang field per-produk di PUT; create-only lebih mudah di-rollback |
| Audit trail | **Tabel baru `PromotionAuditLog`** (bukan numpang SyncLog) | Perlu kolom relasional (userId, before/after JSON, status konfirmasi) yang akan diterawangi kalau memaksa ke SyncLog |
| Deactivate | Masuk iterasi 1 (satu tombol, satu endpoint, dialog konfirmasi) | Mekanisme "pegas rem" saat ada yang salah — justru bagian dari fail-safe |
| Update partial discount | **DITUNDA** (di luar iterasi 1) | Sesuai instruksi; hapus/tambah produk cukup via Remove/Attach |
| Lead time begin_time | Jangan mengandalkan ~26 jam; set default UI **besok +1 jam**, hard-validate ≥ **+2 jam** dari now, dan **probe runtime** di sandbox | Tidak ada konfirmasi dokumentasi resmi (lihat §1.4) |

---

## 1. Review Ulang Batasan API (bukti dari SDK vendored + runtime)

### 1.1 Payload POST `/promotion/202309/activities` untuk DIRECT_DISCOUNT

Dari `CreatePromotionActivityRequestBody` (SDK, wire snake_case):

| Field | Wajib? | Catatan |
|---|---|---|
| `activity_type` | ✅ | `"DIRECT_DISCOUNT"` |
| `title` | ✅ praktis | **Unik antar semua activity**, maks **50 karakter** — Maxius harus generate/enforce unik (mis. prefix toko + timestamp) |
| `product_level` | ✅ | `"PRODUCT"` untuk iterasi 1 (SPU; semua SKU ikut) |
| `begin_time` / `end_time` | ✅ | epoch detik; begin_time harus di masa depan; end > begin |
| `discount` | ❌ **tidak untuk DIRECT_DISCOUNT** | Model create hanya punya `bmsm/bxgy/gift/shipping_discount` — TIDAK ADA `direct_discount`. Discount % DIRECT_DISCOUNT diset **per produk saat attach** |
| `duration_type` | opsional | default `NORMAL` |
| `auction_support_type` | opsional | default biarkan |
| `participation_limit` / `target_user_info` | opsional | **TUNDA** ke iterasi berikutnya |

**Implikasi arsitektur**: create dan attach adalah dua call, dan angka diskon hidup di attach.
Skenario gagal terburuk: create sukses → attach gagal → ada activity kosong di TikTok.
Mitigasi (wajib): bila attach pertama gagal, UI menawarkan **"Nonaktifkan activity kosong ini"**
(atau auto-deactivate dengan konfirmasi) supaya tidak meninggalkan sampah.

### 1.2 Batas 300 SKU per call PUT `/activities/{id}/products`

- Dokumentasi model: *"The number of the SKUs across all products must not exceed 300 in an API call."*
  Dokumen "Adding SKU and product limit to Promotion API" menandai ini sebagai **batas platform yang di-enforce** (bukan kebetulan).
- Untuk PRODUCT level, `skus` wajib `[]`, jadi yang dihitung praktis = jumlah produk terpilih.
- **Kalau seller pilih > 300 produk → WAJIB batching**: pecah per 300 (fermi: 900 produk = 3 call
  berurutan, `await` satu per satu), **tahan sementara** status partial di server, dan UI menampilkan
  progres per batch. Kegagalan batch ke-N tidak me-rollback batch sebelumnya (tidak ada transaksi
  lintas-call di TikTok) → UI harus jujur menampilkan "300/900 terpasang, batch 2 gagal: [reason]"
  + tombol retry per batch yang tersisa.
- Hard cap yang SAYA SARANKAN di UI iterasi 1: **maks 1.000 produk per activity** (cicilan ≤ 4 batch)
  supaya alur gagal-parse dan UX progres tetap terkontrol; angka ini bisa dinaikkan belakangan.

### 1.3 Aturan min/max discount %

- Dari model: nilai `discount` = string persen (contoh tervalidasi runtime: `"10"`). Tidak ada
  batas numerik yang tertulis di model SDK.
- Sumber lain menunjukkan batas platform **ada** (mis. minimum ~5-10% tergantung kategori/region)
  tapi **tidak bisa saya konfirmasi** dari dokumen yang dapat diakses di sesi ini (SPA).
- **Keputusan desain**: jangan hardcode angka tebakan sebagai "aturan TikTok". Guardrail Maxius
  memakai ambang KEBIJAKAN sendiri (lihat §2.2), dan error/penolakan dari TikTok ditampilkan
  verbatim per produk. Tambahkan **probe runtime** (submit 1 produk diskon kecil di sandbox)
  ke daftar verifikasi sebelum fitur dianggap matang.

### 1.4 Constraint create_time → begin_time (jeda ~26 jam di sandbox)

- Yang tervalidasi runtime kemarin hanya: begin_time harus **masa depan** dan sandbox menerima
  begin ≈ create + 26 jam. **Tidak ada pernyataan resmi "minimum lead time X jam"** yang berhasil
  saya temukan di dokumentasi yang dapat diakses (doc SPA tidak terekstrak; butuh cek manual).
- Interpretasi konservatif: 26 jam kemungkinan artefak siang/malam + aturan "mulai besok"
  milik kategori sandbox, BUKAN konstanta API. Tapi karena tidak pasti:
  - UI default: `begin_time = besok, jam berikutnya` (aman untuk kedua kemungkinan)
  - Validasi server Maxius: tolak begin_time < now + 2 jam dengan pesan jelas
  - Bila TikTok menolak dengan error lead-time, tampilkan error apa adanya + sarankan naikkan tanggal
  - **Verifikasi manual yang disarankan sebelum rilis**: di sandbox, coba create dengan begin
    +3 jam / +12 jam / +26 jam dan catat hasilnya → isi tabel kecil di dokumen ini.

### 1.5 Endpoint lain yang relevan (sudah ada di SDK)

- `PUT /activities/{id}/products` — attach/update produk (max 300 SKU)
- `DELETE /activities/{id}/products` (RemovePromotionActivityProducts) — lepas produk
- `POST /activities/{id}/deactivate` — nonaktifkan activity (untuk fail-safe)
- `GET /activities/{id}` — konfirmasi pasca-tindakan (wajib, lihat §2.5)

---

## 2. Guardrail di Sisi Maxius (semua SEBELUM request ke TikTok)

### G1 — Preview harga final wajib
- Tabel per produk: harga asli (dari `ProductMapping.price` → fallback `ProductVariant.price`),
  % diskon, **harga final (Rp, dibulatkan)**, dan kolom "selisih".
- Angka final dihitung server-side (bukan dipercaya dari client) pada submit.
- Submit DITOLAK bila ada produk tanpa harga sumber (tidak bisa dipreview → tidak boleh ikut).

### G2 — Validasi diskon tidak masuk akal
- Angka: harus bilangan bulat 1–95 (kebijakan Maxius; bukan klaim aturan TikTok).
- **0% atau ≥96%** (mendekati gratis): form menolak, kecuali user mencentang konfirmasi eksplisit
  dua tahap ("Saya paham harga jual akan menjadi Rp X / hampir gratis") — sesuai permintaan.
- Konsistensi per-produk boleh beda persen (iterasi 1: satu % per produk, di-set per baris; tanpa bulk-edit dulu).

### G3 — Deteksi overlap
- Sebelum submit, kumpulkan `platformProductId` terpilih → cek `PromotionActivityItem` join
  `PromotionActivity` milik account yang sama dengan status `ONGOING`/`NOT_START`
  (plus jendela waktu tumpang-tindih).
- **Hasilnya WARN + block-by-default**: daftar produk konflik + activity pemiliknya; user harus
  menghapus produk konflik ATAU mencentang "tetap lanjutkan" (TikTok sendiri bisa menolak
  produk ganda — kami tidak mengandalkan itu).
- Catatan jujur: data lokal bisa basi (ingest terakhir). Overlap check adalah best-effort;
  error penolakan TikTok tetap ditampilkan verbatim.

### G4 — Konfirmasi eksplisit (dialog ringkas)
> "Anda akan mengubah harga **X produk** menjadi **Rp Y (contoh produk termurah/termahal)**
> selama **Z hari** (mulai [tanggal]) di toko **[label]**. Lanjutkan?"
- Wajib mengetik kata "BUAT" untuk eksekusi (pattern type-to-confirm) — klik saja tidak cukup.

### G5 — Konfirmasi pasca-create via Get by ID (WAJIB)
- Setelah POST create sukses → call GET by ID → cocokkan (status awal, title, begin/end).
- Setelah SETIAP batch attach → GET by ID lagi → hitung ulang items dari response → cocokkan
  dengan yang dikirim. Baru setelah itu UI menampilkan sukses + angka final.
- Jika Get by ID gagal/tidak cocok → status "TIDAK TERVERIFIKASI" (bukan sukses, bukan gagal),
  activity dicatat di audit dengan status itu, UI menyuruh cek halaman monitoring + ingest.

---

## 3. Audit Trail

**Keputusan: tabel baru `PromotionAuditLog`** — bukan numpang SyncLog. Alasan: butuh query
"siapa mengubah harga apa kapan" dengan before/after terstruktur; SyncLog dirancang untuk
hasil sinkronisasi (message/error string), bukan relasi user↔aktivitas komersial.

Skema draft (detail final saat implementasi, 1 migrasi terpisah):

```
PromotionAuditLog
  id, accountId, userId, username           (siapa; snapshot username utk ketahanan)
  action     // CREATE_ACTIVITY | ATTACH_PRODUCTS | REMOVE_PRODUCTS | DEACTIVATE
  externalActivityId, activityTitle
  payloadSent      String?  // JSON request yang dikirim ke TikTok
  resultStatus     // SUCCESS | TIKTOK_ERROR | UNVERIFIED | PARTIAL
  tiktokCode, tiktokMessage, requestId
  itemsBefore/itemsAfter String?  // JSON ringkas [{productId, discount, priceBefore, priceAfter}]
  batchIndex, batchTotal  Int?     // utk attach >300
  createdAt
```

- Ditulis **sebelum** call TikTok (intent) → diupdate setelah response + konfirmasi G5.
  Jadi bila server mati di tengah, ada jejak intent yang menggantung.
- Deactivate & Remove ikut tercatat (bukan hanya create).
- Halaman monitoring promotions nanti diberi panel riwayat audit (read-only) — iterasi berikutnya.

---

## 4. Scope Perubahan Kode (perkiraan)

### 4.1 Endpoint baru (app/api/marketplace/tiktok/promotions/...)

| Endpoint | Metode | Fungsi |
|---|---|---|
| `/preview` | POST | Body: {accountId, productIds[], discount%, begin, end} → return per-produk: harga asli, harga final, konflik overlap, validasi error. **Tanpa efek samping.** |
| `/create` | POST | Orkestrasi: validasi ulang → create activity → attach batch ≤300 → konfirmasi Get by ID → tulis audit. Satu transaksi logika (bukan DB transaction — TikTok tidak bisa). |
| `/[activityId]/deactivate` | POST | Deactivate + konfirmasi Get by ID (status DEACTIVATED) + audit. |

Tidak dibuat: update partial discount, update title/waktu (Update Activity), remove products —
semuanya **sengaja ditunda** (Remove bisa jadi iterasi 2 bila butuh "kurangi produk").

### 4.2 Integrasi baru (lib/integrations/tiktokShop.ts)

`createPromotionActivity`, `updatePromotionActivityProducts`, `deactivatePromotionActivity`
— tipis di atas `callApi` yang sudah ada (sign + shop_cipher + error mapping sudah beres).
Batching di service layer, bukan di integrasi.

### 4.3 Migrasi DB
1 migrasi baru: tabel `PromotionAuditLog` (± 1 tabel, tanpa menyentuh tabel lama — pola sama
dengan `add_promotion_activities`).

### 4.4 UI (form minimal di iterasi 1)

Masuk: pilih toko → pilih produk (dari listing yang sudah ada, checkbox, tampil harga) →
input % per produk (default seragam, bisa diedit per baris) → pilih mulai (default besok)
& durasi/berakhir → **preview G1-G3** → dialog G4 → hasil G5.
Ditunda: quantity_limit/quantity_per_user (pakai default -1/unlimited), VARIATION level,
participation_limit, target_user_info, template promo, bulk edit.

### 4.5 Urutan implementasi (kalau rencana disetujui)
1. Migrasi audit log + integrasi 3 fungsi TikTok
2. Endpoint `/preview` (murni baca) + unit test validasi
3. Endpoint `/create` + G1–G5 + audit intent/result
4. UI form + preview + dialog konfirmasi
5. `/deactivate` (terakhir; kecil tapi penting)
6. Verifikasi sandbox end-to-end + probe aturan (§1.3/§1.4) + dokumentasi hasil

---

## 5. Pertanyaan untuk Reviewer (balas singkat saja)

1. Setuju iterasi 1 = DIRECT_DISCOUNT + PRODUCT level + attach ≤300/batch (cap 1.000 produk)?
2. Ambang diskon kebijakan Maxius: 1–95% dengan konfirmasi khusus di luar rentang itu — pas?
3. Audit trail pakai tabel baru `PromotionAuditLog` — setuju?
4. Deactivate ikut iterasi 1 — setuju?
5. Begin_time default "besok" + validasi ≥ +2 jam — setuju, atau mau lebih konservatif?
