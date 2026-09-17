"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";
import NotificationBell from "@/components/layout/NotificationBell";
import BrandSwitcher from "@/components/layout/BrandSwitcher";
import { Download, Radio } from "lucide-react";

const subscribe = () => () => {};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const token = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem("token"),
    () => null
  );
  const username = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem("username") || "Dermarket",
    () => "Dermarket"
  );

  useEffect(() => {
    if (token !== null) return;
    // Token null saat full page load BELUM tentu berarti logged out: waktu
    // hydrate, hook sempat menyerahkan server snapshot (null) padahal token
    // valid ada di localStorage. Verifikasi ulang nilai LIVE secara async
    // sebelum redirect — cegah bounce paksa sesi valid ke /login.
    const t = setTimeout(() => {
      if (localStorage.getItem("token") === null) {
        router.replace("/login");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [token, router]);

  if (token === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">
        Memeriksa sesi...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] flex font-sans">
      <Sidebar />

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Topbar */}
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0 z-10">
          <div className="flex-1"></div>
          <div className="flex items-center gap-4">
            <BrandSwitcher />
            <button className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Radio size={16} /> Mode Livestream
            </button>
            <button className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 border border-gray-200">
              <Download size={16} />
            </button>
            <NotificationBell />
            <div className="flex items-center gap-2 border-l border-gray-200 pl-4 cursor-pointer">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                {username?.slice(0, 1).toUpperCase() || 'D'}
              </div>
              <span className="text-sm font-medium text-gray-700">{username}</span>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
