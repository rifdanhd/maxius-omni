"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  Info,
  Loader2,
  PackageOpen,
  Percent,
  Plus,
  RefreshCw,
  Search,
  Store,
  Tag,
} from "lucide-react";
import {
  classifyPromotionTab,
  countPromotionTabs,
  type PromotionTabId,
} from "@/lib/services/promotion-tab.service";
import { authFetch } from "@/lib/utils/api-client";

/* ------------------------------ Types ------------------------------ */

type PromotionItem = {
  id: string;
  externalItemKey: string;
  platformProductId: string;
  platformSkuId: string | null;
  productMapping: { id: string; channelSku: string; platformProductId: string } | null;
  discount: string | null;
  activityPriceAmount: string | null;
  activityPriceCurrency: string | null;
  quantityLimit: number | null;
  quantityPerUser: number | null;
  usedQuantity: number | null;
  createdAt: string;
  updatedAt: string;
};

type PromotionActivity = {
  id: string;
  accountId: string;
  externalActivityId: string;
  title: string;
  activityType: string;
  status: string;
  productLevel: string;
  durationType: string | null;
  startsAt: string;
  endsAt: string;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  lastConfirmedAt: string | null;
  account: { id: string; label: string };
  items: PromotionItem[];
};

// Alert dari GET /promotions/alerts — UNVERIFIED / PENDING menggantung.
type PromotionAlertLite = {
  kind: string;
  auditLogId: string;
  activityTitle: string | null;
  externalActivityId: string | null;
  username: string;
  createdAt: string;
  reason: string;
};

/* ------------------------------ Constants ------------------------------ */

// Label ID untuk tipe activity TikTok (nilai lain → kode asli ditampilkan).
const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  DIRECT_DISCOUNT: "Diskon Langsung",
  FIXED_PRICE: "Harga Tetap",
  FLASHSALE: "Flash Sale",
  SHIPPING_DISCOUNT: "Diskon Ongkir",
};

// Badge warna per status activity (nilai API TikTok).
const STATUS_BADGE: Record<string, string> = {
  ONGOING: "bg-muted text-foreground border-border",
  NOT_START: "bg-muted text-foreground border-border",
  DEACTIVATED: "bg-muted text-foreground border-border",
  ENDED: "bg-muted text-muted-foreground border-border",
  NOT_EFFECTIVE: "bg-muted text-foreground border-border",
};

const PRODUCT_LEVEL_LABEL: Record<string, string> = {
  PRODUCT: "Level Produk (SPU)",
  VARIATION: "Level Varian (SKU)",
  SHOP: "Seluruh Toko",
};

// Empty state per tab (teks disesuaikan konteks tab).
const TAB_EMPTY_TEXT: Record<PromotionTabId, string> = {
  aktif: "Tidak ada promo yang sedang berjalan.",
  upcoming: "Tidak ada promo yang dijadwalkan.",
  ended: "Tidak ada promo yang telah berakhir.",
};

const TAB_LABEL: Record<PromotionTabId, string> = {
  aktif: "Aktif",
  upcoming: "Akan Datang",
  ended: "Telah Berakhir",
};

const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

// Waktu relatif id-ID untuk kolom Sinkronisasi ("5 menit lalu").
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "-";
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 60) return "baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} hari lalu`;
  return fmtDateTime(iso);
}

function statusBadgeClass(status: string): string {
  return STATUS_BADGE[status] ?? "bg-muted text-foreground border-border";
}

function activityTypeLabel(type: string): string {
  return ACTIVITY_TYPE_LABEL[type] ?? type;
}

/* ------------------------------ Item detail (expand) ------------------------------ */

