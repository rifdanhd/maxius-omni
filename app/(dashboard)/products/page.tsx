"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Search, Filter } from "lucide-react";

type Mapping = {
  id: string;
  channelSku: string;
  account: { id: string; platform: string; label: string } | null;
};

type Variant = {
  id: string;
  sku: string;
  stock: number;
  mappings: Mapping[];
};

type Product = {
  id: string;
  name: string;
  threshold: number;
  variants: Variant[];
};

export default function MasterProductsPage() {
  const [activeTab, setActiveTab] = useState("semua_produk");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const totalVariants = products.reduce((acc, p) => acc + p.variants.length, 0);
  const tabs = [
    { id: "semua_produk", label: "Semua Produk", count: totalVariants },
    { id: "produk_satuan", label: "Produk Satuan", count: totalVariants },
    { id: "produk_bundle", label: "Produk Bundle", count: 0 },
  ];

  const formatPlatform = (platform: string) => {
    switch (platform) {
      case "TIKTOK_SHOP":
        return "TikTok Shop";
      case "SHOPEE":
        return "Shopee";
      case "TOKOPEDIA":
        return "Tokopedia";
      default:
        return platform;
    }
  };

  return (
    <div className="p-8">

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
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

        {/* Filter Bar */}
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <div className="relative w-80">
            <input
              type="text"
              placeholder="Cari nama produk atau SKU"
              className="border border-gray-300 rounded-md pl-3 pr-10 py-2 text-sm outline-none w-full h-[38px] font-medium"
            />
            <Search size={16} className="text-gray-400 absolute right-3 top-2.5" />
          </div>

          <select className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-500 outline-none bg-white font-medium h-[38px] w-36">
            <option>Urutkan</option>
          </select>

          <button className="flex items-center gap-2 border border-gray-300 bg-white rounded-md px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 h-[38px]">
            Filter <Filter size={14} />
          </button>
        </div>

        {/* Main Tabs */}
        <div className="flex overflow-x-auto border-b border-gray-200 px-2 hide-scrollbar">
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
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                activeTab === tab.id ? "bg-[#5e72e4] text-white" : "bg-blue-100 text-blue-600"
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#f8f9fa] border-b border-gray-200 text-gray-600 font-semibold">
              <tr>
                <th className="px-5 py-3 w-10">
                  <input type="checkbox" className="w-4 h-4 rounded border-gray-300" />
                </th>
                <th className="px-5 py-3 flex items-center gap-1">Informasi Produk</th>
                <th className="px-5 py-3">Master SKU</th>
                <th className="px-5 py-3">Stok</th>
                <th className="px-5 py-3">Toko Terkait</th>
                <th className="px-5 py-3">SKU Marketplace</th>
                <th className="px-5 py-3">Atur</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-gray-500">
                    Memuat produk...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-red-600">
                    {error}
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-gray-500">
                    Tidak ada produk master.
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-5 py-4 align-top pt-5">
                      <input type="checkbox" className="w-4 h-4 rounded border-gray-300" />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-3">
                        <div className="w-12 h-12 bg-orange-200 rounded object-cover shrink-0"></div>
                        <div className="text-gray-900 font-bold max-w-[220px] leading-tight">
                          {product.name}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 align-top pt-5 text-gray-700">
                      {product.variants.map((v) => (
                        <div key={v.id}>{v.sku}</div>
                      ))}
                    </td>
                    <td className="px-5 py-4 align-top pt-5 text-gray-700">
                      {product.variants.map((v) => (
                        <div key={v.id}>
                          <span className={v.stock <= product.threshold ? "text-red-600 font-semibold" : ""}>
                            {v.stock}
                          </span>
                        </div>
                      ))}
                    </td>
                    <td className="px-5 py-4 align-top pt-5 text-blue-600 font-semibold">
                      {product.variants.map((v) => {
                        const storeCount = new Set(v.mappings.map((m) => m.account?.id)).size;
                        return <div key={v.id}>{storeCount} Toko</div>;
                      })}
                    </td>
                    <td className="px-5 py-4 align-top pt-5 text-gray-700">
                      {product.variants.map((v) =>
                        v.mappings.length
                          ? v.mappings.map((m) => (
                              <div key={m.id} className="text-gray-600">
                                {formatPlatform(m.account?.platform ?? "")}: {m.channelSku}
                              </div>
                            ))
                          : <div key={v.id} className="text-gray-400">-</div>
                      )}
                    </td>
                    <td className="px-5 py-4 align-top pt-5">
                      <button className="border border-gray-300 rounded px-3 py-1 text-gray-700 bg-white hover:bg-gray-50 flex items-center gap-1">
                        Atur <ChevronDown size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
