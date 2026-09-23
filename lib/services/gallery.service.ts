import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";

/**
 * Kelola Gambar — galeri gambar per produk induk (MasterProduct).
 *
 * - Model ProductImage menyimpan banyak gambar per produk.
 * - Cover (isCover) disinkronkan otomatis ke MasterProduct.imageUrl,
 *   sehingga tabel Kelola Harga & Produk Master tetap memakai cover tsb.
 * - "upload" untuk versi awal = URL manual ATAU data URL (base64) dari file
 *   lokal, disimpan langsung di kolom `url` (tanpa integrasi storage eksternal).
 */

const isUrl = (u: string) => /^https?:\/\/.+/.test(u);
const isDataImage = (u: string) => /^data:image\/[a-zA-Z0-9.+-]+(;[a-zA-Z0-9=,.]+)*;base64,/.test(u);
export const isValidImageUrl = (u: string) => isUrl(u) || isDataImage(u);

export type GallerySort =
  | "name_asc"
  | "name_desc"
  | "variants_desc"
  | "images_desc";

export interface GalleryParams {
  businessId: string;
  search?: string;
  sort?: GallerySort;
  category?: string;
  status?: "complete" | "incomplete" | "none";
  page?: number;
  pageSize?: number;
}

export interface GalleryRow {
  id: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  variantCount: number;
  totalImages: number;
  coverCount: number;
  required: number;
  complete: boolean;
}

export interface ImageRow {
  id: string;
  url: string;
  isCover: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Target minimal gambar agar produk dianggap lengkap = sejumlah variannya. */
const requiredImages = (variantCount: number) => Math.max(1, variantCount);

export async function listGallery(
  params: GalleryParams
): Promise<{ rows: GalleryRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.MasterProductWhereInput = { businessId: params.businessId };
  const search = params.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { productVariant: { some: { sku: { contains: search } } } },
    ];
  }
  if (params.category?.trim()) {
    where.category = params.category.trim();
  }

  const products = await prisma.masterProduct.findMany({
    where,
    include: {
      _count: { select: { productVariant: true, productImage: true } },
      productImage: { where: { isCover: true }, select: { url: true }, take: 1 },
    },
  });

  let rows: GalleryRow[] = products.map((p) => {
     const variantCount = p._count.productVariant;
     const totalImages = p._count.productImage;
     const required = requiredImages(variantCount);
     return {
       id: p.id,
       name: p.name,
       category: p.category,
       imageUrl: p.productImage[0]?.url ?? null,
       variantCount,
       totalImages,
       coverCount: p.productImage.length,
      required,
      complete: totalImages >= required,
    };
  });

  if (params.status) {
    if (params.status === "complete") rows = rows.filter((r) => r.complete);
    else if (params.status === "incomplete")
      rows = rows.filter((r) => !r.complete && r.totalImages > 0);
    else if (params.status === "none") rows = rows.filter((r) => r.totalImages === 0);
  }

  const sort = params.sort ?? "name_asc";
  const localeCompare = (a: string, b: string) => a.localeCompare(b, "id");
  rows.sort((a, b) => {
    switch (sort) {
      case "name_desc":
        return localeCompare(b.name, a.name);
      case "variants_desc":
        return b.variantCount - a.variantCount || localeCompare(a.name, b.name);
      case "images_desc":
        return b.totalImages - a.totalImages || localeCompare(a.name, b.name);
      default:
        return localeCompare(a.name, b.name);
    }
  });

  const total = rows.length;
  const sliced = rows.slice((page - 1) * pageSize, page * pageSize);
  return { rows: sliced, total, page, pageSize };
}

/**
 * listProductImages — daftar gambar satu produk.
 * Bila galeri masih kosong tapi MasterProduct.imageUrl terisi (hasil backfill
 * dari order), gambar tersebut di-seed otomatis sebagai cover agar tampil.
 */
