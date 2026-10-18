import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

const TITLE = "MAXIUS - One central stock for all your online stores";
const DESCRIPTION =
  "MAXIUS connects your marketplace stores to one central stock. Manage products, mapping, orders, and stock history in one dashboard.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
};

const FEATURES = [
  {
    title: "Central product catalog",
    desc: "Keep all product information in one place and reuse it for every connected store.",
  },
  {
    title: "Product mapping across stores",
    desc: "Map each product and its variants to the matching SKU on every marketplace, even when IDs differ.",
  },
  {
    title: "Central stock with automatic sync",
    desc: "One stock source for all stores. Updates are pushed to connected marketplaces automatically.",
  },
  {
    title: "Order sync in one dashboard",
    desc: "Orders from all connected stores are collected in one dashboard, so you work from a single list.",
  },
  {
    title: "Stock history and stock opname",
    desc: "Review stock movements over time and run physical counts with a guided stock opname flow.",
  },
  {
    title: "Multi-store authorization",
    desc: "Connect multiple stores through the official marketplace OAuth authorization flow.",
  },
];

const STEPS = [
  {
    title: "Connect your stores",
    desc: "Authorize each marketplace store with the official OAuth flow.",
  },
  {
    title: "Map your products",
    desc: "Link your catalog items to the SKUs used on each platform.",
  },
  {
    title: "Manage stock and orders",
    desc: "Control one central stock and see all orders in one dashboard.",
  },
];

const SCREENSHOTS = [
  { src: "/images/placeholder-catalog.svg", alt: "Placeholder for the product catalog screen" },
  { src: "/images/placeholder-stock.svg", alt: "Placeholder for the stock dashboard screen" },
  { src: "/images/placeholder-orders.svg", alt: "Placeholder for the order list screen" },
];

export default function LandingPage() {
  return (
    <div className="max-w-6xl mx-auto px-6">
      {/* Hero */}
      <section className="pt-16 pb-14 text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight max-w-3xl mx-auto">
          One central stock for all your online stores
        </h1>
        <p className="mt-5 text-muted-foreground max-w-2xl mx-auto text-base md:text-lg">
          MAXIUS connects your marketplace stores to one central stock, so every store shows the same availability and every order lands in one dashboard.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/login"
            className="px-6 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary"
          >
            Login
          </Link>
          <a
            href="#contact"
            className="px-6 py-3 rounded-xl border border-border text-sm font-semibold text-foreground hover:bg-muted"
          >
            Contact us
          </a>
        </div>
      </section>

      {/* Problem */}
      <section className="pb-14">
        <div className="rounded-2xl border border-border bg-muted/60 p-8">
          <h2 className="text-2xl font-bold text-center">The problem we solve</h2>
          <p className="mt-4 text-muted-foreground max-w-3xl mx-auto text-center">
            Sellers who run multiple online stores often update stock by hand, one store at a time. The list on each store gets out of date, and that leads to overselling items that were already sold, or hiding stock that was actually available. Both cost time and money.
          </p>
          <p className="mt-3 text-foreground max-w-3xl mx-auto text-center">
            MAXIUS removes the manual step: your stores read from one central stock.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="pb-14">
        <h2 className="text-2xl font-bold text-center">Main features</h2>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="pb-14">
        <h2 className="text-2xl font-bold text-center">How it works</h2>
        <div className="mt-8 grid md:grid-cols-3 gap-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-2xl border border-border bg-card p-5">
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center">
                {i + 1}
              </div>
              <h3 className="font-semibold mt-3">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Screenshots */}
      <section className="pb-14">
        <h2 className="text-2xl font-bold text-center">Inside the dashboard</h2>
        {/* TODO: Replace placeholder images under public/images/ with real dashboard screenshots. */}
        <p className="mt-2 text-sm text-muted-foreground text-center">
          Screenshots below are placeholders and will be replaced with real views of the dashboard.
        </p>
        <div className="mt-8 grid sm:grid-cols-3 gap-4">
          {SCREENSHOTS.map((s) => (
            <div key={s.src} className="rounded-2xl border border-border overflow-hidden bg-muted/60">
              <Image
                src={s.src}
                alt={s.alt}
                width={1200}
                height={750}
                className="w-full h-auto"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Data and security */}
      <section className="pb-14">
        <div className="rounded-2xl border border-border bg-muted/60 p-8">
          <h2 className="text-2xl font-bold">Data and security</h2>
          <ul className="mt-4 text-muted-foreground space-y-2 text-sm max-w-3xl list-disc pl-5">
            <li>MAXIUS only requests the API permissions required for products, stock, and orders.</li>
            <li>Seller data is used to run those features and is not shared with third parties.</li>
            <li>Store authorizations are handled through the official marketplace OAuth flow.</li>
          </ul>
          <p className="mt-4 text-sm">
            <Link href="/privacy-policy" className="font-semibold text-foreground hover:underline">
              Read the Privacy Policy
            </Link>
          </p>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="pb-16">
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <h2 className="text-2xl font-bold">Contact us</h2>
          <p className="mt-3 text-muted-foreground">
            Questions about the product or the review of this application? Send an email and we will reply.
          </p>
          <p className="mt-4 font-semibold text-foreground">
            <a href="mailto:support@maxius.id" className="hover:underline">
              support@maxius.id
            </a>
          </p>
          {/* TODO: Confirm the official contact email registered with the business. */}
        </div>
      </section>
    </div>
  );
}
