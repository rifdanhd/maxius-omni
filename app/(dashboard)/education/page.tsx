const TOC = [
  { id: "menu", title: "Kenalan dengan Menu" },
  { id: "masuk", title: "1. Masuk ke Akun" },
  { id: "toko", title: "2. Sambungkan Toko" },
  { id: "produk", title: "3. Produk Master & Varian" },
  { id: "mapping", title: "4. Mapping Stok Terpusat" },
  { id: "stok", title: "5. Kelola Stok" },
  { id: "sinkron", title: "6. Sinkron ke Marketplace" },
  { id: "pesanan", title: "7. Pesanan & Pengiriman" },
  { id: "laporan", title: "8. Laporan" },
  { id: "notifikasi", title: "9. Notifikasi & Kesehatan Toko" },
  { id: "harian", title: "Checklist Kerja Harian" },
  { id: "faq", title: "FAQ" },
] as const;

const MENU_TABLE = [
  ["Dashboard", "Ringkasan pesanan baru, stok, kesehatan toko, grafik penjualan, dan Panduan Awal."],
  ["Pesanan", "Kelola Pesanan untuk proses & kirim barang; Kelola Pengembalian untuk retur."],
  ["Produk", "Produk Master (satu produk + semua varian), Mapping Stok, Kelola Harga & Gambar."],
  ["Produk Marketplace", "Daftar produk per toko (Shopee/TikTok): status listing, tombol sinkron, stok platform."],
  ["Inventori", "Stok Varian, Stok Mismatch, Pengaturan (safety stock), Stok Opname, Riwayat Inventori."],
  ["Promosi", "Buat campaign diskon TikTok Shop (wizard langkah demi langkah)."],
  ["Laporan", "Laporan Penjualan (omset & produk terlaris) dan Laporan Stok (fisik/safety/tersedia)."],
  ["Pengaturan", "Pengaturan Toko: hubungkan/melihat integrasi Shopee & TikTok."],
  ["Panduan", "Halaman tutorial ini — bisa dibuka kapan saja dari menu kiri."],
] as const;

const FAQ = [
  {
    q: "Stok di aplikasi beda dengan yang tampil di marketplace?",
    a: "Buka Inventori → Stok Mismatch untuk melihat daftarnya. Biasanya karena perubahan belum selesai dikirim atau ada pesanan baru. Jalankan sinkron ulang dari Produk Marketplace; bila masih berbeda, stok varian di aplikasi adalah acuan — perbaiki dari sana, bukan dari marketplace.",
  },
  {
    q: "Kenapa SKU di Shopee dan TikTok berbeda?",
    a: "Wajar — tiap marketplace punya kode sendiri. Cukup sekali mapping di Mapping Stok Terpusat, stok terpusat akan terkirim ke semua toko yang sudah di-mapping.",
  },
  {
    q: "Kata Kesehatan Toko tertulis Token 'Hilang' / toko terputus. Bagaimana?",
    a: "Buka Pengaturan → Pengaturan Toko, klik Hubungkan lagi, lalu login & setujui akses di halaman seller. Token otomatis diperbarui dan toko langsung tersambung kembali.",
  },
  {
    q: "Stok terus berkurang sendiri, apakah normal?",
    a: "Normal — setiap pesanan baru otomatis memotong stok varian terkait supaya tidak ada penjualan ganda (oversell) di beberapa toko sekaligus.",
  },
  {
    q: "Kalau stok habis, apakah semua toko ikut kosong?",
    a: "Ya. Stok bersifat terpusat: satu angka stok dipakai bersama oleh semua toko. Saat stok habis, sistem menghentikan penjualan di semua toko untuk melindungi dari oversell.",
  },
  {
    q: "Lonceng di pojok kanan atas artinya apa?",
    a: "Notifikasi operasional — terutama stok menipis/habis. Klik lonceng untuk melihat daftarnya, lalu segera catat Barang Masuk atau restock.",
  },
  {
    q: "Ada tulisan 'Sync Error' di dashboard, harus apa?",
    a: "Artinya pengiriman data (stok/harga) ke marketplace gagal dalam 7 hari terakhir. Buka Produk Marketplace → pilih toko → Sinkron untuk menarik data terbaru; bila berulang, catat nama toko & pesannya dan hubungi admin.",
  },
  {
    q: "Lupa password?",
    a: "Hubungi admin yang membuat akun Anda untuk reset. Gunakan tombol Keluar dengan benar di akhir sesi, terutama di komputer bersama.",
  },
  {
    q: "Bisa diakses dari HP?",
    a: "Bisa via browser HP untuk cek cepat (dashboard, pesanan, stok). Untuk kerja massal (mapping, opname, cetak label) disarankan komputer/laptop.",
  },
] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 md:p-6">
      <h2 className="mb-4 text-lg font-bold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Steps({ items }: { items: readonly string[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((line, i) => (
        <li key={line} className="flex gap-3 text-sm leading-relaxed text-gray-700">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white">
            {i + 1}
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ol>
  );
}

