"use client";

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/utils/api-client";
import { stockLevel, effectiveStock } from "@/lib/services/stock-level.policy";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Info,
  Eye,
  Pencil,
  Image as ImageIcon,
  Plus,
  Store,
  PackagePlus,
  FileUp,
  X,
  Loader2,
  Trash2,
} from "lucide-react";

type Mapping = {
  id: string;
  channelSku: string;
  account: { id: string; platform: string; label: string } | null;
};

type Variant = {
  id: string;
  sku: string;
  stock: number;
  safetyStock: number;
  minStock: number | null;
  mappings: Mapping[];
};

type Product = {
  id: string;
  name: string;
  threshold: number;
  imageUrl: string | null;
  status?: string;
  isActive: boolean;
  importedFrom?: string | null;
  variants: Variant[];
  // Opsional: belum dikirim oleh /api/products saat ini. Begitu backend
  // menambahkan field ini (mis. "single" | "bundle"), tab "Produk Bundle"
  // di bawah otomatis mulai memfilter dengan benar tanpa perubahan lain.
  type?: "single" | "bundle";
};

type StockLevel = "ok" | "low" | "out";

// Level stok memakai definisi tunggal stockLevel() (stock-level.policy) —
// sama dengan halaman Stok Varian, /api/stock-alerts, & ringkasan dashboard.
function level(v: Variant, threshold: number): StockLevel {
  return stockLevel(v.stock, v.safetyStock, v.minStock, threshold);
}

function isBundle(p: Product): boolean {
  return p.type === "bundle";
}

const SORT_OPTIONS = [
  { id: "name_asc", label: "Nama: A-Z" },
  { id: "name_desc", label: "Nama: Z-A" },
  { id: "stock_desc", label: "Stok: Terbanyak" },
  { id: "stock_asc", label: "Stok: Tersedikit" },
  { id: "links_desc", label: "Produk Terkait Terbanyak" },
];

