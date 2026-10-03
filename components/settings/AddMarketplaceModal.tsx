"use client";

import TikTokLogo from "@/components/icons/TikTokLogo";
import ShopeeLogo from "@/components/icons/ShopeeLogo";
import { X } from "lucide-react";
import { getActiveBusinessId } from "@/lib/utils/api-client";

type PlatformConfig = {
  name: string;
  icon: React.ReactNode;
  authorizePath?: string;
};

export default function AddMarketplaceModal({ onClose }: { onClose: () => void }) {
  const handleConnect = (authorizePath?: string) => {
    // Guard Shopee ISV sudah tidak diperlukan: app ISV telah disetujui Shopee
    // (flag server SHOPEE_AUTHORIZE_ENABLED di .env tetap sbg kill-switch admin).
    if (!authorizePath) return;
    // Bawa brand aktif: akun baru dibuat di brand ini (callback).
    const sep = authorizePath.includes("?") ? "&" : "?";
    window.location.assign(
      `${authorizePath}${sep}businessId=${encodeURIComponent(getActiveBusinessId())}`
    );
  };

  // Lazada, Blibli, Shopify & WooCommerce dihapus dari modal (belum didukung).
  const marketplaces: PlatformConfig[] = [
    { name: "Shopee", icon: <ShopeeLogo size={24} />, authorizePath: "/api/auth/shopee/authorize" },
    { name: "TikTok Shop", icon: <TikTokLogo size={14} />, authorizePath: "/api/auth/tiktok/authorize" },
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
          <div>
            <h3 className="text-sm font-semibold text-gray-900 bg-gray-50 px-3 py-1 rounded-full inline-block mb-4">Marketplace</h3>
            <div className="grid grid-cols-2 gap-4">
              {marketplaces.map((item) => (
                <PlatformCard
                  key={item.name}
                  name={item.name}
                  icon={item.icon}
                  onClick={() => handleConnect(item.authorizePath)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlatformCard({ name, icon, onClick }: { name: string, icon: React.ReactNode, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-gray-500 hover:shadow-md transition-all group bg-white"
    >
      <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <span className="text-sm font-medium text-gray-700">{name}</span>
    </button>
  );
}