export default function PanduanPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Panduan Penggunaan</h1>
        <p className="mt-1 text-sm text-gray-500">
          Tutorial lengkap dari login sampai laporan. Klik judul di daftar isi untuk melompat ke bagian yang dibutuhkan.
        </p>
      </div>

      {/* Daftar Isi */}
      <nav className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Daftar Isi</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TOC.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
            >
              {t.title}
            </a>
          ))}
        </div>
      </nav>

      <Section id="menu" title="Kenalan dengan Menu">
        <p className="mb-4 text-sm text-gray-600">
          Menu ada di bilah kiri. Ini ringkasan tiap menu supaya Anda tahu harus ke mana:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4">Menu</th>
                <th className="py-2">Fungsi</th>
              </tr>
            </thead>
            <tbody>
              {MENU_TABLE.map(([menu, desc]) => (
                <tr key={menu} className="border-b border-gray-100 last:border-0">
                  <td className="whitespace-nowrap py-2.5 pr-4 font-semibold text-gray-900">{menu}</td>
                  <td className="py-2.5 text-gray-700">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="masuk" title="1. Masuk ke Akun">
        <Steps
          items={[
            "Buka alamat aplikasi, masukkan username dan password yang diberikan admin.",
            "Setelah masuk, Anda langsung melihat Dashboard: pesanan baru, stok, dan kesehatan toko.",
            "Selesai bekerja? Klik tombol Keluar di bagian bawah menu kiri — wajib dilakukan di komputer bersama.",
          ]}
        />
      </Section>

      <Section id="toko" title="2. Sambungkan Toko (Shopee / TikTok Shop)">
        <Steps
          items={[
            "Buka menu Pengaturan → Pengaturan Toko.",
            "Klik Hubungkan pada toko yang ingin disambungkan (atau Tambah Marketplace bila toko belum terdaftar).",
            "Anda dibawa ke halaman resmi Shopee / TikTok. Login dengan akun seller toko tersebut, lalu setujui aksesnya.",
            "Setelah disetujui, Anda otomatis kembali ke aplikasi dan status toko menjadi tersambung (Token: OK).",
            "Ulangi langkah di atas untuk setiap toko yang dimiliki.",
          ]}
        />
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <span className="font-semibold text-gray-900">Troubleshooting:</span> toko terputus / Token tertulis
          &quot;Hilang&quot; → cukup klik Hubungkan lagi dan setujui ulang di halaman seller. Akun yang dipakai harus
          akun seller toko tersebut (bukan akun pembeli).
        </div>
      </Section>

      <Section id="produk" title="3. Produk Master & Varian">
        <Steps
          items={[
            "Buka menu Produk → Produk Master, lalu buat produk baru.",
            "Isi nama produk, SKU internal (kode sendiri, bebas), dan daftar varian — misal warna Hitam, Putih; ukuran 38, 39.",
            "Masukkan stok awal tiap varian. Satu baris produk master = semua varian yang dimiliki.",
            "Produk yang sama nantinya dipakai bersama oleh semua toko — tidak perlu membuat produk terpisah per marketplace.",
          ]}
        />
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <span className="font-semibold text-gray-900">Ingat:</span> stok selalu dihitung per varian (per SKU),
          bukan per produk induk. Ukuran &quot;L&quot; warna Hitam adalah stok tersendiri dari ukuran &quot;L&quot; warna Putih.
        </div>
      </Section>

      <Section id="mapping" title="4. Mapping Stok Terpusat">
        <Steps
          items={[
            "Buka menu Produk → Mapping Stok Terpusat.",
            "Untuk tiap varian, hubungkan dengan SKU/ID varian yang dipakai di masing-masing toko (kolom Shopee, TikTok, dst.).",
            "SKU berbeda antar toko itu NORMAL — yang menghubungkan adalah mapping ini, bukan kesamaan kode.",
            "SKU toko yang belum masuk daftar muncul di status Belum Terhubung — selesaikan mapping-nya supaya stok terpusat terkirim ke toko itu.",
          ]}
        />
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <span className="font-semibold text-gray-900">Cara cepat:</span> ambil kode SKU dari halaman listing di
          Shopee/TikTok, lalu tempel ke kolom mapping varian yang sesuai. Mapping cukup dilakukan sekali.
        </div>
      </Section>

      <Section id="stok" title="5. Kelola Stok">
        <div className="grid gap-3 md:grid-cols-2">
          {[
            ["Stok Varian", "Lihat & ubah stok fisik per varian. Ini angka acuan yang dipakai semua toko."],
            ["Barang Masuk", "Catat stok baru dari supplier agar angka stok bertambah dengan jejak yang benar."],
            ["Stok Opname", "Hitung fisik gudang berkala; selisih dengan sistem tercatat rapi di riwayat."],
            ["Pengaturan Inventori", "Atur safety stock (buffer minimum) & peringatan stok menipis per brand."],
            ["Stok Mismatch", "Daftar stok di aplikasi ≠ stok di marketplace. Perbaiki dari sini, lalu sinkron."],
            ["Riwayat Inventori", "Jejak lengkap semua perubahan stok: siapa, kapan, berapa, dan karena apa."],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="text-sm font-bold text-gray-900">{title}</div>
              <div className="mt-1 text-sm leading-relaxed text-gray-700">{desc}</div>
            </div>
          ))}
        </div>
        <ol className="mt-4 space-y-2.5">
          <li className="flex gap-3 text-sm text-gray-700">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white">1</span>
            <span>Alur normal: pesanan masuk → stok otomatis berkurang → stok menipis → Anda catat Barang Masuk.</span>
          </li>
          <li className="flex gap-3 text-sm text-gray-700">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white">2</span>
            <span>Safety stock membuat sistem membatasi stok yang boleh dijual, sehingga selalu ada cadangan minimal.</span>
          </li>
        </ol>
      </Section>

      <Section id="sinkron" title="6. Sinkron ke Marketplace">
        <Steps
          items={[
            "Perubahan stok & harga dari aplikasi terkirim otomatis ke semua toko yang sudah di-mapping.",
            "Untuk menarik data terbaru dari marketplace (nama, harga, status listing): buka Produk Marketplace → pilih toko → tombol Sinkron.",
            "Perubahan massal dikirim bertahap oleh sistem agar tidak kena limit API marketplace — tunggu sampai selesai, tidak perlu klik berulang.",
            "Jangan mengubah stok langsung di Shopee/TikTok — ubah dari aplikasi agar angkanya tidak bertabrakan.",
          ]}
        />
      </Section>

      <Section id="pesanan" title="7. Pesanan & Pengiriman">
        <Steps
          items={[
            "Pesanan dari semua toko masuk ke Pesanan → Kelola Pesanan secara otomatis.",
            "Pesanan baru langsung memotong stok varian terkait (anti oversell).",
            "Siapkan barang → proses pengiriman di marketplace → cetak label (opsi label resmi atau label lokal).",
            "Masukkan nomor resi setelah barang diserahkan ke kurir supaya status pesanan ter-update.",
            "Retur / pengembalian dari marketplace diproses di Pesanan → Kelola Pengembalian.",
          ]}
        />
      </Section>

      <Section id="laporan" title="8. Laporan">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm font-bold text-gray-900">Laporan Penjualan</div>
            <div className="mt-1 text-sm leading-relaxed text-gray-700">
              Omset per periode, perbandingan dengan periode sebelumnya, produk/varian terlaris (Winning Product),
              dan penjualan per toko.
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm font-bold text-gray-900">Laporan Stok</div>
            <div className="mt-1 text-sm leading-relaxed text-gray-700">
              Ringkasan stok fisik, safety stock, dan sisa yang benar-benar tersedia untuk dijual per varian.
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-600">
          Buka dari menu kiri → Laporan. Grafik penjualan terbaru juga tampil di Dashboard (Analisis Bisnis).
        </p>
      </Section>

      <Section id="notifikasi" title="9. Notifikasi & Kesehatan Toko">
        <div className="space-y-3 text-sm leading-relaxed text-gray-700">
          <p>
            <span className="font-semibold text-gray-900">Lonceng (pojok kanan atas):</span> daftar peringatan stok
            menipis/habis. Klik untuk melihat, lalu segera restock lewat Barang Masuk.
          </p>
          <p>
            <span className="font-semibold text-gray-900">Kesehatan Operasional (Dashboard):</span> Stok Central,
            Stok Kritis, Stok Mismatch, dan Sync Error (7 hari) — angka yang harus dijaga tetap aman.
          </p>
          <p>
            <span className="font-semibold text-gray-900">Kesehatan Toko (Dashboard):</span> status tiap toko —
            Token, jumlah error, mismatch, dan SKU belum mapping. Titik gelap berarti perlu perhatian.
          </p>
          <p>
            <span className="font-semibold text-gray-900">Panduan Awal (Dashboard):</span> checklist 6 langkah
            penyiapan yang menyesuaikan otomatis dengan kondisi data Anda — klik tiap langkah untuk langsung ke
            halaman kerjanya.
          </p>
        </div>
      </Section>

      <Section id="harian" title="Checklist Kerja Harian">
        <ol className="space-y-2.5">
          {[
            "Buka Dashboard — cek lonceng notifikasi & kartu Stok Kritis.",
            "Cek Pesanan → Siap Dikirim, proses semua yang bisa dikirim hari ini, catat resinya.",
            "Pantau Sync Error (7 hari) & Stok Mismatch — bila ada angka > 0, tuntaskan hari itu juga.",
            "Stok menipis? Catat Barang Masuk dari supplier sebelum kehabisan.",
            "Sekali seminggu: jalankan Sinkron di Produk Marketplace & cek Laporan Penjualan.",
          ].map((line, i) => (
            <li key={line} className="flex gap-3 text-sm leading-relaxed text-gray-700">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-gray-300 text-[11px] font-bold text-gray-500">
                {i + 1}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="faq" title="FAQ (Pertanyaan Umum)">
        <div className="space-y-4">
          {FAQ.map((f) => (
            <div key={f.q} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
              <p className="text-sm font-semibold text-gray-900">{f.q}</p>
              <p className="mt-1 text-sm leading-relaxed text-gray-700">{f.a}</p>
            </div>
          ))}
        </div>
      </Section>

      <p className="pb-4 text-center text-xs text-gray-400">
        Panduan ini bisa dibuka kapan saja dari menu Panduan di bilah kiri.
      </p>
    </div>
  );
}
