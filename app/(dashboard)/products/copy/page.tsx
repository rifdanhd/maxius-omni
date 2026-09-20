"use client";

import { useState } from "react";
import { authFetch } from "@/lib/utils/api-client";
import { useRouter } from "next/navigation";
import {
  Link2,
  Loader2,
  Sparkles,
  AlertTriangle,
  Check,
  ArrowLeft,
  ArrowRight,
  Save,
  ImagePlus,
  ShieldCheck,
  Plus,
  Trash2,
  Boxes,
} from "lucide-react";

type CopyVariant = {
  name: string;
  price: number;
  stock: number | null;
  sku?: string;
};

type ParsedData = {
  title: string;
  description: string;
  price: number | null;
  images: string[];
  sourceUrl: string;
  sourcePlatform: string;
  variants: CopyVariant[] | null;
};

type VariantRow = {
  name: string;
  price: string;
  stock: string;
  sku: string;
};

function fmtRupiah(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}

function PriceInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">
        Rp
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        placeholder="contoh: 25000"
        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
      />
    </div>
  );
}

export default function ProductCopyPage() {
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"input" | "preview" | "manual">("input");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [form, setForm] = useState({ name: "", price: "", description: "", category: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 5000);
  }

  function toggleImage(url_: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url_)) next.delete(url_);
      else next.add(url_);
      return next;
    });
  }

  function hasVariantMode(): boolean {
    return Array.isArray(parsed?.variants) && parsed!.variants!.length > 1 && variantRows.length > 0;
  }

  function updateVariantRow(index: number, patch: Partial<VariantRow>) {
    setVariantRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addVariantRow() {
    setVariantRows((rows) => [...rows, { name: "", price: "", stock: "0", sku: "" }]);
  }

  function removeVariantRow(index: number) {
    setVariantRows((rows) => rows.filter((_, i) => i !== index));
  }

  async function runParse() {
    const target = url.trim();
    if (!target) {
      setError("Masukkan URL halaman produk dulu.");
      return;
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(target);
      if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("protocol");
    } catch {
      setError("URL tidak valid. Masukkan URL lengkap, contoh: https://www.tokopedia.com/…");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await authFetch("/api/product-copy/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: target }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; data?: ParsedData; code?: string; error?: string }
        | null;
      if (!res.ok || !json?.ok || !json.data) {
        const code: string = json?.code ?? "";
        if (code === "NOT_PARSEABLE") {
          setMode("manual");
          setParsed(null);
          setError(
            json?.error ?? "Data tidak bisa diambil otomatis, silakan isi manual."
          );
        } else {
          setError(json?.error ?? `Gagal mengambil data (${res.status}).`);
        }
        return;
      }
      const data = json.data;
      setParsed(data);
      setSelected(new Set(data.images));
      setVariantRows(
        Array.isArray(data.variants) && data.variants.length > 1
          ? data.variants.map((v) => ({
              name: v.name,
              price: v.price > 0 ? String(v.price) : "",
              stock: v.stock !== null && v.stock > 0 ? String(v.stock) : "0",
              sku: v.sku ?? "",
            }))
          : []
      );
      setForm({
        name: data.title,
        price: data.price !== null && data.price > 0 ? String(data.price) : "",
        description: data.description,
        category: "",
      });
      setMode("preview");
    } catch (e) {
      console.error(e);
      setError("Terjadi kesalahan saat mengambil data.");
    } finally {
      setBusy(false);
    }
  }

  function startManual() {
    setError(null);
    setParsed(null);
    setSelected(new Set());
    setVariantRows([]);
    setForm({ name: "", price: "", description: "", category: "" });
    setMode("manual");
  }

  function resetToInput() {
    setMode("input");
    setError(null);
    setParsed(null);
    setVariantRows([]);
  }

  async function saveDraft() {
    const name = form.name.trim();
    if (!name) {
      setError("Nama produk wajib diisi.");
      return;
    }
    const price = form.price.replace(/[^\d]/g, "");
    const priceNum = price ? Number(price) : null;

    const variantMode = hasVariantMode();
    const variants = variantMode
      ? variantRows
          .filter((r) => r.name.trim() || r.price || r.stock.trim() || r.sku.trim())
          .map((r) => ({
            name: r.name.trim(),
            price: r.price ? Number(r.price) : null,
            stock: r.stock !== "" ? Number(r.stock) || 0 : 0,
            sku: r.sku.trim() || null,
          }))
      : undefined;

    setSaving(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const images = selected.size > 0 ? [...selected] : [];
      const res = await authFetch("/api/product-copy/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name,
          description: form.description.trim(),
          price: priceNum,
          images,
          imageUrl: images[0] ?? parsed?.images[0] ?? null,
          sourceUrl: parsed?.sourceUrl ?? null,
          category: form.category.trim() || null,
          variants,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? `Gagal menyimpan draft (${res.status}).`);
        return;
      }
      showToast("success", "Draft produk berhasil disimpan.");
      window.setTimeout(() => router.push("/products"), 1200);
    } catch (e) {
      console.error(e);
      setError("Terjadi kesalahan saat menyimpan draft.");
    } finally {
      setSaving(false);
    }
  }

  const backButton = (
    <button
      onClick={resetToInput}
      className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4"
    >
      <ArrowLeft size={14} /> Ganti URL
    </button>
  );

  return (
    <div className="p-8">
      <div className="mb-5">
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">
          Produk › Product Copy
        </p>
        <h1 className="text-xl font-bold text-gray-900">Copy Produk dari URL</h1>
      </div>

      <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
        <ShieldCheck size={16} className="mt-0.5 shrink-0" />
        <p>
          Fitur untuk membantu Anda meng-input ulang produk milik Anda sendiri (misal produk lama
          yang pernah dijual di platform lain) — bukan untuk menyalin produk kompetitor.
          <strong> Pastikan Anda punya hak untuk menggunakan konten ini.</strong>
        </p>
      </div>

      {toast && (
        <div
          className={`mb-4 px-4 py-3 rounded-md text-sm font-medium flex items-center gap-2 ${
            toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.type === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            {mode === "input" && (
              <button
                onClick={startManual}
                className="mt-1 text-red-600 underline font-medium hover:text-red-800"
              >
                Isi manual saja
              </button>
            )}
          </div>
        </div>
      )}

      {mode === "input" && (
        <div className="max-w-2xl">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <label className="font-semibold text-gray-700 text-sm flex items-center gap-1.5 mb-1.5">
              <Link2 size={15} /> URL Halaman Produk
            </label>
            <p className="text-[11px] text-gray-400 mb-3">
              Tempel link produk dari Shopee, Tokopedia, Tokopedia | Shop, atau situs lainnya.
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runParse()}
                placeholder="https://www.tokopedia.com/…"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              />
              <button
                onClick={runParse}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-[#2a3a8c] px-4 py-2 text-sm font-medium text-white hover:bg-blue-900 disabled:opacity-60"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {busy ? "Mengambil data..." : "Ambil Data"}
              </button>
            </div>
            {busy && (
              <p className="mt-3 text-xs text-gray-400 flex items-center gap-2">
                <Loader2 size={13} className="animate-spin" /> Mengambil & mem-parsing halaman…
              </p>
            )}
          </div>
          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-[11px] text-gray-500">
            Data yang diambil hanya yang tampil publik di halaman (judul, gambar, harga, deskripsi,
            dan varian bila tersedia). Stok diisi 0 bila tidak bisa dibaca — Anda memutakhirannya
            sebelum menyimpan draft.
          </div>
        </div>
      )}

      {(mode === "preview" || mode === "manual") && (
        <div className="relative">
          {backButton}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {/* Cover / form */}
            <div className="p-6">
              {/* Preview hasil scrape */}
              {mode === "preview" && parsed && (
                <div className="mb-6 flex items-start justify-between gap-3 flex-wrap border-b border-gray-100 pb-5">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-semibold">
                      {parsed.sourcePlatform}
                    </span>
                    {parsed.price !== null && (
                      <span className="text-xs text-emerald-600 font-semibold">
                        {fmtRupiah(parsed.price)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 max-w-md truncate" title={parsed.sourceUrl}>
                    Sumber: {parsed.sourceUrl.replace(/^https?:\/\//, "")}
                  </p>
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-1 md:grid-cols-2">
                {/* Gambar */}
                <div>
                  <label className="font-semibold text-gray-700 text-sm flex items-center gap-1.5 mb-1.5">
                    <ImagePlus size={15} /> Gambar Produk
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2">
                    Centang gambar yang ingin dipakai ({selected.size} dipilih)
                  </p>
                  {parsed && parsed.images.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {parsed.images.map((src) => {
                        const on = selected.has(src);
                        return (
                          <button
                            key={src}
                            type="button"
                            onClick={() => toggleImage(src)}
                            className={`relative aspect-square rounded-md border overflow-hidden bg-gray-50 ${
                              on ? "border-indigo-500 ring-2 ring-indigo-200" : "border-gray-200"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt="produk" className="w-full h-full object-cover" />
                            {on && (
                              <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                                <Check size={12} />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="border border-dashed border-gray-300 rounded-md px-4 py-8 text-center text-xs text-gray-400">
                      Tidak ada gambar yang berhasil diambil. Simpan dulu, tambahkan gambar nanti.
                    </div>
                  )}
                </div>

                {/* Field produk */}
                <div className="space-y-4">
                  <div>
                    <label className="font-semibold text-gray-700 text-sm block mb-1.5">
                      Nama Produk <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {!hasVariantMode() && (
                      <div>
                        <label className="font-semibold text-gray-700 text-sm block mb-1.5">
                          Harga (Rp)
                        </label>
                        <PriceInput value={form.price} onChange={(v) => setForm({ ...form, price: v })} />
                      </div>
                    )}
                    <div>
                      <label className="font-semibold text-gray-700 text-sm block mb-1.5">
                        Kategori <span className="text-gray-400 font-normal">(opsional)</span>
                      </label>
                      <input
                        type="text"
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                        placeholder="contoh: Makanan Ringan"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="font-semibold text-gray-700 text-sm block mb-1.5">
                      Deskripsi
                    </label>
                    <textarea
                      rows={6}
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Deskripsi produk…"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 resize-y"
                    />
                  </div>
                </div>
              </div>

              {hasVariantMode() && (
                <div className="border-t border-gray-200 px-6 py-6">
                  <div className="flex items-center gap-2 mb-1">
                    <Boxes size={16} className="text-[#2a3a8c]" />
                    <h2 className="font-semibold text-gray-900">Daftar Varian</h2>
                    <span className="text-[11px] text-gray-400 font-normal">
                      ({variantRows.length} varian — hasil deteksi otomatis bisa diubah)
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mb-4">
                    Stok kosong/unknown diisi 0 secara otomatis — perbarui sebelum menyimpan.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          <th className="px-4 py-3">Nama Varian</th>
                          <th className="px-4 py-3 w-40">Harga (Rp)</th>
                          <th className="px-4 py-3 w-28">Stok</th>
                          <th className="px-4 py-3 w-52">SKU (opsional)</th>
                          <th className="px-4 py-3 w-12"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {variantRows.map((row, i) => (
                          <tr key={i} className="align-top">
                            <td className="px-4 py-2">
                              <input
                                type="text"
                                value={row.name}
                                onChange={(e) => updateVariantRow(i, { name: e.target.value })}
                                placeholder="mis. Hitam - M"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <PriceInput value={row.price} onChange={(v) => updateVariantRow(i, { price: v })} />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="text"
                                inputMode="numeric"
                                value={row.stock}
                                onChange={(e) =>
                                  updateVariantRow(i, { stock: e.target.value.replace(/[^\d]/g, "") })
                                }
                                placeholder="0"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="text"
                                value={row.sku}
                                onChange={(e) => updateVariantRow(i, { sku: e.target.value })}
                                placeholder="kosongkan untuk generate otomatis"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() => removeVariantRow(i)}
                                className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                                title="Hapus varian"
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    onClick={addVariantRow}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    <Plus size={14} /> Tambah varian
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-3 flex-wrap bg-gray-50/60">
              <p className="text-[11px] text-gray-400">
                Hasil ambil otomatis bisa tidak 100% akurat — periksa & edit dulu sebelum menyimpan.
              </p>
              <button
                onClick={saveDraft}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-[#2a3a8c] px-5 py-2 text-sm font-medium text-white hover:bg-blue-900 disabled:opacity-60"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {saving ? "Menyimpan…" : "Simpan sebagai Draft Produk"}
                {!saving && <ArrowRight size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}