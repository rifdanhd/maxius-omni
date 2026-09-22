import {
  Home, Package, ShoppingBag, Boxes, Warehouse, Tag,
  MessageSquare, Users, BarChart2, Settings, ClipboardList,
  Compass, Grid2x2, BookOpen,
  ArrowDownToLine, ArrowUpToLine,
  Receipt, Clock, Store, Plug, AlertTriangle,
  Command, GalleryVerticalEnd,
} from 'lucide-react'
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
      logo: Command,
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
            { title: 'Produk Marketplace', url: '/products/marketplace', icon: Compass },
            { title: 'Shopee', url: '/products/marketplace/shopee', icon: ShoppingBag },
            { title: 'TikTok Shop', url: '/products/marketplace/tiktok', icon: Compass },
            { title: 'Tokopedia', url: '/products/marketplace/tokopedia', icon: Store },
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
          title: 'WMS',
          icon: Warehouse,
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
        { title: 'Chat', url: '/chat', icon: MessageSquare },
        { title: 'Daftar Pelanggan', url: '/customers', icon: Users },
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
            { title: 'Kelola Pengguna', url: '/settings/users', icon: Users },
          ],
        },
        { title: 'Log Aktivitas', url: '/logs', icon: ClipboardList },
        { title: 'Market', url: '/market', icon: Compass },
        {
          title: 'Aplikasi',
          icon: Grid2x2,
          items: [
            { title: 'Koneksi API', url: '/apps/api-connections', icon: Plug },
          ],
        },
        { title: 'Pusat Edukasi', url: '/education', icon: BookOpen },
      ],
    },
  ],
}

