"use client";

import { Feedback, PageState } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/ui/feedback";
import { notify } from "@/components/ui/notify";
import { confirmAction } from "@/components/ui/confirm-action";
import { useState, useEffect } from "react";
import { MonitorPlay, RefreshCw, Trash2, ShoppingBag } from "lucide-react";
import AddMarketplaceModal from "./AddMarketplaceModal";
import { authFetch, getActiveBusinessId, setActiveBusinessId } from "@/lib/utils/api-client";

type StoreItem = {
  id: string;
  name: string;
  platform?: string;
  businessName?: string;
  status?: string;
  canRefresh?: boolean;
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
  invalid_state: { ok: false, text: "Sesi penyambungan toko tidak valid atau sudah kedaluwarsa. Coba hubungkan ulang." },
  token_exchange_failed: { ok: false, text: "Koneksi belum berhasil dibuat. Coba hubungkan ulang." },
  token_missing: { ok: false, text: "Izin koneksi yang diterima belum lengkap. Coba hubungkan ulang." },
  save_failed: { ok: false, text: "Koneksi gagal disimpan. Hubungi admin." },
  missing_env: { ok: false, text: "Kredensial aplikasi belum dikonfigurasi di server." },
  missing_auth_url: { ok: false, text: "Penyambungan TikTok Shop belum dikonfigurasi. Hubungi admin." },
  shopee_missing_env: { ok: false, text: "Partner ID/Key Shopee belum dikonfigurasi di server." },
  shopee_token_exchange_failed: { ok: false, text: "Gagal menukar kode Shopee — coba hubungkan ulang." },
  shopee_authorize_disabled: { ok: false, text: "Penyambungan Shopee sedang dinonaktifkan. Hubungi admin." },
  account_frozen: { ok: false, text: "Toko dibekukan sehingga koneksi belum dapat diperbarui. Hubungi admin." },
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
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [failedSyncIds, setFailedSyncIds] = useState<string[]>([]);

  useEffect(() => {
    // Banner hasil OAuth dibaca dari query string redirect callback
    // (?success / ?error=...), lalu dibersihkan dari URL.
    const params = new URLSearchParams(window.location.search);
    // Callback OAuth membawa brand tujuan (?brand=) — bila beda dgn brand
    // aktif, pindahkan dulu SEBELUM fetch daftar toko (localStorage dipakai
    // authFetch), supaya toko baru langsung terlihat tanpa reload/loop.
    const brandParam = params.get("brand");
    if (brandParam && brandParam !== getActiveBusinessId()) {
      setActiveBusinessId(brandParam);
    }
    const key = params.get("success") !== null ? "success" : params.get("error");
    if (key) {
      queueMicrotask(() =>
        setNotice(OAUTH_MESSAGES[key] ?? { ok: false, text: "Penyambungan toko belum berhasil. Coba hubungkan ulang." }),
      );
      const url = new URL(window.location.href);
      url.searchParams.delete("success");
      url.searchParams.delete("error");
      url.searchParams.delete("brand");
      window.history.replaceState(null, "", url.toString());
    } else if (brandParam) {
      const url = new URL(window.location.href);
      url.searchParams.delete("brand");
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
    if (syncingId) return;
    setSyncingId(id);
    setNotice(null);
    try {
      const res = await authFetch(`/api/stores/${id}/sync`, { method: "POST" });
      const data = await res.json().catch(() => null) as { error?: string; message?: string; success?: boolean } | null;
      if (!res.ok || !data?.success) throw new Error(data?.error ?? "Pembaruan data belum berhasil.");
      setFailedSyncIds((ids) => ids.filter((storeId) => storeId !== id));
      setNotice({ ok: true, text: data.message ?? "Data produk toko selesai diperbarui." });
      await loadStores();
    } catch (e) {
      setFailedSyncIds((ids) => ids.includes(id) ? ids : [...ids, id]);
      setNotice({ ok: false, text: e instanceof Error ? e.message : "Gagal memperbarui data toko." });
    } finally { setSyncingId(null); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (await confirmAction(`Apakah kamu yakin ingin menghapus toko ${name}?`)) {
      try {
        const res = await authFetch(`/api/stores/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Gagal menghapus toko. Coba lagi.");
        notify("success", "Toko berhasil dihapus!");
        loadStores();
      } catch (e) {
        notify("error", "Gagal menghapus toko: " + (e instanceof Error ? e.message : String(e)));
      }
    }
  };

  const platformLabel = (platform?: string) =>
    platform === "SHOPEE" ? "Shopee" : platform === "TIKTOK_SHOP" ? "TikTok Shop" : (platform ?? "—");

  return (
    <div className="flex flex-col h-full font-sans">
      {notice && <Feedback className="mb-4" variant={notice.ok ? "success" : "error"} title={notice.ok ? "Toko diperbarui" : "Koneksi belum berhasil"} description={notice.ok ? notice.text : friendlyError(notice.text, "Coba perbarui data toko lagi. Jika tetap gagal, periksa izin toko di marketplace.")} details={notice.ok ? undefined : notice.text} />}
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row items-start justify-between gap-4 mb-8 p-6 bg-muted border border-border rounded-xl">
        <div className="flex min-w-0 items-start gap-4">
          <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center shrink-0">
            <MonitorPlay className="text-foreground" size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Tambahkan Semua Toko Marketplace kamu</h2>
            <p className="text-sm text-muted-foreground mt-1">Mulai dengan Tambahkan Marketplace dan selesaikan pemberian izin. Setelah terhubung, buka Produk Marketplace untuk memperbarui data, mengimpor produk, atau menghubungkannya ke katalog pusat.</p>
          </div>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-primary hover:bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold transition-colors shrink-0"
        >
          Tambahkan Marketplace
        </button>
      </div>

      {/* Table Section */}
      <div className="flex-1 overflow-x-auto border border-border rounded-xl">
        <table className="w-full text-left min-w-[800px] border-collapse">
          <thead>
              <tr className="bg-muted text-foreground text-xs uppercase border-b border-border">
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
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-muted-foreground">Memuat...</td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={5}><PageState variant="error" title="Toko belum dapat dimuat" description={loadError} action={<Button variant="outline" onClick={loadStores}>Coba lagi</Button>} /></td>
                </tr>
              ) : stores.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-muted-foreground">Belum ada toko terhubung. Klik Tambahkan Marketplace di atas, pilih Shopee atau TikTok Shop, lalu berikan izin akses.</td>
              </tr>
            ) : (
              stores.map((store) => (
                <tr key={store.id} className="border-b border-border hover:bg-muted transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-foreground shrink-0">
                        <ShoppingBag size={16} />
                      </div>
                      <span className="text-sm font-semibold text-foreground">{store.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-foreground">{store.platform ? platformLabel(store.platform) : "—"}</span>
                    {store.scope && (
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={store.scope}>
                        {store.scope.split(",").length} izin akses (Scope)
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={store.isFrozen ? "inactive" : store.status === "expired" && store.canRefresh ? "pending" : store.status ?? "unlinked"} label={store.isFrozen ? "Dibekukan" : store.status === "connected" ? "Terhubung" : store.status === "expired" ? store.canRefresh ? "Menunggu pembaruan" : "Perlu dihubungkan ulang" : "Belum terhubung"} />
                    {!store.isFrozen && store.status === "expired" && store.canRefresh && (
                      <div className="mt-1 max-w-[240px] text-xs text-muted-foreground">Koneksi akan dicoba diperbarui otomatis saat data toko disinkronkan.</div>
                    )}
                    {store.businessName && (
                      <div className="text-xs text-muted-foreground mt-0.5">{store.businessName}</div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-foreground">
                      {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleString("id-ID") : "-"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-3">
                      {!store.isFrozen && store.authorizePath && ((store.status !== "connected" && !store.canRefresh) || failedSyncIds.includes(store.id)) && (
                        <button
                          onClick={() => {
                            const url = new URL(store.authorizePath!, window.location.origin);
                            url.searchParams.set("businessId", getActiveBusinessId());
                            window.location.assign(url.href);
                          }}
                          className="text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary px-3 py-1.5 rounded transition-colors"
                          title="Hubungkan ulang via OAuth"
                        >
                          Hubungkan ulang
                        </button>
                      )}
                      <button 
                        onClick={() => handleSync(store.id)}
                        aria-label={`Perbarui data ${store.name}`}
                        disabled={syncingId !== null || store.isFrozen || (store.status !== "connected" && !store.canRefresh)}
                        className="text-foreground hover:bg-muted p-1.5 rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        title={syncingId === store.id ? "Memperbarui data produk…" : "Perbarui Data Produk Toko"}
                      >
                        <RefreshCw size={16} className={syncingId === store.id ? "animate-spin" : ""} />
                      </button>
                      <button 
                        onClick={() => handleDelete(store.id, store.name)}
                        aria-label={`Hapus ${store.name}`}
                        className="text-foreground hover:bg-muted hover:text-foreground p-1.5 rounded transition-colors"
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
