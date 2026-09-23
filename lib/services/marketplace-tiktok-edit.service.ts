import { prisma } from "@/lib/db/prisma";
import {
  getProductDetail,
  getCategoryAttributes,
  getCategoryRules,
  uploadProductImage,
  uploadProductFile,
  editProduct,
  getProductWarehouses,
  productSkuStock,
} from "@/lib/integrations/tiktokShop";

/**
 * Marketplace TikTok Shop — Edit Produk ("Ubah").
 *
 * Orkestrasi halaman edit: (1) muat data gabungan lokal + TikTok terkini,
 * (2) submit "Publish Semua" — upload gambar/dokumen baru ke TikTok dahulu,
 * panggil Update Product (PUT /product/202309/products/{product_id}), dan
 * BARU update DB lokal setelah API sukses. Gagal → DB tidak berubah.
 */

export const LISTING_PLATFORMS = [
  { key: "TOKOPEDIA", label: "Tokopedia" },
  { key: "TIKTOK_SHOP", label: "TikTok Shop" },
];

/* ------------------------------ Types ------------------------------ */

export interface EditAttributeOption {
  id: string;
  name: string;
}

export interface EditAttributeSchema {
  id: string;
  name: string;
  type: string; // PRODUCT_PROPERTY | SALES_PROPERTY
  required: boolean;
  multiple: boolean;
  customizable: boolean;
  options: EditAttributeOption[];
  current: string[]; // id/name nilai saat ini
}

export interface EditVariantRow {
  key: string;
  name: string;
  salesAttributes: {
    attrId: string;
    attrName: string;
    valueId: string | null;
    valueName: string;
  }[];
  tiktokSkuId?: string;
  sellerSku: string;
  price: number | null;
  stock: number | null;
  localVariantId?: string;
}

export interface EditImageItem {
  id: string;
  uri?: string; // gambar TikTok (dipakai ulang, tak di-upload)
  dataUrl?: string; // base64 lokal → di-upload baru
  name?: string;
  src: string; // url utk ditampilkan di grid
}

export interface EditCertItem {
  id: string;
  title: string;
  required: boolean;
  documentDetails?: string;
  files: Array<{ id?: string; name?: string; format?: string }>;
  images: Array<{ uri?: string }>;
}

export interface EditLoadData {
  mappingId: string;
  masterName: string;
  channelSku: string;
  platformProductId: string;
  accountLabel: string;
  title: string;
  description: string;
  categoryId: string | null;
  categoryNames: string[];
  brandId?: string;
  brandName?: string;
  attributes: EditAttributeSchema[];
  variants: EditVariantRow[];
  images: EditImageItem[];
  certifications: EditCertItem[];
  weight: { value: number | null; unit: "KG" | "G" };
  dimensions: { length: number | null; width: number | null; height: number | null };
  cod: boolean;
  listingPlatforms: string[];
  platforms: typeof LISTING_PLATFORMS;
}

export interface SubmitEditInput {
  title: string;
  description: string;
  categoryId: string;
  brandId?: string;
  requiredAttributeIds: string[];
  attributes: { id: string; valueIds: string[]; customNames: string[] }[];
  variants: {
    key: string;
    tiktokSkuId?: string;
    sellerSku: string;
    price: number;
    stock: number;
    salesAttributes: { attrId: string; valueId: string | null; valueName: string }[];
    localVariantId?: string;
  }[];
  images: { uri?: string; dataUrl?: string; remoteUrl?: string; name?: string }[];
  certifications: {
    id: string;
    files: {
      existingFileId?: string;
      existingUri?: string;
      name?: string;
      format?: string;
      dataUrl?: string;
      remoteUrl?: string;
      mimeType?: string;
    }[];
  }[];
  weight: { value: number; unit: "KG" | "G" };
  dimensions: { length: number; width: number; height: number };
  cod: boolean;
  listingPlatforms: string[];
}

export interface SubmitEditResult {
  ok: boolean;
  productId?: string;
  auditStatus?: string;
  message?: string;
  error?: string;
}

/* ------------------------------ Helpers ------------------------------ */

function asNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && v !== "" && v !== null ? n : null;
}

function leafCategoryId(chain: Array<Record<string, unknown>>): string | null {
  if (!Array.isArray(chain) || chain.length === 0) return null;
  const leaf = chain.filter((c) => c.is_leaf === true).pop() ?? chain[chain.length - 1];
  const id = leaf?.id;
  return typeof id === "string" && id ? id : null;
}

function productAttrCurrent(
  productAttributes: Array<Record<string, unknown>> | undefined,
  max: number
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!Array.isArray(productAttributes)) return map;
  // Batasi ambil nilai dari N atribut pertama demi keamanan payload besar.
  const slice = productAttributes.slice(0, max);
  for (const a of slice) {
    const id = a.id as string | undefined;
    if (!id) continue;
    const values: string[] = [];
    for (const v of (a.values as Array<Record<string, unknown>> | undefined) ?? []) {
      const vid = v.id as string | undefined;
      const vname = v.name as string | undefined;
      values.push(vid ?? vname ?? String(v ?? ""));
    }
    if (values.length > 0) map.set(id, values);
  }
  return map;
}

function base64ToBuffer(dataUrl: string): Buffer {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!m) throw new Error("[Edit] Format data URL tidak valid untuk upload.");
  return Buffer.from(m[2], "base64");
}

