"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  BellRing,
  ClipboardList,
  Loader2,
  Mail,
  Save,
  SlidersHorizontal,
  Store,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  Clock,
} from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";
import { ErrorFeedback } from "@/components/ui/feedback";

/* ------------------------------ Types ------------------------------ */

type Settings = {
  lowStockDefaultThreshold: number;
  notifyLowStock: boolean;
  notifyLowStockEmail: boolean;
  syncPushTokopedia: boolean;
  syncPushShopee: boolean;
  syncPushTiktok: boolean;
  stockPushEnabled: boolean;
  stockBaselineReady: boolean;
  opnameReminderFrequency: string;
};

type StoreSummary = {
  tiktok: number;
  shopee: number;
  total: number;
};

const FREQ_OPTIONS = [
  { id: "off", label: "Nonaktif", desc: "Tidak menampilkan pengingat opname" },
  { id: "daily", label: "Harian", desc: "Setiap hari" },
  { id: "weekly", label: "Mingguan", desc: "Setiap 7 hari sekali" },
  { id: "monthly", label: "Bulanan", desc: "Setiap 30 hari sekali (Disarankan)" },
] as const;

const THRESHOLD_PRESETS = [5, 10, 20, 50];

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
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
        checked ? "bg-primary" : "bg-muted"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/* ------------------------------ Section ------------------------------ */

