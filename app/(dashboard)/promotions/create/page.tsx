"use client";

/**
 * TAHAP 4 — Wizard BUAT Discount Activity (DIRECT_DISCOUNT) dari Maxius.
 *
 * 3 step (bukan satu form panjang):
 *   1. Pilih produk (listing aktif) — produk tanpa harga WAJIB di-set dulu
 *      inline (PATCH /products/pricing/[variantId]) sebelum boleh lanjut.
 *   2. Atur diskon & jadwal → Preview (POST /preview, zero-write): harga asli →
 *      final, blocking error (G1), pesan dampak ekstrem VERBATIM (G2, border
 *      merah), overlap aktif (G3).
 *   3. Konfirmasi: ketik "BUAT" persis (case-sensitive) → POST /create.
 *
 * Aturan penting:
 * - TIDAK ada auto-retry untuk create — operasi sensitif (uang riil); gagal =
 *   user re-submit manual.
 * - Error backend diterjemahkan ke Bahasa Indonesia awam; kode/error asli
 *   dicatat ke console untuk debugging.
 * - quantity_limit / quantity_per_user tidak diminta — server default -1
 *   (unlimited), tervalidasi sandbox.
 * - Server TETAP re-validasi semuanya (G1–G4); validasi di UI hanya UX.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Percent,
  Search,
  ShieldAlert,
} from "lucide-react";
import { authFetch } from "@/lib/utils/api-client";

/* ------------------------------ Types (bentuk response API) ------------------------------ */

type TikTokAccount = { id: string; label: string };

type ListingVariant = {
  mappingId: string;
  variantId: string;
  sku: string;
  channelSku: string;
  price: number | null;
  stock: number;
};

type ListingRow = {
  key: string;
  accountId: string;
  accountLabel: string;
  platformProductId: string | null;
  platformTitle: string | null;
  master: { name: string | null; imageUrl: string | null } | null;
  channelSku: string | null;
  priceMin: number | null;
  priceMax: number | null;
  variantCount: number;
  variants: ListingVariant[];
};

type PreviewItem = {
  mappingId: string;
  input: {
    price: number | null;
    priceSource: "MAPPING_OVERRIDE" | "VARIANT_DEFAULT" | null;
    displayName: string | null;
    channelSku: string;
    platformProductId: string | null;
  };
  finalPrice: number | null;
  error: string | null;
  activeOverlaps: Array<{ externalActivityId: string; title: string; status: string; overlapKind: "FULL" | "PARTIAL" }>;
};

type PreviewResponse = {
  ok: boolean;
  items?: PreviewItem[];
  hasBlockingError?: boolean;
  hasActiveOverlap?: boolean;
  activityCountScanned?: number;
  extremeConfirmMessages?: Array<{ mappingId: string; displayName: string; discount: number; message: string }>;
  error?: string;
};

type CreateResponse = {
  ok: boolean;
  error?: string;
  itemErrors?: Array<{ mappingId: string; error: string }>;
  resultStatus?: "SUCCESS" | "TIKTOK_ERROR" | "UNVERIFIED" | "PARTIAL";
  externalActivityId?: string | null;
  title?: string;
  attachedCount?: number;
  failedBatches?: Array<{ batchIndex: number; error: string }>;
  unverifiedReason?: string;
  overlapWarningAcknowledged?: boolean;
};

/* ------------------------------ Helpers ------------------------------ */

const rupiah = (v: number | null | undefined) =>
  v === null || v === undefined ? "-" : `Rp ${Math.round(v).toLocaleString("id-ID")}`;

/** Default jadwal: besok jam berikutnya (aman utk lead time minimal +2 jam). */
function defaultBeginAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

/** G2 mirror client: null = valid; string = pesan. Server tetap re-check. */
function discountIssue(value: number): string | null {
  if (!Number.isInteger(value)) return "Diskon harus bilangan bulat.";
  if (value < 0 || value > 100) return "Diskon harus di antara 0 dan 100.";
  return null;
}

function isExtreme(value: number): boolean {
  return value === 0 || value >= 96;
}

