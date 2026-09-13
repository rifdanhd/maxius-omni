"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/utils/api-client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Check,
  Plus,
  X,
  Upload,
  List,
  ListOrdered,
  ImagePlus,
  ChevronDown,
  ChevronRight,
  Info,
  Layers,
} from "lucide-react";

/* ------------------------------ Types ------------------------------ */

type AttrOption = { id: string; name: string };
type AttrRow = {
  id: string;
  name: string;
  type: string;
  required: boolean;
  multiple: boolean;
  customizable: boolean;
  options: AttrOption[];
  selected: string[];
  customInput: string;
};

type SalesAttr = {
  attrId: string;
  attrName: string;
  valueId: string | null;
  valueName: string;
};

type VariantRow = {
  key: string;
  name: string;
  salesAttributes: SalesAttr[];
  tiktokSkuId?: string;
  sellerSku: string;
  price: string;
  stock: string;
  localVariantId?: string;
};

type DimValue = { id: string; name: string };
type Dim = { id: string; name: string; values: DimValue[] };

type ImageItem = { uid: string; uri?: string; dataUrl?: string; name?: string; src: string };

type CertItem = {
  uid: string;
  kind: "file" | "image";
  id?: string; // existing file id / uri utk existing image
  name?: string;
  format?: string;
  uri?: string;
  dataUrl?: string;
  mimeType?: string;
};

type CertState = {
  id: string;
  title: string;
  required: boolean;
  documentDetails?: string;
  items: CertItem[];
};

type EditLoad = {
  mappingId: string;
  masterName: string;
  channelSku: string;
  platformProductId: string;
  accountLabel: string;
  title: string;
  description: string;
  categoryId: string | null;
  categoryNames: string[];
  brandName?: string;
  attributes: Array<{
    id: string;
    name: string;
    type: string;
    required: boolean;
    multiple: boolean;
    customizable: boolean;
    options: AttrOption[];
    current: string[];
  }>;
  variants: Array<{
    key: string;
    name: string;
    salesAttributes: SalesAttr[];
    tiktokSkuId?: string;
    sellerSku: string;
    price: number | null;
    stock: number | null;
    localVariantId?: string;
  }>;
  images: Array<{ id: string; uri?: string; dataUrl?: string; name?: string; src: string }>;
  certifications: Array<{
    id: string;
    title: string;
    required: boolean;
    documentDetails?: string;
    files: Array<{ id?: string; name?: string; format?: string }>;
    images: Array<{ uri?: string }>;
  }>;
  weight: { value: number | null; unit: "KG" | "G" };
  dimensions: { length: number | null; width: number | null; height: number | null };
  cod: boolean;
  listingPlatforms: string[];
  platforms: Array<{ key: string; label: string }>;
};

type LoadResponse = { ok: boolean; data?: EditLoad; error?: string };
type PutResponse = { ok: boolean; error?: string; message?: string; auditStatus?: string };

