import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";

// TODO: Konfirmasi nama bisnis sesuai NIB dan email resmi untuk footer.
const BUSINESS_NAME = "Maxius Indonesia";
const CONTACT_EMAIL = "support@maxius.id";

export default function PublicLayout({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-screen flex flex-col bg-card text-foreground font-sans">
      <header className="border-b border-border bg-card/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="relative h-9 w-9 block">
              <Image src="/Logo/maxius-mark.png" alt="MAXIUS" fill className="object-contain" priority />
            </span>
            <span className="font-bold text-lg tracking-tight">MAXIUS</span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/privacy-policy" className="hidden sm:inline px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hidden sm:inline px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground">
              Terms
            </Link>
            <Link
              href="/login"
              className="px-4 py-2 rounded-lg font-semibold bg-primary text-primary-foreground hover:bg-primary"
            >
              Login
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-muted/60">
        <div className="max-w-6xl mx-auto px-6 py-8 grid gap-6 md:grid-cols-3 text-sm">
          <div>
            <p className="font-semibold text-foreground">{BUSINESS_NAME}</p>
            <p className="mt-1 text-muted-foreground">MAXIUS (maxius.id)</p>
          </div>
          <div>
            <p className="text-muted-foreground">
              Contact:{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-foreground hover:underline">
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>
          <div className="flex md:justify-end items-start gap-4">
            <Link href="/privacy-policy" className="text-muted-foreground hover:text-foreground">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-muted-foreground hover:text-foreground">
              Terms of Service
            </Link>
          </div>
        </div>
        <div className="border-t border-border">
          <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-muted-foreground">
            <p>&copy; {year} {BUSINESS_NAME}. All rights reserved.</p>
            <p className="mt-1">
              MAXIUS is an independent service and is not affiliated with TikTok or TikTok Shop.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