const authHeaders = (): HeadersInit => {
  const token = localStorage.getItem("token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
};

/**
 * Terjemahkan error backend ke Bahasa Indonesia awam. Kode/error asli SELALU
 * dicatat ke console untuk debugging (permintaan reviewer).
 */
function translateError(raw: string, context: string): string {
  console.error(`[Promosi] ${context} — error asli:`, raw);
  if (raw.includes("LEAD_TIME_TOO_SHORT")) {
    return "Waktu mulai terlalu dekat. Pilih waktu mulai minimal 2 jam dari sekarang.";
  }
  if (raw.includes("END_BEFORE_START")) {
    return "Waktu selesai harus setelah waktu mulai.";
  }
  if (raw.includes("TOO_LONG")) {
    return "Durasi promo terlalu lama. Maksimal 90 hari.";
  }
  if (raw.includes("Konfirmasi wajib")) {
    return "Ketik kata BUAT di kotak konfirmasi untuk melanjutkan.";
  }
  if (raw.includes("tidak punya harga sumber") || raw.includes("belum punya harga")) {
    return "Ada produk yang belum punya harga. Kembali ke langkah 1 dan isi harga dulu.";
  }
  if (raw.includes("Mapping tidak ditemukan")) {
    return "Ada produk yang tidak terhubung ke toko ini. Muat ulang halaman lalu pilih ulang produk.";
  }
  if (raw.includes("belum ter-sync ke TikTok")) {
    return "Ada produk yang belum tersinkron ke TikTok. Sinkronkan produk dulu di halaman produk marketplace.";
  }
  if (raw.includes("activity AKTIF lain")) {
    return "Ada produk yang sedang ikut promo lain yang masih aktif. Hapus produk itu atau centang konfirmasi lanjut.";
  }
  if (raw.includes("HTTP 401") || raw.includes("Token")) {
    return "Sesi login habis. Muat ulang halaman dan login kembali.";
  }
  return raw;
}

const STEP_LABELS = ["Pilih Produk", "Atur Diskon & Jadwal", "Konfirmasi"];

/* ------------------------------ Page ------------------------------ */

export default function PromotionCreatePage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ── Data source
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // ── Step 1: pilihan + set harga inline
  const [discountByListingKey, setDiscountByListingKey] = useState<Record<string, number>>({});
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [priceSavingFor, setPriceSavingFor] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  // ── Step 2: diskon + preview
  const [bulkDiscount, setBulkDiscount] = useState<number>(10);
  const [beginAt, setBeginAt] = useState<string>(defaultBeginAt);
  const [durationDays, setDurationDays] = useState<number>(7);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmExtreme, setConfirmExtreme] = useState(false);
  const [acknowledgeActiveOverlap, setAcknowledgeActiveOverlap] = useState(false);

  // ── Step 3: konfirmasi + create
  const [confirmationWord, setConfirmationWord] = useState("");
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<CreateResponse | null>(null);

  // "now" dipatok saat mount — cek lead time client-side hanya UX.
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    authFetch("/api/marketplace/tiktok/products?tab=all&pageSize=1", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { accounts?: TikTokAccount[] }) => {
        setAccounts(data.accounts ?? []);
        if (data.accounts?.[0]) setAccountId(data.accounts[0].id);
      })
      .catch((e) => {
        console.error("[Promosi] gagal muat toko:", e);
        setLoadError("Gagal memuat daftar toko TikTok. Muat ulang halaman.");
      });
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    async function run() {
      setLoadingListings(true);
      setLoadError(null);
      const qs = new URLSearchParams({ tab: "active", pageSize: "100", accountIds: accountId });
      if (search.trim()) qs.set("search", search.trim());
      try {
        const r = await authFetch(`/api/marketplace/tiktok/products?${qs.toString()}`, { headers: authHeaders() });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { rows?: ListingRow[]; total?: number };
        if (cancelled) return;
        setListings(data.rows ?? []);
        if ((data.total ?? 0) > (data.rows?.length ?? 0)) {
          setLoadError(`Menampilkan ${data.rows?.length ?? 0} dari ${data.total} listing — persempit dengan pencarian.`);
        }
      } catch (e) {
        console.error("[Promosi] gagal muat produk:", e);
        if (!cancelled) setLoadError("Gagal memuat daftar produk. Coba lagi atau muat ulang halaman.");
      } finally {
        if (!cancelled) setLoadingListings(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [accountId, search]);

  const selected = useMemo(
    () =>
      Object.keys(discountByListingKey)
        .map((k) => listings.find((l) => l.key === k))
        .filter((l): l is ListingRow => Boolean(l)),
    [discountByListingKey, listings]
  );
  const selectedKeys = useMemo(() => selected.map((l) => l.key), [selected]);

  /** Listing terpilih yang masih punya varian tanpa harga → blok lanjut. */
  const missingPrices = useMemo(
    () =>
      selected
        .map((l) => ({
          listing: l,
          variants: l.variants.filter((v) => v.price === null),
        }))
        .filter((x) => x.variants.length > 0),
    [selected]
  );

  const step1Problem = useMemo(() => {
    if (selected.length === 0) return "Pilih minimal 1 produk.";
    if (missingPrices.length > 0)
      return `${missingPrices.length} produk masih belum punya harga — isi harga di daftar di atas dulu.`;
    return null;
  }, [selected, missingPrices]);

  const payload = useMemo(() => {
    const mappingIds: string[] = [];
    const discountByMappingId: Record<string, number> = {};
    for (const listing of selected) {
      for (const v of listing.variants) {
        mappingIds.push(v.mappingId);
        discountByMappingId[v.mappingId] = discountByListingKey[listing.key];
      }
    }
    return { mappingIds, discountByMappingId };
  }, [selected, discountByListingKey]);

  const endAtIso = useMemo(() => {
    const begin = new Date(beginAt);
    if (Number.isNaN(begin.getTime())) return "";
    return new Date(begin.getTime() + durationDays * 86400000).toISOString();
  }, [beginAt, durationDays]);

  const step2Problem = useMemo(() => {
    for (const key of selectedKeys) {
      const issue = discountIssue(discountByListingKey[key]);
      if (issue) return `Diskon belum benar: ${issue}`;
    }
    const begin = new Date(beginAt);
    if (Number.isNaN(begin.getTime())) return "Waktu mulai belum benar.";
    if (begin.getTime() - nowMs < 2 * 3600000) return "Waktu mulai minimal 2 jam dari sekarang.";
    if (durationDays < 1 || durationDays > 90) return "Durasi harus 1–90 hari.";
    return null;
  }, [selectedKeys, discountByListingKey, beginAt, durationDays, nowMs]);

  const hasExtreme = (preview?.extremeConfirmMessages?.length ?? 0) > 0;
  const hasActiveOverlap = preview?.hasActiveOverlap === true;
  const hasBlockingError = preview?.hasBlockingError === true;

  const step2GateOk =
    preview?.ok === true && !hasBlockingError && (!hasExtreme || confirmExtreme) && (!hasActiveOverlap || acknowledgeActiveOverlap);

  /* ------------------------------ Actions ------------------------------ */

  async function savePrice(variant: ListingVariant) {
    const raw = priceDraft[variant.variantId];
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value <= 0) {
      setPriceError("Harga harus angka lebih dari 0 (contoh: 100000).");
      return;
    }
    setPriceError(null);
    setPriceSavingFor(variant.variantId);
    try {
      const r = await authFetch(`/api/products/pricing/${variant.variantId}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ price: value }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${r.status}`);
      }
      // Update lokal — tidak perlu refetch daftar.
      setListings((prev) =>
        prev.map((l) =>
          l.key.includes(variant.channelSku) || l.variants.some((v) => v.variantId === variant.variantId)
            ? { ...l, variants: l.variants.map((v) => (v.variantId === variant.variantId ? { ...v, price: value } : v)) }
            : l
        )
      );
    } catch (e) {
      console.error("[Promosi] gagal simpan harga:", e);
      setPriceError(`Gagal menyimpan harga: ${e instanceof Error ? e.message : "coba lagi"}`);
    } finally {
      setPriceSavingFor(null);
    }
  }

  function toggleListing(listing: ListingRow) {
    setDiscountByListingKey((prev) => {
      const next = { ...prev };
      if (listing.key in next) delete next[listing.key];
      else next[listing.key] = bulkDiscount;
      return next;
    });
    setPreview(null);
    setConfirmExtreme(false);
    setAcknowledgeActiveOverlap(false);
  }

  function applyBulkDiscount() {
    if (!Number.isInteger(bulkDiscount)) return;
    const next: Record<string, number> = {};
    for (const key of selectedKeys) next[key] = bulkDiscount;
    setDiscountByListingKey((prev) => ({ ...prev, ...next }));
    setPreview(null);
    setConfirmExtreme(false);
    setAcknowledgeActiveOverlap(false);
  }

  async function runPreview() {
    setPreview(null);
    setConfirmExtreme(false);
    setAcknowledgeActiveOverlap(false);
    setPreviewing(true);
    try {
      const res = await authFetch("/api/marketplace/tiktok/promotions/preview", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          accountId,
          mappingIds: payload.mappingIds,
          discountByMappingId: payload.discountByMappingId,
          beginAt: new Date(beginAt).toISOString(),
          endAt: endAtIso,
        }),
      });
      const data = (await res.json()) as PreviewResponse;
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPreview(data);
    } catch (e) {
      console.error("[Promosi] preview gagal:", e);
      setPreview({ ok: false, error: translateError(e instanceof Error ? e.message : String(e), "preview") });
    } finally {
      setPreviewing(false);
    }
  }

  // TANPA auto-retry — create sensitif; gagal = user re-submit manual.
  async function runCreate() {
    setCreating(true);
    setCreateResult(null);
    try {
      const res = await authFetch("/api/marketplace/tiktok/promotions/create", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          accountId,
          mappingIds: payload.mappingIds,
          discountByMappingId: payload.discountByMappingId,
          beginAt: new Date(beginAt).toISOString(),
          endAt: endAtIso,
          confirmationWord,
          confirmExtreme,
          acknowledgeActiveOverlap,
        }),
      });
      const data = (await res.json()) as CreateResponse;
      if (!res.ok) {
        console.error("[Promosi] create ditolak server:", data);
        setCreateResult({
          ok: false,
          error: translateError(
            data.itemErrors?.map((i) => i.error).join(" | ") || data.error || `HTTP ${res.status}`,
            "create"
          ),
          itemErrors: data.itemErrors,
        });
        return;
      }
      console.error("[Promosi] create selesai dengan status:", data.resultStatus, data);
      setCreateResult(data);
    } catch (e) {
      console.error("[Promosi] create gagal (jaringan/server):", e);
      setCreateResult({
        ok: false,
        error: "Tidak ada jawaban dari server. TIDAK ada percobaan ulang otomatis — periksa dulu di halaman monitoring/Seller Center sebelum mencoba membuat lagi.",
      });
    } finally {
      setCreating(false);
      setConfirmationWord("");
    }
  }

  /* ------------------------------ Render helpers ------------------------------ */

  const previewByProduct = useMemo(() => {
    const map = new Map<string, { finalPrices: number[]; errors: string[]; overlaps: PreviewItem["activeOverlaps"] }>();
    for (const item of preview?.items ?? []) {
      const pid = item.input.platformProductId ?? item.input.channelSku;
      const entry = map.get(pid) ?? { finalPrices: [], errors: [], overlaps: [] };
      if (item.finalPrice !== null) entry.finalPrices.push(item.finalPrice);
      if (item.error) entry.errors.push(item.error);
      entry.overlaps.push(...item.activeOverlaps);
      map.set(pid, entry);
    }
    return map;
  }, [preview]);

  const listingPrice = (l: ListingRow): string => {
    if (l.priceMin === null) return "harga belum di-set";
    return l.priceMin === l.priceMax
      ? rupiah(l.priceMin)
      : `${rupiah(l.priceMin)} – ${rupiah(l.priceMax)}`;
  };

  const finalPriceText = (l: ListingRow): string => {
    if (l.platformProductId === null) return "—";
    const agg = previewByProduct.get(l.platformProductId);
    if (!agg || agg.finalPrices.length === 0) return "—";
    const min = Math.min(...agg.finalPrices);
    const max = Math.max(...agg.finalPrices);
    return min === max ? `→ ${rupiah(min)}` : `→ ${rupiah(min)} – ${rupiah(max)}`;
  };

  /* ------------------------------ Result panel ------------------------------ */

  if (createResult) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        {createResult.ok && createResult.resultStatus === "SUCCESS" ? (
          <div className="bg-white border border-emerald-200 rounded-xl shadow-sm p-6">
            <div className="flex items-start gap-3 text-emerald-700">
              <CheckCircle2 size={28} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-lg">Promosi berhasil dibuat & terverifikasi.</p>
                <p className="text-sm mt-1">
                  &quot;{createResult.title}&quot; — {createResult.attachedCount} produk terpasang (ID{" "}
                  {createResult.externalActivityId}).
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Harga mulai berlaku sesuai jadwal yang dipilih. Status terbaru muncul di halaman monitoring setelah sinkronisasi.
                </p>
              </div>
            </div>
          </div>
        ) : createResult.ok ? (
          /* UNVERIFIED / PARTIAL — warning BESAR: activity ada di TikTok tapi
             produk belum pasti ter-attach → wajib cek manual. */
          <div className="bg-white border-2 border-amber-400 rounded-xl shadow-sm p-6">
            <div className="flex items-start gap-3 text-amber-800">
              <AlertTriangle size={32} className="mt-0.5 shrink-0 text-amber-500" />
              <div>
                <p className="font-bold text-lg">
                  {createResult.resultStatus === "PARTIAL"
                    ? "Promosi TERPASANG SEBAGIAN — perlu pengecekan manual"
                    : "Promosi dibuat di TikTok, tapi produk BELUM PASTI ter-attach — perlu pengecekan manual"}
                </p>
                <p className="text-sm mt-2">
                  {createResult.attachedCount ?? 0} produk terpasang · ID activity: {createResult.externalActivityId ?? "-"}
                </p>
                <p className="text-sm mt-2 font-semibold">
                  Segera cek TikTok Seller Center (menu Promosi) atau hubungi admin. Jika activity terlihat kosong/salah,
                  nonaktifkan di sana agar pembeli tidak terkena diskon yang tidak diinginkan.
                </p>
                {createResult.unverifiedReason && (
                  <p className="text-xs text-amber-700 mt-2">Penyebab: {createResult.unverifiedReason}</p>
                )}
                {(createResult.failedBatches?.length ?? 0) > 0 && (
                  <ul className="text-xs mt-2 space-y-1 text-amber-700">
                    {createResult.failedBatches!.map((b) => (
                      <li key={b.batchIndex}>
                        Batch {b.batchIndex} gagal: {b.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-red-200 rounded-xl shadow-sm p-6">
            <div className="flex items-start gap-3 text-red-700">
              <AlertCircle size={28} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-lg">Promosi TIDAK jadi dibuat.</p>
                <p className="text-sm mt-1">{createResult.error}</p>
                {(createResult.itemErrors?.length ?? 0) > 1 && (
                  <p className="text-xs text-gray-500 mt-2">
                    {createResult.itemErrors!.length} produk bermasalah — perbaiki lalu coba buat lagi secara manual.
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  Tidak ada percobaan ulang otomatis. Setelah yakin sudah benar, tekan &quot;Coba buat lagi&quot; di bawah.
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="mt-5 flex gap-2">
          <Link href="/promotions" className="rounded-md bg-[#2a3a8c] px-4 py-2 text-sm font-medium text-white hover:bg-blue-900">
            Lihat daftar promosi
          </Link>
          <button
            onClick={() => {
              setCreateResult(null);
              setPreview(null);
              setStep(1);
              setDiscountByListingKey({});
            }}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            {createResult.ok ? "Buat promosi lain" : "Coba buat lagi"}
          </button>
        </div>
      </div>
    );
  }

  /* ------------------------------ Wizard ------------------------------ */

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link href="/promotions" className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-[#2a3a8c] mb-2">
        <ChevronLeft size={14} /> Kembali ke daftar promosi
      </Link>
      <div className="flex items-center gap-2.5 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Buat Promosi Baru</h1>
        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700">
          <ShieldAlert size={12} />
          Mengubah harga jual nyata
        </span>
      </div>

      {/* Stepper */}
      <div className="mt-4 mb-6 flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const active = step === n;
          const done = step > n;
          return (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold border ${
                  active
                    ? "bg-[#2a3a8c] text-white border-transparent"
                    : done
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-gray-50 text-gray-400 border-gray-200"
                }`}
              >
                <span>{done ? "✓" : n}</span>
                {label}
              </div>
              {n < 3 && <ArrowRight size={14} className="text-gray-300" />}
            </div>
          );
        })}
      </div>

      {/* ── STEP 1: pilih produk ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Toko</label>
                <select
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setDiscountByListingKey({});
                    setPreview(null);
                  }}
                  className="mt-1 border border-gray-300 rounded-md px-3 py-2 text-sm h-[36px] bg-white cursor-pointer font-medium"
                >
                  {accounts.length === 0 && <option value="">(memuat toko…)</option>}
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="relative w-64">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama / SKU…"
                  className="border border-gray-300 rounded-md pl-3 pr-8 py-2 text-sm w-full outline-none"
                />
                <Search size={14} className="text-gray-400 absolute right-2.5 top-3" />
              </div>
            </div>

            {loadingListings ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 size={22} className="animate-spin mr-2 text-[#2a3a8c]" />
                <span className="text-sm">Memuat produk…</span>
              </div>
            ) : (
              <>
                {loadError && (
                  <p className="mx-4 mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    {loadError}
                  </p>
                )}
                {priceError && (
                  <p className="mx-4 mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{priceError}</p>
                )}
                <div className="m-4 rounded-lg border border-gray-100 divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
                  {listings.length === 0 && <p className="px-4 py-8 text-center text-sm text-gray-400">Tidak ada listing aktif.</p>}
                  {listings.map((listing) => {
                    const isSelected = listing.key in discountByListingKey;
                    const needsPrice = isSelected && listing.variants.some((v) => v.price === null);
                    return (
                      <div key={listing.key} className={`px-4 py-3 ${isSelected ? "bg-blue-50/40" : ""}`}>
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleListing(listing)}
                            className="mt-1 h-4 w-4 accent-[#2a3a8c] cursor-pointer"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-gray-900 truncate" title={listing.platformTitle ?? listing.master?.name ?? ""}>
                              {listing.platformTitle ?? listing.master?.name ?? listing.channelSku ?? "-"}
                            </p>
                            <p className="text-[11px] text-gray-500">
                              {listing.variantCount} varian · {listingPrice(listing)}
                              {listing.channelSku ? ` · ${listing.channelSku}` : ""}
                            </p>
                          </div>
                          {isSelected && !needsPrice && (
                            <div className="shrink-0 flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={discountByListingKey[listing.key]}
                                onChange={(e) =>
                                  setDiscountByListingKey((prev) => ({ ...prev, [listing.key]: Number(e.target.value) }))
                                }
                                className={`border rounded-md px-2 py-1 text-sm w-16 text-right outline-none ${
                                  discountIssue(discountByListingKey[listing.key])
                                    ? "border-red-400 bg-red-50"
                                    : isExtreme(discountByListingKey[listing.key])
                                      ? "border-amber-400 bg-amber-50"
                                      : "border-gray-300"
                                }`}
                              />
                              <Percent size={13} className="text-gray-400" />
                            </div>
                          )}
                        </div>
                        {/* Inline set-harga untuk listing terpilih yang belum punya harga */}
                        {isSelected &&
                          listing.variants
                            .filter((v) => v.price === null)
                            .map((v) => (
                              <div key={v.variantId} className="mt-2 ml-7 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
                                <p className="text-[11px] font-bold text-amber-800">
                                  Produk belum punya harga — isi dulu agar bisa dipromosikan (SKU: {v.sku})
                                </p>
                                <div className="mt-1.5 flex items-center gap-2">
                                  <span className="text-xs text-gray-500">Rp</span>
                                  <input
                                    type="number"
                                    min={1}
                                    value={priceDraft[v.variantId] ?? ""}
                                    onChange={(e) => setPriceDraft((prev) => ({ ...prev, [v.variantId]: e.target.value }))}
                                    placeholder="100000"
                                    className="border border-gray-300 rounded-md px-2 py-1 text-sm w-32 text-right outline-none"
                                  />
                                  <button
                                    onClick={() => savePrice(v)}
                                    disabled={priceSavingFor === v.variantId}
                                    className="rounded-md bg-[#2a3a8c] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-60 flex items-center gap-1"
                                  >
                                    {priceSavingFor === v.variantId && <Loader2 size={12} className="animate-spin" />}
                                    Simpan harga
                                  </button>
                                </div>
                              </div>
                            ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {step1Problem && <p className="text-xs text-red-600">{step1Problem}</p>}
          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={step1Problem !== null}
              className="flex items-center gap-2 rounded-md bg-[#2a3a8c] px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Lanjut ke Diskon & Jadwal <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: diskon + preview ── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 space-y-3">
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <p className="text-[11px] text-gray-500 mb-1">Diskon seragam (%) — bisa diubah per produk di daftar</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={95}
                    value={bulkDiscount}
                    onChange={(e) => setBulkDiscount(Number(e.target.value))}
                    className="border border-gray-300 rounded-md px-3 py-2 text-sm w-20 text-right outline-none"
                  />
                  <Percent size={14} className="text-gray-400" />
                  <button
                    onClick={applyBulkDiscount}
                    disabled={selectedKeys.length === 0}
                    className="rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Terapkan ke {selectedKeys.length} produk
                  </button>
                </div>
              </div>
              <div>
                <p className="text-[11px] text-gray-500 mb-1">Mulai (minimal 2 jam dari sekarang)</p>
                <input
                  type="datetime-local"
                  value={beginAt}
                  onChange={(e) => {
                    setBeginAt(e.target.value);
                    setPreview(null);
                  }}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <p className="text-[11px] text-gray-500 mb-1">Durasi (hari, maks 90)</p>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={durationDays}
                  onChange={(e) => {
                    setDurationDays(Number(e.target.value));
                    setPreview(null);
                  }}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm w-24 outline-none"
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-400">
              Kebijakan: diskon 1–95% langsung boleh. 0% / ≥96% (hampir gratis) butuh konfirmasi tambahan.
              Limit pembelian mengikuti default TikTok (tanpa batas).
            </p>
            {step2Problem && <p className="text-xs text-red-600">{step2Problem}</p>}
          </div>

          {/* Tabel produk + diskon + hasil preview */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wider text-gray-400 bg-gray-50/50">
                  <th className="px-4 py-2.5 font-semibold">Produk</th>
                  <th className="px-4 py-2.5 font-semibold w-24">Diskon</th>
                  <th className="px-4 py-2.5 font-semibold w-44">Harga</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((listing) => {
                  const d = discountByListingKey[listing.key];
                  const invalid = discountIssue(d) !== null;
                  const overlapCount = listing.platformProductId
                    ? (previewByProduct.get(listing.platformProductId)?.overlaps.length ?? 0)
                    : 0;
                  return (
                    <tr key={listing.key} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <p className="text-xs font-bold text-gray-800 truncate max-w-[280px]">
                          {listing.platformTitle ?? listing.master?.name ?? "-"}
                        </p>
                        {overlapCount > 0 && preview?.ok && (
                          <p className="text-[10px] text-amber-700 mt-0.5">⚠ sedang ikut promo aktif lain</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={d}
                            onChange={(e) => {
                              setDiscountByListingKey((prev) => ({ ...prev, [listing.key]: Number(e.target.value) }));
                              setPreview(null);
                            }}
                            className={`border rounded-md px-2 py-1 text-sm w-16 text-right outline-none ${
                              invalid ? "border-red-400 bg-red-50" : isExtreme(d) ? "border-amber-400 bg-amber-50" : "border-gray-300"
                            }`}
                          />
                          <Percent size={12} className="text-gray-400" />
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-xs text-gray-500">{listingPrice(listing)}</p>
                        <p className="text-xs font-bold text-gray-900">{preview?.ok ? finalPriceText(listing) : "—"}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            onClick={runPreview}
            disabled={previewing || step2Problem !== null}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-[#2a3a8c] px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50"
          >
            {previewing ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {previewing ? "Menghitung…" : "Preview Harga Akhir"}
          </button>

          {preview && !preview.ok && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{preview.error}</span>
            </div>
          )}

          {preview?.ok && (
            <div className="space-y-3">
              {/* Blocking error (G1) */}
              {hasBlockingError && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-bold">Ada produk yang tidak bisa ikut promosi:</p>
                    <ul className="text-xs mt-1 list-disc pl-4 space-y-0.5">
                      {Array.from(
                        new Set(
                          (preview.items ?? [])
                            .map((i) => i.error)
                            .filter((e): e is string => Boolean(e))
                        )
                      ).map((err) => (
                        <li key={err}>{translateError(err, "preview-item")}</li>
                      ))}
                    </ul>
                    <p className="text-xs mt-1 font-semibold">Perbaiki dulu — tombol lanjut terkunci.</p>
                  </div>
                </div>
              )}

              {/* Pesan dampak ekstrem — VERBATIM dari backend, border merah (G2) */}
              {(preview.extremeConfirmMessages?.length ?? 0) > 0 && (
                <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4">
                  <p className="text-xs font-bold text-red-800 uppercase tracking-wider mb-2">
                    Peringatan — dampak sangat besar:
                  </p>
                  <ul className="space-y-2">
                    {preview.extremeConfirmMessages!.map((m) => (
                      <li key={m.mappingId} className="text-sm font-semibold text-red-800 leading-snug">
                        {m.message}
                      </li>
                    ))}
                  </ul>
                  <label className="mt-3 flex items-start gap-2 text-sm font-bold text-red-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmExtreme}
                      onChange={(e) => setConfirmExtreme(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-red-600"
                    />
                    Saya sudah membaca peringatan di atas dan tetap ingin lanjut.
                  </label>
                </div>
              )}

              {/* Overlap aktif (G3) */}
              {hasActiveOverlap && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-800">Ada produk yang sedang ikut promo lain yang masih aktif.</p>
                  <p className="text-xs text-amber-700 mt-1">
                    TikTok bisa menolak produk yang ikut dua promo sekaligus. Penolakan resmi tetap tampil apa adanya.
                  </p>
                  <label className="mt-2 flex items-start gap-2 text-sm font-bold text-amber-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acknowledgeActiveOverlap}
                      onChange={(e) => setAcknowledgeActiveOverlap(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-amber-600"
                    />
                    Tetap lanjutkan meski ada tumpang tindih.
                  </label>
                </div>
              )}

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="rounded-md border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Kembali
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!step2GateOk}
                  className="flex items-center gap-2 rounded-md bg-[#2a3a8c] px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Lanjut ke Konfirmasi <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: konfirmasi type-to-confirm ── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Ringkasan</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <p>
                <span className="text-gray-500">Toko:</span>{" "}
                <b>{accounts.find((a) => a.id === accountId)?.label ?? "-"}</b>
              </p>
              <p>
                <span className="text-gray-500">Jumlah produk:</span> <b>{selected.length}</b>
              </p>
              <p>
                <span className="text-gray-500">Diskon:</span>{" "}
                <b>
                  {Array.from(new Set(selectedKeys.map((k) => discountByListingKey[k])))
                    .sort((a, b) => a - b)
                    .join("%, ")}
                  %
                </b>
              </p>
              <p>
                <span className="text-gray-500">Jadwal:</span>{" "}
                <b>
                  {new Date(beginAt).toLocaleString("id-ID", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {durationDays} hari
                </b>
              </p>
            </div>
            <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-600 mb-1">Contoh harga akhir (hasil preview):</p>
              <div className="space-y-0.5">
                {selected.slice(0, 3).map((l) => (
                  <p key={l.key} className="text-xs">
                    <span className="text-gray-500">{l.platformTitle ?? l.master?.name}:</span>{" "}
                    <b>{finalPriceText(l)}</b>{" "}
                    <span className="text-gray-400">(dari {listingPrice(l)})</span>
                  </p>
                ))}
                {selected.length > 3 && <p className="text-[11px] text-gray-400">…dan {selected.length - 3} produk lainnya.</p>}
              </div>
            </div>
            {(hasExtreme || hasActiveOverlap) && (
              <p className="mt-3 text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                <AlertTriangle size={13} />
                Termasuk konfirmasi khusus yang sudah Anda centang di langkah sebelumnya.
              </p>
            )}
          </div>

          <div className="bg-white border-2 border-red-200 rounded-xl shadow-sm p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-red-50 p-2.5 text-red-600 shrink-0">
                <ShieldAlert size={20} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-900">Konfirmasi terakhir</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Setelah langkah ini, harga jual di TikTok benar-benar berubah sesuai jadwal di atas.
                </p>
                <label className="block mt-4 text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Ketik <span className="text-red-600">BUAT</span> (huruf besar semua) untuk melanjutkan
                </label>
                <input
                  type="text"
                  value={confirmationWord}
                  onChange={(e) => setConfirmationWord(e.target.value)}
                  placeholder="BUAT"
                  autoFocus
                  className="mt-1.5 border border-gray-300 rounded-md px-3 py-2 text-sm w-full outline-none focus:border-red-400"
                />
                <div className="mt-4 flex gap-2 justify-end">
                  <button
                    onClick={() => setStep(2)}
                    disabled={creating}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Kembali
                  </button>
                  <button
                    onClick={runCreate}
                    // Persis & case-sensitive — tanpa trim di sini (server tetap validasi ulang).
                    disabled={confirmationWord !== "BUAT" || creating}
                    className="flex items-center gap-2 rounded-md bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {creating && <Loader2 size={14} className="animate-spin" />}
                    {creating ? "Sedang membuat…" : "Ya, Buat Promosi Sekarang"}
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-gray-400">
                  Tidak ada percobaan ulang otomatis. Jika gagal, Anda akan diminta memeriksa dulu lalu mencoba manual.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
