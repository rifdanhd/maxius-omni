"use client";

import { useState, useEffect } from "react";
import { MonitorPlay, RefreshCw, Trash2, ShoppingBag } from "lucide-react";
import AddMarketplaceModal from "./AddMarketplaceModal";
import { authFetch, getActiveBusinessId } from "@/lib/utils/api-client";

type StoreItem = {
  id: string;
  name: string;
  platform?: string;
  businessName?: string;
  status?: string;
  connectedAt?: string;
  tokenExpiresAt?: string | null;
  scope?: string | null;
  authorizePath?: string | null;
  isFrozen?: boolean;
  frozenReason?: string | null;
  lastSyncAt?: string | null;
};

// Pesan banner hasil OAuth (?success / ?error dari redirect callback).
const OAUTH_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  success: { ok: true, text: "Toko berhasil terhubung." },
  missing_code: { ok: false, text: "Otorisasi gagal: kode dari marketplace tidak diterima." },
  auth_denied: { ok: false, text: "Otorisasi dibatalkan di halaman marketplace." },
  invalid_state: { ok: false, text: "Otorisasi gagal: state tidak valid (coba lagi)." },
  token_exchange_failed: { ok: false, text: "Gagal menukar kode menjadi token — coba hubungkan ulang." },
  token_missing: { ok: false, text: "Token tidak lengkap dari marketplace — coba lagi." },
  save_failed: { ok: false, text: "Token diterima tapi gagal disimpan — hubungi admin." },
  missing_env: { ok: false, text: "Kredensial aplikasi belum dikonfigurasi di server." },
  shopee_missing_env: { ok: false, text: "Partner ID/Key Shopee belum dikonfigurasi di server." },
  shopee_token_exchange_failed: { ok: false, text: "Gagal menukar kode Shopee — coba hubungkan ulang." },
  shopee_authorize_disabled: { ok: false, text: "Authorize Shopee dimatikan sementara — app ISV masih dalam review. Hubungi admin." },
  account_frozen: { ok: false, text: "Akun ini dibekukan — authorize/refresh ditolak. Hubungi admin." },
  token_request_failed: { ok: false, text: "Gagal menghubungi server token TikTok — coba lagi." },
};

// Ambil daftar toko (tanpa setState — reusable dari effect & event handler).
const fetchStores = async (): Promise<StoreItem[]> => {
  const res = await authFetch("/api/stores"); // assuming we will have this API in next.js or we map to external api
  if (!res.ok) throw new Error("Failed to load stores");
  return ((await res.json()) as StoreItem[]) || [];
};

export default function StoreIntegration() {
  const [stores, setStores] = useState<StoreItem[]>([]);
  // loading diinisialisasi true: spinner tampil sejak mount sampai load selesai,
  // sehingga effect tidak melakukan setState sinkron saat mount.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    // Banner hasil OAuth dibaca dari query string redirect callback
    // (?success / ?error=...), lalu dibersihkan dari URL.
    const params = new URLSearchParams(window.location.search);
    const key = params.get("success") !== null ? "success" : params.get("error");
    if (key) {
      setNotice(OAUTH_MESSAGES[key] ?? { ok: false, text: `Otorisasi gagal: ${key}.` });
      const url = new URL(window.location.href);
      url.searchParams.delete("success");
      url.searchParams.delete("error");
      window.history.replaceState(null, "", url.toString());
    }
    let cancelled = false;
    async function run() {
      try {
        const data = await fetchStores();
        if (!cancelled) setStores(data);
      } catch (e) {
        console.error("Gagal memuat toko:", e);
        if (!cancelled) setLoadError("Gagal memuat daftar toko dari server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadStores = async () => {
    try {
      setLoadError(null);
      setStores(await fetchStores());
    } catch (e) {
      console.error("Gagal memuat toko:", e);
      setLoadError("Gagal memuat daftar toko dari server.");
    }
  };

  const handleSync = async (id: string) => {
    try {
      const res = await authFetch(`/api/stores/${id}/sync`, { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      alert("Sinkronisasi berhasil!");
    } catch (e) {
      alert("Gagal sinkronisasi: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`Apakah kamu yakin ingin menghapus toko ${name}?`)) {
      try {
        const res = await authFetch(`/api/stores/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Delete failed");
        alert("Toko berhasil dihapus!");
        loadStores();
      } catch (e) {
        alert("Gagal menghapus toko: " + (e instanceof Error ? e.message : String(e)));
      }
    }
  };

  const statusMeta = (store: StoreItem) =>
    store.isFrozen
      ? { dot: "bg-gray-400", text: "Dibekukan" }
      : store.status === "connected"
        ? { dot: "bg-green-500", text: "Terhubung" }
        : store.status === "expired"
          ? { dot: "bg-amber-500", text: "Token kedaluwarsa" }
          : { dot: "bg-red-500", text: "Terputus" };

  const platformLabel = (platform?: string) =>
    platform === "SHOPEE" ? "Shopee" : platform === "TIKTOK_SHOP" ? "TikTok Shop" : (platform ?? "—");

  return (
    <div className="flex flex-col h-full font-sans">
      {notice && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
            notice.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {notice.text}
        </div>
      )}
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
                <th className="px-6 py-4 font-semibold w-[20%]">Platform</th>
                <th className="px-6 py-4 font-semibold w-[20%]">Status</th>
                <th className="px-6 py-4 font-semibold w-[20%]">Sinkron Terakhir</th>
                <th className="px-6 py-4 font-semibold text-right w-[15%]">Atur</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">Memuat...</td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-red-600">{loadError}</td>
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
                    <span className="text-sm text-gray-600">{store.platform ? platformLabel(store.platform) : "—"}</span>
                    {store.scope && (
                      <div className="text-xs text-gray-400 truncate max-w-[200px]" title={store.scope}>
                        {store.scope.split(",").length} scope
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${statusMeta(store).dot}`}></div>
                      <span className="text-sm text-gray-600" title={store.isFrozen ? (store.frozenReason ?? "Dibekukan admin") : undefined}>
                        {statusMeta(store).text}
                      </span>
                    </div>
                    {store.businessName && (
                      <div className="text-xs text-gray-400 mt-0.5">{store.businessName}</div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-600">
                      {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleString("id-ID") : "-"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-3">
                      {store.status !== "connected" && store.authorizePath && (
                        <button
                          onClick={() => {
                            // Guard Shopee: konfirmasi manual sebelum re-authorize
                            // (app ISV masih under review).
                            if (
                              store.platform === "SHOPEE" &&
                              !window.confirm(
                                "Yakin authorize ulang toko Shopee ini? App ISV masih dalam review — batalkan bila tidak sengaja."
                              )
                            ) {
                              return;
                            }
                            const sep = store.authorizePath!.includes("?") ? "&" : "?";
                            window.location.assign(
                              `${store.authorizePath!}${sep}businessId=${encodeURIComponent(getActiveBusinessId())}`
                            );
                          }}
                          className="text-xs font-semibold text-white bg-[#2a3a8c] hover:bg-blue-900 px-3 py-1.5 rounded transition-colors"
                          title="Hubungkan ulang via OAuth"
                        >
                          Hubungkan ulang
                        </button>
                      )}
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
