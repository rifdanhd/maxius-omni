import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  Footprints,
  Leaf,
  Wind,
  Ruler,
  Sparkles,
  Truck,
  ArrowRight,
  Check,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "KausKaki.id — Kaos Kaki Nyaman Sehari-hari",
  description:
    "Jual kaos kaki premium: katun lembut, anti-bau, tersedia segala ukuran. Pengiriman cepat ke seluruh Indonesia.",
};

const PRODUCTS = [
  {
    name: "Everyday Cotton",
    price: "Rp29.000",
    tag: "Best seller",
    colors: ["bg-primary", "bg-muted-foreground", "bg-card border"],
    desc: "Katun combed 24s, adem dipakai seharian.",
  },
  {
    name: "Sport Ankle",
    price: "Rp39.000",
    tag: "Olahraga",
    colors: ["bg-primary", "bg-muted-foreground", "bg-primary"],
    desc: "Rib kaki stabil, kering cepat saat lari.",
  },
  {
    name: "Knee High Stripe",
    price: "Rp45.000",
    tag: "Pilihan baru",
    colors: ["bg-muted-foreground", "bg-muted-foreground", "bg-primary"],
    desc: "Setinggi lutut, motif stripe klasik.",
  },
  {
    name: "Wool Warm",
    price: "Rp59.000",
    tag: "Musim dingin",
    colors: ["bg-primary", "bg-primary", "bg-primary"],
    desc: "Wool blend tebal, hangat tanpa gerah.",
  },
];

const FEATURES = [
  {
    icon: Leaf,
    title: "Katun Premium",
    desc: "Benang combed lembut, tidak mudah kusut dan tidak melar setelah dicuci berkali-kali.",
  },
  {
    icon: Wind,
    title: "Anti Bau & Adem",
    desc: "Teknologi serat berlubang menjaga kaki tetap kering dan bebas bau seharian.",
  },
  {
    icon: Ruler,
    title: "Ukuran Lengkap",
    desc: "Dari 35–45, tersedia reguler, besar, hingga versi khusus pria dan wanita.",
  },
  {
    icon: Footprints,
    title: "Pas di Kaki",
    desc: "Toe seam halus dan tumit Y-heel membuat kaos kaki tidak bergeser.",
  },
  {
    icon: Sparkles,
    title: "Anti Pilling",
    desc: "Dirajut rapat agar awet dan tetap rapi meski sudah 50+ kali cuci.",
  },
  {
    icon: Truck,
    title: "Kirim Se-Indonesia",
    desc: "Packing rapi, kirim hari ini juga untuk pesanan sebelum pukul 15.00.",
  },
];

