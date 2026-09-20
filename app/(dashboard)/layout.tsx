"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { Header } from "@/components/layout/header";
import { useAuthStore } from "@/stores/auth-store";
import { ThemeSwitch } from "@/components/theme-switch";
import { Search } from "@/components/search";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const accessToken = useAuthStore((state) => state.auth.accessToken);

  useEffect(() => {
    if (!accessToken) {
      router.replace("/login");
    }
  }, [accessToken, router]);

  if (!accessToken) {
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
