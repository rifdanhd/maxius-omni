"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  Upload,
  Loader2,
  Trash2,
  Star,
  History,
  Images,
  PackageOpen,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";

/* ------------------------------ Types ------------------------------ */

type GalleryRow = {
  id: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  variantCount: number;
  totalImages: number;
  coverCount: number;
  required: number;
  complete: boolean;
};

type GalleryResponse = {
  rows: GalleryRow[];
  total: number;
  page: number;
  pageSize: number;
};

type ImageRow = {
  id: string;
  url: string;
  isCover: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
};

type HistoryRow = {
  id: string;
  url: string;
  isCover: boolean;
  createdAt: string;
  updatedAt: string;
  product: { id: string; name: string };
};

/* ------------------------------ Constants / helpers ------------------------------ */

const PAGE_SIZE = 20;

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

function statusBadge(row: GalleryRow) {
  if (row.totalImages === 0)
    return { label: "Tidak Ada Gambar", cls: "bg-gray-100 text-gray-600" };
  if (row.complete) return { label: "Lengkap", cls: "bg-emerald-100 text-emerald-700" };
  return { label: "Belum Lengkap", cls: "bg-amber-100 text-amber-700" };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Gagal membaca file."));
    reader.readAsDataURL(file);
  });
}

/* ------------------------------ Gallery Detail Modal ------------------------------ */