const STEPS = [
  { n: "1", title: "Pilih gaya", desc: "Pilih warna, panjang, dan bahan sesuai aktivitas kamu." },
  { n: "2", title: "Tentukan ukuran", desc: "Gunakan panduan ukuran kami supaya pas sejak pasangan pertama." },
  { n: "3", title: "Terima di rumah", desc: "Dikirim cepat, bisa tukar ukuran gratis bila belum cocok." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-card text-foreground font-sans">
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="relative h-10 w-10 block">
              <Image src="/Logo/Logo_backroundNO.png" alt="KausKaki.id" fill className="object-contain" priority />
            </span>
            <span className="font-bold text-lg">KausKaki.id</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-foreground">
            <a href="#koleksi" className="hover:text-foreground">Koleksi</a>
            <a href="#keunggulan" className="hover:text-foreground">Keunggulan</a>
            <a href="#cara-beli" className="hover:text-foreground">Cara Beli</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="text-sm font-medium px-4 py-2 rounded-lg text-foreground hover:bg-muted">Masuk</Link>
            <Link href="/dashboard" className="text-sm font-semibold px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary flex items-center gap-1">
              Belanja <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 text-center">
          <div className="flex justify-center mb-4">
            <span className="relative h-16 w-16 block">
              <Image src="/Logo/Logo_backroundNO.png" alt="KausKaki.id" fill className="object-contain" priority />
            </span>
          </div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold bg-muted text-foreground border border-border rounded-full px-3 py-1 mb-5">
            <span className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" />
            Gratis ongkir untuk belanja di atas Rp150.000
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
            Kaos kaki yang enak
            <br className="hidden md:block" /> dipakai seharian.
          </h1>
          <p className="mt-5 text-foreground max-w-2xl mx-auto text-base md:text-lg">
            Dibuat dari katun premium, adem, anti-bau, dan pas di kaki.
            Tersedia segala warna dan ukuran untuk kerja, olahraga, sampai
            santai di rumah.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <a href="#koleksi" className="px-6 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary flex items-center gap-2">
              Lihat Koleksi <ArrowRight size={16} />
            </a>
            <a href="#keunggulan" className="px-6 py-3 rounded-xl border border-border text-sm font-semibold text-foreground hover:bg-muted">Kenapa Kami</a>
          </div>
          <div className="mt-6 flex items-center justify-center gap-5 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1"><Check size={14} className="text-foreground" /> Katun lembut</span>
            <span className="flex items-center gap-1"><Check size={14} className="text-foreground" /> Anti-bau</span>
            <span className="flex items-center gap-1"><Check size={14} className="text-foreground" /> Ukuran 35–45</span>
          </div>
        </section>

        <section className="border-y border-border bg-muted/60">
          <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-center gap-3 md:gap-10 text-sm font-semibold text-foreground">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Dipercaya oleh</span>
            <span className="px-4 py-2 bg-card border border-border rounded-lg">20.000+ pelanggan</span>
            <span className="px-4 py-2 bg-card border border-border rounded-lg">Rating 4.9/5</span>
            <span className="px-4 py-2 bg-card border border-border rounded-lg">Tukar ukuran gratis</span>
          </div>
        </section>

        <section id="koleksi" className="max-w-6xl mx-auto px-6 pb-14 pt-14">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold">Koleksi unggulan</h2>
            <p className="text-sm text-muted-foreground mt-1">Empat model paling laris bulan ini.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PRODUCTS.map((p) => (
              <Card key={p.name} className="hover:border-primary transition-colors">
                <CardContent className="p-5 pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    {p.colors.map((c, i) => (
                      <span key={i} className={`w-6 h-6 rounded-full ${c}`} />
                    ))}
                  </div>
                  <Badge variant="secondary" className="mb-2">{p.tag}</Badge>
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{p.desc}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-bold">{p.price}</span>
                    <Link href="#cara-beli" className="text-xs font-semibold text-foreground hover:text-foreground">Lihat →</Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section id="keunggulan" className="max-w-6xl mx-auto px-6 pb-14">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold">Keunggulan</h2>
            <p className="text-sm text-muted-foreground mt-1">Detail kecil yang bikin beda di kaki kamu.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <Card key={f.title} className="hover:border-primary transition-colors">
                <CardContent className="p-5 pt-6">
                  <f.icon size={20} className="text-foreground mb-3" />
                  <h3 className="font-semibold mt-1">{f.title}</h3>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section id="cara-beli" className="bg-primary text-primary-foreground">
          <div className="max-w-6xl mx-auto px-6 py-14">
            <div className="text-center mb-10">
              <h2 className="text-2xl font-bold">Cara beli</h2>
              <p className="text-sm text-primary-foreground mt-1">Tiga langkah, langsung sampai rumah.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              {STEPS.map((s) => (
                <div key={s.n} className="bg-card/5 border border-primary-foreground/30 rounded-2xl p-5">
                  <div className="w-8 h-8 rounded-full bg-card text-foreground font-bold text-sm flex items-center justify-center">{s.n}</div>
                  <h3 className="font-semibold mt-3">{s.title}</h3>
                  <p className="text-sm text-primary-foreground mt-1">{s.desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <a href="#koleksi" className="px-6 py-3 rounded-xl bg-card text-foreground text-sm font-semibold hover:bg-muted flex items-center gap-2">
                Mulai belanja <ArrowRight size={16} />
              </a>
              <Link href="/login" className="px-6 py-3 rounded-xl border border-primary-foreground/40 text-sm font-semibold hover:bg-card/10">Masuk</Link>
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 py-14">
          <div className="bg-muted border border-border rounded-2xl p-8 grid md:grid-cols-2 gap-8 items-center">
            <div>
              <h2 className="text-2xl font-bold mb-3">Pernah merasakan ini?</h2>
              <ul className="text-sm text-foreground space-y-2 list-disc pl-5">
                <li>Kaos kaki melar, melorot, dan harus ditarik terus.</li>
                <li>Kaki cepat bau karena bahan yang tidak menyerap keringat.</li>
                <li>Beli online, ternyata ukuran kekecilan dan ribet tukar.</li>
              </ul>
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-3">Dengan KausKaki.id…</h2>
              <ul className="text-sm text-foreground space-y-2 list-disc pl-5">
                <li>Pas di kaki sejak pasangan pertama, tidak melar.</li>
                <li>Katun premium yang adem dan anti-bau seharian.</li>
                <li>Tukar ukuran gratis dalam 7 hari, tanpa ribet.</li>
              </ul>
              <div className="mt-4 flex gap-2">
                <Badge variant="default">Katun Premium</Badge>
                <Badge variant="secondary">Anti Bau</Badge>
                <Badge variant="outline">Tukar Gratis</Badge>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} KausKaki.id — semua hak cipta dilindungi</span>
          <div className="flex items-center gap-4">
            <a href="#koleksi" className="hover:text-foreground">Koleksi</a>
            <Link href="/login" className="hover:text-foreground">Masuk</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
