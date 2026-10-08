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
  const res = await authFetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      
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
        checked ? "bg-primary" : "bg-muted"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${
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
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="rounded-lg bg-muted p-2 text-foreground">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-bold text-foreground">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
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
      <div className="flex h-full min-h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat…
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pengaturan Inventori</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Atur batas stok rendah dan pengiriman stok ke toko; mulai dengan meninjau nilai setiap pengaturan, lalu klik Simpan Pengaturan. Perubahan tidak otomatis berarti stok toko sudah berhasil diperbarui.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CheckCircle2 className="h-4 w-4" /> Tersimpan
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || !settings}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Simpan Pengaturan
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
          <div>{error}</div>
        </div>
      )}

      {!settings ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Pengaturan belum dapat dimuat. Muat ulang halaman untuk mencoba lagi; jangan mengubah stok sebelum pengaturan dapat diperiksa.
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
                className="w-28 rounded-lg border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none"
              />
              <span className="text-sm text-muted-foreground">unit atau kurang = stok menipis</span>
            </div>
            <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Berlaku untuk <b>produk baru</b> (Pemetaan Produk &amp; Salin Produk). Produk yang
              sudah ada memakai ambang per-produk masing-masing dan tetap bisa diubah melalui Batas Min di halaman Stok Varian. Nilai ini dipakai dashboard &ldquo;Yang Perlu Dilakukan&rdquo;,
              lonceng notifikasi, dan penanda stok di halaman produk.
            </p>
          </Section>

          {/* 2 — Notifikasi stok */}
          <Section
            icon={BellRing}
            title="Notifikasi Stok"
            desc="Peringatan saat stok produk menyentuh ambang batas."
          >
            <div className="divide-y divide-border">
              <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
                <div>
                  <div className="font-medium text-foreground">Notifikasi di Aplikasi (In-App)</div>
                  <div className="text-sm text-muted-foreground">
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
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Mail className="h-4 w-4 text-muted-foreground" /> Notifikasi email
                  </div>
                  <div className="text-sm text-muted-foreground">
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
            desc="Kirim target stok terbaru setelah penyesuaian manual atau hitung stok fisik. Periksa kegagalan di Stok Mismatch."
          >
            <div className="divide-y divide-border">
              {(
                [
                  {
                    key: "syncPushTiktok" as const,
                    label: "TikTok Shop",
                    note: "Pembaruan masuk antrean dan digabung sebelum dikirim. Status koneksi toko diperiksa di Pengaturan Toko.",
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
                    <div className="font-medium text-foreground">{p.label}</div>
                    <div className="text-sm text-muted-foreground">{p.note}</div>
                  </div>
                  <Toggle
                    disabled={p.key !== "syncPushTiktok"}
                    checked={settings[p.key]}
                    onChange={(v) => setSettings({ ...settings, [p.key]: v })}
                  />
                </label>
              ))}
            </div>
            <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Mematikan push tidak mengubah stok pusat — hanya menahan pengiriman angka ke
              marketplace. Setiap penahanan tercatat di log sinkronisasi.
            </p>
          </Section>

          {/* 4 — Preferensi Stok Opname */}
          <Section
            icon={ClipboardList}
            title="Pengingat Hitung Stok Fisik (Belum Tersedia)"
            desc="Pengingat rutin untuk menghitung fisik ulang stok gudang."
          >
            <label className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-foreground">Frekuensi pengingat</span>
              <select
                disabled
                value={settings.opnameReminderFrequency}
                onChange={(e) =>
                  setSettings({ ...settings, opnameReminderFrequency: e.target.value })
                }
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-ring focus:outline-none"
              >
                {FREQ_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Preferensi disimpan dulu — pengingat otomatis (penjadwal) belum berjalan dan akan
              dikerjakan terpisah.
            </p>
          </Section>
        </div>
      )}
    </div>
  );
}