function GalleryModal({ row, onClose }: { row: GalleryRow; onClose: () => void }) {
  const [images, setImages] = useState<ImageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingUrls, setPendingUrls] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadImages() {
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/products/${row.id}/images`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Gagal memuat gambar (${res.status})`);
      const data = await res.json();
      setImages((data.images ?? []) as ImageRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`/api/products/${row.id}/images`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) throw new Error(`Gagal memuat gambar (${res.status})`);
        const data = await res.json();
        setImages((data.images ?? []) as ImageRow[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  async function upload() {
    const urls: string[] = pendingUrls
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    for (const f of pendingFiles) {
      try {
        urls.push(await fileToDataUrl(f));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal membaca file.");
        return;
      }
    }
    if (urls.length === 0) {
      setError("Tambah URL atau pilih file terlebih dahulu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/products/${row.id}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ images: urls.map((url) => ({ url })) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Gagal mengunggah gambar.");
      setPendingUrls("");
      setPendingFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      await loadImages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengunggah gambar.");
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(img: ImageRow) {
    if (!window.confirm("Hapus gambar ini? Aksi ini tidak bisa dibatalkan.")) return;
    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/products/${row.id}/images/${img.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Gagal menghapus gambar.");
      await loadImages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus gambar.");
    } finally {
      setBusy(false);
    }
  }

  async function setCover(img: ImageRow) {
    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/products/${row.id}/images/${img.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isCover: true }),
      });
      if (!res.ok) throw new Error("Gagal set cover.");
      await loadImages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal set cover.");
    } finally {
      setBusy(false);
    }
  }

  async function move(delta: number, img: ImageRow) {
    const idx = images.findIndex((i) => i.id === img.id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= images.length) return;
    const next = [...images];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`/api/products/${row.id}/images/${img.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderedIds: next.map((i) => i.id) }),
      });
      if (!res.ok) throw new Error("Gagal mengubah urutan.");
      await loadImages();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengubah urutan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{row.name}</h2>
            <p className="text-xs text-gray-400">
              {row.totalImages} gambar · {row.variantCount} varian
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex flex-col gap-5">
          {/* Upload area */}
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 rounded-md bg-[#2a3a8c] px-4 py-2 text-sm font-medium text-white hover:bg-blue-900"
              >
                <Upload size={15} /> Pilih File
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => setPendingFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
              />
              <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                <input
                  type="text"
                  value={pendingUrls}
                  onChange={(e) => setPendingUrls(e.target.value)}
                  placeholder="Atau tempel URL gambar (pisahkan dengan koma/baris baru)"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm outline-none"
                />
              </div>
            </div>
            {pendingFiles.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-xs text-gray-600">
                {pendingFiles.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-gray-100 px-2 py-1 rounded-md">
                    {f.name}
                    <button
                      onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="text-gray-400 hover:text-red-600"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                <button
                  onClick={upload}
                  disabled={busy}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Unggah
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-xs px-4 py-3 rounded-xl border border-red-100">
              {error}
            </div>
          )}

          {/* Grid */}
          {loading ? (
            <p className="text-sm text-gray-400">Memuat gambar...</p>
          ) : images.length === 0 ? (
            <div className="text-center text-gray-400 py-10">
              <Images size={32} className="mx-auto mb-2" />
              Belum ada gambar. Unggah gambar pertama produk ini.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {images.map((img, i) => (
                <div key={img.id} className="group relative rounded-xl border border-gray-200 overflow-hidden bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={`Gambar ${i + 1}`} className="w-full aspect-square object-cover" />
                  {img.isCover && (
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-amber-400 text-amber-950 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      <Star size={11} /> Cover
                    </span>
                  )}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!img.isCover && (
                      <button
                        onClick={() => setCover(img)}
                        title="Jadikan cover"
                        className="bg-white/90 hover:bg-white shadow rounded-md p-1.5 text-amber-600"
                      >
                        <Star size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => removeImage(img)}
                      title="Hapus"
                      className="bg-white/90 hover:bg-white shadow rounded-md p-1.5 text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="px-2 py-1.5 flex items-center justify-between border-t border-gray-100 bg-white">
                    <button
                      onClick={() => move(-1, img)}
                      disabled={i === 0}
                      title="Geser ke kiri"
                      className="text-gray-400 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowLeft size={14} />
                    </button>
                    <span className="text-[10px] text-gray-400">#{i + 1}</span>
                    <button
                      onClick={() => move(1, img)}
                      disabled={i === images.length - 1}
                      title="Geser ke kanan"
                      className="text-gray-400 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Riwayat Modal ------------------------------ */

function HistoryModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/products/gallery/history", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Gagal memuat riwayat (${res.status})`);
        const data = await res.json();
        setRows(data.rows ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Riwayat Gambar</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {error && <div className="bg-red-50 text-red-600 text-xs px-4 py-3 rounded-xl">{error}</div>}
          {loading ? (
            <p className="text-sm text-gray-400">Memuat riwayat...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-400">Belum ada aktivitas gambar.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.id} className="py-3 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt="" className="w-10 h-10 rounded-md object-cover bg-gray-100 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-800 truncate">{r.product.name}</div>
                    <div className="text-xs text-gray-400">
                      {r.isCover ? "Dijadikan cover" : "Gambar produk"} · update {fmtDate(r.updatedAt)}
                    </div>
                  </div>
                  {r.isCover && (
                    <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      <Star size={11} /> Cover
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Main Page ------------------------------ */

export default function KelolaGambarPage() {
  const [rows, setRows] = useState<GalleryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "complete" | "incomplete" | "none">("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [draftStatus, setDraftStatus] = useState<"all" | "complete" | "incomplete" | "none">("all");
  const [draftCategory, setDraftCategory] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailRow, setDetailRow] = useState<GalleryRow | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const filterRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterActive =
    statusFilter !== "all" || categoryFilter !== "";

  useEffect(() => {
    const token = localStorage.getItem("token");
    const sp = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (q) sp.set("search", q);
    if (categoryFilter) sp.set("category", categoryFilter);
    if (statusFilter !== "all") sp.set("status", statusFilter);

    let cancelled = false;
    async function run() {
      try {
        const res = await fetch(`/api/products/gallery?${sp.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(`Gagal memuat galeri (${res.status}).`);
          return;
        }
        const data: GalleryResponse = await res.json();
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setError("Terjadi kesalahan saat memuat galeri.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [page, q, categoryFilter, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    async function loadCategories() {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch("/api/products/gallery?pageSize=1000", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data: GalleryResponse = await res.json();
        setCategories([...new Set(data.rows.map((r) => r.category).filter((c): c is string => !!c))]);
      } catch {
        // opsional
      }
    }
    loadCategories();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!(filterRef.current?.contains(t))) setFilterOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function applyFilter() {
    setStatusFilter(draftStatus);
    setCategoryFilter(draftCategory.trim());
    setPage(1);
    setFilterOpen(false);
  }

  function resetFilter() {
    setDraftStatus("all");
    setDraftCategory("");
    setStatusFilter("all");
    setCategoryFilter("");
    setPage(1);
  }

  const allPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    const out: number[] = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  }, [page, totalPages]);

  return (
    <div className="p-8">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-bold text-gray-900">Kelola Gambar</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setHistoryOpen(true)}
              className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <History size={16} /> Riwayat
            </button>
            <button
              disabled
              className="flex items-center gap-2 rounded-md bg-[#2a3a8c] px-4 py-2 text-sm font-medium text-white opacity-60 cursor-not-allowed"
            >
              <Upload size={16} /> Unggah Massal
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="p-4 border-b border-gray-200 flex items-center gap-3 flex-wrap">
          <div className="relative w-80">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari nama produk atau SKU"
              className="border border-gray-300 rounded-md pl-3 pr-10 py-2 text-sm outline-none w-full h-[38px] font-medium"
            />
            <Search size={16} className="text-gray-400 absolute right-3 top-2.5" />
          </div>

          {/* Filter */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => {
                setDraftStatus(statusFilter);
                setDraftCategory(categoryFilter);
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
                  {(statusFilter !== "all" ? 1 : 0) + (categoryFilter ? 1 : 0)}
                </span>
              )}
              <ChevronDown size={14} />
            </button>
            {filterOpen && (
              <div className="absolute left-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-30 p-4 flex flex-col gap-4">
                <div>
                  <p className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">Kategori</p>
                  <input
                    type="text"
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value)}
                    placeholder="Mis. Makanan"
                    list="gallery-categories"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm outline-none"
                  />
                  <datalist id="gallery-categories">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">Status Kelengkapan</p>
                  <div className="flex flex-col gap-1">
                    {([
                      ["all", "Semua"],
                      ["complete", "Lengkap"],
                      ["incomplete", "Belum Lengkap"],
                      ["none", "Tidak Ada Gambar"],
                    ] as const).map(([val, label]) => (
                      <label key={val} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                        <input
                          type="radio"
                          name="status"
                          checked={draftStatus === val}
                          onChange={() => setDraftStatus(val)}
                          className="w-4 h-4"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button onClick={resetFilter} className="px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-md">
                    Reset
                  </button>
                  <button onClick={applyFilter} className="px-4 py-2 text-sm font-medium bg-[#2a3a8c] text-white rounded-md hover:bg-blue-900">
                    Terapkan
                  </button>
                </div>
              </div>
            )}
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 ml-auto bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-2 rounded-md">
              {selected.size} produk dipilih
              <button onClick={() => setSelected(new Set())} className="text-indigo-500 hover:text-indigo-800 underline">
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
                  <input type="checkbox" className="w-4 h-4 rounded border-gray-300" checked={allPageSelected} onChange={toggleAll} />
                </th>
                <th className="px-5 py-3">Informasi Produk</th>
                <th className="px-5 py-3">Kategori</th>
                <th className="px-5 py-3">Varian</th>
                <th className="px-5 py-3">Total Gambar</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Atur</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-500">Memuat galeri...</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-red-600">{error}</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                    <PackageOpen size={28} className="mx-auto mb-2" />
                    Tidak ada produk yang cocok dengan pencarian/filter.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const badge = statusBadge(row);
                  return (
                    <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/50 align-top">
                      <td className="px-5 py-4 pt-5">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300"
                          checked={selected.has(row.id)}
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

                      <td className="px-5 py-4">
                        <div className="flex gap-3">
                          {row.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={row.imageUrl} alt={row.name} className="w-12 h-12 rounded object-cover bg-gray-100 shrink-0" />
                          ) : (
                            <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-gray-300 shrink-0">
                              <Images size={18} />
                            </div>
                          )}
                          <div className="max-w-[240px]">
                            <div className="text-gray-900 font-bold leading-tight">{row.name}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{row.totalImages} gambar terunggah</div>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4 text-gray-600">
                        {row.category ? (
                          <span className="inline-block text-[10px] font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            {row.category}
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>

                      <td className="px-5 py-4 text-gray-700 font-semibold">{row.variantCount}</td>

                      <td className="px-5 py-4 text-gray-700 font-semibold">{row.totalImages}</td>

                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.cls}`}>
                          {badge.label}
                        </span>
                        {row.totalImages > 0 && (
                          <div className="text-[11px] text-gray-400 mt-1">
                            {Math.min(row.totalImages, row.required)}/{row.required} gambar
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => setDetailRow(row)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                        >
                          <Images size={14} /> Lihat Gambar
                        </button>
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
            {total.toLocaleString("id-ID")} produk · halaman {page} dari {totalPages}
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

      {detailRow && <GalleryModal row={detailRow} onClose={() => setDetailRow(null)} />}
      {historyOpen && <HistoryModal onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}