function Section({
  icon: Icon,
  title,
  desc,
  badge,
  children,
}: {
  icon: typeof Store;
  title: string;
  desc: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs transition-shadow hover:shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
              {badge}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------ Page ------------------------------ */

export default function InventorySettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [initialSettings, setInitialSettings] = useState<Settings | null>(null);
  const [storeSummary, setStoreSummary] = useState<StoreSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalPushEnabled, setGlobalPushEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const { settings: s, pushRuntime, storeSummary: summary } = await api<{
          settings: Settings;
          pushRuntime?: { globalEnabled: boolean };
          storeSummary?: StoreSummary;
        }>("/api/inventory/settings");
        if (!cancelled) {
          setSettings(s);
          setInitialSettings(s);
          setGlobalPushEnabled(pushRuntime?.globalEnabled ?? null);
          if (summary) setStoreSummary(summary);
        }
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

  const isDirty = useMemo(() => {
    if (!settings || !initialSettings) return false;
    return JSON.stringify(settings) !== JSON.stringify(initialSettings);
  }, [settings, initialSettings]);

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
      setInitialSettings(fresh);
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
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="text-sm">Memuat pengaturan inventori…</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      {/* Header Halaman */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Pengaturan Inventori
            </h1>
            {isDirty && (
              <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                Ada perubahan belum disimpan
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Atur batas stok rendah dan pengiriman stok ke toko; mulai dengan meninjau nilai setiap pengaturan, lalu klik Simpan Pengaturan. Perubahan tidak otomatis berarti stok toko sudah berhasil diperbarui.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {saved && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>Tersimpan</span>
            </div>
          )}
          <button
            onClick={save}
            disabled={saving || !settings || (!isDirty && !saved)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all shadow-xs ${
              isDirty
                ? "bg-primary text-primary-foreground hover:bg-primary/90 ring-2 ring-primary/20"
                : "bg-primary/80 text-primary-foreground hover:bg-primary"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span>Simpan Pengaturan</span>
          </button>
        </div>
      </div>

      {error && <ErrorFeedback error={error} className="mb-2" />}

      {!settings ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Pengaturan belum dapat dimuat. Muat ulang halaman untuk mencoba lagi; jangan mengubah stok sebelum pengaturan dapat diperiksa.
        </div>
      ) : (
        <div className="grid gap-5">
          {/* 1 — Ambang Batas Stok Rendah */}
          <Section
            icon={SlidersHorizontal}
            title="Ambang Batas Stok Rendah"
            desc="Produk baru otomatis memakai nilai ini sebagai ambang awal."
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    value={settings.lowStockDefaultThreshold}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        lowStockDefaultThreshold: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-32 rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                  />
                </div>
                <span className="text-sm font-medium text-foreground">
                  unit atau kurang = stok menipis
                </span>

                <div className="flex items-center gap-1.5 pl-2">
                  <span className="text-xs text-muted-foreground">Preset cepat:</span>
                  {THRESHOLD_PRESETS.map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setSettings({ ...settings, lowStockDefaultThreshold: val })}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        settings.lowStockDefaultThreshold === val
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p>
                  Berlaku untuk <b>produk baru</b> (Pemetaan Produk &amp; Salin Produk). Produk yang
                  sudah ada memakai ambang per-produk masing-masing dan tetap bisa diubah melalui Batas Min di halaman Stok Varian. Nilai ini dipakai dashboard &ldquo;Yang Perlu Dilakukan&rdquo;,
                  lonceng notifikasi, dan penanda stok di halaman produk.
                </p>
              </div>
            </div>
          </Section>

          {/* 2 — Notifikasi Stok */}
          <Section
            icon={BellRing}
            title="Notifikasi Stok"
            desc="Peringatan saat stok produk menyentuh ambang batas."
          >
            <div className="divide-y divide-border/60">
              <label className="flex cursor-pointer items-center justify-between gap-4 py-3.5">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium text-foreground">Notifikasi di Aplikasi (In-App)</div>
                  <div className="text-xs text-muted-foreground">
                    Lonceng notifikasi &ldquo;Stok Menipis&rdquo; di kanan atas dashboard.
                  </div>
                </div>
                <Toggle
                  checked={settings.notifyLowStock}
                  onChange={(v) => setSettings({ ...settings, notifyLowStock: v })}
                  aria-label="Toggle notifikasi in-app"
                />
              </label>

              <div className="flex items-center justify-between gap-4 py-3.5 opacity-70">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>Notifikasi email</span>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Segera Hadir
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Belum tersedia — sistem belum terhubung ke layanan email.
                  </div>
                </div>
                <Toggle
                  disabled
                  checked={settings.notifyLowStockEmail}
                  onChange={(v) => setSettings({ ...settings, notifyLowStockEmail: v })}
                  aria-label="Toggle notifikasi email (belum tersedia)"
                />
              </div>
            </div>
          </Section>

          {/* 3 — Sinkronisasi Stok ke Marketplace */}
          <Section
            icon={Store}
            title="Sinkronisasi Stok ke Marketplace"
            desc="Kirim target stok terbaru setelah penyesuaian manual atau hitung stok fisik. Periksa kegagalan di Stok Mismatch."
          >
            <div className="space-y-4">
              {/* Banner Peringatan Server Runtime (bila dinonaktifkan di server env) */}
              {globalPushEnabled === false && (
                <div
                  role="status"
                  className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300"
                >
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="space-y-1">
                    <p className="font-semibold">Push Stok Global Server Nonaktif</p>
                    <p className="text-xs leading-relaxed opacity-90">
                      Push stok sedang dinonaktifkan pada server. Mengaktifkan pengaturan brand atau platform belum mengirim stok sampai server mengizinkan pengiriman.
                    </p>
                  </div>
                </div>
              )}

              <div className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card p-3">
                <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold text-foreground">Baseline stok sudah diisi</div>
                    <div className="text-xs text-muted-foreground">Aktifkan hanya setelah seluruh stok awal tervalidasi. Tanpa konfirmasi ini, tidak ada stok yang dikirim ke marketplace.</div>
                  </div>
                  <Toggle checked={settings.stockBaselineReady} onChange={(value) => setSettings({ ...settings, stockBaselineReady: value })} aria-label="Konfirmasi baseline stok sudah diisi" />
                </label>
                {/* Gate Brand Utama */}
                <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold text-foreground">Push stok brand ini</div>
                    <div className="text-xs text-muted-foreground">
                      Berlaku untuk semua toko brand ini; pengaturan per toko dan platform tetap diperiksa.
                    </div>
                  </div>
                  <Toggle
                    checked={settings.stockPushEnabled}
                    onChange={(value) => setSettings({ ...settings, stockPushEnabled: value })}
                    aria-label="Toggle push stok brand"
                  />
                </label>

                {/* Platform Toggles */}
                {[
                  {
                    key: "syncPushTiktok" as const,
                    label: "TikTok Shop",
                    storeCount: storeSummary?.tiktok,
                    note: "Pembaruan masuk antrean dan digabung sebelum dikirim. Status koneksi toko diperiksa di Pengaturan Toko.",
                    disabled: false,
                  },
                  {
                    key: "syncPushShopee" as const,
                    label: "Shopee",
                    storeCount: storeSummary?.shopee,
                    note: "Perubahan stok dikirim ke item dan variasi Shopee sesuai mapping toko. Kegagalan API tercatat per listing.",
                    disabled: false,
                  },
                ].map((p) => (
                  <label
                    key={p.key}
                    className={`flex items-center justify-between gap-4 py-3.5 ${
                      p.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{p.label}</span>
                        {p.disabled ? (
                          <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Segera Hadir
                          </span>
                        ) : typeof p.storeCount === "number" ? (
                          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            {p.storeCount} Toko Terhubung
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">{p.note}</div>
                    </div>
                    <Toggle
                      disabled={p.disabled}
                      checked={settings[p.key]}
                      onChange={(v) => setSettings({ ...settings, [p.key]: v })}
                      aria-label={`Toggle sinkronisasi ${p.label}`}
                    />
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
                <p>
                  Mematikan push tidak mengubah stok pusat — hanya menahan pengiriman angka ke
                  marketplace. Setiap penahanan tercatat di log sinkronisasi.
                </p>
                <Link
                  href="/settings/accounts"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  <span>Atur per toko</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </Section>

          {/* 4 — Pengingat Stok Opname (Hitung Fisik) */}
          <Section
            icon={ClipboardList}
            title="Pengingat Stok Opname (Hitung Fisik)"
            desc="Pengingat rutin untuk menghitung fisik ulang stok gudang agar stok fisik selalu sesuai dengan sistem."
          >
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <label htmlFor="opname-freq-select" className="text-sm font-medium text-foreground">
                    Frekuensi Pengingat
                  </label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Pengingat akan muncul di Lonceng Notifikasi dashboard bila telah melewati jadwal ini.
                  </p>
                </div>

                <select
                  id="opname-freq-select"
                  value={settings.opnameReminderFrequency}
                  onChange={(e) =>
                    setSettings({ ...settings, opnameReminderFrequency: e.target.value })
                  }
                  className="rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-medium text-foreground shadow-xs focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                >
                  {FREQ_OPTIONS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label} — {f.desc}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span>
                    Status opname terakhir dan varian yang perlu dihitung fisik dapat dilihat di halaman Stok Opname.
                  </span>
                </div>
                <Link
                  href="/inventory/opname"
                  className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
                >
                  <span>Buka Stok Opname</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
