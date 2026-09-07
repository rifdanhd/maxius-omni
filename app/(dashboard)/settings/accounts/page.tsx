"use client";

import { useState } from "react";
import StoreIntegration from "@/components/settings/StoreIntegration";

export default function SettingsAccountsPage() {
  const [activeTab, setActiveTab] = useState('integrasi');

  return (
    <div className="p-8 font-sans">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col min-h-[600px]">
        {/* Tabs */}
        <div className="flex items-center border-b border-gray-200 px-2">
          <TabButton active={activeTab === 'integrasi'} onClick={() => setActiveTab('integrasi')}>Integrasi</TabButton>
          <TabButton active={activeTab === 'umum'} onClick={() => setActiveTab('umum')}>Umum</TabButton>
          <TabButton active={activeTab === 'pesanan'} onClick={() => setActiveTab('pesanan')}>Pesanan</TabButton>
          <TabButton active={activeTab === 'addon'} onClick={() => setActiveTab('addon')}>Add-On</TabButton>
        </div>

        {/* Tab Content */}
        <div className="flex-1 p-6">
          {activeTab === 'integrasi' && <StoreIntegration />}
          {activeTab === 'umum' && <div className="text-gray-500">Konten Umum</div>}
          {activeTab === 'pesanan' && <div className="text-gray-500">Konten Pesanan</div>}
          {activeTab === 'addon' && <div className="text-gray-500">Konten Add-On</div>}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
  return (
    <button 
      onClick={onClick}
      className={`px-6 py-4 text-sm font-semibold border-b-2 transition-colors ${
        active 
          ? 'border-indigo-600 text-indigo-600' 
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  );
}
