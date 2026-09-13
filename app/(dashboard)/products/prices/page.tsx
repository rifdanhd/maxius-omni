"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/utils/api-client";
import {
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Upload,
  FileDown,
  X,
  Check,
  Loader2,
  PackageOpen,
} from "lucide-react";

/* ------------------------------ Types ------------------------------ */

type Market = {
  id: string;
  accountId: string;
  accountLabel: string;
  platform: string;
  channelSku: string;
  price: number | null;
  overridePrice: number | null;
  priceUpdatedAt: string | null;
};

type PricingRow = {
  id: string;
  sku: string;
  defaultPrice: number | null;
  defaultPriceUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  product: { id: string; name: string; category: string | null; imageUrl: string | null } | null;
  markets: Market[];
};

type PricingResponse = {
  rows: PricingRow[];
  total: number;
  page: number;
  pageSize: number;
};

type Account = { id: string; platform: string; label: string };

/* ------------------------------ Constants ------------------------------ */

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { id: "name_asc", label: "Nama: A-Z" },
  { id: "name_desc", label: "Nama: Z-A" },
  { id: "sku_asc", label: "SKU: A-Z" },
  { id: "sku_desc", label: "SKU: Z-A" },
  { id: "price_asc", label: "Harga Default: Terendah" },
  { id: "price_desc", label: "Harga Default: Tertinggi" },
  { id: "updated_desc", label: "Pembaruan Terakhir" },
  { id: "created_desc", label: "Dibuat Terbaru" },
];

const PLATFORM_BADGE: Record<string, string> = {
  SHOPEE: "bg-orange-100 text-orange-700",
  TOKOPEDIA: "bg-green-100 text-green-700",
  TIKTOK_SHOP: "bg-black text-white",
  DEFAULT: "bg-gray-100 text-gray-700",
};

const PLATFORM_LABEL: Record<string, string> = {
  SHOPEE: "Shopee",
  TOKOPEDIA: "Tokopedia",
  TIKTOK_SHOP: "TikTok Shop",
};

const fmtRp = (n: number | null | undefined) =>
  n === null || n === undefined ? "-" : "Rp" + Math.round(n).toLocaleString("id-ID");

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/* ------------------------------ InlinePrice ------------------------------ */

function InlinePrice({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (next: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    const raw = draft.trim().replace(/[Rp\s.,]/g, "").replace(",", ".");
    const n = Number(raw && raw.length ? raw.replace(/[^0-9.]/g, "") : "NaN");
    if (draft.trim() === "") {
      setError("Harga tidak boleh kosong.");
      return;
    }
    if (!Number.isFinite(n) || n < 0) {
      setError("Masukkan angka harga yang valid (>= 0).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(n);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan harga.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="group/price flex items-center justify-end gap-2">
        <span className={value === null ? "text-gray-400" : "text-gray-900 font-semibold"}>
          {fmtRp(value)}
        </span>
        <button
          onClick={() => {
            setDraft(value === null ? "" : String(Math.round(value)));
            setEditing(true);
          }}
          className="text-gray-400 hover:text-indigo-600 opacity-0 group-hover/price:opacity-100 transition-opacity"
          title="Ubah harga"
          aria-label="Ubah harga"
        >
          <Pencil size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <div className="flex items-center gap-1 border border-indigo-300 rounded-md px-2 py-1 bg-indigo-50/50">
        <span className="text-xs text-gray-500 font-semibold">Rp</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setEditing(false);
              setError(null);
            }
          }}
          onBlur={() => {
            if (!saving) setEditing(false);
          }}
          className="w-24 bg-transparent outline-none text-sm font-semibold text-gray-900"
          inputMode="decimal"
        />
      </div>
      <button
        onClick={commit}
        disabled={saving}
        className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
        title="Simpan"
        aria-label="Simpan"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      </button>
      <button
        onClick={() => {
          setEditing(false);
          setError(null);
        }}
        className="text-gray-400 hover:text-gray-600"
        title="Batal"
        aria-label="Batal"
      >
        <X size={14} />
      </button>
      {error && (
        <span className="text-[10px] text-red-600 whitespace-nowrap absolute right-0 top-full mt-0.5">
          {error}
        </span>
      )}
    </div>
  );
}

