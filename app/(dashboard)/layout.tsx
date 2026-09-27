"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { Header } from "@/components/layout/header";
import { useAuthStore } from "@/stores/auth-store";
import { ThemeSwitch } from "@/components/theme-switch";
import { Search } from "@/components/search";
import BrandSwitcher from "@/components/layout/BrandSwitcher";

// Tidak ada sumber data eksternal yang berubah — subscribe hanya untuk
// memenuhi kontrak useSyncExternalStore.
const subscribeNoop = () => () => {};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAuthStore((state) => state.auth.accessToken);
  // Token berasal dari localStorage: server & render pertama client SAMA-SAMA
  // kosong. Tanpa gate ini cabangnya beda saat hydration → React gagal
  // (Recoverable Error) dan dev overlay menutupi halaman (E2E tidak bisa klik).
  // useSyncExternalStore: snapshot server = false, client = true, tanpa
  // setState di dalam effect (larangan react-hooks/set-state-in-effect).
  const hydrated = useSyncExternalStore(subscribeNoop, () => true, () => false);

  useEffect(() => {
    if (!accessToken) {
      router.replace("/login");
    }
  }, [accessToken, router]);

  if (!hydrated || !accessToken) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">
        Memeriksa sesi...
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
        <Header>
          <div className="flex items-center gap-2 md:gap-4">
            <BrandSwitcher />
            <Search />
            <ThemeSwitch />
          </div>
        </Header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          {children}
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