function ActivityItemsDetail({ activity }: { activity: PromotionActivity }) {
  if (activity.items.length === 0) {
    return (
      <p className="px-4 py-3 text-xs italic text-muted-foreground">
        Tidak ada item tersimpan untuk activity ini.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto bg-muted/60">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="pl-11 pr-4 py-2 font-semibold">Produk / SKU</th>
            <th className="px-4 py-2 font-semibold">Diskon</th>
            <th className="px-4 py-2 font-semibold">Harga Aktivitas</th>
            <th className="px-4 py-2 font-semibold">Limit Qty</th>
            <th className="px-4 py-2 font-semibold">Terpakai</th>
          </tr>
        </thead>
        <tbody>
          {activity.items.map((item) => {
            const productName = item.productMapping?.channelSku ?? null;
            return (
              <tr key={item.id} className="border-b border-border last:border-0 hover:bg-card/60">
                <td className="pl-11 pr-4 py-3">
                  <p className="font-semibold text-foreground">
                    {productName ?? item.platformProductId}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {item.platformSkuId ? `SKU ${item.platformSkuId}` : `Product ${item.platformProductId}`}
                    {item.productMapping ? "" : " · belum ter-mapping di Maxius"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  {item.discount ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-foreground border border-border">
                      <Percent size={11} />
                      {item.discount}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-foreground">
                  {item.activityPriceAmount
                    ? `${item.activityPriceCurrency ?? ""} ${item.activityPriceAmount}`.trim()
                    : item.activityPriceCurrency
                      ? `${item.activityPriceCurrency} (tanpa amount)`
                      : "-"}
                </td>
                <td className="px-4 py-3 text-xs text-foreground">
                  {item.quantityLimit ?? "-"}
                  {item.quantityPerUser !== null && item.quantityPerUser !== undefined ? (
                    <span className="text-[11px] text-muted-foreground block">
                      max {item.quantityPerUser}/pembeli
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-xs text-foreground">{item.usedQuantity ?? "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Page ------------------------------ */

const TAB_ORDER: PromotionTabId[] = ["aktif", "upcoming", "ended"];

export default function PromotionsPage() {
  const [activities, setActivities] = useState<PromotionActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // "now" dipatok saat fetch — klasifikasi tab konsisten sampai refetch.
  const [now, setNow] = useState<Date>(() => new Date());

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [accountFilter, setAccountFilter] = useState("ALL");
  const [tab, setTab] = useState<PromotionTabId>("aktif");

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Alert UNVERIFIED / PENDING menggantung (Tahap 3) — harus TERLIHAT di UI,
  // bukan cuma tersimpan di kolom DB yang tidak pernah dibaca.
  const [alerts, setAlerts] = useState<PromotionAlertLite[]>([]);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const token = localStorage.getItem("token");
    let cancelled = false;
    async function run() {
      try {
        const res = await authFetch("/api/marketplace/tiktok/promotions/alerts", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { alerts?: PromotionAlertLite[] };
        if (!cancelled) setAlerts(data.alerts ?? []);
      } catch {
        if (!cancelled) setAlerts([]);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const visibleAlerts = alerts.filter((a) => !dismissedAlertIds.has(a.auditLogId));

  // Activity yang punya alert UNVERIFIED → badge "perlu cek manual" di baris list
  // (status TikTok-nya bisa saja NOT_START/ONGOING — bahayanya justru tidak kelihatan).
  const unverifiedActivityIds = useMemo(
    () =>
      new Set(
        alerts.filter((a) => a.kind === "UNVERIFIED" && a.externalActivityId).map((a) => a.externalActivityId)
      ),
    [alerts]
  );

  // Daftar unik toko dari data ter-load (read-only, filter sisi client).
  const accounts = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of activities) map.set(a.account.id, a.account.label);
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [activities]);

  // Search juga menyentuh produk/SKU di dalam activity.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return activities.filter((a) => {
      if (accountFilter !== "ALL" && a.account.id !== accountFilter) return false;
      if (!needle) return true;
      const itemText = a.items
        .map(
          (i) =>
            `${i.productMapping?.channelSku ?? ""} ${i.platformSkuId ?? ""} ${i.platformProductId}`
        )
        .join(" ")
        .toLowerCase();
      const haystack = `${a.title} ${a.externalActivityId} ${a.activityType} ${itemText}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [activities, q, accountFilter]);

  // Badge jumlah per tab dihitung dari hasil filter search/toko.
  const counts = useMemo(() => countPromotionTabs(filtered, now), [filtered, now]);

  const rows = useMemo(
    () => filtered.filter((a) => classifyPromotionTab(a, now) === tab),
    [filtered, tab, now]
  );

  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    let cancelled = false;

    async function run() {
      setLoading(true);
      try {
        const res = await authFetch("/api/marketplace/tiktok/promotions?take=100", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(data?.error ?? `Gagal memuat data (${res.status}).`);
          return;
        }
        const data = (await res.json()) as { ok: boolean; activities: PromotionActivity[] };
        setActivities(data.activities ?? []);
        setNow(new Date());
        setError(null);
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setError("Terjadi kesalahan saat memuat data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filterActive = q.trim() !== "" || accountFilter !== "ALL";

  return (
    <div className="p-4 md:p-8">
      {/* Page header + badge mode monitoring */}
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl font-bold text-foreground">Promosi Marketplace</h1>
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-[11px] font-bold text-foreground"
              title="Halaman ini menampilkan data dari TikTok Shop & Shopee — tidak ada aksi kelola"
            >
              <Info size={12} />
              Mode monitoring (baca-saja)
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground uppercase tracking-wider">
            Marketplace › Promosi
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/promotions/create"
            className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary"
          >
            <Plus size={16} />
            Buat Promosi Baru
          </Link>
          <span className="text-xs text-muted-foreground">
            {activities.length > 0 ? (
              <>
                <b className="text-foreground">{activities.length}</b> activity terpantau
              </>
            ) : (
              "Data diperbarui lewat ingest"
            )}
          </span>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {loading ? "Memuat..." : "Muat Ulang"}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-foreground">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Banner alert UNVERIFIED / PENDING menggantung — jangan sampai activity
          zombie terlewat: create sukses menurut sebagian sumber tapi tidak
          terkonfirmasi, atau intent PENDING >30 menit (proses crash). */}
      {visibleAlerts.length > 0 && (
        <div className="mb-4 rounded-lg border border-border bg-muted px-4 py-3">
          <div className="flex items-start gap-2 text-sm text-foreground">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">
                {visibleAlerts.length} tindakan promosi perlu perhatian (TIDAK TERVERIFIKASI)
              </p>
              <ul className="mt-1 space-y-1 text-xs">
                {visibleAlerts.map((a) => (
                  <li key={a.auditLogId} className="leading-snug">
                    <b>{a.kind === "STALE_PENDING" ? "MENGGANTUNG" : "UNVERIFIED"}</b>
                    {a.activityTitle ? ` — "${a.activityTitle}"` : ""}
                    {a.externalActivityId ? ` (ID ${a.externalActivityId})` : ""}: {a.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-foreground">
                Cek TikTok Seller Center — nonaktifkan activity zombie bila ada.
              </p>
            </div>
            <button
              onClick={() => setDismissedAlertIds(new Set(alerts.map((a) => a.auditLogId)))}
              className="shrink-0 rounded px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-muted"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl shadow-sm">
        {/* Toolbar: search + dropdown toko + reset filter — satu baris */}
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <div className="relative w-80">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari nama promosi, produk, atau SKU"
              className="border border-border rounded-md pl-3 pr-10 py-2 text-sm outline-none w-full h-[38px] font-medium"
            />
            <Search size={16} className="text-muted-foreground absolute right-3 top-2.5" />
          </div>

          <div className="relative">
            <Store size={14} className="text-muted-foreground absolute left-3 top-3 pointer-events-none" />
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="border border-border rounded-md pl-8 pr-3 py-2 text-sm outline-none h-[38px] bg-card cursor-pointer font-medium"
            >
              <option value="ALL">Semua Toko</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.label}
                </option>
              ))}
            </select>
          </div>

          {filterActive && (
            <button
              onClick={() => {
                setSearchInput("");
                setAccountFilter("ALL");
              }}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground h-[38px] hover:bg-muted"
            >
              Reset Filter
            </button>
          )}
        </div>

        {/* Tabs per status — SELALU terlihat (badge 0 saat kosong) supaya
            struktur halaman jelas, bukan hanya muncul saat ada data. */}
        <div className="px-4 pt-3 flex items-center gap-2 flex-wrap border-b border-border">
            {TAB_ORDER.map((key) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setTab(key);
                    setExpanded(new Set());
                  }}
                  className={`px-4 py-2 rounded-t-lg text-sm font-semibold flex items-center gap-2 border border-b-0 transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-transparent"
                      : "bg-muted text-foreground border-border hover:bg-muted"
                  }`}
                >
                  {TAB_LABEL[key]}
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      active ? "bg-card/20 text-primary-foreground" : "bg-muted/70 text-muted-foreground"
                    }`}
                  >
                    {counts[key]}
                  </span>
                </button>
              );
            })}
          </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 size={28} className="animate-spin mb-3 text-foreground" />
            <p className="text-sm">Memuat daftar promosi…</p>
          </div>
        ) : activities.length === 0 ? (
          /* Empty state global — belum ada data ingest sama sekali */
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
            <div className="mb-5 rounded-2xl bg-muted p-5">
              <PackageOpen size={32} className="mx-auto text-muted-foreground" />
            </div>
            <h2 className="mb-1.5 text-base font-bold text-foreground">
              Belum ada promo aktif dari marketplace
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Data promosi muncul otomatis — ingest berjalan tiap 30 menit (TikTok &
amp; Shopee). Untuk tarik sekarang, jalankan{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground">
                scripts/run-promotion-ingest.mts
              </code>
              .
            </p>
          </div>
        ) : rows.length === 0 ? (
          /* Empty state per tab */
          <div className="flex flex-col items-center justify-center py-14 px-8 text-center">
            <div className="mb-4 rounded-2xl bg-muted p-4">
              <Tag size={24} className="mx-auto text-muted-foreground" />
            </div>
            <h2 className="mb-1 text-sm font-bold text-foreground">{TAB_EMPTY_TEXT[tab]}</h2>
            {filterActive ? (
              <p className="text-xs text-muted-foreground">
                Coba ubah kata kunci atau reset filter toko — activity bisa saja ada di tab lain.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Activity dengan status lain tetap tampil di tab yang sesuai.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Tabel activity */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/50">
                    <th className="px-4 py-3 font-semibold w-[24%]">Nama Promosi</th>
                    <th className="px-4 py-3 font-semibold w-[24%]">Informasi Produk</th>
                    <th className="px-4 py-3 font-semibold w-[14%]">Toko</th>
                    <th className="px-4 py-3 font-semibold w-[19%]">Periode</th>
                    <th className="px-4 py-3 font-semibold w-[13%]">Sinkronisasi</th>
                    <th className="px-4 py-3 font-semibold text-right w-[6%]">Info</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((activity) => {
                    const isExpanded = expanded.has(activity.id);
                    const firstProduct =
                      activity.items[0]?.productMapping?.channelSku ??
                      activity.items[0]?.platformProductId ??
                      null;
                    return (
                      <Fragment key={activity.id}>
                        <tr
                          className="border-b border-border hover:bg-muted/50 align-top"
                        >
                          <td className="px-4 py-3.5">
                            <div className="flex items-start gap-2">
                              <div
                                className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                  activity.status === "ONGOING"
                                    ? "bg-muted text-foreground"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                <Tag size={14} />
                              </div>
                              <div className="min-w-0">
                                <p
                                  className="font-bold text-foreground leading-tight truncate max-w-[260px]"
                                  title={activity.title}
                                >
                                  {activity.title}
                                </p>
                                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full border ${statusBadgeClass(activity.status)}`}
                                  >
                                    {activity.status}
                                  </span>
                                  {unverifiedActivityIds.has(activity.externalActivityId) && (
                                    <span
                                      className="px-1.5 py-0.5 text-[10px] font-bold rounded-full border bg-muted text-foreground border-border"
                                      title="Create dari Maxius tidak terkonfirmasi — cek TikTok Seller Center"
                                    >
                                      Perlu cek manual
                                    </span>
                                  )}
                                  <span className="text-[11px] text-muted-foreground">
                                    {activityTypeLabel(activity.activityType)}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground">•</span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {PRODUCT_LEVEL_LABEL[activity.productLevel] ??
                                      activity.productLevel}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Informasi Produk: jumlah + preview produk pertama, klik utk expand */}
                          <td className="px-4 py-3.5">
                            <button
                              type="button"
                              onClick={() => toggleExpand(activity.id)}
                              className="flex items-start gap-1.5 text-left group"
                              title="Klik untuk lihat detail item"
                            >
                              <ChevronDown
                                size={14}
                                className={`mt-0.5 shrink-0 text-muted-foreground transition-transform ${
                                  isExpanded ? "rotate-180" : ""
                                }`}
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-bold text-foreground group-hover:text-foreground">
                                  {activity.items.length} produk
                                </span>
                                <span className="block text-[11px] text-muted-foreground truncate max-w-[220px]">
                                  {firstProduct ?? "-"}
                                  {activity.items.length > 1
                                    ? ` +${activity.items.length - 1} lainnya`
                                    : ""}
                                </span>
                              </span>
                            </button>
                          </td>

                          <td className="px-4 py-3.5">
                            <span
                              className="text-xs font-semibold text-foreground block truncate max-w-[150px]"
                              title={activity.account.label}
                            >
                              {activity.account.label}
                            </span>
                          </td>

                          <td className="px-4 py-3.5">
                            <p className="text-xs font-semibold text-foreground">
                              {fmtDateTime(activity.startsAt)}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              s/d {fmtDateTime(activity.endsAt)}
                            </p>
                          </td>

                          <td className="px-4 py-3.5">
                            <p className="text-xs text-foreground">
                              {formatRelativeTime(activity.lastConfirmedAt)}
                            </p>
                            <p
                              className="text-[11px] text-muted-foreground"
                              title={fmtDateTime(activity.lastConfirmedAt)}
                            >
                              Terakhir disinkron
                            </p>
                          </td>

                          {/* Kolom Info — pengganti "Atur": TIDAK ada aksi kelola */}
                          <td className="px-4 py-3.5 text-right">
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground border border-border">
                              <Info size={10} />
                              Baca saja
                            </span>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr>
                            <td colSpan={6} className="p-0 border-b border-border">
                              <ActivityItemsDetail activity={activity} />
                              <div className="px-4 py-2 flex items-center justify-between bg-muted/60">
                                <p className="text-[11px] font-mono text-muted-foreground">
                                  ID: {activity.externalActivityId}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  Terakhir dikonfirmasi: {fmtDateTime(activity.lastConfirmedAt)}
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Catatan read-only */}
            <div className="m-4 flex items-start gap-2 rounded-lg border border-border bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
              <Info size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                Halaman ini <b>mode monitoring (baca-saja)</b>: data ditampilkan apa adanya dari
                TikTok Shop &amp; Shopee tanpa aksi buat/ubah/nonaktifkan promo. Data diperbarui
                lewat ingest terjadwal/otomatis (tiap 30 menit).
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