export async function listProductImages(
  productId: string,
  businessId: string
): Promise<ImageRow[]> {
  const productBrand = await prisma.masterProduct.findUnique({
    where: { id: productId },
    select: { businessId: true },
  });
  if (!productBrand || productBrand.businessId !== businessId) return [];
  const existing = await prisma.productImage.findMany({
    where: { masterProductId: productId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  if (existing.length > 0) return existing;

  const product = await prisma.masterProduct.findUnique({
    where: { id: productId },
    select: { imageUrl: true },
  });
  if (product?.imageUrl) {
     const created = await prisma.productImage.create({
       data: { id: crypto.randomUUID(), updatedAt: new Date(), masterProductId: productId, url: product.imageUrl, isCover: true, order: 0 },
     });
    return [created];
  }
  return [];
}

export interface AddImagesResult {
  ok: boolean;
  added: number;
  reasons: Array<{ index: number; reason: string }>;
}

/** Bangun daftar gambar dari input (URL tunggal, array string, atau array {url}). */
export function normalizeImageInputs(body: unknown): { url: string; error?: string }[] {
  const raw = body as { url?: unknown; images?: unknown };
  const list: unknown[] = [];
  if (Array.isArray(raw.images)) list.push(...raw.images);
  else if (raw.url !== undefined) list.push(raw.url);

  return list.map((u) => {
    const asObj =
      u && typeof u === "object" ? (u as { url?: unknown }).url : u;
    const url = typeof asObj === "string" ? asObj.trim() : "";
    if (!url) return { url: "", error: "URL kosong." };
    if (!isValidImageUrl(url)) {
      return { url: "", error: "URL harus http(s):// atau data:image/... (base64)." };
    }
    if (url.length > 8 * 1024 * 1024) {
      return { url: "", error: "Gambar terlalu besar (maks 8MB per gambar)." };
    }
    return { url };
  });
}

export async function addImages(
  productId: string,
  entries: { url: string }[],
  businessId: string
): Promise<AddImagesResult> {
  const product = await prisma.masterProduct.findUnique({
    where: { id: productId },
    select: { id: true, businessId: true },
  });
  if (!product || product.businessId !== businessId) {
    return { ok: false, added: 0, reasons: [{ index: 0, reason: "Produk tidak ditemukan." }] };
  }

  const nextOrder = await prisma.productImage.aggregate({
    where: { masterProductId: productId },
    _max: { order: true },
  });
  let base = (nextOrder._max.order ?? -1) + 1;

  const result: AddImagesResult = { ok: true, added: 0, reasons: [] };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.url === "") {
      result.reasons.push({ index: i, reason: "Tidak ada URL valid pada entri ini." });
      continue;
    }
     const created = await prisma.productImage.create({
       data: { id: crypto.randomUUID(), updatedAt: new Date(), masterProductId: productId, url: e.url, order: base++ },
     });
    // Gambar pertama otomatis jadi cover & disinkronkan ke MasterProduct.imageUrl.
    if (created.order === 0) {
      await promoteCover(productId, created.id);
    }
    result.added += 1;
  }
  return result;
}

/**
 * promoteCover — set satu gambar sebagai cover: nonaktifkan cover lain,
 * `order`-nya dipaksa terdepan (0), lalu sinkronkan MasterProduct.imageUrl.
 */
async function promoteCover(productId: string, imageId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.productImage.updateMany({
      where: { masterProductId: productId, isCover: true },
      data: { isCover: false },
    });
    const img = await tx.productImage.update({
      where: { id: imageId },
      data: { isCover: true, order: 0 },
    });
    // Normalisasi urutan agar tidak ada dua gambar order=0 (cover di depan).
    const others = await tx.productImage.findMany({
      where: { masterProductId: productId, id: { not: imageId } },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, order: true },
    });
    await Promise.all(
      others.map((o, i) =>
        tx.productImage.update({ where: { id: o.id }, data: { order: i + 1 } })
      )
    );
    await tx.masterProduct.update({
      where: { id: productId },
      data: { imageUrl: img.url },
    });
  });
}

export async function deleteImage(
  productId: string,
  imageId: string,
  businessId: string
): Promise<{ ok: boolean; reason?: string }> {
  const img = await prisma.productImage.findFirst({
    where: {
      id: imageId,
      masterProductId: productId,
      masterProduct: { businessId },
    },
  });
  if (!img) return { ok: false, reason: "Gambar tidak ditemukan pada produk ini." };

  await prisma.$transaction(async (tx) => {
    await tx.productImage.delete({ where: { id: imageId } });
    if (img.isCover) {
      const next = await tx.productImage.findFirst({
        where: { masterProductId: productId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (next) {
        await promoteCover(productId, next.id);
      } else {
        await tx.masterProduct.update({
          where: { id: productId },
          data: { imageUrl: null },
        });
      }
    } else {
      // Rapikan urutan agar tetap 0..n tanpa celah.
      const rest = await tx.productImage.findMany({
        where: { masterProductId: productId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      await Promise.all(
        rest.map((r, i) => tx.productImage.update({ where: { id: r.id }, data: { order: i } }))
      );
    }
  });

  return { ok: true };
}

export type UpdateImageAction = {
  isCover?: boolean;
  order?: number;
  orderedIds?: string[];
};

export async function updateImage(
  productId: string,
  imageId: string,
  action: UpdateImageAction,
  businessId: string
): Promise<{ ok: boolean; reason?: string }> {
  const img = await prisma.productImage.findFirst({
    where: {
      id: imageId,
      masterProductId: productId,
      masterProduct: { businessId },
    },
  });
  if (!img) return { ok: false, reason: "Gambar tidak ditemukan pada produk ini." };

  if (action.orderedIds) {
    if (!action.orderedIds.includes(imageId)) {
      return { ok: false, reason: "Daftar urutan tidak memuat gambar ini." };
    }
    const orderedIds = action.orderedIds;
    await prisma.$transaction(async (tx) => {
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
      const rows = await tx.productImage.findMany({
        where: { masterProductId: productId },
      });
      await Promise.all(
        rows.map((r) => {
          const o = orderMap.get(r.id);
          if (o === undefined) return Promise.resolve();
          return tx.productImage.update({ where: { id: r.id }, data: { order: o } });
        })
      );
    });
    return { ok: true };
  }

  if (action.isCover) {
    await promoteCover(productId, imageId);
    return { ok: true };
  }

  if (typeof action.order === "number") {
    await prisma.productImage.update({
      where: { id: imageId },
      data: { order: action.order },
    });
    return { ok: true };
  }

  return { ok: false, reason: "Action tidak dikenali (isCover, order, atau orderedIds)." };
}

/** Riwayat aktivitas gambar sederhana (dari createdAt/updatedAt existing). */
export async function listImageHistory(limit = 100, businessId?: string) {
  const rows = await prisma.productImage.findMany({
    where: businessId ? { masterProduct: { businessId } } : undefined,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      url: true,
      isCover: true,
      createdAt: true,
      updatedAt: true,
      masterProduct: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    isCover: r.isCover,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    product: r.masterProduct,
  }));
}