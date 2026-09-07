"use client";

import { useState, useEffect } from "react";
import { MonitorPlay, Edit2, RefreshCw, Trash2, ShoppingBag } from "lucide-react";
import AddMarketplaceModal from "./AddMarketplaceModal";

export default function StoreIntegration() {
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadStores = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/stores"); // assuming we will have this API in next.js or we map to external api
      if (!res.ok) throw new Error("Failed to load stores");
      const data = await res.json();
      setStores(data || []);
    } catch (e) {
      console.error("Gagal memuat toko:", e);
      // fallback mock data for UI demo if backend is empty/error
      setStores([
        {
          id: '1',
          name: 'weirdme.cloth',
          url: 'https://shopee.co.id/weirdme.cloth',
          platform: 'shopee',
          status: 'connected',
          connectedAt: '07-09-2026 07:40'
        },
        {
          id: '2',
          name: 'Dermarket',
          url: '',
          platform: 'tiktok',
          status: 'connected',
          connectedAt: '04-09-2026 01:30'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStores();
  }, []);

  const handleSync = async (id: string) => {
    try {
      const res = await fetch(`/api/stores/${id}/sync`, { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      alert("Sinkronisasi berhasil!");
    } catch (e: any) {
      alert("Gagal sinkronisasi: " + e.message);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Apakah kamu yakin ingin menghapus toko ${name}?`)) {
      try {
        const res = await fetch(`/api/stores/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Delete failed");
        alert("Toko berhasil dihapus!");
        loadStores();
      } catch (e: any) {
        alert("Gagal menghapus toko: " + e.message);
      }
    }
  };

  return (
    <div className="flex flex-col h-full font-sans">
      {/* Header Section */}
      <div className="flex items-start justify-between mb-8 p-6 bg-gray-50 border border-gray-100 rounded-xl">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
            <MonitorPlay className="text-blue-600" size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Tambahkan Semua Toko Marketplace kamu</h2>
            <p className="text-sm text-gray-500 mt-1">Setelah terhubung, semua produk kamu akan diunduh secara otomatis</p>
          </div>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-[#2a3a8c] hover:bg-blue-900 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shrink-0"
        >
          Tambahkan Marketplace
        </button>
      </div>

      {/* Table Section */}
      <div className="flex-1 overflow-x-auto border border-gray-200 rounded-xl">
        <table className="w-full text-left min-w-[800px] border-collapse">
          <thead>
            <tr className="bg-[#f3f4f6] text-gray-600 text-xs uppercase border-b border-gray-200">
              <th className="px-6 py-4 font-semibold w-[25%]">Nama Toko</th>
              <th className="px-6 py-4 font-semibold w-[30%]">URL Toko</th>
              <th className="px-6 py-4 font-semibold w-[15%]">Status</th>
              <th className="px-6 py-4 font-semibold w-[20%]">Waktu Dihubungkan</th>
              <th className="px-6 py-4 font-semibold text-right w-[10%]">Atur</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">Memuat...</td>
              </tr>
            ) : stores.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">Belum ada toko terhubung.</td>
              </tr>
            ) : (
              stores.map((store) => (
                <tr key={store.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-orange-100 flex items-center justify-center text-orange-600 shrink-0">
                        <ShoppingBag size={16} />
                      </div>
                      <span className="text-sm font-semibold text-gray-800">{store.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {store.url ? (
                        <a href={store.url} target="_blank" rel="noreferrer" className="text-sm text-[#2a3a8c] hover:underline truncate max-w-[200px]">
                          {store.url}
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                      <button className="text-gray-400 hover:text-gray-600 p-1">
                        <Edit2 size={12} />
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${store.status === 'connected' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                      <span className="text-sm text-gray-600">
                        {store.status === 'connected' ? 'Terhubung' : 'Terputus'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-600">{store.connectedAt || '-'}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-3">
                      <button 
                        onClick={() => handleSync(store.id)}
                        className="text-[#2a3a8c] hover:bg-blue-50 p-1.5 rounded transition-colors"
                        title="Sync"
                      >
                        <RefreshCw size={16} />
                      </button>
                      <button 
                        onClick={() => handleDelete(store.id, store.name)}
                        className="text-[#2a3a8c] hover:bg-red-50 hover:text-red-600 p-1.5 rounded transition-colors"
                        title="Hapus"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && <AddMarketplaceModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}
