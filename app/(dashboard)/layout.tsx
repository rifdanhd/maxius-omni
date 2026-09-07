"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";
import { Bell, Download, Radio } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [username, setUsername] = useState<string>("");

  useEffect(() => {
    // Basic client-side auth check
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
    } else {
      setUsername(localStorage.getItem("username") || "Dermarket");
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-[#f3f4f6] flex font-sans">
      <Sidebar />

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Topbar */}
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0 z-10">
          <div className="flex-1"></div>
          <div className="flex items-center gap-4">
            <button className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Radio size={16} /> Mode Livestream
            </button>
            <button className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 border border-gray-200">
              <Download size={16} />
            </button>
            <button className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 border border-gray-200 relative">
              <Bell size={16} />
              <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>
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
