"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import {
  Home, ShoppingBag, Package, Warehouse, Tag, MessageSquare,
  Users, BarChart2, Settings, ChevronDown, ChevronUp, ClipboardList,
  Compass, Grid2x2, BookOpen, Boxes, MessageCircle, Rss, ArrowLeftToLine, ArrowRightToLine, LogOut
} from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";

type MenuChild = { key: string; label: string; href?: string; submenu?: boolean };
type MenuGroup = { key: string; icon: LucideIcon; label: string; children: MenuChild[] };
type MenuLink = { key: string; icon: LucideIcon; label: string; href: string };
type MenuItem = MenuGroup | MenuLink;

const MENU: MenuItem[] = [
  { key: "dashboard", icon: Home, label: "Dashboard", href: "/dashboard" },
  {
    key: "pesanan",
    icon: ShoppingBag,
    label: "Pesanan",
    children: [
      { key: "kelola-pesanan", label: "Kelola Pesanan", href: "/orders" },
      { key: "kelola-pengembalian", label: "Kelola Pengembalian", href: "/orders/returns" },
    ],
  },
  {
    key: "produk",
    icon: Package,
    label: "Produk",
    children: [
      { key: "produk-master", label: "Produk Master", href: "/products" },
      { key: "mapping-stok", label: "Mapping Stok Terpusat", href: "/products/mapping" },
      { key: "kelola-harga", label: "Kelola Harga", href: "/products/prices" },
      { key: "kelola-gambar", label: "Kelola Gambar", href: "/products/images" },
      { key: "product-copy", label: "Product Copy", href: "/products/copy" },
      { key: "produk-marketplace", label: "Produk Marketplace", submenu: true },
    ],
  },
  {
    key: "inventori",
    icon: Boxes,
    label: "Inventori",
    children: [
      { key: "stok-varian", label: "Stok Varian", href: "/inventory" },
      { key: "stok-mismatch", label: "Stok Mismatch", href: "/inventory/mismatch" },
      { key: "pengaturan-inventori", label: "Pengaturan Inventori", href: "/inventory/settings" },
      { key: "stok-opname", label: "Stok Opname", href: "/inventory/opname" },
      { key: "riwayat-inventori", label: "Riwayat Inventori", href: "/inventory/history" },
    ],
  },
  { 
    key: "wms", 
    icon: Warehouse, 
    label: "WMS",
    children: [
      { key: "inbound", label: "Inbound", href: "/wms/inbound" },
      { key: "outbound", label: "Outbound", href: "/wms/outbound" },
      { key: "gudang", label: "Gudang", href: "/wms/warehouse" },
      { key: "kelola-rak", label: "Kelola Rak", href: "/wms/racks" },
    ],
  },
  { key: "promosi", icon: Tag, label: "Promosi", href: "/promotions" },
  { key: "chat", icon: MessageSquare, label: "Chat", href: "/chat" },
  { key: "pelanggan", icon: Users, label: "Daftar Pelanggan", href: "/customers" },
  {
    key: "laporan",
    icon: BarChart2,
    label: "Laporan",
    children: [
      { key: "laporan-penjualan", label: "Laporan Penjualan", href: "/reports/sales" },
      { key: "laporan-stok", label: "Laporan Stok", href: "/reports/stock" },
    ],
  },
  {
    key: "pengaturan",
    icon: Settings,
    label: "Pengaturan",
    children: [
      { key: "akun-toko", label: "Pengaturan Toko", href: "/settings/accounts" },
      { key: "pengguna", label: "Kelola Pengguna", href: "/settings/users" },
    ],
  },
  { key: "log-aktivitas", icon: ClipboardList, label: "Log Aktivitas", href: "/logs" },
  { key: "market", icon: Compass, label: "Market", href: "/market" },
  {
    key: "aplikasi",
    icon: Grid2x2,
    label: "Aplikasi",
    children: [{ key: "koneksi-api", label: "Koneksi API", href: "/apps/api-connections" }],
  },
  { key: "pusat-edukasi", icon: BookOpen, label: "Pusat Edukasi", href: "/education" },
];

type ConnectedPlatform = { key: string; label: string; href: string };

function isMenuLink(item: MenuItem): item is MenuLink {
  return "href" in item;
}

function isMenuGroup(item: MenuItem): item is MenuGroup {
  return "children" in item;
}