/* ------------------------------ Helpers ------------------------------ */

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`;
}

function combine<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap((a) => arr.map((v) => [...a, v])),
    [[]]
  );
}

function comboSignature(sales: SalesAttr[]): string {
  return sales
    .map((s) => `${(s.attrName || s.attrId || "").toLowerCase()}|${(s.valueName || s.valueId || "").toLowerCase()}`)
    .sort()
    .join("^");
}

function buildRowsFromDims(baseRows: VariantRow[], dims: Dim[]): VariantRow[] {
  const active = dims.filter((d) => d.name.trim() && d.values.length > 0);
  if (active.length === 0) return baseRows;

  const combos = combine(active.map((d) => d.values));
  const bySig = new Map(baseRows.map((r) => [comboSignature(r.salesAttributes), r]));
  const singleFlatBase = baseRows.length === 1 && baseRows[0].salesAttributes.length === 0 ? baseRows[0] : undefined;

  return combos.map((values, idx) => {
    const sales: SalesAttr[] = values.map((v, vi) => ({
      attrId: "",
      attrName: active[vi].name.trim(),
      valueId: null,
      valueName: v.name,
    }));
    const sig = comboSignature(sales);
    const matched = bySig.get(sig);
    const base = matched ?? (idx === 0 && singleFlatBase ? singleFlatBase : undefined);
    return {
      key: uid(),
      name: sales.map((s) => s.valueName).join(" - "),
      salesAttributes: sales,
      ...(base?.tiktokSkuId ? { tiktokSkuId: base.tiktokSkuId } : {}),
      sellerSku: base?.sellerSku ?? `SKU-${idx + 1}`,
      price: base?.price ?? "",
      stock: base?.stock ?? "",
      localVariantId: base?.localVariantId,
    };
  });
}

function htmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  const lines: string[] = [];
  const walk = (node: ChildNode) => {
    const tag = node.nodeType === 1 ? (node as Element).tagName.toLowerCase() : "";
    if (tag === "br") {
      lines.push("");
      return;
    }
    if (tag === "ul") {
      for (const li of Array.from(node.childNodes)) {
        if (li.nodeType === 1 && (li as Element).tagName.toLowerCase() === "li") {
          lines.push("- " + (li.textContent ?? "").trim());
        } else walk(li);
      }
      return;
    }
    if (tag === "ol") {
      Array.from(node.childNodes).forEach((li, i) => {
        if (li.nodeType === 1 && (li as Element).tagName.toLowerCase() === "li") {
          lines.push(`${i + 1}. ` + (li.textContent ?? "").trim());
        } else walk(li);
      });
      return;
    }
    if (tag === "img") return; // gambar deskripsi tak dibawa ke API deskripsi
    if (tag === "p" || tag === "div" || tag === "li") {
      if (node.childNodes.length <= 1) {
        lines.push((node.textContent ?? "").trim());
        return;
      }
    }
    if (tag === "div" || tag === "p") {
      // blok: kumpulkan teks dari children, lalu flush di akhir anak
    }
    node.childNodes.forEach(walk);
  };
  div.childNodes.forEach(walk);
  return lines
    .join("\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

/* ------------------------------ Page ------------------------------ */

export default function TikTokEditPage() {
  const params = useParams<{ mappingId: string }>();
  const router = useRouter();
  const mappingId = params?.mappingId ?? "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [data, setData] = useState<EditLoad | null>(null);
  const [title, setTitle] = useState("");
  const [descHtml, setDescHtml] = useState("");
  const [catId, setCatId] = useState<string | null>(null);
  const [catNames, setCatNames] = useState<string[]>([]);
  const [attrs, setAttrs] = useState<AttrRow[]>([]);
  const [dims, setDims] = useState<Dim[]>([]);
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [baseRows, setBaseRows] = useState<VariantRow[]>([]);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [certs, setCerts] = useState<CertState[]>([]);
  const [weight, setWeight] = useState<{ value: string; unit: "KG" | "G" }>({ value: "", unit: "KG" });
  const [pkg, setPkg] = useState<{ length: string; width: string; height: string }>({
    length: "",
    width: "",
    height: "",
  });
  const [cod, setCod] = useState(true);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [showOptional, setShowOptional] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const descRef = useRef<HTMLDivElement>(null);
  const descInitRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const catInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`/api/marketplace/tiktok/products/${mappingId}/edit`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
        });
        const json = (await res.json()) as LoadResponse;
        if (!json.ok || !json.data) throw new Error(json.error ?? "Gagal memuat data.");
        const d = json.data;
        setData(d);
        setTitle(d.title);
        setDescHtml(d.description);
        descInitRef.current = false;
        setCatId(d.categoryId);
        setCatNames(d.categoryNames);
        setAttrs(
          d.attributes.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            required: a.required,
            multiple: a.multiple,
            customizable: a.customizable,
            options: a.options,
            selected: a.current.slice(),
            customInput: a.multiple || !a.options.length ? a.current.filter((c) => !a.options.some((o) => o.id === c)).join(", ") : a.current[0] ?? "",
          }))
        );
        setDims([]);
        const br = d.variants.map((v) => ({
          key: v.key,
          name: v.name,
          salesAttributes: v.salesAttributes,
          ...(v.tiktokSkuId ? { tiktokSkuId: v.tiktokSkuId } : {}),
          sellerSku: v.sellerSku,
          price: v.price === null || v.price === undefined ? "" : String(v.price),
          stock: v.stock === null || v.stock === undefined ? "" : String(v.stock),
          localVariantId: v.localVariantId,
        }));
        setBaseRows(br);
        setRows(br);
        setImages(
          d.images.map((i) => ({
            uid: i.id,
            uri: i.uri,
            dataUrl: i.dataUrl,
            name: i.name,
            src: i.src,
          }))
        );
        setCerts(
          d.certifications.map((c) => ({
            id: c.id,
            title: c.title,
            required: c.required,
            documentDetails: c.documentDetails,
            items: [
              ...c.files.map(
                (f, i): CertItem => ({
                  uid: `cf-${i}-${f.id}`,
                  kind: "file",
                  id: f.id,
                  name: f.name,
                  format: f.format,
                })
              ),
              ...c.images.map(
                (img, i): CertItem => ({
                  uid: `ci-${i}-${img.uri}`,
                  kind: "image",
                  uri: img.uri,
                  name: `sertifikat-${i + 1}.jpg`,
                })
              ),
            ].slice(0, 3),
          }))
        );
        setWeight({
          value: d.weight.value === null ? "" : String(d.weight.value),
          unit: d.weight.unit,
        });
        setPkg({
          length: d.dimensions.length === null ? "" : String(d.dimensions.length),
          width: d.dimensions.width === null ? "" : String(d.dimensions.width),
          height: d.dimensions.height === null ? "" : String(d.dimensions.height),
        });
        setCod(d.cod);
        setPlatforms(d.listingPlatforms);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Gagal memuat data edit.");
      } finally {
        setLoading(false);
      }
    })();
  }, [mappingId]);

  // isi HTML editor setalah data datang (contentEditable tidak dikontrol React)
  useEffect(() => {
    if (data && !descInitRef.current && descRef.current) {
      descRef.current.innerHTML = data.description || "";
      descInitRef.current = true;
    }
  }, [data]);

  const requiredAttrs = useMemo(() => attrs.filter((a) => a.required), [attrs]);
  const optionalAttrs = useMemo(() => attrs.filter((a) => !a.required), [attrs]);

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 6000);
  }

  function setAttrsUpdated(next: AttrRow[]) {
    setAttrs(next);
    setFieldErrors((f) => {
      const copy = { ...f };
      delete copy.attrs;
      return copy;
    });
  }

  /* Category picker */
  const [catOpen, setCatOpen] = useState(false);
  const [catQuery, setCatQuery] = useState("");
  const [catResults, setCatResults] = useState<
    Array<{ id: string; name: string; parentId: string | null; isLeaf: boolean }>
  >([]);
  const [catBusy, setCatBusy] = useState(false);
  const catTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function searchCategory(q: string) {
    if (catTimer.current) clearTimeout(catTimer.current);
    catTimer.current = setTimeout(async () => {
      setCatBusy(true);
      try {
        const res = await authFetch(
          `/api/marketplace/tiktok/categories?keyword=${encodeURIComponent(q)}`,
          { headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` } }
        );
        const json = await res.json();
        if (json.ok) setCatResults(json.categories as typeof catResults);
        else setCatResults([]);
      } catch {
        setCatResults([]);
      } finally {
        setCatBusy(false);
      }
    }, 300);
  }

  function pickCategory(c: { id: string; name: string }) {
    setCatId((prev) => (prev === c.id ? prev : c.id));
    setCatNames((prev) => (prev[prev.length - 1] === c.name ? prev : [...prev, c.name]));
    setCatOpen(false);
    setCatQuery("");
    // Muat ulang atribut & sertifikasi untuk kategori baru
    fetchAttributesFor(c.id);
  }

  async function fetchAttributesFor(categoryId: string) {
    try {
      const res = await authFetch(
        `/api/marketplace/tiktok/categories/${encodeURIComponent(categoryId)}/attributes?accountId=`,
        { headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` } }
      );
      const json = await res.json();
      if (!json.ok) return;
      setAttrs(
        (json.attributes as Array<AttrRow & { options: AttrOption[] }>).map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          required: a.required,
          multiple: a.multiple,
          customizable: a.customizable,
          options: a.options,
          selected: [],
          customInput: "",
        }))
      );
      const certsNew = (json.certifications as Array<{ id: string; title: string; required: boolean; documentDetails?: string }>).map((c) => ({
        id: c.id,
        title: c.title,
        required: c.required,
        documentDetails: c.documentDetails,
        items: [] as CertItem[],
      }));
      if (certsNew.length > 0) setCerts(certsNew);
    } catch {
      /* biarkan atribut lama */
    }
  }

  /* Variants */
  function updateDim(id: string, patch: Partial<Dim>) {
    const nextDims = dims.map((d) => (d.id === id ? { ...d, ...patch } : d));
    setDims(nextDims);
    setRows(buildRowsFromDims(baseRows, nextDims));
  }

  function removeDim(id: string) {
    const d = dims.find((x) => x.id === id);
    if (d && (d.values.length > 0 || d.name.trim())) {
      const ok = window.confirm(
        "Mohon berhati-hati hapus opsi varian berdampak terhadap produk master terkait. Lanjutkan?"
      );
      if (!ok) return;
    }
    const nextDims = dims.filter((x) => x.id !== id);
    setDims(nextDims);
    setRows(buildRowsFromDims(baseRows, nextDims));
  }

  function removeDimValue(dimId: string, valId: string) {
    const ok = window.confirm(
      "Mohon berhati-hati hapus opsi varian berdampak terhadap produk master terkait. Lanjutkan?"
    );
    if (!ok) return;
    const nextDims = dims.map((d) =>
      d.id === dimId ? { ...d, values: d.values.filter((v) => v.id !== valId) } : d
    );
    setDims(nextDims);
    setRows(buildRowsFromDims(baseRows, nextDims));
  }

  function addDimValue(dimId: string, valueName: string) {
    const name = valueName.trim();
    if (!name) return;
    setDims((prev) => {
      const next = prev.map((d) =>
        d.id === dimId && !d.values.some((v) => v.name.toLowerCase() === name.toLowerCase())
          ? { ...d, values: [...d.values, { id: uid(), name }] }
          : d
      );
      setRows(buildRowsFromDims(baseRows, next));
      return next;
    });
  }

  function setRowField(key: string, field: "price" | "stock" | "sellerSku", value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
    setFieldErrors((f) => {
      const c = { ...f };
      delete c[`variant-${key}`];
      return c;
    });
  }

  const [applyPrice, setApplyPrice] = useState("");
  const [applyStock, setApplyStock] = useState("");
  const [applySku, setApplySku] = useState("");

  function applyAll() {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        price: applyPrice !== "" ? applyPrice : r.price,
        stock: applyStock !== "" ? applyStock : r.stock,
        sellerSku: applySku.trim() !== "" ? applySku : r.sellerSku,
      }))
    );
  }

  /* Images */
  function addFilesFromInput(files: FileList | null) {
    if (!files) return;
    setImages((prev) => {
      const next = [...prev];
      for (const file of Array.from(files)) {
        if (next.length >= 9) break;
        const url = URL.createObjectURL(file);
        const reader = new FileReader();
        reader.onload = () => {
          setImages((cur) =>
            cur.map((i) => (i.src === url ? { ...i, dataUrl: String(reader.result) } : i))
          );
        };
        next.push({ uid: uid(), src: url, name: file.name, dataUrl: undefined });
        reader.readAsDataURL(file);
      }
      return next;
    });
  }

  function removeImage(uid_: string) {
    setImages((prev) => prev.filter((i) => i.uid !== uid_));
  }

  /* Certifications */
  function addCertFile(certId: string, file: File) {
    const isImage = file.type.startsWith("image/");
    setCerts((prev) =>
      prev.map((c) => {
        if (c.id !== certId || c.items.length >= 3) return c;
        const url = URL.createObjectURL(file);
        const reader = new FileReader();
        let itemUid = "";
        const item: CertItem & { src?: string } = {
          uid: uid(),
          kind: isImage ? "image" : "file",
          name: file.name,
          dataUrl: undefined,
          mimeType: file.type || undefined,
          src: url,
        };
        itemUid = item.uid;
        reader.onload = () => {
          setCerts((cur) =>
            cur.map((cc) =>
              cc.id === certId
                ? {
                    ...cc,
                    items: cc.items.map((it) =>
                      it.uid === itemUid ? { ...it, dataUrl: String(reader.result) } : it
                    ),
                  }
                : cc
            )
          );
        };
        reader.readAsDataURL(file);
        return { ...c, items: [...c.items, item] };
      })
    );
  }

  function removeCertItem(certId: string, itemUid: string) {
    setCerts((prev) =>
      prev.map((c) => (c.id === certId ? { ...c, items: c.items.filter((i) => i.uid !== itemUid) } : c))
    );
  }

  /* Validation & submit */
  function setAttrSelection(id: string, valueId: string, add: boolean) {
    setAttrsUpdated(
      attrs.map((a) => {
        if (a.id !== id) return a;
        const selected = add
          ? a.multiple
            ? [...a.selected, valueId]
            : [valueId]
          : a.selected.filter((s) => s !== valueId);
        return { ...a, selected };
      })
    );
  }

  async function submit() {
    if (saving) return;
    const errors: Record<string, string> = {};
    const text = descHtml ? htmlToText(descHtml) : "";
    if (!title.trim()) errors.title = "Nama produk wajib diisi.";
    else if (title.trim().length > 255) errors.title = "Maksimal 255 karakter.";
    if (!catId) errors.category = "Kategori wajib dipilih.";
    if (!text) errors.description = "Deskripsi produk wajib diisi.";
    for (const a of requiredAttrs) {
      if (a.selected.length === 0 && !a.customInput.trim()) {
        errors.attrs = "Atribut wajib kategori belum dilengkapi.";
        break;
      }
    }
    for (const r of rows) {
      if (!r.sellerSku.trim()) errors[`variant-${r.key}`] = "SKU wajib diisi.";
      else if (!(Number(r.price) > 0)) errors[`variant-${r.key}`] = "Harga wajib diisi (> 0).";
      else if (r.stock === "" || !Number.isFinite(Number(r.stock)) || Number(r.stock) < 0)
        errors[`variant-${r.key}`] = "Stok wajib diisi (>= 0).";
    }
    if (!(Number(weight.value) > 0)) errors.weight = "Berat produk wajib diisi (> 0).";
    for (const [k, v] of Object.entries(pkg)) {
      const n = Number(v);
      if (!v || !Number.isFinite(n) || n < 1 || n > 1000) {
        errors[k] = "Diisi antara 1 - 1.000";
      }
    }
    if (platforms.length === 0) errors.platforms = "Minimal satu platform harus dipilih.";
    if (images.length === 0) errors.images = "Unggah minimal 1 foto produk.";

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      showToast("error", "Periksa kembali field yang wajib diisi.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: descHtml.replace(/<img[^>]*>/g, ""),
        categoryId: catId!,
        requiredAttributeIds: requiredAttrs.map((a) => a.id),
        attributes: attrs
          .filter((a) => a.type === "PRODUCT_PROPERTY")
          .map((a) => ({
            id: a.id,
            valueIds: a.selected,
            customNames: a.customInput.trim() ? [a.customInput.trim()] : [],
          })),
        variants: rows.map((r) => ({
          key: r.key,
          ...(r.tiktokSkuId ? { tiktokSkuId: r.tiktokSkuId } : {}),
          sellerSku: r.sellerSku.trim(),
          price: Number(r.price),
          stock: Number(r.stock),
          salesAttributes: r.salesAttributes.map((sa) => ({
            attrId: sa.attrId,
            valueId: sa.valueId,
            valueName: sa.valueName,
          })),
          ...(r.localVariantId ? { localVariantId: r.localVariantId } : {}),
        })),
        images: images
          .filter((i) => i.uri || i.dataUrl)
          .map((i) => ({
            ...(i.uri ? { uri: i.uri } : {}),
            ...(i.dataUrl ? { dataUrl: i.dataUrl } : {}),
            ...(i.name ? { name: i.name } : {}),
          })),
        certifications: certs.map((c) => ({
          id: c.id,
          files: c.items.map((it) => ({
            ...(it.id && it.kind === "file" ? { existingFileId: it.id } : {}),
            ...(it.uri || (it.id && it.kind === "image") ? { existingUri: it.uri ?? it.id } : {}),
            ...(it.name ? { name: it.name } : {}),
            ...(it.format ? { format: it.format } : {}),
            ...(it.dataUrl ? { dataUrl: it.dataUrl } : {}),
            ...(it.mimeType ? { mimeType: it.mimeType } : {}),
          })),
        })),
        weight: { value: Number(weight.value), unit: weight.unit },
        dimensions: {
          length: Number(pkg.length),
          width: Number(pkg.width),
          height: Number(pkg.height),
        },
        cod,
        listingPlatforms: platforms,
      };

      const res = await authFetch(`/api/marketplace/tiktok/products/${mappingId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
        },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as PutResponse;
      if (!json.ok || !res.ok) throw new Error(json.error ?? "Publish gagal.");
      showToast("success", json.message ?? "Produk berhasil diperbarui.");
      window.setTimeout(() => router.push("/products/marketplace/tiktok"), 1500);
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Publish gagal.");
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------ Render ------------------------------ */

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-gray-500 gap-2">
        <Loader2 className="animate-spin" size={18} /> Memuat data produk...
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="min-h-[45vh] flex items-center justify-center">
        <div className="max-w-md text-center">
          <AlertTriangle size={28} className="mx-auto mb-3 text-red-500" />
          <p className="text-gray-700 font-semibold">{loadError ?? "Data tidak ditemukan."}</p>
          <Link href="/products/marketplace/tiktok" className="inline-flex items-center gap-1 mt-4 text-sm text-indigo-600 hover:underline">
            <ArrowLeft size={14} /> Kembali ke listing
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-md shadow-lg text-sm font-medium flex items-center gap-2 ${
            toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.type === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link
            href="/products/marketplace/tiktok"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
          >
            <ArrowLeft size={14} /> Kembali ke listing TikTok Shop
          </Link>
          <h1 className="text-xl font-bold text-gray-900 mt-2 flex items-center gap-2">
            Ubah Produk
            <span className="text-xs font-semibold text-white bg-black px-2 py-0.5 rounded-full">TikTok Shop</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">{title || data.masterName}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Master: {data.masterName} · Produk ID: {data.platformProductId}
          </p>
        </div>
      </div>

      {/* A. Informasi Produk */}
      <Section title="A. Informasi Produk" icon={Layers} index={1}>
        <Field label="Nama Produk" required error={fieldErrors.title}>
          <input
            type="text"
            value={title}
            maxLength={255}
            onChange={(e) => {
              setTitle(e.target.value);
              setFieldErrors((f) => ({ ...f, title: "" }));
            }}
              placeholder="Nama produk sesuai SKU & kategori TikTok Shop"
            className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${
              fieldErrors.title ? "border-red-400" : "border-gray-300"
            }`}
          />
          <span className="text-[11px] text-gray-400">{title.length}/255 karakter</span>
        </Field>

        <Field label="Kategori" required error={fieldErrors.category}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setCatOpen((v) => !v)}
              className={`w-full px-3 py-2 border rounded-md text-sm text-left flex items-center justify-between ${
                fieldErrors.category ? "border-red-400" : "border-gray-300"
              }`}
            >
              <span className={catNames.length ? "text-gray-900" : "text-gray-400"}>
                {catNames.length ? catNames.join(" > ") : "Cari kategori TikTok Shop..."}
              </span>
              {catOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {catOpen && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg p-3">
                <input
                  ref={catInputRef}
                  autoFocus
                  value={catQuery}
                  onChange={(e) => {
                    setCatQuery(e.target.value);
                    if (e.target.value.trim().length >= 2) searchCategory(e.target.value);
                  }}
                  placeholder="Ketik minimal 2 huruf (mis. keripik)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
                <div className="mt-2 max-h-56 overflow-y-auto">
                  {catBusy && (
                    <div className="flex items-center gap-2 text-xs text-gray-400 p-2">
                      <Loader2 size={13} className="animate-spin" /> mencari...
                    </div>
                  )}
                  {!catBusy && catResults.length === 0 && (
                    <p className="text-xs text-gray-400 p-2">Ketik keyword untuk mencari kategori.</p>
                  )}
                  {catResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCategory(c)}
                      className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-indigo-50 text-gray-700"
                    >
                      <span className="font-medium">{c.name}</span>
                      {!c.isLeaf && <span className="text-[10px] text-gray-400 ml-1">(parent)</span>}
                    </button>
                  ))}
                </div>
                {catId && (
                  <div className="mt-2 border-t border-gray-100 pt-2 flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Terpilih: {catId}</span>
                    <button
                      type="button"
                      onClick={() => setCatOpen(false)}
                      className="text-xs font-semibold bg-[#2a3a8c] text-white px-3 py-1 rounded-md"
                    >
                      Terapkan
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Field>

        <Field label="Deskripsi Produk" required error={fieldErrors.description} hint="Bullet list, numbered list, dan insert gambar didukung.">
          <div
            className={`border rounded-md overflow-hidden ${fieldErrors.description ? "border-red-400" : "border-gray-300"}`}
          >
            <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-50 border-b border-gray-200">
              <ToolButton label="Bullet list" onClick={() => document.execCommand("insertUnorderedList")}>
                <List size={14} />
              </ToolButton>
              <ToolButton label="Numbered list" onClick={() => document.execCommand("insertOrderedList")}>
                <ListOrdered size={14} />
              </ToolButton>
              <ToolButton
                label="Insert gambar"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.onchange = () => {
                    const f = input.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () =>
                      descRef.current?.focus() &&
                      document.execCommand("insertHTML", false, `<img src="${reader.result}" width="200" />`);
                    reader.readAsDataURL(f);
                  };
                  input.click();
                }}
              >
                <ImagePlus size={14} />
              </ToolButton>
            </div>
            <div
              ref={descRef}
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => setDescHtml(e.currentTarget.innerHTML)}
              className="min-h-[140px] px-3 py-2 text-sm text-gray-800 focus:outline-none prose-sm"
              data-placeholder="Tulis deskripsi lengkap produk..."
            />
          </div>
        </Field>
      </Section>

      {/* B. Spesifikasi */}
      <Section title="B. Spesifikasi" icon={Info} index={2} hint="Atribut dinamis dari kategori TikTok Shop yang dipilih.">
        {requiredAttrs.map((a) => (
          <AttributeField
            key={a.id}
            attr={a}
            error={fieldErrors.attrs}
            onToggle={setAttrSelection}
            onCustom={(v) => setAttrsUpdated(attrs.map((x) => (x.id === a.id ? { ...x, customInput: v } : x)))}
            onErrorClear={() => setFieldErrors((f) => ({ ...f, attrs: "" }))}
          />
        ))}

        {optionalAttrs.length > 0 && (
          <>
            {showOptional &&
              optionalAttrs.map((a) => (
                <AttributeField
                  key={a.id}
                  attr={a}
                  error={fieldErrors.attrs}
                  onToggle={setAttrSelection}
                  onCustom={(v) => setAttrsUpdated(attrs.map((x) => (x.id === a.id ? { ...x, customInput: v } : x)))}
                  onErrorClear={() => setFieldErrors((f) => ({ ...f, attrs: "" }))}
                />
              ))}
            {!showOptional && (
              <button
                type="button"
                onClick={() => setShowOptional(true)}
                className="mt-2 text-sm font-medium text-indigo-600 hover:underline inline-flex items-center gap-1"
              >
                Lihat lebih banyak <ChevronDown size={14} />
              </button>
            )}
          </>
        )}
        {attrs.length === 0 && (
          <p className="text-sm text-gray-400">Tidak ada atribut kategori untuk ditampilkan.</p>
        )}
      </Section>

      {/* C. Varian */}
      <Section title="C. Informasi Penjualan (Varian)" icon={Layers} index={3} hint="Maksimum 3 tipe varian sesuai batas TikTok Shop.">
        {dims.map((d) => (
          <div key={d.id} className="border border-gray-200 rounded-md p-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Tipe Varian</span>
              <button
                type="button"
                onClick={() => removeDim(d.id)}
                className="text-xs text-red-500 hover:underline inline-flex items-center gap-1"
              >
                <X size={12} /> Hapus Varian
              </button>
            </div>
            <input
              type="text"
              value={d.name}
              onChange={(e) => updateDim(d.id, { name: e.target.value })}
              placeholder="Nama tipe varian, mis. Berat"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            <div className="flex flex-wrap items-center gap-2">
              {d.values.map((v) => (
                <span
                  key={v.id}
                  className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 text-sm font-medium px-3 py-1.5 rounded-full"
                >
                  {v.name}
                  <button type="button" onClick={() => removeDimValue(d.id, v.id)} className="hover:text-red-500">
                    <X size={13} />
                  </button>
                </span>
              ))}
              <AddChip onAdd={(name) => addDimValue(d.id, name)} placeholder="tambah nilai" />
            </div>
          </div>
        ))}

        {dims.length < 3 && (
          <button
            type="button"
            onClick={() => {
              setDims((prev) => [...prev, { id: uid(), name: "", values: [] }]);
            }}
            className="text-sm font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1 mb-4"
          >
            <Plus size={14} /> Tambah Varian
          </button>
        )}

        {/* Apply all */}
        <div className="bg-gray-50 border border-gray-200 rounded-md p-4 mb-4">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
            Atur dan terapkan ke semua Varian
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input
              type="number"
              min={0}
              step={100}
              value={applyPrice}
              onChange={(e) => setApplyPrice(e.target.value)}
              placeholder="Harga semua (Rp)"
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <input
              type="number"
              min={0}
              value={applyStock}
              onChange={(e) => setApplyStock(e.target.value)}
              placeholder="Stok semua"
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <input
              type="text"
              value={applySku}
              onChange={(e) => setApplySku(e.target.value)}
              placeholder="SKU semua (prefix)"
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <button
              type="button"
              onClick={applyAll}
              className="px-3 py-2 bg-[#2a3a8c] text-white text-sm font-semibold rounded-md hover:bg-indigo-700"
            >
              Terapkan Semua
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Hanya mengisi baris di bawah, tidak langsung submit.
          </p>
        </div>

        <div className="overflow-x-auto border border-gray-200 rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-[#f8f9fa] text-gray-600 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left">Nama</th>
                <th className="px-4 py-3 text-left w-36">Harga (Rp)</th>
                <th className="px-4 py-3 text-left w-28">Stok</th>
                <th className="px-4 py-3 text-left w-48">SKU Varian</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const err = fieldErrors[`variant-${r.key}`];
                return (
                  <tr key={r.key} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2 text-gray-700 font-semibold">{r.name || "Varian"}</td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={r.price}
                        onChange={(e) => setRowField(r.key, "price", e.target.value)}
                        placeholder="10000"
                        className={`w-full px-2 py-2 border rounded-md text-sm ${err ? "border-red-400" : "border-gray-300"} focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        value={r.stock}
                        onChange={(e) => setRowField(r.key, "stock", e.target.value)}
                        placeholder="0"
                        className={`w-full px-2 py-2 border rounded-md text-sm ${err ? "border-red-400" : "border-gray-300"} focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={r.sellerSku}
                        onChange={(e) => setRowField(r.key, "sellerSku", e.target.value)}
                        placeholder="SKU-CHANNEL-001"
                        className={`w-full px-2 py-2 border rounded-md text-sm ${err ? "border-red-400" : "border-gray-300"} focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
                      />
                      {err && <span className="text-[11px] text-red-500 block mt-1">{err}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-4 text-sm text-gray-400 text-center">Belum ada varian.</p>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          {rows.filter((r) => r.tiktokSkuId).length} SKU terhubung ke TikTok; baris baru akan dibuatkan SKU baru saat Publish.
        </p>
      </Section>

      {/* D. Foto Produk */}
      <Section title="D. Unggah Foto Produk" icon={ImagePlus} index={4} error={fieldErrors.images}>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          {images.map((img) => (
            <div key={img.uid} className="relative group aspect-square rounded-md overflow-hidden border border-gray-200 bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt="produk" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeImage(img.uid)}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition"
                aria-label="Hapus foto"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {images.length < 9 && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="aspect-square rounded-md border-2 border-dashed border-gray-300 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 flex flex-col items-center justify-center gap-1 transition"
            >
              <Upload size={18} />
              <span className="text-[11px] font-medium">Tambah</span>
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addFilesFromInput(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-[11px] text-gray-400 mt-2">
          {images.length}/9 foto · Gambar baru di-upload ke TikTok Shop saat Publish.
        </p>
      </Section>

      {/* E. Sertifikasi */}
      <Section title="E. Sertifikasi Produk" icon={Check} index={5} hint="Dokumen dari aturan kategori TikTok Shop (mis. Halal & BPOM). Maks. 3 file per sertifikat.">
        {certs.length === 0 && <p className="text-sm text-gray-400">Kategori ini tidak mensyaratkan sertifikasi.</p>}
        {certs.map((c) => (
          <div key={c.id} className="border border-gray-200 rounded-md p-4 mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                {c.title}
                {c.required && (
                  <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Wajib</span>
                )}
              </span>
              <span className="text-[11px] text-gray-400">{c.items.length}/3 file</span>
            </div>
            {c.documentDetails && <p className="text-[11px] text-gray-400 mb-2">{c.documentDetails}</p>}
            <div className="flex flex-wrap gap-2">
              {c.items.map((it) => (
                <span
                  key={it.uid}
                  className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-xs px-3 py-1.5 rounded-full"
                  title={it.kind === "image" ? "Gambar sertifikat" : "File sertifikat"}
                >
                  {it.kind === "image" ? <ImagePlus size={12} /> : <Check size={12} />}
                  <span className="max-w-[160px] truncate">{it.name ?? (it.uri ? "gambar yang ada" : "file")}</span>
                  <button type="button" onClick={() => removeCertItem(c.id, it.uid)} className="hover:text-red-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
              {c.items.length < 3 && (
                <label className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 border border-dashed border-indigo-300 rounded-full px-3 py-1.5 cursor-pointer hover:bg-indigo-50">
                  <Upload size={12} /> Tambah file
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) addCertFile(c.id, f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        ))}
      </Section>

      {/* F. Pengiriman & Garansi */}
      <Section title="F. Pengiriman & Garansi" icon={Check} index={6}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Field label="Berat Produk" required error={fieldErrors.weight}>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                step="any"
                value={weight.value}
                onChange={(e) => {
                  setWeight((w) => ({ ...w, value: e.target.value }));
                  setFieldErrors((f) => ({ ...f, weight: "" }));
                }}
                placeholder="0.5"
                className={`w-full px-3 py-2 border rounded-md text-sm ${fieldErrors.weight ? "border-red-400" : "border-gray-300"} focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
              />
              <select
                value={weight.unit}
                onChange={(e) => setWeight((w) => ({ ...w, unit: e.target.value as "KG" | "G" }))}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
              >
                <option value="KG">kg</option>
                <option value="G">g</option>
              </select>
            </div>
            {fieldErrors.weight && <span className="text-[11px] text-red-500 block mt-1">{fieldErrors.weight}</span>}
          </Field>
        </div>

        <Field label="Ukuran Produk" required>
          <div className="grid grid-cols-3 gap-2">
            {(["length", "width", "height"] as const).map((k) => (
              <div key={k}>
                <label className="text-[11px] text-gray-500 mb-1 block capitalize">{k === "length" ? "Panjang" : k === "width" ? "Lebar" : "Tinggi"} (cm)</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={pkg[k]}
                  onChange={(e) => {
                    setPkg((p) => ({ ...p, [k]: e.target.value }));
                    setFieldErrors((f) => ({ ...f, [k]: "" }));
                  }}
                  placeholder="1 - 1.000"
                  className={`w-full px-3 py-2 border rounded-md text-sm ${fieldErrors[k] ? "border-red-400" : "border-gray-300"} focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
                />
                {fieldErrors[k] && <span className="text-[11px] text-red-500 block mt-1">{fieldErrors[k]}</span>}
              </div>
            ))}
          </div>
        </Field>

        <ToggleRow
          checked={true}
          onChange={() => {}}
          title="Pengiriman: Default"
          desc="Mengikuti template pengiriman default akun TikTok Shop." 
        />
        <ToggleRow
          checked={cod}
          onChange={setCod}
          title="Cash on Delivery"
          desc="Aktifkan metode pembayaran COD untuk produk ini."
        />
      </Section>

      {/* G. Publish Platform */}
      <Section title="G. Publish Platform" icon={Check} index={7} error={fieldErrors.platforms} hint="Akun ini terintegrasi TikTok Shop — satu produk bisa tayang di beberapa storefront.">
        <div className="space-y-2">
          {data.platforms.map((p) => (
            <label
              key={p.key}
              className="flex items-center gap-3 px-3 py-2.5 border border-gray-200 rounded-md cursor-pointer hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={platforms.includes(p.key)}
                onChange={(e) => {
                  setPlatforms((prev) =>
                    e.target.checked ? [...prev, p.key] : prev.filter((x) => x !== p.key)
                  );
                  setFieldErrors((f) => ({ ...f, platforms: "" }));
                }}
                className="w-4 h-4 rounded border-gray-300"
              />
              <span className="text-sm font-medium text-gray-800">{p.label}</span>
              <span className="text-[10px] text-gray-400 ml-auto">{p.key}</span>
            </label>
          ))}
        </div>
        {fieldErrors.platforms && <span className="text-[11px] text-red-500 block mt-1">{fieldErrors.platforms}</span>}
        <p className="text-[11px] text-gray-400 mt-2">
          Melepas centang platform yang sedang tayang akan menyembunyikan produk dari storefront tersebut saat Publish.
        </p>
      </Section>

      {/* Footer */}
      <div className="mt-8 flex items-center justify-end gap-3 border-t border-gray-200 pt-6">
        <Link
          href="/products/marketplace/tiktok"
          className="px-5 py-2.5 border border-gray-300 rounded-md text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Batal
        </Link>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="px-6 py-2.5 bg-[#2a3a8c] text-white text-sm font-bold rounded-md hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          {saving ? "Publish..." : "Publish Semua"}
        </button>
      </div>
      {saving && (
        <p className="text-right text-xs text-gray-400 mt-2">
          Mungkin butuh beberapa detik: upload foto & sertifikasi, lalu update produk ke TikTok Shop.
        </p>
      )}
    </div>
  );
}

/* ------------------------------ Sub-components ------------------------------ */

function Section({
  title,
  icon: Icon,
  index,
  hint,
  error,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  index?: number;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        {index && (
          <span className="w-6 h-6 rounded-full bg-[#2a3a8c] text-white text-xs font-bold flex items-center justify-center">
            {index}
          </span>
        )}
        <Icon size={16} className="text-gray-400" />
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
      </div>
      {hint && <p className="text-[11px] text-gray-400 mb-3 -mt-2">{hint}</p>}
      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      <div className="bg-white border border-gray-200 rounded-lg p-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="font-semibold text-gray-700 text-sm flex items-center gap-1 mb-1.5">
        {label}
        {required && <span className="text-red-500">*</span>}
      </label>
      {hint && <p className="text-[11px] text-gray-400 mb-1">{hint}</p>}
      {children}
      {error && <span className="text-[11px] text-red-500 block mt-1">{error}</span>}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="p-1.5 rounded hover:bg-gray-200 text-gray-600"
    >
      {children}
    </button>
  );
}

function AttributeField({
  attr,
  error,
  onToggle,
  onCustom,
  onErrorClear,
}: {
  attr: AttrRow;
  error?: string;
  onToggle: (id: string, valueId: string, add: boolean) => void;
  onCustom: (value: string) => void;
  onErrorClear: () => void;
}) {
  const isCustomEntry = attr.options.length === 0;
  return (
    <div className="mb-4">
      <label className="font-semibold text-gray-700 text-sm flex items-center gap-1 mb-1.5">
        {attr.name}
        {attr.required && <span className="text-red-500">*</span>}
        <span className="text-[10px] font-normal text-gray-400 ml-1">{attr.type}</span>
      </label>
      {!isCustomEntry ? (
        <>
          <div className="flex flex-wrap gap-2">
            {attr.options.map((o) => {
              const active = attr.selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onToggle(attr.id, o.id, !active);
                    onErrorClear();
                  }}
                  className={`px-3 py-1.5 rounded-full text-sm border font-medium transition ${
                    active
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-indigo-400"
                  }`}
                >
                  {o.name}
                </button>
              );
            })}
          </div>
          {attr.customizable && (
            <input
              type="text"
              value={attr.customInput}
              onChange={(e) => {
                onCustom(e.target.value);
                onErrorClear();
              }}
              placeholder={`Nilai tambahan (opsional) — ${attr.name}`}
              className="mt-2 w-full max-w-sm px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          )}
        </>
      ) : (
        <input
          type="text"
          value={attr.customInput}
          onChange={(e) => {
            onCustom(e.target.value);
            onErrorClear();
          }}
          placeholder={`Isi ${attr.name}`}
          className={`w-full max-w-md px-3 py-2 border rounded-md text-sm ${error ? "border-red-400" : "border-gray-300"} focus:outline-none focus:ring-2 focus:ring-indigo-500/30`}
        />
      )}
      {attr.required && attr.selected.length === 0 && !attr.customInput.trim() && error && (
        <span className="text-[11px] text-red-500 block mt-1">{error}</span>
      )}
    </div>
  );
}

function ToggleRow({
  checked,
  onChange,
  title,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <p className="text-[11px] text-gray-400">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? "bg-emerald-500" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function AddChip({ onAdd, placeholder }: { onAdd: (name: string) => void; placeholder: string }) {
  const [value, setValue] = useState("");
  return (
    <span className="inline-flex items-center gap-1 border border-dashed border-gray-300 rounded-full px-2 py-1">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd(value);
            setValue("");
          }
        }}
        placeholder={placeholder}
        className="w-24 bg-transparent text-sm text-gray-600 focus:outline-none placeholder:text-gray-300"
      />
      <button
        type="button"
        onClick={() => {
          onAdd(value);
          setValue("");
        }}
        className="text-indigo-600 hover:text-indigo-800"
      >
        <Plus size={14} />
      </button>
    </span>
  );
}