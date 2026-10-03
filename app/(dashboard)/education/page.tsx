const STEPS = [
  {
    title: "1. Masuk ke Akun",
    body: [
      "Buka halaman login, masukkan username dan password yang diberikan admin.",
      "Setelah masuk, Anda langsung melihat Dashboard: ringkasan penjualan, pesanan terbaru, dan status toko.",
    ],
  },
  {
    title: "2. Hubungkan Toko Shopee / TikTok Shop",
    body: [
      "Buka menu Pengaturan → Pengaturan Toko.",
      "Klik Hubungkan pada toko yang ingin disambungkan, lalu setujui akses di halaman seller Shopee / TikTok.",
      "Anda otomatis kembali ke aplikasi dan toko langsung tersambung. Ulangi untuk toko lainnya.",
    ],
  },
  {
    title: "3. Produk & Mapping Stok",
    body: [
      "Produk Master = satu produk induk beserta seluruh varian (ukuran, warna) beserta stoknya.",
      "Mapping Stok Terpusat menghubungkan varian ke SKU di tiap toko — SKU berbeda antar toko itu wajar, yang penting sudah di-mapping.",
      "Saat stok di aplikasi berubah, perubahan dikirim ke semua toko yang ter-mapping.",
    ],
  },
  {
    title: "4. Kelola Stok",
    body: [
      "Stok Varian: lihat dan ubah stok fisik tiap varian.",
      "Barang Masuk / Opname: catat stok baru atau hasil stock opname.",
      "Pengaturan Inventori: atur safety stock (buffer) agar tidak kehabisan stok, dan atur peringatan stok menipis.",
    ],
  },
  {
    title: "5. Pesanan & Pengiriman",
    body: [
      "Kelola Pesanan: semua pesanan dari toko tersambung masuk ke satu daftar.",
      "Pesanan masuk otomatis memotong stok varian terkait.",
      "Masukkan nomor resi setelah mengirim barang agar status pesanan ter-update.",
    ],
  },
  {
    title: "6. Pantau Laporan",
    body: [
      "Laporan Penjualan: rekap penjualan per periode dan per toko.",
      "Laporan Stok: ringkasan stok fisik, safety stock, dan sisa yang tersedia untuk dijual.",
    ],
  },
] as const;

const FAQ = [
  {
    q: "Stok tiba-tiba berbeda dengan marketplace?",
    a: "Sinkron stok berjalan real-time saat pesanan masuk. Jika masih berbeda, jalankan sinkron ulang dari halaman Produk Marketplace atau cek halaman Stok Mismatch.",
  },
  {
    q: "Akun toko terputus / belum tersambung?",
    a: "Buka Pengaturan → Pengaturan Toko, klik Hubungkan lagi, lalu setujui akses di halaman seller. Token otomatis diperbarui.",
  },
  {
    q: "SKU di Shopee dan TikTok berbeda, boleh?",
    a: "Boleh. Yang menghubungkannya adalah Mapping Stok Terpusat — cukup sekali mapping, stok terpusat terkirim ke semua toko.",
  },
  {
    q: "Berapa lama stok tersinkron?",
    a: "Real-time via webhook saat ada pesanan masuk. Untuk perubahan massal, sistem mengirim bertahap agar tidak kena limit API marketplace.",
  },
] as const;

export default function PanduanPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Panduan Penggunaan</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ikuti langkah berurutan untuk mulai mengelola toko, produk, stok, dan pesanan dari satu dashboard.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {STEPS.map((s) => (
          <section key={s.title} className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-base font-semibold text-gray-900">{s.title}</h2>
            <ol className="space-y-2">
              {s.body.map((line) => (
                <li key={line} className="flex gap-2 text-sm leading-relaxed text-gray-600">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Pertanyaan Umum (FAQ)</h2>
        <div className="space-y-4">
          {FAQ.map((f) => (
            <div key={f.q} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
              <p className="text-sm font-medium text-gray-900">{f.q}</p>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">{f.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