/* ------------------------------ Bulk Upload Modal ------------------------------ */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (ch !== "\r") field += ch;
  }
  row.push(field);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function BulkUploadModal({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<{ text: string } | null>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    updated: number;
    failed: Array<{ row: number; message: string }>;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handleFile(file: File) {
    setErr(null);
    setResult(null);
    setFileName(file.name);
    file.text().then((text) => {
      const rows = parseCsv(text);
      if (rows.length < 2) {
        setErr("File tidak memiliki header + minimal 1 baris data.");
        setPreview([]);
        return;
      }
      setPreview(rows.slice(0, 4));
      setCsvText({ text });
    });
  }

  async function submit() {
    if (!csvText) return;
    setSubmitting(true);
    setErr(null);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/products/pricing/bulk-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ csv: csvText.text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok && !data) throw new Error(`Unggah gagal (HTTP ${res.status}).`);
      setResult(
        data ?? { ok: false, updated: 0, failed: [{ row: 0, message: "Respons tidak valid." }] }
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Terjadi kesalahan saat mengunggah.");
    } finally {
      setSubmitting(false);
    }
  }

  function downloadTemplate() {
    const template = "sku,price,store,channel_sku\n" +
      "DEFAULT-xxx,25000,,\n" +
      "DEFAULT-xxx,,Dermarket 1,DEFAULT-xxx-SHOPEE\n";
    const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "template-harga.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Unggah Massal Harga</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-300 rounded-xl py-8 flex flex-col items-center gap-2 text-gray-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
          >
            <Upload size={24} />
            <span className="text-sm font-medium">
              {fileName ?? "Pilih file CSV untuk diunggah"}
            </span>
            <span className="text-xs text-gray-400">hanya format .csv yang didukung</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />

          <p className="mt-4 text-xs text-gray-500">
            Kolom: <code className="bg-gray-100 px-1 rounded">sku, price, store, channel_sku</code>.
            <br />
            <code className="bg-gray-100 px-1 rounded">store</code> kosong → set harga default varian.
            <code className="bg-gray-100 px-1 rounded">store</code> terisi → override per toko.
          </p>

          {preview.length > 0 && (
            <div className="mt-4 overflow-x-auto border border-gray-200 rounded-lg max-h-32 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-gray-100">
                  {preview.map((cells, i) => (
                    <tr key={i} className={i === 0 ? "bg-gray-50 font-semibold" : ""}>
                      {cells.map((c, j) => (
                        <td key={j} className="px-2 py-1 text-gray-700 whitespace-nowrap">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {err && (
            <div className="mt-4 bg-red-50 text-red-600 text-xs px-4 py-3 rounded-xl border border-red-100">
              {err}
            </div>
          )}

          {result && (
            <div
              className={`mt-4 text-xs px-4 py-3 rounded-xl border ${
                result.ok
                  ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                  : "bg-amber-50 text-amber-700 border-amber-100"
              }`}
            >
              <div className="font-semibold">
                {result.ok ? "Berhasil" : "Selesai dengan sebagian gagal"} — {result.updated} baris
                diperbarui{result.failed.length > 0 ? `, ${result.failed.length} gagal.` : "."}
              </div>
              {result.failed.length > 0 && (
                <ul className="mt-2 list-disc pl-4 max-h-24 overflow-y-auto">
                  {result.failed.slice(0, 10).map((f, i) => (
                    <li key={i}>
                      Baris {f.row}: {f.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <button
            onClick={downloadTemplate}
            className="text-sm font-medium text-indigo-600 hover:underline inline-flex items-center gap-1.5"
          >
            <FileDown size={14} /> Unduh template
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Tutup
            </button>
            <button
              onClick={submit}
              disabled={!fileName || submitting}
              className="px-4 py-2 text-sm font-medium bg-[#2a3a8c] text-white rounded-md hover:bg-blue-900 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Proses Unggah
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Main Page ------------------------------ */

export default function KelolaHargaPage() {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(SORT_OPTIONS[0]);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  const [page, setPage] = useState(1);
  const [selectedStores, setSelectedStores] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [draftStores, setDraftStores] = useState<Set<string>>(new Set());
  const [draftCategory, setDraftCategory] = useState("");
  const [draftMin, setDraftMin] = useState("");
  const [draftMax, setDraftMax] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sortRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterActive =
    selectedStores.size > 0 || categoryFilter !== "" || priceMin !== "" || priceMax !== "";

  /* Load accounts + categories once */
  useEffect(() => {
    async function loadMeta() {
      try {
        const token = localStorage.getItem("token");
        const [accRes, catRes] = await Promise.all([
          authFetch("/api/accounts", { headers: { Authorization: `Bearer ${token}` } }),
          authFetch("/api/products/pricing?pageSize=1000", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        if (accRes.ok) {
          const d = await accRes.json();
          setAccounts(d.accounts ?? []);
        }
        if (catRes.ok) {
          const d: PricingResponse = await catRes.json();
          setCategories([
            ...new Set(
              d.rows.map((r) => r.product?.category).filter((c): c is string => !!c)
            ),
          ]);
        }
      } catch {
        // meta opsional; jangan gagalkan halaman utama
      }
    }
    loadMeta();
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const sp = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort: sort.id,
    });
    if (q) sp.set("search", q);
    if (selectedStores.size > 0) sp.set("store", [...selectedStores].join(","));
    if (categoryFilter) sp.set("category", categoryFilter);
    if (priceMin) sp.set("priceMin", priceMin);
    if (priceMax) sp.set("priceMax", priceMax);

    let cancelled = false;
    async function run() {
      try {
        const res = await authFetch(`/api/products/pricing?${sp.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(`Gagal memuat data harga (${res.status}).`);
          return;
        }
        const data: PricingResponse = await res.json();
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setError("Terjadi kesalahan saat memuat data harga.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [page, q, sort.id, selectedStores, categoryFilter, priceMin, priceMax]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  /* Close dropdown on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!(sortRef.current?.contains(t))) setSortOpen(false);
      if (!(filterRef.current?.contains(t))) setFilterOpen(false);
      if (!(uploadRef.current?.contains(t))) setUploadOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggleStore(id: string) {
    setDraftStores((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyFilter() {
    setSelectedStores(new Set(draftStores));
    setCategoryFilter(draftCategory.trim());
    setPriceMin(draftMin.trim());
    setPriceMax(draftMax.trim());
    setLoading(true);
    setPage(1);
    setFilterOpen(false);
  }

  function resetFilter() {
    setDraftStores(new Set());
    setDraftCategory("");
    setDraftMin("");
    setDraftMax("");
    setSelectedStores(new Set());
    setCategoryFilter("");
    setPriceMin("");
    setPriceMax("");
    setPage(1);
  }

  const allPageSelected =
    rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  async function saveDefaultPrice(row: PricingRow, price: number) {
    const token = localStorage.getItem("token");
    const res = await authFetch(`/api/products/pricing/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ price }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? "Gagal menyimpan harga default.");
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              defaultPrice: price,
              defaultPriceUpdatedAt: new Date().toISOString(),
              markets: r.markets.map((m) =>
                m.overridePrice === null ? { ...m, price } : m
              ),
            }
          : r
      )
    );
  }

  async function saveOverridePrice(row: PricingRow, market: Market, price: number) {
    const token = localStorage.getItem("token");
    const res = await authFetch(
      `/api/products/pricing/${row.id}/marketplace/${market.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ price }),
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? "Gagal menyimpan harga marketplace.");
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              markets: r.markets.map((m) =>
                m.id === market.id
                  ? { ...m, price, overridePrice: price, priceUpdatedAt: new Date().toISOString() }
                  : m
              ),
            }
          : r
      )
    );
  }

  async function clearOverridePrice(row: PricingRow, market: Market) {
    const token = localStorage.getItem("token");
    const res = await authFetch(
      `/api/products/pricing/${row.id}/marketplace/${market.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ price: null }),
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? "Gagal menghapus override.");
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              markets: r.markets.map((m) =>
                m.id === market.id ? { ...m, price: r.defaultPrice, overridePrice: null } : m
              ),
            }
          : r
      )
    );
  }

  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    const out: number[] = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  }, [page, totalPages]);

  const toggleNameSort = () =>
    setSort((prev) => (prev.id === "name_asc" ? SORT_OPTIONS[1] : SORT_OPTIONS[0]));

  return (
    <div className="p-8">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-bold text-gray-900">Kelola Harga</h1>
          <div className="relative" ref={uploadRef}>
            <button
              onClick={() => setUploadOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md bg-[#2a3a8c] px-4 py-2 text-sm font-medium text-white hover:bg-blue-900 transition-colors"
            >
              <Upload size={16} /> Unggah Massal <ChevronDown size={14} />
            </button>
            {uploadOpen && (
              <div className="flex flex-col w-52 absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1.5">
                <button
                  onClick={() => {
                    setUploadOpen(false);
                    setBulkModalOpen(true);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Unggah File Harga
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Toolbar */}
        <div className="p-4 border-b border-gray-200 flex items-center gap-3 flex-wrap">
          <div className="relative w-80">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari nama produk, SKU induk, SKU marketplace"
              className="border border-gray-300 rounded-md pl-3 pr-10 py-2 text-sm outline-none w-full h-[38px] font-medium"
            />
            <Search size={16} className="text-gray-400 absolute right-3 top-2.5" />
          </div>

          {/* Sort */}
          <div className="relative" ref={sortRef}>
            <button
              onClick={() => setSortOpen((v) => !v)}
              className={`flex items-center gap-2 border rounded-md px-3 text-sm font-medium h-[38px] min-w-[150px] justify-between ${
                sortOpen
                  ? "border-indigo-500 bg-indigo-50/70 text-indigo-700"
                  : "border-gray-300 text-gray-500 bg-white hover:bg-gray-50"
              }`}
            >
              <span className="truncate">{sort.label}</span>
              <ChevronDown size={14} className="shrink-0" />
            </button>
            {sortOpen && (
              <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-30 py-1.5 max-h-80 overflow-y-auto">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setLoading(true);
                      setSort(opt);
                      setSortOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm ${
                      sort.id === opt.id
                        ? "font-semibold text-indigo-600 bg-indigo-50"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filter */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => {
                setDraftStores(new Set(selectedStores));
                setDraftCategory(categoryFilter);
                setDraftMin(priceMin);
                setDraftMax(priceMax);
                setFilterOpen((v) => !v);
              }}
              className={`flex items-center gap-2 border rounded-md px-4 py-2 text-sm font-medium h-[38px] min-w-[120px] justify-between ${
                filterOpen || filterActive
                  ? "border-indigo-500 bg-indigo-50/70 text-indigo-700"
                  : "border-gray-300 text-gray-500 bg-white hover:bg-gray-50"
              }`}
            >
              <span>Filter</span>
              {filterActive && (
                <span className="px-1.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
                  {
                    selectedStores.size +
                      (categoryFilter ? 1 : 0) +
                      ((priceMin || priceMax) ? 1 : 0)
                  }
                </span>
              )}
              <ChevronDown size={14} />
            </button>
            {filterOpen && (
              <div className="absolute left-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-30 p-4 flex flex-col gap-4">
                <div>
                  <p className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">
                    Kategori
                  </p>
                  <input
                    type="text"
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value)}
                    placeholder="Mis. Makanan"
                    list="pricing-categories"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm outline-none"
                  />
                  <datalist id="pricing-categories">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <p className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">
                    Toko / Marketplace
                  </p>
                  <div className="max-h-40 overflow-y-auto flex flex-col gap-1 border border-gray-200 rounded-lg p-2">
                    {accounts.length === 0 && (
                      <p className="text-xs text-gray-400">Belum ada toko terhubung.</p>
                    )}
                    {accounts.map((acc) => {
                      const on = draftStores.has(acc.id);
                      return (
                        <label
                          key={acc.id}
                          className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleStore(acc.id)}
                            className="w-4 h-4 rounded border-gray-300"
                          />
                          {PLATFORM_LABEL[acc.platform] ?? acc.platform} — {acc.label}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">
                    Rentang Harga Default
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={draftMin}
                      onChange={(e) => setDraftMin(e.target.value)}
                      placeholder="Min"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm outline-none"
                    />
                    <span className="text-gray-400">—</span>
                    <input
                      type="number"
                      min={0}
                      value={draftMax}
                      onChange={(e) => setDraftMax(e.target.value)}
                      placeholder="Max"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={resetFilter}
                    className="px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-md"
                  >
                    Reset
                  </button>
                  <button
                    onClick={applyFilter}
                    className="px-4 py-2 text-sm font-medium bg-[#2a3a8c] text-white rounded-md hover:bg-blue-900"
                  >
                    Terapkan
                  </button>
                </div>
              </div>
            )}
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 ml-auto bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-2 rounded-md">
              {selected.size} baris dipilih
              <button
                onClick={() => setSelected(new Set())}
                className="text-indigo-500 hover:text-indigo-800 underline"
              >
                Batal
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#f8f9fa] border-b border-gray-200 text-gray-600 font-semibold">
              <tr>
                <th className="px-5 py-3 w-10">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300"
                    checked={allPageSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-5 py-3">
                  <button
                    onClick={toggleNameSort}
                    className="inline-flex items-center gap-1 hover:text-gray-900"
                  >
                    Informasi Produk
                    <ChevronDown size={12} className="opacity-40" />
                  </button>
                </th>
                <th className="px-5 py-3 text-right">Harga Default</th>
                <th className="px-5 py-3">Toko</th>
                <th className="px-5 py-3">SKU Marketplace</th>
                <th className="px-5 py-3 text-right">Harga</th>
                <th className="px-5 py-3">Waktu</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-500">
                    Memuat data harga...
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-red-600">
                    {error}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                    <PackageOpen size={28} className="mx-auto mb-2" />
                    Tidak ada data harga. Ubah kata kunci/filter atau buat produk terlebih dahulu.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const checked = selected.has(row.id);
                  return (
                    <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/50 align-top">
                      <td className="px-5 py-4 pt-5">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300"
                          checked={checked}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.id)) next.delete(row.id);
                              else next.add(row.id);
                              return next;
                            })
                          }
                        />
                      </td>

                      {/* Informasi Produk */}
                      <td className="px-5 py-4">
                        <div className="flex gap-3">
                          {row.product?.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={row.product.imageUrl}
                              alt={row.product.name ?? row.sku}
                              className="w-12 h-12 rounded object-cover shrink-0 bg-gray-100"
                            />
                          ) : (
                            <div className="w-12 h-12 bg-orange-200 rounded object-cover shrink-0"></div>
                          )}
                          <div className="max-w-[220px]">
                            <div className="text-gray-900 font-bold leading-tight">
                              {row.product?.name ?? row.sku}
                            </div>
                            {row.product?.category && (
                              <span className="mt-1 inline-block text-[10px] font-semibold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                {row.product.category}
                              </span>
                            )}
                            <div className="text-xs text-gray-400 mt-0.5">
                              Varian: {row.sku}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Harga Default */}
                      <td className="px-5 py-4">
                        <div className="relative flex justify-end">
                          <InlinePrice
                            value={row.defaultPrice}
                            onSave={(p) => saveDefaultPrice(row, p)}
                          />
                        </div>
                        {row.defaultPriceUpdatedAt && (
                          <p className="text-[10px] text-gray-400 text-right mt-1">
                            update {fmtDate(row.defaultPriceUpdatedAt)}
                          </p>
                        )}
                      </td>

                      {/* Toko */}
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1.5">
                          {row.markets.length === 0 && (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                          {row.markets.map((m) => (
                            <span
                              key={m.id}
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold w-fit ${
                                PLATFORM_BADGE[m.platform] ?? PLATFORM_BADGE.DEFAULT
                              }`}
                            >
                              {PLATFORM_LABEL[m.platform] ?? m.platform}
                              <span className="font-medium opacity-80">· {m.accountLabel}</span>
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* SKU Marketplace */}
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1.5">
                          {row.markets.length === 0 && (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                          {row.markets.map((m) => (
                            <code
                              key={m.id}
                              className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 w-fit"
                            >
                              {m.channelSku}
                            </code>
                          ))}
                        </div>
                      </td>

                      {/* Harga */}
                      <td className="px-5 py-4">
                        <div className="flex flex-col gap-1.5 items-end">
                          {row.markets.length === 0 && (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                          {row.markets.map((m) => (
                            <div key={m.id} className="relative flex flex-col items-end">
                              <InlinePrice
                                value={m.price}
                                onSave={(p) => saveOverridePrice(row, m, p)}
                              />
                              {m.overridePrice !== null && (
                                <button
                                  onClick={() => clearOverridePrice(row, m)}
                                  className="text-[10px] text-indigo-500 hover:text-indigo-800 underline mt-0.5"
                                  title="Hapus override → ikuti harga default"
                                >
                                  ikuti default
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* Waktu */}
                      <td className="px-5 py-4 text-xs text-gray-400 whitespace-nowrap">
                        <div>
                          Dibuat:{" "}
                          <span className="text-gray-600">{fmtDate(row.createdAt)}</span>
                        </div>
                        <div className="mt-1">
                          Update: <span className="text-gray-600">{fmtDate(row.updatedAt)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {total.toLocaleString("id-ID")} varian · halaman {page} dari {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setLoading(true);
                setPage((p) => Math.max(1, p - 1));
              }}
              disabled={page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} /> Sebelumnya
            </button>
            {pageNumbers.map((n) => (
              <button
                key={n}
                onClick={() => {
                  setLoading(true);
                  setPage(n);
                }}
                className={`w-9 h-9 text-sm rounded-md ${
                  n === page
                    ? "bg-[#2a3a8c] text-white font-semibold"
                    : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => {
                setLoading(true);
                setPage((p) => Math.min(totalPages, p + 1));
              }}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Selanjutnya <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {bulkModalOpen && <BulkUploadModal onClose={() => setBulkModalOpen(false)} />}
    </div>
  );
}