async function fetchRemoteBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[Edit] Gagal mengunduh gambar remote (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/* ------------------------------ Load ------------------------------ */

export async function loadTikTokEditData(mappingId: string): Promise<EditLoadData> {
  const m = await prisma.productMapping.findUnique({
    where: { id: mappingId },
    include: {
      account: true,
      variant: { include: { masterProduct: { include: { productImage: { orderBy: { order: "asc" } }, productVariant: true } } } },
    },
  });
  if (!m) throw new Error("Mapping tidak ditemukan.");
  if (m.account.platform !== "TIKTOK_SHOP") throw new Error("Mapping bukan milik akun Tokopedia.");
  if (!m.account.accessToken) throw new Error("Akun belum punya access token.");
  if (!m.platformProductId) throw new Error("Listing belum pernah di-sync — refresh status baris dulu.");

  const token = m.account.accessToken;
  const cipher = m.account.shopCipher ?? undefined;

  const detail = await getProductDetail(token, cipher, m.platformProductId);
  const chains = (detail.category_chains as Array<Record<string, unknown>> | undefined) ?? [];
  const catId = leafCategoryId(chains);

  const [schemaRaw, rules] = await Promise.all([
    catId
      ? getCategoryAttributes(token, cipher, catId).catch(() => [] as Array<Record<string, unknown>>)
      : Promise.resolve([] as Array<Record<string, unknown>>),
    catId
      ? getCategoryRules(token, cipher, catId).catch(() => ({} as Record<string, unknown>))
      : Promise.resolve({} as Record<string, unknown>),
  ]);

  const currentAttrs = productAttrCurrent(
    detail.product_attributes as Array<Record<string, unknown>> | undefined,
    200
  );

  const attributes: EditAttributeSchema[] = [];
  for (const a of schemaRaw) {
    const id = a.id as string | undefined;
    if (!id) continue;
    const options: EditAttributeOption[] = [];
    for (const v of (a.values as Array<Record<string, unknown>> | undefined) ?? []) {
      const vid = v.id as string | undefined;
      const vname = v.name as string | undefined;
      if (vid && vname) options.push({ id: vid, name: vname });
    }
    attributes.push({
      id,
      name: (a.name as string) ?? `Atribut ${id}`,
      type: (a.type as string) ?? "PRODUCT_PROPERTY",
      required: (a.is_requried as boolean) ?? (a.is_required as boolean) ?? false,
      multiple: (a.is_multiple_selection as boolean) ?? false,
      customizable: (a.is_customizable as boolean) ?? true,
      options,
      current: currentAttrs.get(id) ?? [],
    });
  }

  // Susun varian dari TikTok skus + cocokkan ke varian local master.
  const master = m.variant.masterProduct;
  const masterVariants = master.productVariant ?? [];
  const skus = (detail.skus as Array<Record<string, unknown>> | undefined) ?? [];
  const singleMappingVariantId = skus.length <= 1 ? m.variantId : undefined;

  const variants: EditVariantRow[] = skus.map((sku, i) => {
    const sales = (sku.sales_attributes as Array<Record<string, unknown>> | undefined) ?? [];
    const salesAttrs = sales.map((sa, j) => ({
      attrId: (sa.id as string) ?? "",
      attrName: (sa.name as string) ?? `Atribut ${j + 1}`,
      valueId: (sa.value_id as string | null) ?? null,
      valueName: (sa.value_name as string) ?? "",
    }));
    const name =
      salesAttrs.map((sa) => sa.valueName).filter(Boolean).join(" - ") ||
      ((sku.seller_sku as string) || "") ||
      `Varian ${i + 1}`;
    const sellerSku = (sku.seller_sku as string) || "";
    // Cocokkan ke varian master by seller_sku; fallback mapping tunggal.
    const localVariantId =
      masterVariants.find((v) => sellerSku && v.sku === sellerSku)?.id ??
      singleMappingVariantId;
    const price =
      asNumber((sku.price as { amount?: unknown } | undefined)?.amount) ??
      asNumber((sku.list_price as { amount?: unknown } | undefined)?.amount) ??
      asNumber((sku.sale_price as { amount?: unknown } | undefined)?.amount);
    const stock = productSkuStock(sku);
    return {
      key: `sku-${i}-${(sku.id as string) ?? ""}`,
      name,
      salesAttributes: salesAttrs,
      tiktokSkuId: sku.id as string | undefined,
      sellerSku: sellerSku || (masterVariants[i]?.sku ?? `SKU-${i + 1}`),
      price: price ?? m.variant.price ?? m.price,
      stock: typeof stock === "number" && Number.isFinite(stock) ? stock : m.variant.stock,
      localVariantId,
    };
  });

  if (variants.length === 0) {
    // Produk tanpa SKU di TikTok — seed dari varian master.
    const v = masterVariants[0] ?? m.variant;
    variants.push({
      key: "master-0",
      name: m.variant.sku || "Varian",
      salesAttributes: [],
      sellerSku: m.variant.sku,
      price: m.price ?? v.price,
      stock: v.stock,
      localVariantId: v.id,
    });
  }

  // Gambar TikTok + seed galeri master bila kosong.
  const images: EditImageItem[] = [];
  for (const [i, img] of ((detail.main_images as Array<Record<string, unknown>> | undefined) ?? []).entries()) {
    const uri = (img.uri as string | undefined) ?? (typeof img === "string" ? img : undefined);
    if (uri) images.push({ id: `t${i}`, uri, src: uri });
  }
  if (images.length === 0) {
    for (const gi of master.productImage ?? []) {
      images.push({ id: `g-${gi.id}`, dataUrl: gi.url, name: `galeri-${gi.order}.jpg`, src: gi.url });
    }
  }

  // Sertifikasi dari rules kategori + isi dari detail produk.
  const certRules = (rules.product_certifications as Array<Record<string, unknown>> | undefined) ?? [];
  const detailCerts = (detail.certifications as Array<Record<string, unknown>> | undefined) ?? [];
  const certifications: EditCertItem[] = certRules.map((r) => {
    const id = r.id as string;
    const detailCert = detailCerts.find((dc) => dc.id === id);
    return {
      id,
      title: (r.name as string) ?? id,
      required: (r.is_required as boolean) ?? false,
      documentDetails: (r.document_details as string | undefined) ?? undefined,
      files: ((detailCert?.files as Array<Record<string, unknown>> | undefined) ?? []).map((f) => ({
        id: f.id as string | undefined,
        name: f.name as string | undefined,
        format: f.format as string | undefined,
      })),
      images: ((detailCert?.images as Array<Record<string, unknown>> | undefined) ?? []).map((img) => ({
        uri: img.uri as string | undefined,
      })),
    };
  });

  const weightVal = asNumber((detail.package_weight as { value?: unknown } | undefined)?.value);
  const dims = detail.package_dimensions as
    | { length?: unknown; width?: unknown; height?: unknown }
    | undefined;

  const integrated = (detail.integrated_platform_statuses as
    | Array<{ platform?: string; status?: string }>
    | undefined) ?? [];
  const listingPlatforms = integrated
    .map((p) => p.platform)
    .filter((p): p is string => !!p && (p === "TOKOPEDIA" || p === "TIKTOK_SHOP"));

  return {
    mappingId,
    masterName: master.name ?? m.variant.masterProduct.name ?? "",
    channelSku: m.channelSku,
    platformProductId: m.platformProductId,
    accountLabel: m.account.label,
    title: (detail.title as string) ?? master.name ?? "",
    description: (detail.description as string) ?? "",
    categoryId: catId,
    categoryNames: chains.map((c) => (c.local_name as string) ?? (c.name as string) ?? ""),
    brandId: (detail.brand as { id?: string } | undefined)?.id,
    brandName: (detail.brand as { name?: string } | undefined)?.name,
    attributes,
    variants,
    images,
    certifications,
    weight: {
      value: weightVal !== null && weightVal < 1 ? weightVal * 1000 : weightVal,
      unit: weightVal !== null && weightVal < 1 ? "G" : "KG",
    },
    dimensions: {
      length: asNumber(dims?.length),
      width: asNumber(dims?.width),
      height: asNumber(dims?.height),
    },
    cod: (detail.is_cod_allowed as boolean | undefined) ?? false,
    listingPlatforms: listingPlatforms.length > 0 ? listingPlatforms : ["TIKTOK_SHOP"],
    platforms: LISTING_PLATFORMS,
  };
}

/* ------------------------------ Submit ------------------------------ */

export async function submitTikTokEdit(
  mappingId: string,
  input: SubmitEditInput
): Promise<SubmitEditResult> {
  const m = await prisma.productMapping.findUnique({
    where: { id: mappingId },
    include: { account: true },
  });
  if (!m) return { ok: false, error: "Mapping tidak ditemukan." };
  if (!m.account.accessToken) return { ok: false, error: "Akun belum punya access token." };
  if (!m.platformProductId) return { ok: false, error: "Listing belum pernah di-sync." };

  const token = m.account.accessToken;
  const cipher = m.account.shopCipher ?? undefined;

  // ---- Validasi server (lapis kedua; sisi client sudah memvalidasi inline). ----
  const title = input.title.trim();
  const description = input.description.replace(/<img[^>]*>/gi, "").trim();
  if (!title || title.length > 255) {
    return { ok: false, error: "Nama produk wajib diisi (maks. 255 karakter)." };
  }
  if (!input.categoryId) return { ok: false, error: "Kategori produk wajib dipilih." };
  if (!description) return { ok: false, error: "Deskripsi produk wajib diisi." };
  if (!Array.isArray(input.listingPlatforms) || input.listingPlatforms.length === 0) {
    return { ok: false, error: "Minimal satu platform tayang harus dipilih." };
  }
  for (const p of input.listingPlatforms) {
    if (p !== "TOKOPEDIA" && p !== "TIKTOK_SHOP") {
      return { ok: false, error: `Platform "${p}" tidak didukung.` };
    }
  }
  const kg = input.weight.unit === "G" ? input.weight.value / 1000 : input.weight.value;
  if (!(kg > 0)) return { ok: false, error: "Berat produk harus lebih dari 0." };
  for (const [k, v] of Object.entries(input.dimensions)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > 1000) {
      return { ok: false, error: `Ukuran produk (${k}) harus diisi antara 1 - 1.000 cm.` };
    }
  }
  if (!input.images || input.images.length === 0) {
    return { ok: false, error: "Unggah minimal 1 foto produk." };
  }
  if (input.images.length > 9) return { ok: false, error: "Maksimal 9 foto produk." };
  for (const v of input.variants) {
    if (!v.sellerSku?.trim()) return { ok: false, error: "SKU varian wajib diisi untuk semua kombinasi." };
    if (!(Number(v.price) > 0)) return { ok: false, error: `Harga untuk "${v.sellerSku}" wajib lebih dari 0.` };
    if (v.stock < 0 || !Number.isFinite(Number(v.stock))) {
      return { ok: false, error: `Stok untuk "${v.sellerSku}" tidak valid.` };
    }
  }
  const requiredIds = new Set(input.requiredAttributeIds ?? []);
  for (const a of input.attributes) {
    if (requiredIds.has(a.id) && a.valueIds.length === 0 && a.customNames.length === 0) {
      return { ok: false, error: "Atribut wajib kategori belum dilengkapi." };
    }
  }

  try {
    // ---- 1) Upload gambar utama baru (data URL / remote) ke TikTok. ----
    const mainImages: Array<{ uri: string }> = [];
    for (let i = 0; i < input.images.length; i++) {
      const img = input.images[i];
      if (img.uri) {
        mainImages.push({ uri: img.uri });
        continue;
      }
      const buf =
        img.dataUrl
          ? base64ToBuffer(img.dataUrl)
          : img.remoteUrl
            ? await fetchRemoteBuffer(img.remoteUrl)
            : null;
      if (!buf) return { ok: false, error: `Foto ke-${i + 1} tidak punya sumber yang valid.` };
      const up = await uploadProductImage(token, buf, "MAIN_IMAGE", img.name ?? `photo-${i + 1}.jpg`);
      mainImages.push({ uri: up.uri });
    }

    // ---- 2) Upload dokumen sertifikasi baru (gambar → CERTIFICATION_IMAGE, lain → file). ----
    const certifications: Array<Record<string, unknown>> = [];
    for (const cert of input.certifications) {
      if (!cert.files || cert.files.length === 0) continue;
      const filesOut: Array<{ id: string; name?: string; format?: string }> = [];
      const imagesOut: Array<{ uri: string }> = [];
      for (const f of cert.files) {
        if (f.existingFileId) {
          filesOut.push({ id: f.existingFileId, name: f.name, format: f.format });
          continue;
        }
        if (f.existingUri) {
          imagesOut.push({ uri: f.existingUri });
          continue;
        }
        const buf = f.dataUrl
          ? base64ToBuffer(f.dataUrl)
          : f.remoteUrl
            ? await fetchRemoteBuffer(f.remoteUrl)
            : null;
        if (!buf) continue;
        const fileName = f.name || "certificate";
        const isImage = (f.mimeType ?? fileName).startsWith("image/");
        if (isImage) {
          const up = await uploadProductImage(token, buf, "CERTIFICATION_IMAGE", fileName);
          imagesOut.push({ uri: up.uri });
        } else {
          const up = await uploadProductFile(token, buf, fileName);
          filesOut.push({ id: up.id, name: up.name ?? fileName, format: up.format ?? undefined });
        }
      }
      if (filesOut.length === 0 && imagesOut.length === 0) continue;
      certifications.push({
        id: cert.id,
        ...(filesOut.length > 0 ? { files: filesOut } : {}),
        ...(imagesOut.length > 0 ? { images: imagesOut } : {}),
      });
    }

    // ---- 3) Siapkan skus + warehouse. ----
    const productId = m.platformProductId;
    let detail: Record<string, unknown> = {};
    try {
      detail = await getProductDetail(token, cipher, productId);
    } catch {
      /* payload produk lama masih cukup utk warehouse fallback */
    }
    const detailSkus = (detail.skus as Array<Record<string, unknown>> | undefined) ?? [];
    const skuWarehouse = new Map<string, string>();
    for (const s of detailSkus) {
      const sid = s.id as string | undefined;
      const wh = (s.inventory as Array<Record<string, unknown>> | undefined)?.[0]?.warehouse_id;
      if (sid && typeof wh === "string" && wh) skuWarehouse.set(sid, wh);
    }
    let globalWarehouse: string | undefined = Array.from(skuWarehouse.values())[0];
    if (!globalWarehouse) {
      try {
        const whs = await getProductWarehouses(token, cipher, productId);
        globalWarehouse = whs[0];
      } catch {
        globalWarehouse = undefined;
      }
    }
    if (!globalWarehouse) {
      return { ok: false, error: "Tidak ada warehouse aktif di akun Tokopedia." };
    }

    const skus: Array<Record<string, unknown>> = input.variants.map((v) => {
      const warehouseId = (v.tiktokSkuId && skuWarehouse.get(v.tiktokSkuId)) || globalWarehouse;
      const salesAttributes = v.salesAttributes
        .filter((sa) => sa.attrId && (sa.valueId || sa.valueName))
        .map((sa) => ({
          id: sa.attrId,
          ...(sa.valueId ? { value_id: sa.valueId } : {}),
          value_name: sa.valueName,
        }));
      return {
        ...(v.tiktokSkuId ? { id: v.tiktokSkuId } : {}),
        seller_sku: v.sellerSku.trim(),
        price: { amount: Number(v.price).toFixed(2), currency: "IDR" },
        inventory: [{ quantity: Math.round(Number(v.stock)), warehouse_id: warehouseId }],
        ...(salesAttributes.length > 0 ? { sales_attributes: salesAttributes } : {}),
      };
    });

    // ---- 4) product_attributes dari pilihan user. ----
    const productAttributes = input.attributes
      .filter((a) => a.valueIds.length > 0 || a.customNames.length > 0)
      .map((a) => ({
        id: a.id,
        values: [
          ...a.valueIds.map((id) => ({ id })),
          ...a.customNames.filter(Boolean).map((name) => ({ name })),
        ],
      }));

    // ---- 5) Package, platform, sertifikasi → payload edit. ----
    const payload: Record<string, unknown> = {
      title,
      description,
      category_id: input.categoryId,
      category_version: "v2",
      ...(input.brandId ? { brand_id: input.brandId } : {}),
      main_images: mainImages,
      skus,
      ...(productAttributes.length > 0 ? { product_attributes: productAttributes } : {}),
      package_weight: { unit: "KILOGRAM", value: String(Math.max(0.001, kg).toFixed(3)) },
      package_dimensions: {
        unit: "CENTIMETER",
        length: String(Math.round(Number(input.dimensions.length))),
        width: String(Math.round(Number(input.dimensions.width))),
        height: String(Math.round(Number(input.dimensions.height))),
      },
      is_cod_allowed: input.cod,
      listing_platforms: input.listingPlatforms,
      ...(certifications.length > 0 ? { certifications } : {}),
      save_mode: "LISTING",
    };

    const result = await editProduct(token, cipher, productId, payload);

    // ---- 6) API sukses → baru update DB lokal. ----
    const stockTotal = input.variants.reduce((sum, v) => sum + Math.round(Number(v.stock || 0)), 0);
    const variantUpdates = input.variants
      .filter((v) => v.localVariantId)
      .map((v) =>
        prisma.productVariant.update({
          where: { id: v.localVariantId! },
          data: { price: Number(v.price), stock: Math.round(Number(v.stock)) },
        })
      );
    await Promise.all([
      ...variantUpdates,
      prisma.productMapping.update({
        where: { id: mappingId },
        data: { platformTitle: title, platformStock: stockTotal, lastSyncedAt: new Date() },
      }),
    ]);

    await prisma.syncLog.create({
      data: {
        direction: "out",
        kind: "product_edit",
        status: "success",
        message: `Publish ulang produk ${productId} (${m.account.label}).`,
        payload: JSON.stringify({ productId, auditStatus: result.auditStatus }),
        accountId: m.accountId,
      },
    });

    return {
      ok: true,
      productId: result.productId,
      auditStatus: result.auditStatus,
      message: result.auditStatus
        ? `Produk berhasil dikirim ke TikTok Shop (status review: ${result.auditStatus}).`
        : "Produk berhasil dikirim ke TikTok Shop.",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.syncLog.create({
      data: {
        direction: "out",
        kind: "product_edit",
        status: "error",
        message: `Publish ulang produk ${m.platformProductId} gagal.`,
        errorMessage: msg,
        payload: JSON.stringify({ productId: m.platformProductId, hasInput: true }),
        accountId: m.accountId,
      },
    });
    return { ok: false, error: msg };
  }
}