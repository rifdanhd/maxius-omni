"use client";

import { useEffect, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Mail,
  Save,
  SlidersHorizontal,
  Store,
  TriangleAlert,
} from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";

/* ------------------------------ Types ------------------------------ */

type Settings = {
  lowStockDefaultThreshold: number;
  notifyLowStock: boolean;
  notifyLowStockEmail: boolean;
  syncPushTokopedia: boolean;
  syncPushShopee: boolean;
  syncPushTiktok: boolean;
  opnameReminderFrequency: string;
};

const FREQ_OPTIONS = [
  { id: "off", label: "Nonaktif" },
  { id: "daily", label: "Harian" },
  { id: "weekly", label: "Mingguan" },
  { id: "monthly", label: "Bulanan" },
] as const;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await authFetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

/* ------------------------------ Toggle ------------------------------ */

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-blue-600" : "bg-gray-300"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Section({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof Store;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="rounded-lg bg-blue-50 p-2 text-blue-600">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-bold text-gray-900">{title}</h2>
          <p className="mt-0.5 text-sm text-gray-500">{desc}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------ Page ------------------------------ */

export default function InventorySettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const { settings: s } = await api<{ settings: Settings }>(
          "/api/inventory/settings"
        );
        if (!cancelled) setSettings(s);
      } catch (e) {
        if (!cancelled) {
          console.error("[InventorySettings] load gagal:", e);
          setError(e instanceof Error ? e.message : "Gagal memuat pengaturan.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { settings: fresh } = await api<{ settings: Settings }>(
        "/api/inventory/settings",
        { method: "PUT", body: JSON.stringify(settings) }
      );
      setSettings(fresh);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      console.error("[InventorySettings] simpan gagal:", e);
      setError(e instanceof Error ? e.message : "Gagal menyimpan pengaturan.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat…
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pengaturan Inventori</h1>
          <p className="mt-1 text-sm text-gray-500">
            Ambang stok rendah, notifikasi, sinkronisasi ke marketplace, dan preferensi stok
            opname.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Tersimpan
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || !settings}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Simpan Pengaturan
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>{error}</div>
        </div>
      )}

      {!settings ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Pengaturan tidak tersedia.
        </div>
      ) : (
        <div className="grid gap-4">
          {/* 1 — Ambang batas stok rendah */}
          <Section
            icon={SlidersHorizontal}
            title="Ambang Batas Stok Rendah"
            desc="Produk baru otomatis memakai nilai ini sebagai ambang awal."
          >
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="number"
                min={0}
                value={settings.lowStockDefaultThreshold}
                onChange={(e) =>
                  setSettings({ ...settings, lowStockDefaultThreshold: Number(e.target.value) })
                }
                className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <span className="text-sm text-gray-500">unit atau kurang = stok menipis</span>
            </div>
            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Berlaku untuk <b>produk baru</b> (Pemetaan Produk &amp; Salin Produk). Produk yang
              sudah ada memakai ambang per-produk masing-masing dan tetap bisa diubah di halaman
              Produk Master. Nilai ini dipakai dashboard &ldquo;Yang Perlu Dilakukan&rdquo;,
              lonceng notifikasi, dan penanda stok di halaman produk.
            </p>
          </Section>

          {/* 2 — Notifikasi stok */}
          <Section
            icon={BellRing}
            title="Notifikasi Stok"
            desc="Peringatan saat stok produk menyentuh ambang batas."
          >
            <div className="divide-y divide-gray-100">
              <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
                <div>
                  <div className="font-medium text-gray-900">Notifikasi in-app</div>
                  <div className="text-sm text-gray-500">
                    Lonceng notifikasi &ldquo;Stok Menipis&rdquo; di kanan atas dashboard.
                  </div>
                </div>
                <Toggle
                  checked={settings.notifyLowStock}
                  onChange={(v) => setSettings({ ...settings, notifyLowStock: v })}
                />
              </label>
              <div className="flex items-center justify-between gap-4 py-3">
                <div>
                  <div className="flex items-center gap-1.5 font-medium text-gray-900">
                    <Mail className="h-4 w-4 text-gray-400" /> Notifikasi email
                  </div>
                  <div className="text-sm text-gray-500">
                    Belum tersedia — sistem belum terhubung ke layanan email.
                  </div>
                </div>
                <Toggle
                  disabled
                  checked={settings.notifyLowStockEmail}
                  onChange={(v) => setSettings({ ...settings, notifyLowStockEmail: v })}
                />
              </div>
            </div>
          </Section>

          {/* 3 — Sinkronisasi stok ke marketplace */}
          <Section
            icon={Store}
            title="Sinkronisasi Stok ke Marketplace"
            desc="Push otomatis stok terbaru setelah penyesuaian manual atau stok opname."
          >
            <div className="divide-y divide-gray-100">
              {(
                [
                  {
                    key: "syncPushTiktok" as const,
                    label: "TikTok Shop",
                    note: "Terhubung — push masuk antrean debounce (tergabung per ±8 detik).",
                  },
                  {
                    key: "syncPushShopee" as const,
                    label: "Shopee",
                    note: "Integrasi push belum tersedia — preferensi disimpan untuk saat integrasi siap.",
                  },
                  {
                    key: "syncPushTokopedia" as const,
                    label: "Tokopedia",
                    note: "Integrasi push belum tersedia — preferensi disimpan untuk saat integrasi siap.",
                  },
                ]
              ).map((p) => (
                <label key={p.key} className="flex cursor-pointer items-center justify-between gap-4 py-3">
                  <div>
                    <div className="font-medium text-gray-900">{p.label}</div>
                    <div className="text-sm text-gray-500">{p.note}</div>
                  </div>
                  <Toggle
                    checked={settings[p.key]}
                    onChange={(v) => setSettings({ ...settings, [p.key]: v })}
                  />
                </label>
              ))}
            </div>
            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Mematikan push tidak mengubah stok pusat — hanya menahan pengiriman angka ke
              marketplace. Setiap penahanan tercatat di log sinkronisasi.
            </p>
          </Section>

          {/* 4 — Preferensi Stok Opname */}
          <Section
            icon={ClipboardList}
            title="Preferensi Stok Opname"
            desc="Pengingat rutin untuk menghitung fisik ulang stok gudang."
          >
            <label className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-gray-700">Frekuensi pengingat</span>
              <select
                value={settings.opnameReminderFrequency}
                onChange={(e) =>
                  setSettings({ ...settings, opnameReminderFrequency: e.target.value })
                }
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {FREQ_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Preferensi disimpan dulu — pengingat otomatis (penjadwal) belum berjalan dan akan
              dikerjakan terpisah.
            </p>
          </Section>
        </div>
      )}
    </div>
  );
}
