"use client";

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Info,
  Eye,
  Pencil,
  Image as ImageIcon,
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
  mappings: Mapping[];
};

type Product = {
  id: string;
  name: string;
  threshold: number;
  imageUrl: string | null;
  variants: Variant[];
};

type StockLevel = "ok" | "low" | "out";

const eff = (stock: number, safety: number) => Math.max(0, stock - safety);

function level(v: Variant, threshold: number): StockLevel {
  const e = eff(v.stock, v.safetyStock);
  if (e <= 0) return "out";
  if (e <= threshold) return "low";
  return "ok";
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

export default function MasterProductsPage() {
  const [activeTab, setActiveTab] = useState("semua_produk");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/products", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          setError(`Gagal memuat produk (${res.status})`);
          return;
        }
        const data = await res.json();
        setProducts(data.products ?? []);
      } catch (e) {
        console.error(e);
        setError("Terjadi kesalahan saat memuat produk.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function refreshProducts() {
    const token = localStorage.getItem("token");
    const res = await fetch("/api/products", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    setProducts(data.products ?? []);
  }

  async function updateImage(product: Product) {
    const current = product.imageUrl ?? "";
    const url = window.prompt("URL gambar produk (kosongkan untuk menghapus):", current);
    if (url === null) return;
    const imageUrl = url.trim();

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/products/${product.id}`, {
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
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = products;
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
  }, [products, q, sort, filterLevel]);

  const tabs = [
    { id: "semua_produk", label: "Semua Produk", count: products.length },
    { id: "produk_satuan", label: "Produk Satuan", count: products.length },
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
            <button className="flex items-center gap-2 rounded-md bg-[#2a3a8c] px-4 py-2 text-sm font-medium text-white hover:bg-blue-900 transition-colors">
              Tambah Produk Baru <ChevronDown size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center overflow-x-auto border-b border-gray-200 px-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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
                    Tidak ada produk master.
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
                              <div className="text-gray-900 font-bold leading-tight">
                                {product.name}
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
                                            {eff(v.stock, v.safetyStock)}
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
    </div>
  );
}