// Cache session-level agar submenu marketplace tidak fetch ulang tiap render/remount.
let accountsCache: ConnectedPlatform[] | null = null;

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ produk: true });
  const [marketplaceOpen, setMarketplaceOpen] = useState(true);
  const [platforms, setPlatforms] = useState<ConnectedPlatform[]>(() => accountsCache ?? []);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (accountsCache) return;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await authFetch("/api/accounts/connected", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const d = (await res.json()) as { platforms?: ConnectedPlatform[] };
        if (!cancelled && d.platforms) {
          accountsCache = d.platforms;
          setPlatforms(d.platforms);
        }
      } catch {
        // Sidebar tetap render; submenu kosong hingga fetch berhasil.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "ngrok-skip-browser-warning": "true" },
      });
    } catch {
      // Bersihkan localStorage tetap jalan meski API tidak tercapai.
    }
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    router.push("/login");
  }

  function toggleGroup(key: string) {
    if (collapsed) setCollapsed(false);
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function isItemActive(item: MenuItem) {
    if (isMenuLink(item)) return pathname === item.href;
    return item.children.some((c) => c.href === pathname);
  }

  function platformActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside className={`${collapsed ? 'w-20' : 'w-64'} shrink-0 bg-white border-r border-gray-200 flex flex-col min-h-screen transition-all duration-300`}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
        <div className="h-14 flex items-center justify-center shrink-0 relative aspect-[278/307]">
          <Image src="/Logo/Logo_backroundNO.png" alt="Maxius.id Logo" fill className="object-contain" priority />
        </div>
        {!collapsed && <span className="font-bold text-gray-900 text-xl">Maxius.id</span>}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-1 hide-scrollbar">
        
        {/* Menu Items */}
        {MENU.map((item) => {
          const hasChildren = isMenuGroup(item);
          const active = isItemActive(item);
          const open = openGroups[item.key] && !collapsed;

          const buttonContent = (
            <span className={`flex items-center ${collapsed ? 'justify-center w-full' : 'gap-3 w-full'}`}>
              <item.icon size={18} className={active ? "text-gray-900" : "text-gray-500 group-hover:text-gray-700"} />
              {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
              {!collapsed && hasChildren && (open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />)}
            </span>
          );

          const className = "w-full flex items-center px-3 py-2.5 rounded-lg text-sm transition-colors group " +
            (active
              ? (collapsed ? "bg-gray-100 text-gray-900 justify-center" : "bg-gray-100 text-gray-900 font-medium border-l-[3px] border-gray-900")
              : (collapsed ? "text-gray-600 hover:bg-gray-50 justify-center" : "text-gray-600 hover:bg-gray-50 font-medium"));

          return (
            <div key={item.key}>
              {isMenuGroup(item) ? (
                <button
                  onClick={() => toggleGroup(item.key)}
                  className={className}
                  title={collapsed ? item.label : undefined}
                >
                  {buttonContent}
                </button>
              ) : (
                <Link href={item.href} className={className} title={collapsed ? item.label : undefined}>
                  {buttonContent}
                </Link>
              )}

              {/* Submenus */}
              {"children" in item && open && !collapsed && (
                <div className="mt-1 ml-9 flex flex-col gap-1 mb-2">
                  {item.children.map((child) => {
                    if ("submenu" in child && child.submenu) {
                      const mpActive = platforms.some((p) => platformActive(p.href));
                      return (
                        <div key={child.key}>
                          <button
                            onClick={() => setMarketplaceOpen((v) => !v)}
                            className={
                              "w-full flex items-center px-3 py-2 rounded-lg text-sm transition-colors group " +
                              (mpActive
                                ? "text-gray-900 font-semibold"
                                : "text-gray-500 hover:text-gray-900")
                            }
                          >
                            <span className="flex-1 text-left">{child.label}</span>
                            {marketplaceOpen ? (
                              <ChevronUp size={16} className="text-gray-400" />
                            ) : (
                              <ChevronDown size={16} className="text-gray-400" />
                            )}
                          </button>
                          {marketplaceOpen && (
                            <div className="mt-1 ml-2 flex flex-col gap-1">
                              {platforms.length > 0 ? (
                                platforms.map((p) => (
                                  <Link
                                    key={p.key}
                                    href={p.href}
                                    className={
                                      "text-left px-3 py-1.5 rounded-lg text-sm transition-colors block " +
                                      (platformActive(p.href)
                                        ? "text-gray-900 font-semibold"
                                        : "text-gray-400 hover:text-gray-900")
                                    }
                                  >
                                    {p.label}
                                  </Link>
                                ))
                              ) : (
                                <span className="px-3 py-1.5 text-xs text-gray-400 italic">
                                  Belum ada channel terhubung.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                      <Link
                        key={child.key}
                        href={child.href!}
                        className={
                          "text-left px-3 py-2 rounded-lg text-sm transition-colors block " +
                          (pathname === child.href
                            ? "text-gray-900 font-semibold"
                            : "text-gray-500 hover:text-gray-900")
                        }
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer Actions */}
      <div className="px-3 pb-3 pt-2 border-t border-gray-100 flex flex-col gap-2 bg-white">
        {!collapsed ? (
          <div className="flex items-center gap-2">
            <button className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg py-2 transition-colors">
              <MessageCircle size={14} /> Contact Us
            </button>
            <button className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg py-2 transition-colors">
              <Rss size={14} /> Follow Channel
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <button className="w-full flex justify-center text-gray-700 bg-gray-100 rounded-lg py-2 hover:bg-gray-200 transition-colors" title="Contact Us">
              <MessageCircle size={16} />
            </button>
            <button className="w-full flex justify-center text-gray-700 bg-gray-100 rounded-lg py-2 hover:bg-gray-200 transition-colors" title="Follow Channel">
              <Rss size={16} />
            </button>
          </div>
        )}
        
<button
            onClick={() => setCollapsed(!collapsed)}
            className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors mt-2`}
            title={collapsed ? "Tampilkan Menu" : "Sembunyikan Menu"}
          >
            {collapsed ? <ArrowRightToLine size={18} /> : <ArrowLeftToLine size={18} />}
            {!collapsed && "Sembunyikan Menu"}
          </button>

          <button
            onClick={handleLogout}
            className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors`}
            title={collapsed ? "Keluar" : undefined}
          >
            <LogOut size={18} />
            {!collapsed && "Keluar"}
          </button>
      </div>

      <style jsx>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </aside>
  );
}
