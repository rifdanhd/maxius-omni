import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  Boxes,
  Zap,
  ShieldCheck,
  BarChart3,
  Warehouse,
  Link2,
  ArrowRight,
  Check,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export const metadata: Metadata = {
  title: "Maxius.id — Sinkronisasi Stok Omnichannel",
  description:
    "Platform omnichannel stock sync Indonesia: cegah oversell, sinkronisasi stok real-time via webhook untuk Shopee, Tokopedia, dan TikTok Shop.",
};

const FEATURES = [
  {
    icon: Boxes,
    title: "Stok Central per Varian",
    desc: "Satu angka stok pusat per varian (warna/ukuran), bukan per produk induk. Akurat hingga puluhan ribu SKU.",
  },
  {
    icon: Link2,
    title: "Mapping SKU per Marketplace",
    desc: "Setiap varian dipetakan ke SKU/ID berbeda di tiap marketplace via PlatformSkuMapping. Tidak ada lagi asumsi ID sama.",
  },
  {
    icon: Zap,
    title: "Webhook Real-time",
    desc: "Update stok terpicu webhook saat ada order, bukan polling. Mencegah oversell di detik yang sama.",
  },
  {
    icon: ShieldCheck,
    title: "Safety Stock Buffer",
    desc: "Cadangan pengaman per varian agar tampilan marketplace tidak pernah menjual stok yang tidak ada.",
  },
  {
    icon: BarChart3,
    title: "Batching Anti Rate-limit",
    desc: "Update ke API marketplace di-batch via antrean agar aman dari rate limit saat order membludak.",
  },
  {
    icon: Warehouse,
    title: "WMS + Laporan",
    desc: "Inbound/outbound gudang, stok opname, riwayat inventori, dan analitik penjualan per toko.",
  },
];

const STEPS = [
  { n: "1", title: "Hubungkan toko", desc: "Koneksikan akun Shopee, Tokopedia, dan TikTok Shop via halaman Pengaturan Toko." },
  { n: "2", title: "Mapping SKU", desc: "Petakan tiap varian master ke SKU marketplace masing-masing satu kali." },
  { n: "3", title: "Jualan tanpa oversell", desc: "Setiap order masuk via webhook langsung mengurangi stok central dan menyebar ke semua channel." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="relative h-10 w-10 block">
              <Image src="/Logo/Logo_backroundNO.png" alt="Maxius.id" fill className="object-contain" priority />
            </span>
            <span className="font-bold text-lg">Maxius.id</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-gray-600">
            <a href="#fitur" className="hover:text-gray-900">Fitur</a>
            <a href="#cara-kerja" className="hover:text-gray-900">Cara Kerja</a>
            <a href="#marketplace" className="hover:text-gray-900">Marketplace</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="text-sm font-medium px-4 py-2 rounded-lg text-gray-700 hover:bg-gray-100">Masuk</Link>
            <Link href="/dashboard" className="text-sm font-semibold px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-black flex items-center gap-1">
              Buka Dashboard <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1 mb-5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live — maxius.id sudah online
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
            Sinkronisasi stok omnichannel,
            <br className="hidden md:block" /> tanpa oversell.
          </h1>
          <p className="mt-5 text-gray-600 max-w-2xl mx-auto text-base md:text-lg">
            Maxius Indonesia menyatukan stok Shopee, Tokopedia, dan TikTok Shop
            ke satu stok central per varian. Order masuk via webhook, stok
            terpotong real-time di semua channel.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/dashboard" className="px-6 py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-black flex items-center gap-2">
              Buka Dashboard <ArrowRight size={16} />
            </Link>
            <a href="#fitur" className="px-6 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">Lihat Fitur</a>
          </div>
          <div className="mt-6 flex items-center justify-center gap-5 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Check size={14} className="text-emerald-600" /> Webhook real-time</span>
            <span className="flex items-center gap-1"><Check size={14} className="text-emerald-600" /> Safety stock</span>
            <span className="flex items-center gap-1"><Check size={14} className="text-emerald-600" /> Puluhan ribu SKU</span>
          </div>
        </section>

        <section id="marketplace" className="border-y border-gray-100 bg-gray-50/60">
          <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-center gap-3 md:gap-10 text-sm font-semibold text-gray-700">
            <span className="text-xs uppercase tracking-wider text-gray-400 font-bold">Terhubung dengan</span>
            <span className="px-4 py-2 bg-white border border-gray-200 rounded-lg">Shopee</span>
            <span className="px-4 py-2 bg-white border border-gray-200 rounded-lg">Tokopedia</span>
            <span className="px-4 py-2 bg-white border border-gray-200 rounded-lg">TikTok Shop</span>
          </div>
        </section>

        <section id="fitur" className="max-w-6xl mx-auto px-6 pb-14 pt-14">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold">Fitur inti</h2>
            <p className="text-sm text-muted-foreground mt-1">Dibangun untuk correctness stok, bukan sekadar pajangan.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <Card key={f.title} className="hover:border-gray-900 transition-colors">
                <CardContent className="p-5 pt-6">
                  <f.icon size={20} className="text-gray-900 mb-3" />
                  <h3 className="font-semibold mt-1">{f.title}</h3>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section id="cara-kerja" className="bg-gray-900 text-white">
          <div className="max-w-6xl mx-auto px-6 py-14">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-bold">Cara kerja</h2>
              <p className="text-sm text-gray-400 mt-1">Tiga langkah, sekali setting.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              {STEPS.map((s) => (
                <div key={s.n} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <div className="w-8 h-8 rounded-full bg-white text-gray-900 font-bold text-sm flex items-center justify-center">{s.n}</div>
                  <h3 className="font-semibold mt-3">{s.title}</h3>
                  <p className="text-sm text-gray-400 mt-1">{s.desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <Link href="/login" className="px-6 py-3 rounded-xl bg-white text-gray-900 text-sm font-semibold hover:bg-gray-100 flex items-center gap-2">
                Masuk untuk mulai <ArrowRight size={16} />
              </Link>
              <Link href="/dashboard" className="px-6 py-3 rounded-xl border border-white/20 text-sm font-semibold hover:bg-white/10">Buka Dashboard</Link>
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 py-14">
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 grid md:grid-cols-2 gap-8 items-center">
            <div>
              <h2 className="text-2xl font-bold mb-3">Tanpa sinkron yang benar…</h2>
              <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
                <li>Oversell → refund, penalti marketplace, rating turun.</li>
                <li>Stok tampil rendah padahal ada → kehilangan penjualan.</li>
                <li>Update manual / polling lambat → selisih stok antar channel.</li>
              </ul>
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-3">Dengan Maxius…</h2>
              <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
                <li>Satu stok central per varian, satu kebenaran untuk semua channel.</li>
                <li>Webhook real-time + antrean batching yang tahan rate limit.</li>
                <li>Safety-stock buffer + deteksi mismatch & sync error 7 hari.</li>
              </ul>
              <div className="mt-4 flex gap-2">
                <Badge variant="default">Webhook</Badge>
                <Badge variant="secondary">Safety Stock</Badge>
                <Badge variant="outline">10k+ SKU</Badge>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Maxius.id — Maxius Indonesia</span>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-gray-900">Masuk</Link>
            <Link href="/dashboard" className="hover:text-gray-900">Dashboard</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