const stockMeta: Record<StockLevel, { label: string; cls: string; dot: string }> = {
  ok: { label: "Stok Aman", cls: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  low: { label: "Stok Menipis", cls: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  out: { label: "Stok Habis", cls: "bg-red-100 text-red-700", dot: "bg-red-500" },
};

type TabId = "semua_produk" | "produk_satuan" | "produk_bundle";

export default function MasterProductsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("semua_produk");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState(SORT_OPTIONS[0]);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterLevel, setFilterLevel] = useState<"all" | "low" | "out">("all");
  const [filterOpen, setFilterOpen] = useState(false);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Atur menu per baris (satu dibuka dalam satu waktu)
  const [aturFor, setAturFor] = useState<string | null>(null);
  const aturRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const sortRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [confirmProduct, setConfirmProduct] = useState<Product | null>(null);
  const [togglingActive, setTogglingActive] = useState(false);

  const notify = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 6000);
  };

  const productsUrl = (includeInactive: boolean) =>
    includeInactive ? "/api/products?includeInactive=true" : "/api/products";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = localStorage.getItem("token");
        const res = await authFetch(productsUrl(showInactive), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(`Gagal memuat produk (${res.status})`);
          return;
        }
        const data = await res.json();
        setProducts(data.products ?? []);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Terjadi kesalahan saat memuat produk.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [showInactive]);

  async function refreshProducts() {
    const token = localStorage.getItem("token");
    const res = await authFetch(productsUrl(showInactive), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setProducts(data.products ?? []);
  }

  async function setProductActive(product: Product, active: boolean) {
    setTogglingActive(true);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isActive: active }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Gagal mengubah status produk.");
      setConfirmProduct(null);
      notify("success", active ? `Produk "${product.name}" diaktifkan kembali.` : `Produk "${product.name}" dinonaktifkan. Data & riwayat tetap tersimpan.`);
      await refreshProducts();
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "Gagal mengubah status produk.");
    } finally {
      setTogglingActive(false);
    }
  }

  async function updateImage(product: Product) {
    const current = product.imageUrl ?? "";
    const url = window.prompt("URL gambar produk (kosongkan untuk menghapus):", current);
    if (url === null) return;
    const imageUrl = url.trim();

    try {
      const token = localStorage.getItem("token");
      const res = await authFetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ imageUrl: imageUrl || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        alert(data?.error ?? "Gagal menyimpan gambar.");
        return;
      }
      setAturFor(null);
      await refreshProducts();
    } catch (e) {
      console.error(e);
      alert("Terjadi kesalahan saat menyimpan gambar.");
    }
  }

  // Tutup "Atur" dan "Urutkan" saat klik di luar
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideAtur = Array.from(aturRefs.current.values()).some(
        (el) => el && el.contains(target)
      );
      if (!insideAtur) setAturFor(null);
      if (!(sortRef.current && sortRef.current.contains(target))) setSortOpen(false);
      if (!(filterRef.current && filterRef.current.contains(target))) setFilterOpen(false);
      if (!(addRef.current && addRef.current.contains(target))) setAddOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset seleksi saat pindah tab, supaya "N Dipilih" tidak menghitung
  // produk dari tab lain yang sedang tidak terlihat. Dilakukan di event
  // handler (bukan effect) agar lolos aturan react-hooks/set-state-in-effect.
  function switchTab(id: TabId) {
    setActiveTab(id);
    setSelected(new Set());
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = products;

    // Filter tab: Semua Produk tidak memfilter apa pun; Produk Satuan
    // menyembunyikan bundle; Produk Bundle hanya menampilkan bundle.
    if (activeTab === "produk_satuan") {
      list = list.filter((p) => !isBundle(p));
    } else if (activeTab === "produk_bundle") {
      list = list.filter((p) => isBundle(p));
    }

    if (query) {
      list = list.filter((p) => {
        const skus = p.variants.map((v) => v.sku.toLowerCase());
        const channelSkus = p.variants
          .flatMap((v) => v.mappings.map((m) => m.channelSku.toLowerCase()));
        return (
          p.name.toLowerCase().includes(query) ||
          skus.some((s) => s.includes(query)) ||
          channelSkus.some((s) => s.includes(query))
        );
      });
    }
    if (filterLevel === "low") {
      list = list.filter((p) =>
        p.variants.some((v) => level(v, p.threshold) !== "ok")
      );
    } else if (filterLevel === "out") {
      list = list.filter((p) =>
        p.variants.some((v) => level(v, p.threshold) === "out")
      );
    }
    list = [...list].sort((a, b) => {
      const stockA = a.variants.reduce((s, v) => s + v.stock, 0);
      const stockB = b.variants.reduce((s, v) => s + v.stock, 0);
      const linksA = a.variants.reduce((s, v) => s + v.mappings.length, 0);
      const linksB = b.variants.reduce((s, v) => s + v.mappings.length, 0);
      switch (sort.id) {
        case "name_desc":
          return b.name.localeCompare(a.name);
        case "stock_desc":
          return stockB - stockA;
        case "stock_asc":
          return stockA - stockB;
        case "links_desc":
          return linksB - linksA;
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return list;
  }, [products, q, sort, filterLevel, activeTab]);

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "semua_produk", label: "Semua Produk", count: products.length },
    {
      id: "produk_satuan",
      label: "Produk Satuan",
      count: products.filter((p) => !isBundle(p)).length,
    },
    {
      id: "produk_bundle",
      label: "Produk Bundle",
      count: products.filter((p) => isBundle(p)).length,
    },
  ];

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  const toggleAll = () =>
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filtered.forEach((p) => next.delete(p.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((p) => next.add(p.id));
      return next;
    });

  const mastersku = (p: Product) => {
    if (p.variants.length === 0) return "-";
    const first = p.variants[0].sku;
    return p.variants.length > 1 ? `${first} +${p.variants.length - 1}` : first;
  };

  const storeCount = (p: Product) =>
    new Set(p.variants.flatMap((v) => v.mappings.map((m) => m.account?.id))).size;

  const totalLinks = (p: Product) =>
    p.variants.reduce((s, v) => s + v.mappings.length, 0);

  const worstLevel = (p: Product): StockLevel =>
    p.variants.reduce<StockLevel>(
      (acc, v) => {
        const l = level(v, p.threshold);
        if (l === "out" || acc === "out") return "out";
        if (l === "low" || acc === "low") return "low";
        return acc;
      },
      "ok"
    );

  return (
    <div className="p-8">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        {/* Header Title */}
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Produk Master</h1>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Unduh <ChevronDown size={16} />
            </button>
            <div className="relative" ref={addRef}>
              <button
                onClick={() => setAddOpen((v) => !v)}
                className="flex items-center gap-2 rounded-md bg-[#2a3a8c] px-4 py-2 text-sm font-medium text-white hover:bg-blue-900 transition-colors"
              >
                <Plus size={16} /> Tambah Produk Baru <ChevronDown size={16} />
              </button>
              {addOpen && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1.5">
                  <button
                    disabled
                    title="Segera hadir"
                    className="w-full flex items-start gap-3 px-4 py-2.5 text-left opacity-50 cursor-not-allowed"
                  >
                    <Plus size={16} className="mt-0.5 shrink-0 text-gray-400" />
                    <span>
                      <span className="block text-sm font-semibold text-gray-700">
                        Tambah Produk Baru{" "}
                        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold">
                          Segera hadir
                        </span>
                      </span>
                      <span className="block text-[11px] text-gray-400">Buat produk satuan manual</span>
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setAddOpen(false);
                      router.push("/products/marketplace/tiktok");
                    }}
                    className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-gray-50"
                  >
                    <Store size={16} className="mt-0.5 shrink-0 text-gray-500" />
                    <span>
                      <span className="block text-sm font-semibold text-gray-700">Tambah dari Marketplace</span>
                      <span className="block text-[11px] text-gray-400">Mapping produk TikTok yang belum terdaftar</span>
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setAddOpen(false);
                      setBundleOpen(true);
                    }}
                    className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-gray-50"
                  >
                    <PackagePlus size={16} className="mt-0.5 shrink-0 text-gray-500" />
                    <span>
                      <span className="block text-sm font-semibold text-gray-700">Tambah Produk Bundle</span>
                      <span className="block text-[11px] text-gray-400">Gabungan beberapa varian dalam satu SKU</span>
                    </span>
                  </button>
                  <button
                    disabled
                    title="Segera hadir"
                    className="w-full flex items-start gap-3 px-4 py-2.5 text-left opacity-50 cursor-not-allowed"
                  >
                    <FileUp size={16} className="mt-0.5 shrink-0 text-gray-400" />
                    <span>
                      <span className="block text-sm font-semibold text-gray-700">
                        Unggah dari Excel{" "}
                        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold">
                          Segera hadir
                        </span>
                      </span>
                      <span className="block text-[11px] text-gray-400">Import banyak produk sekaligus</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center overflow-x-auto border-b border-gray-200 px-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-800 text-gray-900"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  activeTab === tab.id
                    ? "bg-[#5e72e4] text-white"
                    : "bg-blue-100 text-blue-600"
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="p-4 border-b border-gray-200 flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative w-80">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari nama produk, SKU, atau SKU marketplace"
              className="border border-gray-300 rounded-md pl-3 pr-10 py-2 text-sm outline-none w-full h-[38px] font-medium"
            />
            <Search size={16} className="text-gray-400 absolute right-3 top-2.5" />
          </div>

          {/* Sort */}
          <div className="relative" ref={sortRef}>
            <button
              onClick={() => setSortOpen((v) => !v)}
              className={`flex items-center gap-2 border rounded-md px-3 text-sm font-medium h-[38px] min-w-[140px] justify-between ${
                sortOpen
                  ? "border-indigo-500 bg-indigo-50/70 text-indigo-700"
                  : "border-gray-300 text-gray-500 bg-white hover:bg-gray-50"
              }`}
            >
              <span className="truncate">{sort.label}</span>
              <ChevronDown size={14} className="shrink-0" />
            </button>
            {sortOpen && (
              <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1.5">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setSort(opt);
                      setSortOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm ${
                      sort.id === opt.id
                        ? "font-semibold text-indigo-600 bg-indigo-50"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filter */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen((v) => !v)}
              className={`flex items-center gap-2 border rounded-md px-4 py-2 text-sm font-medium h-[38px] min-w-[120px] justify-between ${
                filterOpen || filterLevel !== "all"
                  ? "border-indigo-500 bg-indigo-50/70 text-indigo-700"
                  : "border-gray-300 text-gray-500 bg-white hover:bg-gray-50"
              }`}
            >
              <span>
                {filterLevel === "low"
                  ? "Stok Menipis"
                  : filterLevel === "out"
                    ? "Stok Habis"
                    : "Filter"}
              </span>
              <ChevronDown size={14} />
            </button>
            {filterOpen && (
              <div className="absolute left-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1.5">
                {[
                  { id: "all" as const, label: "Semua Produk" },
                  { id: "low" as const, label: "Stok Menipis", dot: "bg-amber-500" },
                  { id: "out" as const, label: "Stok Habis", dot: "bg-red-500" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setFilterLevel(opt.id);
                      setFilterOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${
                      filterLevel === opt.id
                        ? "font-semibold text-indigo-600 bg-indigo-50"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {opt.dot && (
                      <span className={`w-2 h-2 rounded-full ${opt.dot}`} />
                    )}
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label
            title="Tampilkan juga produk yang dinonaktifkan (soft delete)"
            className="flex items-center gap-2 text-sm text-gray-600 font-medium cursor-pointer select-none"
          >
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-gray-300"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Tampilkan nonaktif
          </label>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#f8f9fa] border-b border-gray-200 text-gray-600 font-semibold">
              <tr>
                <th className="px-5 py-3 w-10">
                  <div className="flex">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                    />
                  </div>
                </th>
                <th className="px-5 py-3">Informasi Produk</th>
                <th className="px-5 py-3">Master SKU</th>
                <th className="px-5 py-3">Range Harga</th>
                <th className="px-5 py-3">Stok</th>
                <th className="px-5 py-3">Produk Terkait</th>
                <th className="px-5 py-3">Toko Terkait</th>
                <th className="px-5 py-3">Waktu dibuat/update</th>
                <th className="px-5 py-3">Atur</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-gray-500">
                    Memuat produk...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-red-600">
                    {error}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-gray-500">
                    {activeTab === "produk_bundle"
                      ? "Belum ada produk bundle."
                      : "Tidak ada produk master."}
                  </td>
                </tr>
              ) : (
                filtered.map((product) => {
                  const isExpanded = expanded.has(product.id);
                  const isSelected = selected.has(product.id);
                  const meta = stockMeta[worstLevel(product)];
                  const storeN = storeCount(product);
                  return (
                    <Fragment key={product.id}>
                      <tr
                        key={product.id}
                        className="border-b border-gray-100 hover:bg-gray-50/50"
                      >
                        <td className="px-5 py-4 align-top pt-5">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-gray-300"
                            checked={isSelected}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(product.id)) next.delete(product.id);
                                else next.add(product.id);
                                return next;
                              })
                            }
                          />
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex gap-3">
                            {product.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={product.imageUrl}
                                alt={product.name}
                                className="w-12 h-12 rounded object-cover shrink-0 bg-gray-100"
                              />
                            ) : (
                              <div className="w-12 h-12 bg-orange-200 rounded object-cover shrink-0"></div>
                            )}
                            <div className="max-w-[220px]">
                              <div className="text-gray-900 font-bold leading-tight flex items-center gap-2 flex-wrap">
                                {product.name}
                                {product.status === "draft" && (
                                  <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide">
                                    Draft
                                  </span>
                                )}
                                {isBundle(product) && (
                                  <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold uppercase tracking-wide">
                                    Bundle
                                  </span>
                                )}
                                {product.isActive === false && (
                                  <span
                                    title="Produk dinonaktifkan (soft delete) — disembunyikan dari list default, data & riwayat tetap utuh"
                                    className="px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold uppercase tracking-wide"
                                  >
                                    Nonaktif
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => toggleExpand(product.id)}
                                className="mt-1 flex items-center gap-1 text-xs font-medium text-[#2a3a8c] hover:underline"
                              >
                                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                Lihat {product.variants.length} varian produk
                              </button>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4 align-top pt-5 text-gray-700">
                          {mastersku(product)}
                        </td>

                        <td className="px-5 py-4 align-top pt-5 text-gray-400">
                          -
                        </td>

                        <td className="px-5 py-4 align-top pt-5">
                          <div className="text-gray-900 font-semibold">
                            {product.variants.reduce((s, v) => s + v.stock, 0)}
                          </div>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.cls}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                            {meta.label}
                          </span>
                        </td>

                        <td className="px-5 py-4 align-top pt-5 text-gray-700">
                          <span className="inline-flex items-center gap-1 text-blue-600 font-semibold">
                            <Info size={13} />
                            {totalLinks(product)}
                          </span>
                        </td>

                        <td className="px-5 py-4 align-top pt-5">
                          <a
                            href="#"
                            onClick={(e) => e.preventDefault()}
                            className="text-blue-600 font-semibold hover:underline"
                          >
                            {storeN} Toko
                          </a>
                        </td>

                        <td className="px-5 py-4 align-top pt-5 text-gray-400">-</td>

                        <td className="px-5 py-4 align-top pt-5">
                          <div
                            className="relative"
                            ref={(el) => { aturRefs.current.set(product.id, el); }}
                          >
                            <button
                              onClick={() => setAturFor(aturFor === product.id ? null : product.id)}
                              className="border border-gray-300 rounded px-3 py-1 text-gray-700 bg-white hover:bg-gray-50 flex items-center gap-1 text-xs"
                            >
                              Atur <ChevronDown size={13} />
                            </button>
                            {aturFor === product.id && (
                              <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1.5">
                                <button
                                  onClick={() => {
                                    toggleExpand(product.id);
                                    setAturFor(null);
                                  }}
                                  className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 text-gray-700 hover:bg-gray-50"
                                >
                                  <Eye size={14} /> Lihat varian
                                </button>
                                <button
                                  onClick={() => updateImage(product)}
                                  className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 text-gray-700 hover:bg-gray-50"
                                >
                                  <ImageIcon size={14} /> Ubah Gambar
                                </button>
                                <button
                                  onClick={() => setAturFor(null)}
                                  className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 text-gray-700 hover:bg-gray-50"
                                >
                                  <Pencil size={14} /> Edit
                                </button>
                                {product.isActive !== false ? (
                                  <button
                                    onClick={() => {
                                      setConfirmProduct(product);
                                      setAturFor(null);
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 text-red-600 hover:bg-red-50"
                                  >
                                    <Eye size={14} /> Nonaktifkan
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      setAturFor(null);
                                      void setProductActive(product, true);
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 text-emerald-600 hover:bg-emerald-50"
                                  >
                                    <Eye size={14} /> Aktifkan kembali
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expandable sub-table per varian */}
                      {isExpanded && (
                        <tr key={`${product.id}-detail`} className="bg-gray-50/70 border-b border-gray-100">
                          <td colSpan={9} className="px-5 py-3">
                            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                              {/* Sub-header */}
                              <div className="px-4 py-2.5 bg-gray-100/80 border-b border-gray-200 flex items-center justify-between">
                                <span className="text-xs font-bold text-gray-700">
                                  Varian {product.name}
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    disabled
                                    title="Harga belum tersedia di model data"
                                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 border border-gray-300 text-gray-400 bg-white rounded-md cursor-not-allowed"
                                  >
                                    <Pencil size={12} /> Ubah semua harga
                                  </button>
                                </div>
                              </div>

                              <table className="w-full text-sm text-left">
                                <thead className="bg-[#f8f9fa] border-b border-gray-200 text-gray-500 font-semibold text-xs">
                                  <tr>
                                    <th className="px-4 py-2">Varian</th>
                                    <th className="px-4 py-2">SKU Varian</th>
                                    <th className="px-4 py-2">Harga</th>
                                    <th className="px-4 py-2">Stok</th>
                                    <th className="px-4 py-2">Produk Terkait</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {product.variants.map((v) => {
                                    const l = level(v, product.threshold);
                                    const m = stockMeta[l];
                                    return (
                                      <tr key={v.id} className="border-b border-gray-100 last:border-0">
                                        <td className="px-4 py-2.5 text-gray-800 font-medium">
                                          {v.sku}
                                        </td>
                                        <td className="px-4 py-2.5 text-gray-600">{v.sku}</td>
                                        <td className="px-4 py-2.5 text-gray-400">
                                          -
                                        </td>
                                        <td className="px-4 py-2.5">
                                          <div className="text-gray-900 font-semibold">
                                            {effectiveStock(v.stock, v.safetyStock)}
                                            {v.safetyStock > 0 && (
                                              <span className="text-gray-400 font-normal text-xs">
                                                {" "}
                                                (fisik {v.stock})
                                              </span>
                                            )}
                                          </div>
                                          {l !== "ok" && (
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${m.cls}`}>
                                              <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
                                              {m.label}
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-4 py-2.5">
                                          <a
                                            href="#"
                                            onClick={(e) => e.preventDefault()}
                                            className="text-[#2a3a8c] font-semibold inline-flex items-center gap-1 text-xs hover:underline"
                                          >
                                            <Info size={12} /> {v.mappings.length} Produk
                                          </a>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] max-w-sm">
          <div
            className={`rounded-xl border px-4 py-3 text-sm shadow-lg flex items-start gap-2 ${
              toast.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-red-50 border-red-200 text-red-800"
            }`}
          >
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToast(null)} className="underline text-xs opacity-70">
              Tutup
            </button>
          </div>
        </div>
      )}
      {bundleOpen && (
        <BundleModal
          onClose={() => setBundleOpen(false)}
          onCreated={(name) => {
            setBundleOpen(false);
            notify("success", `Produk bundle "${name}" berhasil dibuat.`);
            setActiveTab("produk_bundle");
            void refreshProducts();
          }}
        />
      )}
      {confirmProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !togglingActive && setConfirmProduct(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900">Nonaktifkan produk?</h2>
            <p className="text-sm text-gray-600 mt-2">
              <span className="font-semibold">“{confirmProduct.name}”</span> akan disembunyikan
              dari daftar produk dan tidak bisa dipakai untuk mapping/transaksi baru.
            </p>
            <p className="text-xs text-gray-500 mt-1.5">
              Data tidak dihapus: varian, mapping marketplace, stok, dan riwayat transaksi tetap
              tersimpan dan bisa dikembalikan lewat “Aktifkan kembali”.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmProduct(null)}
                disabled={togglingActive}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={() => void setProductActive(confirmProduct, false)}
                disabled={togglingActive}
                className="px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-60"
              >
                {togglingActive ? "Memproses..." : "Ya, nonaktifkan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Modal Tambah Produk Bundle ------------------------------ */

type BundleComponent = {
  variantId: string;
  sku: string;
  productName: string;
  stock: number;
  qty: number;
};

function BundleModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [masters, setMasters] = useState<Product[]>([]);
  const [loadingMasters, setLoadingMasters] = useState(true);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [search, setSearch] = useState("");
  const [components, setComponents] = useState<BundleComponent[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const token = localStorage.getItem("token");
        const res = await authFetch("/api/products", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? "Gagal memuat varian.");
        if (!cancelled) setMasters((data.products as Product[]) ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Gagal memuat varian.");
      } finally {
        if (!cancelled) setLoadingMasters(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: BundleComponent[] = [];
    for (const m of masters) {
      if (m.type === "bundle") continue;
      for (const v of m.variants) {
        if (components.some((c) => c.variantId === v.id)) continue;
        if (
          q &&
          !m.name.toLowerCase().includes(q) &&
          !v.sku.toLowerCase().includes(q)
        )
          continue;
        out.push({ variantId: v.id, sku: v.sku, productName: m.name, stock: v.stock, qty: 1 });
        if (out.length >= 50) return out;
      }
    }
    return out;
  }, [masters, search, components]);

  function addComponent(opt: BundleComponent) {
    setError(null);
    setComponents((prev) =>
      prev.some((c) => c.variantId === opt.variantId) ? prev : [...prev, opt]
    );
  }

  function setQty(variantId: string, qty: number) {
    setComponents((prev) =>
      prev.map((c) => (c.variantId === variantId ? { ...c, qty } : c))
    );
  }

  function removeComponent(variantId: string) {
    setComponents((prev) => prev.filter((c) => c.variantId !== variantId));
  }

  async function submit() {
    // Validasi frontend (cermin validasi backend) agar feedback instan.
    if (!name.trim()) {
      setError("Nama bundle wajib diisi.");
      return;
    }
    if (components.length === 0) {
      setError("Tambahkan minimal 1 varian komponen.");
      return;
    }
    for (const c of components) {
      if (!Number.isInteger(c.qty) || c.qty < 1) {
        setError(`Qty "${c.sku}" harus bilangan bulat >= 1.`);
        return;
      }
    }
    if (imageUrl.trim() !== "" && !/^https?:\/\/.+/.test(imageUrl.trim())) {
      setError("URL gambar harus berupa URL yang valid (http/https), atau kosongkan.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/products/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          ...(category.trim() ? { category: category.trim() } : {}),
          ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
          items: components.map((c) => ({ variantId: c.variantId, qty: c.qty })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Gagal membuat bundle.");
      onCreated(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat bundle.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Tambah Produk Bundle</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Gabungan beberapa varian yang dijual sebagai satu SKU.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title="Tutup">
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
            Nama bundle <span className="text-red-500">*</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. Paket Hemat Kaos Kaki (3in1)"
              className="border border-gray-300 rounded-md px-2 py-2 text-sm font-normal outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
              Kategori (opsional)
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-2 text-sm font-normal outline-none"
              />
            </label>
            <label className="text-xs font-semibold text-gray-600 flex flex-col gap-1">
              URL gambar (opsional)
              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
                className="border border-gray-300 rounded-md px-2 py-2 text-sm font-normal outline-none"
              />
            </label>
          </div>
          {imageUrl.trim() !== "" && (
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl.trim()}
                alt="Pratinjau gambar bundle"
                className="w-12 h-12 rounded object-cover bg-gray-100"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <span className="text-[11px] text-gray-400">Pratinjau gambar</span>
            </div>
          )}

          <div className="border-t border-gray-100 pt-2.5">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">
              Komponen ({components.length})
            </p>
            <div className="relative mt-1.5">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari varian (nama produk / SKU)…"
                disabled={loadingMasters}
                className="border border-gray-300 rounded-md pl-3 pr-9 py-2 text-sm outline-none w-full"
              />
              <Search size={14} className="text-gray-400 absolute right-3 top-2.5" />
            </div>
            {search.trim() !== "" && !loadingMasters && (
              <div className="mt-1 border border-gray-200 rounded-md max-h-40 overflow-y-auto divide-y divide-gray-100">
                {options.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">Tidak ada varian yang cocok.</p>
                ) : (
                  options.map((o) => (
                    <button
                      key={o.variantId}
                      onClick={() => addComponent(o)}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-center justify-between gap-2"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-gray-800 truncate">
                          {o.productName}
                        </span>
                        <span className="block text-[11px] text-gray-400 font-mono truncate">
                          {o.sku} · fisik {o.stock}
                        </span>
                      </span>
                      <Plus size={14} className="shrink-0 text-indigo-600" />
                    </button>
                  ))
                )}
              </div>
            )}
            {components.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {components.map((c) => (
                  <div
                    key={c.variantId}
                    className="flex items-center gap-2 bg-gray-50 rounded-md px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-gray-800 truncate">
                        {c.productName}
                      </span>
                      <span className="block text-[11px] text-gray-400 font-mono truncate">
                        {c.sku}
                      </span>
                    </span>
                    <label className="text-[11px] text-gray-500 flex items-center gap-1 shrink-0">
                      ×
                      <input
                        type="number"
                        min={1}
                        value={c.qty}
                        onChange={(e) => setQty(c.variantId, Number(e.target.value))}
                        className="w-14 border border-gray-300 rounded-md px-1.5 py-1 text-xs text-right outline-none"
                      />
                    </label>
                    <button
                      onClick={() => removeComponent(c.variantId)}
                      title="Hapus komponen"
                      className="shrink-0 text-gray-400 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Batal
          </button>
          <button
            onClick={submit}
            disabled={saving || loadingMasters}
            className="px-4 py-2 text-sm font-semibold bg-[#2a3a8c] text-white rounded-md hover:bg-blue-900 disabled:opacity-60 flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Menyimpan..." : "Simpan bundle"}
          </button>
        </div>
      </div>
    </div>
  );
}