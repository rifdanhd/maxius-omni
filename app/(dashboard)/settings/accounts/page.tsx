"use client";

import { useState } from "react";
import StoreIntegration from "@/components/settings/StoreIntegration";

export default function SettingsAccountsPage() {
  const [activeTab, setActiveTab] = useState('integrasi');

  return (
    <div className="p-4 md:p-8 font-sans">
      <h1 className="mb-2 text-xl font-bold">Pengaturan Toko</h1>
      <p className="mb-4 text-sm text-muted-foreground">Hubungkan toko dan periksa koneksinya; mulai dari tab Koneksi Toko, lalu pilih Tambahkan Marketplace.</p>
      <div className="bg-card rounded-xl shadow-sm border border-border flex flex-col min-h-[600px]">
        {/* Tabs */}
        <div className="flex items-center overflow-x-auto border-b border-border px-2">
          <TabButton active={activeTab === 'integrasi'} onClick={() => setActiveTab('integrasi')}>Koneksi Toko (Integrasi)</TabButton>
          <TabButton active={activeTab === 'umum'} disabled>Umum (Segera Hadir)</TabButton>
          <TabButton active={activeTab === 'pesanan'} disabled>Pesanan (Segera Hadir)</TabButton>
          <TabButton active={activeTab === 'addon'} disabled>Fitur Tambahan (Add-On, Segera Hadir)</TabButton>
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

function TabButton({ active, onClick, children, disabled = false }: { active: boolean; onClick?: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`disabled:opacity-50 disabled:cursor-not-allowed shrink-0 px-4 sm:px-6 py-4 text-sm font-semibold border-b-2 transition-colors ${
        active 
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
      }`}
    >
      {children}
    </button>
  );
}
