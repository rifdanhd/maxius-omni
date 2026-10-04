"use client";

import { useState } from "react";
import StoreIntegration from "@/components/settings/StoreIntegration";

export default function SettingsAccountsPage() {
  const [activeTab, setActiveTab] = useState('integrasi');

  return (
    <div className="p-4 md:p-8 font-sans">
      <div className="bg-card rounded-xl shadow-sm border border-border flex flex-col min-h-[600px]">
        {/* Tabs */}
        <div className="flex items-center overflow-x-auto border-b border-border px-2">
          <TabButton active={activeTab === 'integrasi'} onClick={() => setActiveTab('integrasi')}>Integrasi</TabButton>
          <TabButton active={activeTab === 'umum'} onClick={() => setActiveTab('umum')}>Umum</TabButton>
          <TabButton active={activeTab === 'pesanan'} onClick={() => setActiveTab('pesanan')}>Pesanan</TabButton>
          <TabButton active={activeTab === 'addon'} onClick={() => setActiveTab('addon')}>Add-On</TabButton>
        </div>

        {/* Tab Content */}
        <div className="flex-1 p-6">
          {activeTab === 'integrasi' && <StoreIntegration />}
          {activeTab === 'umum' && <div className="text-muted-foreground">Konten Umum</div>}
          {activeTab === 'pesanan' && <div className="text-muted-foreground">Konten Pesanan</div>}
          {activeTab === 'addon' && <div className="text-muted-foreground">Konten Add-On</div>}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
  return (
    <button 
      onClick={onClick}
      className={`shrink-0 px-4 sm:px-6 py-4 text-sm font-semibold border-b-2 transition-colors ${
        active 
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
      }`}
    >
      {children}
    </button>
  );
}
