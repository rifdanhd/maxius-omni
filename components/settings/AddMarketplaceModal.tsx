"use client";

import TikTokLogo from "@/components/icons/TikTokLogo";
import ShopeeLogo from "@/components/icons/ShopeeLogo";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    const url = new URL(authorizePath, window.location.origin);
    url.searchParams.set("businessId", getActiveBusinessId());
    window.location.assign(url.href);
  };

  // Lazada, Blibli, Shopify & WooCommerce dihapus dari modal (belum didukung).
  const marketplaces: PlatformConfig[] = [
    { name: "Shopee", icon: <ShopeeLogo size={24} />, authorizePath: "/api/auth/shopee/authorize" },
    { name: "TikTok Shop", icon: <TikTokLogo size={14} />, authorizePath: "/api/auth/tiktok/authorize" },
  ];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="gap-0 bg-card p-0 sm:max-w-2xl">
        {/* Header */}
        <DialogHeader className="border-b border-border px-6 py-4 pr-12 text-left">
          <DialogTitle>Pilih Marketplace</DialogTitle>
          <DialogDescription>Pilih marketplace untuk menghubungkan toko dan memberikan izin akses.</DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="p-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground bg-muted px-3 py-1 rounded-full inline-block mb-4">Marketplace</h3>
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
      </DialogContent>
    </Dialog>
  );
}

function PlatformCard({ name, icon, onClick }: { name: string, icon: React.ReactNode, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-3 p-4 border border-border rounded-xl hover:border-ring hover:shadow-md transition-all group bg-card"
    >
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <span className="text-sm font-medium text-foreground">{name}</span>
    </button>
  );
}
