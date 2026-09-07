"use client";

import { useState, useEffect, useRef } from "react";
import { X, ShoppingBag, Store, ShoppingCart } from "lucide-react";

type PlatformConfig = {
  name: string;
  icon: React.ReactNode;
  authorizePath?: string;
};

function TikTokIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

export default function AddMarketplaceModal({ onClose }: { onClose: () => void }) {
  const [toast, setToast] = useState<string | null>(null);
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
    if (authorizePath) {
      window.location.assign(authorizePath);
      return;
    }
    showToast(`Integrasi ${platform} segera hadir`);
  };

  const marketplaces: PlatformConfig[] = [
    { name: "Shopee", icon: <ShoppingBag size={24} className="text-orange-500" /> },
    { name: "Lazada", icon: <ShoppingCart size={24} className="text-blue-500" /> },
    { name: "Tokopedia | Shop", icon: <Store size={24} className="text-green-500" /> },
    { name: "TikTok Shop", icon: <TikTokIcon size={24} className="text-black" />, authorizePath: "/api/auth/tiktok/authorize" },
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