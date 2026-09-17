"use client";

import { useState, useEffect, useRef } from "react";
import { X, ShoppingBag, Store, ShoppingCart } from "lucide-react";
import TikTokLogo from "@/components/icons/TikTokLogo";

type PlatformConfig = {
  name: string;
  icon: React.ReactNode;
  authorizePath?: string;
};

export default function AddMarketplaceModal({ onClose }: { onClose: () => void }) {
  const [toast, setToast] = useState<string | null>(null);
  const [confirmShopee, setConfirmShopee] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 2500);
  };

  const handleConnect = (platform: string, authorizePath?: string) => {
    // Guard Shopee: app ISV masih under review — wajib konfirmasi manual
    // sebelum authorize apa pun (server juga memblokir via flag
    // SHOPEE_AUTHORIZE_ENABLED sampai ISV approved).
    if (platform === "Shopee" && authorizePath && !confirmShopee) {
      setConfirmShopee(true);
      return;
    }
    if (authorizePath) {
      window.location.assign(authorizePath);
      return;
    }
    showToast(`Integrasi ${platform} segera hadir`);
  };

  const marketplaces: PlatformConfig[] = [
    { name: "Shopee", icon: <ShoppingBag size={24} className="text-orange-500" />, authorizePath: "/api/auth/shopee/authorize" },
    { name: "Lazada", icon: <ShoppingCart size={24} className="text-blue-500" /> },
    { name: "TikTok Shop", icon: <TikTokLogo size={14} />, authorizePath: "/api/auth/tiktok/authorize" },
    { name: "Blibli", icon: <ShoppingBag size={24} className="text-blue-400" /> },
  ];

  const onlineStores: PlatformConfig[] = [
    { name: "Shopify", icon: <Store size={24} className="text-green-600" /> },
    { name: "WooCommerce", icon: <ShoppingCart size={24} className="text-purple-600" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Pilih Marketplace</h2>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-2 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {confirmShopee && (
            <div className="mb-6 border border-amber-300 bg-amber-50 rounded-xl p-4">
              <h3 className="text-sm font-bold text-amber-800">Yakin authorize toko Shopee?</h3>
              <p className="text-sm text-amber-700 mt-1">
                App Shopee ISV kami masih dalam proses review. Jangan authorize toko apa pun
                sebelum ISV disetujui — cukup tekan Batal bila tidak sengaja.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setConfirmShopee(false)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Batal
                </button>
                <button
                  onClick={() => handleConnect("Shopee", "/api/auth/shopee/authorize")}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#2a3a8c] text-white hover:bg-blue-900"
                >
                  Ya, lanjutkan authorize
                </button>
              </div>
            </div>
          )}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full inline-block mb-4">Marketplace</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {marketplaces.map((item) => (
                <PlatformCard
                  key={item.name}
                  name={item.name}
                  icon={item.icon}
                  onClick={() => handleConnect(item.name, item.authorizePath)}
                />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full inline-block mb-4">Online Store</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {onlineStores.map((item) => (
                <PlatformCard
                  key={item.name}
                  name={item.name}
                  icon={item.icon}
                  onClick={() => handleConnect(item.name, item.authorizePath)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function PlatformCard({ name, icon, onClick }: { name: string, icon: React.ReactNode, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-blue-500 hover:shadow-md transition-all group bg-white"
    >
      <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <span className="text-sm font-medium text-gray-700">{name}</span>
    </button>
  );
}