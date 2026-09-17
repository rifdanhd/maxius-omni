"use client";

import { useEffect, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import {
  authFetch,
  getActiveBusinessId,
  setActiveBusinessId,
} from "@/lib/utils/api-client";

type Business = { id: string; name: string };

// Brand switcher fase multi-brand: 1 user akses semua brand (tanpa role).
// Ganti brand → simpan pilihan → reload agar semua halaman fetch ulang
// dgn ?businessId= yg baru (authFetch menyertakan otomatis).
export default function BrandSwitcher() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeId, setActiveId] = useState<string>(getActiveBusinessId());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/businesses");
        if (!res.ok) return;
        const d = (await res.json()) as { businesses?: Business[] };
        if (cancelled || !d.businesses) return;
        setBusinesses(d.businesses);
        // Koreksi pilihan tersimpan bila brand-nya tak lagi tersedia.
        if (d.businesses.length > 0 && !d.businesses.some((b) => b.id === getActiveBusinessId())) {
          const first = d.businesses[0].id;
          setActiveBusinessId(first);
          setActiveId(first);
        }
      } catch {
        // Switcher gagal → halaman tetap jalan dgn brand default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = businesses.find((b) => b.id === activeId);

  function pick(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setActiveBusinessId(id);
    setActiveId(id);
    setOpen(false);
    window.location.reload();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        title="Ganti brand"
      >
        <Building2 size={16} />
        <span className="max-w-[140px] truncate">{active?.name ?? "Brand"}</span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
            {businesses.length === 0 && (
              <div className="px-4 py-2 text-sm text-gray-400">Memuat brand…</div>
            )}
            {businesses.map((b) => (
              <button
                key={b.id}
                onClick={() => pick(b.id)}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-gray-50"
              >
                <span className="flex-1 truncate font-medium text-gray-700">{b.name}</span>
                {b.id === activeId && <Check size={16} className="text-emerald-600" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
