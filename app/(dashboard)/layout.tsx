"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { Header } from "@/components/layout/header";
import { useAuthStore } from "@/stores/auth-store";
import { ThemeSwitch } from "@/components/theme-switch";
import { Search } from "@/components/search";
import NotificationBell from "@/components/layout/NotificationBell";

// Tidak ada sumber data eksternal yang berubah — subscribe hanya untuk
// memenuhi kontrak useSyncExternalStore.
const subscribeNoop = () => () => {};

// Map pathname ke judul halaman yang readable
const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/orders": "Kelola Pesanan",
  "/orders/returns": "Kelola Pengembalian",
  "/products": "Produk Master",
  "/products/mapping": "Mapping Stok Terpusat",
  "/products/prices": "Kelola Harga",
  "/products/images": "Kelola Gambar",
  "/products/copy": "Product Copy",
  "/inventory": "Stok Varian",
  "/inventory/mismatch": "Stok Mismatch",
  "/inventory/settings": "Pengaturan Inventori",
  "/inventory/opname": "Stok Opname",
  "/inventory/history": "Riwayat Inventori",
  "/promotions": "Promosi",
  "/reports/sales": "Laporan Penjualan",
  "/reports/stock": "Laporan Stok",
  "/settings/accounts": "Pengaturan Toko",
  "/settings/account": "Akun Saya",
  "/education": "Panduan",
  "/logs": "Log Sistem",
  "/wms": "WMS",
  "/customers": "Pelanggan",
  "/chat": "Chat",
  "/market": "Market",
};

function getPageTitle(pathname: string): string {
  // Direct match
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  // Prefix match (e.g. /products/mapping/123)
  const match = Object.keys(PAGE_TITLES)
    .filter((k) => pathname.startsWith(k + "/"))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return PAGE_TITLES[match];
  return "Maxius";
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const authenticated = useAuthStore((state) => state.auth.authenticated);
  const checked = useAuthStore((state) => state.auth.checked);
  // Token berasal dari localStorage: server & render pertama client SAMA-SAMA
  // kosong. Tanpa gate ini cabangnya beda saat hydration → React gagal
  // (Recoverable Error) dan dev overlay menutupi halaman (E2E tidak bisa klik).
  // useSyncExternalStore: snapshot server = false, client = true, tanpa
  // setState di dalam effect (larangan react-hooks/set-state-in-effect).
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);

  useEffect(() => {
    if (!checked) { void useAuthStore.getState().auth.loadSession(); return; }
    if (!authenticated) {
      router.replace("/login");
    }
  }, [authenticated, checked, router]);

  if (!hydrated || !checked || !authenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
        <div className="w-6 h-6 rounded-full border-2 border-muted border-t-foreground animate-spin" />
        <span>Memeriksa sesi...</span>
      </div>
    );
  }

  const pageTitle = getPageTitle(pathname);

  return (
    <AuthenticatedLayout>
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden min-w-0">
        <Header>
          <div className="flex-1 flex items-center min-w-0">
            <span className="text-sm font-semibold text-foreground truncate">{pageTitle}</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 md:gap-3 shrink-0">
            <NotificationBell />
            <Search />
            <ThemeSwitch />
          </div>
        </Header>
        <div id="content" tabIndex={-1} className="flex-1 min-h-0 min-w-0 overflow-auto overscroll-y-contain">
          {children}
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
