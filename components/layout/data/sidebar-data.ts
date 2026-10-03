import {
  Home, Package, ShoppingBag, Boxes, Warehouse, Tag,
  MessageSquare, Users, BarChart2, Settings, ClipboardList,
  Compass, Grid2x2, BookOpen,
  ArrowDownToLine, ArrowUpToLine,
  Receipt, Clock, Store, Plug, AlertTriangle,
  GalleryVerticalEnd,
} from 'lucide-react'
import { MaxiusMark } from '@/components/icons/MaxiusLogo'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Maxius User',
    email: '',
    avatar: '/avatars/default.png',
  },
  teams: [
    {
      name: 'Maxius',
      logo: MaxiusMark,
      plan: 'Platform',
    },
  ],
  navGroups: [
    {
      title: 'Utama',
      items: [
        {
          title: 'Dashboard',
          url: '/dashboard',
          icon: Home,
        },
        {
          title: 'Pesanan',
          icon: ShoppingBag,
          items: [
            { title: 'Kelola Pesanan', url: '/orders', icon: Package },
            { title: 'Kelola Pengembalian', url: '/orders/returns', icon: Boxes },
          ],
        },
      ],
    },
    {
      title: 'Produk',
      items: [
        {
          title: 'Produk',
          icon: Package,
          items: [
            { title: 'Produk Master', url: '/products', icon: Package },
            { title: 'Mapping Stok Terpusat', url: '/products/mapping', icon: Boxes },
            { title: 'Kelola Harga', url: '/products/prices', icon: Tag },
            { title: 'Kelola Gambar', url: '/products/images', icon: GalleryVerticalEnd },
            { title: 'Product Copy', url: '/products/copy', icon: ClipboardList },
          ],
        },
        {
          // Dropdown collapsible (pola sama dgn "Pengaturan"). Halaman
          // /products/marketplace tidak ada (404) → tidak ada item "Semua Produk".
          title: 'Produk Marketplace',
          icon: Compass,
          items: [
            { title: 'Shopee', url: '/products/marketplace/shopee', icon: ShoppingBag },
            { title: 'TikTok Shop', url: '/products/marketplace/tiktok', icon: Compass },
            // Scope OUT Paket 2 — rute tetap, disembunyikan dari navigasi.
            { title: 'Tokopedia', url: '/products/marketplace/tokopedia', icon: Store, hidden: true },
          ],
        },
      ],
    },
    {
      title: 'Stok & Inventori',
      items: [
        {
          title: 'Inventori',
          icon: Boxes,
          items: [
            { title: 'Stok Varian', url: '/inventory', icon: Package },
            { title: 'Stok Mismatch', url: '/inventory/mismatch', icon: AlertTriangle },
            { title: 'Pengaturan Inventori', url: '/inventory/settings', icon: Settings },
            { title: 'Stok Opname', url: '/inventory/opname', icon: ClipboardList },
            { title: 'Riwayat Inventori', url: '/inventory/history', icon: Clock },
          ],
        },
        {
          // Scope di luar MVP (PRD) — disembunyikan dari navigasi; rute /wms/* tetap ada.
          title: 'WMS',
          icon: Warehouse,
          hidden: true,
          items: [
            { title: 'Inbound', url: '/wms/inbound', icon: ArrowDownToLine },
            { title: 'Outbound', url: '/wms/outbound', icon: ArrowUpToLine },
            { title: 'Gudang', url: '/wms/warehouse', icon: Warehouse },
            { title: 'Kelola Rak', url: '/wms/racks', icon: Grid2x2 },
          ],
        },
      ],
    },
    {
      title: 'Bisnis',
      items: [
        { title: 'Promosi', url: '/promotions', icon: Tag },
        // Placeholder — disembunyikan sampai fiturnya benar-benar ada.
        { title: 'Chat', url: '/chat', icon: MessageSquare, hidden: true },
        { title: 'Daftar Pelanggan', url: '/customers', icon: Users, hidden: true },
      ],
    },
    {
      title: 'Laporan',
      items: [
        { title: 'Laporan Penjualan', url: '/reports/sales', icon: Receipt },
        { title: 'Laporan Stok', url: '/reports/stock', icon: BarChart2 },
      ],
    },
    {
      title: 'Lainnya',
      items: [
        {
          title: 'Pengaturan',
          icon: Settings,
          items: [
            { title: 'Pengaturan Toko', url: '/settings/accounts', icon: Store },
            // Placeholder — kelola user via seed/psql dulu.
            { title: 'Kelola Pengguna', url: '/settings/users', icon: Users, hidden: true },
          ],
        },
        // Placeholder — disembunyikan sampai fiturnya benar-benar ada.
        { title: 'Log Aktivitas', url: '/logs', icon: ClipboardList, hidden: true },
        { title: 'Market', url: '/market', icon: Compass, hidden: true },
        {
          // Placeholder — fungsinya sudah ada di Pengaturan Toko > Integrasi.
          title: 'Aplikasi',
          icon: Grid2x2,
          hidden: true,
          items: [
            { title: 'Koneksi API', url: '/apps/api-connections', icon: Plug },
          ],
        },
        { title: 'Panduan', url: '/education', icon: BookOpen },
      ],
    },
  ],
}

