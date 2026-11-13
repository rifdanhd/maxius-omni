import { prisma } from "@/lib/db/prisma";
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { findMasterSku, lockSellerSkus, queueSkuReview, registerSellerSku } from "@/lib/services/master-sku.service";
import { applyMarketplaceCover } from "@/lib/services/gallery.service";
import { withRefreshedTiktokToken } from "@/lib/services/tiktok-token.service";
import { isActiveTikTokProduct } from "@/lib/services/catalog-import.policy";
import {
  searchProducts,
  getProduct,
  getProductDetail,
  updateProductStatus,
  productSkuStock,
  productMainImage,
} from "@/lib/integrations/tiktokShop";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";
import { STOCK_REASONS } from "@/lib/services/central-stock.service";

/**
 * Marketplace Tokopedia | Shop — listing produk yang terhubung/published.
 *
 * Status mengikuti status ASLI Tokopedia | Shop API (product/202309/products/search):
 *   ACTIVE / ACTIVATE, SELLER_DEACTIVATED, PLATFORM_DEACTIVATED, FREEZE,
 *   DELETED, DRAFT, PENDING, FAILED, SCHEDULED.
 * Status hasil sync disimpan di ProductMapping.platformStatus (+ payload mentah
 * di platformStatusRaw & stok di platformStock). Tab "Habis" diturunkan dari
 * ACTIVE + stok == 0 (bukan status enum). DELETED tidak ditampilkan di tab.
 */

/* ------------------------------ Status → Tab ------------------------------ */

export const TIKTOK_TABS = [
  "all",
  "active",
  "out",
  "archived",
  "unmapped",
  "attention",
  "pending",
  "draft",
  "failed",
] as const;
export type TikTokTabKey = (typeof TIKTOK_TABS)[number];

export const TIKTOK_TAB_LABELS: Record<TikTokTabKey, string> = {
  all: "Semua Produk",
  active: "Aktif",
  out: "Habis",
  archived: "Diarsipkan",
  unmapped: "Belum Terhubung",
  attention: "Perlu Tindakan",
  pending: "Pending",
  draft: "Draf",
  failed: "Gagal Publish",
};

/**
 * mapTikTokStatusToTab — petakan status API TikTok ke tab halaman.
 * DELETED & tak dikenal dikembalikan sebagai null (produk tak ditampilkan).
 */
export function mapTikTokStatusToTab(
  status: string | null | undefined
): TikTokTabKey | null {
  const s = (status ?? "").toUpperCase();
  switch (s) {
    case "ACTIVE":
    case "ACTIVATE":
      return "active";
    case "SELLER_DEACTIVATED":
    case "PLATFORM_DEACTIVATED":
      return "archived";
    case "FREEZE":
      return "attention";
    case "PENDING":
    case "SCHEDULED":
      return "pending";
    case "DRAFT":
      return "draft";
    case "FAILED":
      return "failed";
    default:
      return null; // DELETED / tak dikenal / belum ada data
  }
}

/** UNMATCHED = sintetis: mapping ada di DB tapi tak ditemukan di TikTok. */
export const STATUS_UNMATCHED = "UNMATCHED";

/* ------------------------------ Types ------------------------------ */

export type TikTokSort =
  | "name_asc"
  | "name_desc"
  | "price_asc"
  | "price_desc"
  | "stock_asc"
  | "stock_desc"
  | "updated_desc";

export interface ListTikTokParams {
  businessId: string;
  search?: string;
  sort?: TikTokSort;
  accountIds?: string[];
  tab?: TikTokTabKey | "all";
  page?: number;
  pageSize?: number;
}

export interface TikTokVariantRow {
  mappingId: string;
  variantId: string | null;
  sku: string;
  sellerSku: string | null;
  channelSku: string;
  status: string | null;
  tab: TikTokTabKey | null;
  price: number | null; // harga efektif (mapping.price ?? variant.price)
  stock: number; // platformStock ?? variant.stock
  platformStock: number | null;
  accountId: string;
  accountLabel: string;
  lastSyncedAt: Date | null;
  imageUrl: string | null;
}

export interface TikTokListingRow {
  key: string;
  accountId: string;
  accountLabel: string;
  platformProductId: string | null;
  platformTitle: string | null;
  imageUrl: string | null;
  /** true bila judul asli di TikTok belum pernah tersinkron (platformTitle null). */
  titleUnsynced?: boolean;
  master: {
    id: string | null;
    name: string | null;
    imageUrl: string | null;
    category: string | null;
  } | null;
  status: string | null;
  tab: TikTokTabKey | null;
  variantCount: number;
  channelSku: string | null; // dipakai kolom SKU sarah bila 1 varian
  priceMin: number | null;
  priceMax: number | null;
  stockTotal: number;
  sharedStock: boolean;
  lastSyncedAt: Date | null;
  variants: TikTokVariantRow[];
}

interface ListedMapping {
  id: string;
  channelSku: string;
  sellerSku: string | null;
  variantId: string | null;
  platformProductId: string | null;
  platformStatus: string | null;
  platformStatusRaw: string | null;
  platformStock: number | null;
  platformTitle: string | null;
  imageUrl: string | null;
  lastSyncedAt: Date | null;
  price: number | null;
  account: { id: string; label: string; platform: string; accessToken: string | null; shopCipher: string | null };
  variant: {
    id: string;
    sku: string;
    stock: number;
    price: number | null;
    masterProduct: { id: string; name: string; category: string | null; imageUrl: string | null } | null;
  } | null;
}

/* ------------------------------ Sync engine ------------------------------ */

/** Terapkan hasil produk TikTok ke satu mapping (berdasarkan SKU atau product.id). */
function applyProduct(
  mapping: { channelSku: string },
  product: Record<string, unknown>
) {
  const productId = String(product.id ?? "");
  const skus = (product.skus as Array<Record<string, unknown>>) ?? [];
  const matchingSku =
    skus.find((s) => s.id === mapping.channelSku || s.seller_sku === mapping.channelSku) ??
    (mapping.channelSku === productId && skus.length === 1 ? skus[0] : undefined);

  const stock = matchingSku
    ? productSkuStock(matchingSku)
    : skus.reduce((sum, s) => sum + productSkuStock(s), 0);

  return {
    platformProductId: productId || null,
    platformSkuId: matchingSku?.id ? String(matchingSku.id) : null,
    sellerSku: typeof matchingSku?.seller_sku === "string" ? matchingSku.seller_sku.trim() || null : null,
    platformStatus: (product.status as string | undefined) ?? null,
    platformStatusRaw: JSON.stringify(product),
    platformStock: stock,
    platformTitle: (product.title as string | undefined) ?? null,
    imageUrl: matchingSku ? (extractSkuImage(matchingSku) ?? productMainImage(product)) : productMainImage(product),
    lastSyncedAt: new Date(),
  };
}

/** Cari produk di TikTok by channelSku (3 modus seperti getProduct). */
async function fetchProductRemote(
  account: { accessToken: string | null; shopCipher: string | null },
  channelSku: string
): Promise<Record<string, unknown> | null> {
  if (!account.accessToken) throw new Error("Akun belum punya access token.");
  return getProduct(account.accessToken, channelSku, account.shopCipher ?? undefined);
}

/** List produk dari sebuah akun dengan pagination (cap 100 halaman). */
async function enumerateAccountProducts(account: {
  id: string;
  label: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  shopCipher: string | null;
}, discoveryOnly = false): Promise<Map<string, Record<string, unknown>>> {
  const byId = new Map<string, Record<string, unknown>>();
  const seenTokens = new Set<string>();
  let token: string | null = null;
  for (let page = 0; page < 100; page++) {
    const res = await withRefreshedTiktokToken(account, (accessToken, creds) =>
      searchProducts(accessToken, account.shopCipher ?? undefined, {
        pageSize: 100,
        pageToken: token ?? undefined,
        ...(discoveryOnly ? { status: "ACTIVATE" } : {}),
      }, creds)
    );
    for (const p of res.products) {
      if (discoveryOnly && !isActiveTikTokProduct(p.status)) continue;
      const id = String(p.id ?? "");
      if (id) byId.set(id, p);
    }
    if (!res.nextPageToken) break;
    if (seenTokens.has(res.nextPageToken) || page === 99) throw new Error("Daftar produk TikTok belum lengkap. Coba lagi atau perbarui koneksi toko.");
    seenTokens.add(res.nextPageToken);
    token = res.nextPageToken;
  }
  return byId;
}

async function refreshKnownProducts(
  account: Parameters<typeof enumerateAccountProducts>[0],
  mappings: Array<{ platformSkuId: string | null; platformProductId: string | null; sellerSku: string | null; channelSku: string }>,
  products: Map<string, Record<string, unknown>>,
) {
  const missing = mappings.filter(mapping => !mapping.platformProductId || !products.has(mapping.platformProductId));
  for (const field of ["skuIds", "sellerSkus"] as const) {
    const values = [...new Set(missing.filter(mapping => field === "skuIds" ? !!mapping.platformSkuId : !mapping.platformSkuId && !mapping.platformProductId)
      .map(mapping => field === "skuIds" ? mapping.platformSkuId! : mapping.sellerSku || mapping.channelSku))];
    for (let offset = 0; offset < values.length; offset += 10) {
      // Paginate penuh agar tidak melempar error saat katalog besar menghasilkan nextPageToken.
      let pageToken: string | null = null;
      let pageCount = 0;
      do {
        try {
          const result = await withRefreshedTiktokToken(account, (token, creds) =>
            searchProducts(token, account.shopCipher ?? undefined,
              { pageSize: 100, status: "ACTIVATE", [field]: values.slice(offset, offset + 10), ...(pageToken ? { pageToken } : {}) }, creds));
          for (const product of result.products) if (product.id) products.set(String(product.id), product);
          pageToken = result.nextPageToken ?? null;
        } catch (searchErr) {
          console.warn(`[refreshKnownProducts] Gagal batch ${field} offset ${offset}:`, searchErr);
          break;
        }
        if (++pageCount > 20) break; // batas keamanan: maks 20 halaman per batch
        if (pageToken) await new Promise((r) => setTimeout(r, 150));
      } while (pageToken);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const productIds = [...new Set(missing.filter(mapping => !mapping.platformSkuId && mapping.platformProductId).map(mapping => mapping.platformProductId!))];
  for (const productId of productIds) {
    if (products.has(productId)) continue;
    try {
      const product = await withRefreshedTiktokToken(account, (token, creds) => getProductDetail(token, account.shopCipher ?? undefined, productId, creds));
      if (String(product.id ?? "") === productId) {
        products.set(productId, product);
      }
    } catch (detailErr) {
      console.warn(`[refreshKnownProducts] Gagal verifikasi produk TikTok ${productId}:`, detailErr);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Enumerasi via search lalu cocokkan channelSku ke sku.id/seller_sku/product.id. */
function buildSkuKeyMap(
  products: Map<string, Record<string, unknown>>
): Map<string, Record<string, unknown>> {
  const skuKeys = new Map<string, Record<string, unknown>>();
  for (const product of products.values()) {
    const skus = (product.skus as Array<Record<string, unknown>>) ?? [];
    for (const sku of skus) {
      const id = sku.id as string;
      const sellerSku = sku.seller_sku as string | undefined;
      if (id) skuKeys.set(id, product);
      if (sellerSku) skuKeys.set(sellerSku, product);
    }
    const productId = product.id as string;
    if (productId) skuKeys.set(productId, product);
  }
  return skuKeys;
}

/** Harga efektif sebuah SKU TikTok (string numerik di-object price didukung). */
function skuPrice(sku: Record<string, unknown>): number | null {
  const p = sku.price;
  if (typeof p === "number" && Number.isFinite(p)) return p;
  if (p && typeof p === "object") {
    for (const k of ["tax_exclusive_price", "sale_price", "price"]) {
      const v = Number((p as Record<string, unknown>)[k]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

export interface TikTokUnmappedSku {
  skuId: string;
  sellerSku: string | null;
  skuName?: string | null;
  stock: number;
  price: number | null;
  imageUrl: string | null;
}

/** Ekstrak nama varian dari objek SKU TikTok (sales_attributes / sku_name). */
function extractSkuName(sku: Record<string, unknown>): string | null {
  if (typeof sku.sku_name === "string" && sku.sku_name.trim()) return sku.sku_name.trim();
  const attrs = sku.sales_attributes as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(attrs) && attrs.length > 0) {
    const names = attrs
      .map((a) => (a.value_name as string) ?? (a.custom_value as string) ?? "")
      .filter(Boolean);
    if (names.length > 0) return names.join(", ");
  }
  return null;
}

/** Ekstrak URL gambar dari objek SKU TikTok (sku_img / image / sales_attributes). */
function extractSkuImage(sku: Record<string, unknown>): string | null {
  const tryImg = (img: unknown): string | null => {
    if (typeof img === "string" && img) return img;
    if (img && typeof img === "object") {
      const u = img as { url?: unknown; urls?: unknown; thumb_urls?: unknown };
      if (typeof u.url === "string" && u.url) return u.url;
      if (Array.isArray(u.urls) && typeof u.urls[0] === "string") return u.urls[0];
      if (Array.isArray(u.thumb_urls) && typeof u.thumb_urls[0] === "string") return u.thumb_urls[0];
    }
    return null;
  };
  const direct = tryImg(sku.sku_img) ?? tryImg(sku.image);
  if (direct) return direct;
  // Coba dari sales_attributes
  const attrs = sku.sales_attributes as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      const hit = tryImg(a.sku_img) ?? tryImg(a.image);
      if (hit) return hit;
    }
  }
  return null;
}

export interface TikTokUnmappedProduct {
  platformProductId: string;
  title: string | null;
  status: string | null;
  imageUrl: string | null;
  skus: TikTokUnmappedSku[];
}

function toUnmappedProduct(product: Record<string, unknown>): TikTokUnmappedProduct {
  const mainImage = productMainImage(product);
  const title = (product.title as string | undefined) ?? null;
  const skus = ((product.skus as Array<Record<string, unknown>>) ?? []).map((s) => {
    const skuImg = extractSkuImage(s);
    const skuId = String(s.id ?? "");
    const sellerSku = ((s.seller_sku as string | undefined) || null) as string | null;
    const extractedName = extractSkuName(s);
    return {
      skuId,
      // TikTok kadang mengembalikan seller_sku berupa string kosong — normalkan
      // ke null agar konsumen (?? skuId) jatuh ke sku.id. Tanpa ini channelSku
      // jadi "" dan POST /api/inventory/mappings menolak dengan 400.
      sellerSku,
      skuName: extractedName || (sellerSku ? sellerSku : (title ? `${title} (#${skuId.slice(-4)})` : null)),
      stock: productSkuStock(s),
      price: skuPrice(s),
      imageUrl: skuImg || mainImage || null,
    };
  });
  return {
    platformProductId: String(product.id ?? ""),
    title,
    status: (product.status as string | undefined) ?? null,
    imageUrl: mainImage,
    skus,
  };
}

/**
 * Status yang disembunyikan dari panel "Belum Terhubung": produk terhapus /
 * diarsipkan di Seller Center tidak lagi layak ditawarkan untuk mapping.
 */
/**
 * findUnmappedProducts — produk TikTok yang tidak match mapping lokal mana pun.
 * Setiap SKU diperiksa terpisah melalui sku.id / seller_sku. Murni discovery (tanpa
 * tulis DB) — mapping baru hanya boleh dibuat lewat aksi eksplisit user.
 */
function findUnmappedProducts(
  products: Map<string, Record<string, unknown>>,
  channelSkus: string[]
): TikTokUnmappedProduct[] {
  const mapped = new Set(channelSkus);
  return [...products.values()]
    .filter((product) => isActiveTikTokProduct(product.status))
    .map(toUnmappedProduct)
    .map((product) => ({
      ...product,
      skus: product.skus.filter((sku) =>
        !mapped.has(sku.skuId) && !(sku.sellerSku && mapped.has(sku.sellerSku)) &&
        !(product.skus.length === 1 && mapped.has(product.platformProductId))
      ),
    }))
    .filter((product) => product.skus.length > 0);
}

type SyncAccountResult = {
  accountId: string;
  label: string;
  error?: string;
  productsOnPlatform: number;
  synced: number;
  notFound: number;
  deleted: number;
  unmapped: TikTokUnmappedProduct[];
};

async function autoLinkKnownTikTokSkus(businessId: string, accountId: string, products: TikTokUnmappedProduct[]) {
  let linked = 0;
  for (const product of products) {
    for (const sku of product.skus) {
      if (!sku.skuId) continue;
      try {
        const added = await prisma.$transaction(async (tx) => {
          let variantId: string | null = null;
          const sellerSku = sku.sellerSku?.trim() || null;

          // 1. Coba cocokkan via sellerSku ke master SKU
          if (sellerSku) {
            await lockSellerSkus(tx, businessId, [sellerSku]);
            const resolution = await findMasterSku(tx, businessId, sellerSku);
            if (resolution.variantId && !resolution.ambiguous) {
              const duplicate = product.skus.filter((item) => item.sellerSku?.trim() === sellerSku).length > 1;
              if (!duplicate) {
                variantId = resolution.variantId;
              }
            }
          }

          // 2. Jika belum ketemu, coba cari dari riwayat pesanan (OrderItem) toko/brand ini
          if (!variantId) {
            const pastOrderItem = await tx.orderItem.findFirst({
              where: { channelSku: sku.skuId, variantId: { not: null }, order: { account: { businessId } } },
              select: { variantId: true },
            });
            if (pastOrderItem?.variantId) {
              variantId = pastOrderItem.variantId;
            }
          }

          // 3. Jika belum ketemu, coba cari dari mapping akun lain dalam brand ini
          if (!variantId) {
            const otherMapping = await tx.productMapping.findFirst({
              where: { channelSku: sku.skuId, variantId: { not: null }, account: { businessId } },
              select: { variantId: true },
            });
            if (otherMapping?.variantId) {
              variantId = otherMapping.variantId;
            }
          }

          if (!variantId) return false;

          const old = await tx.productMapping.findUnique({ where: { accountId_channelSku: { accountId, channelSku: sku.skuId } } });
          if (old?.variantId) return false;

          const values = {
            variantId,
            sellerSku,
            platformSkuId: sku.skuId,
            platformProductId: product.platformProductId,
            platformTitle: product.title,
            platformStatus: product.status,
            platformStock: sku.stock,
            lastSyncedAt: new Date(),
            origin: "auto",
          };

          const mapping = old
            ? await tx.productMapping.update({ where: { id: old.id }, data: values })
            : await tx.productMapping.create({
                data: {
                  id: crypto.randomUUID(),
                  accountId,
                  channelSku: sku.skuId,
                  ...values,
                  updatedAt: new Date(),
                },
              });

          await tx.stockOutbox.create({
            data: {
              id: crypto.randomUUID(),
              businessId,
              variantId,
              eventKey: `auto-map:${mapping.id}:${crypto.randomUUID()}`,
            },
          });
          return true;
        });
        if (added) linked++;
      } catch (err) {
        // Jangan gagal secara keseluruhan jika satu varian gagal
        console.warn(`[autoLink] Gagal memetakan SKU ${sku.skuId}:`, err);
      }
    }
  }
  return linked;
}

/**
 * autoLinkTikTokUnmapped — jalankan auto-link massal untuk semua produk unmapped
 * yang bisa dicocokkan otomatis. Mendukung payload `products` langsung dari frontend
 * agar instan tanpa harus memanggil ulang API TikTok.
 */
export async function autoLinkTikTokUnmapped(
  businessId: string,
  accountId?: string,
  providedProducts?: TikTokUnmappedProduct[]
): Promise<{ linkedCount: number }> {
  if (providedProducts && providedProducts.length > 0 && accountId) {
    const linked = await autoLinkKnownTikTokSkus(businessId, accountId, providedProducts);
    return { linkedCount: linked };
  }

  const unmappedAccounts = await getTikTokUnmapped(businessId, accountId);
  let totalLinked = 0;
  for (const acc of unmappedAccounts) {
    if (acc.unmapped.length > 0) {
      const count = await autoLinkKnownTikTokSkus(businessId, acc.accountId, acc.unmapped);
      totalLinked += count;
    }
  }
  return { linkedCount: totalLinked };
}

/**
 * syncTikTokListing — tarik semua produk TikTok (per akun) & update status
 * seluruh ProductMapping milik akun itu. Idempoten terhadap totalCount.
 */
/**
 * backfillMasterImageUrl — terapkan gambar utama listing ke produk:
 * MasterProduct.imageUrl (jika kosong) + baris ProductImage cover (jika
 * galeri kosong). Tidak pernah menimpa pilihan manual di Kelola Gambar.
 */
async function backfillMasterImageUrl(masterProductId: string | null, image: string | null): Promise<void> {
  if (!masterProductId || !image) return;
  await applyMarketplaceCover(masterProductId, image);
}

/** Status listing yang sudah tidak menjual barang (bukan sekadar beku/sementara). */
const INACTIVE_LISTING_STATUSES = new Set([
  "DELETED", "UNMATCHED", "ARCHIVED", "SELLER_DEACTIVATED", "PLATFORM_DEACTIVATED",
]);

/**
 * Arsipkan varian lokal setelah listing TikTok DIHAPUS, tetapi hanya bila semua
 * mapping varian itu (lintas toko) sudah tidak aktif. Varian yang masih hidup
 * di Shopee tidak ikut diarsipkan. Bila seluruh varian master habis, master
 * dinonaktifkan agar tidak tampil lagi di halaman Produk.
 */
async function archiveVariantWhenNoActiveListing(businessId: string, variantId: string): Promise<boolean> {
  const mappings = await prisma.productMapping.findMany({
    where: { variantId, account: { businessId } },
    select: { platformStatus: true },
  });
  if (mappings.length === 0) return false;
  if (!mappings.every((mapping) => INACTIVE_LISTING_STATUSES.has((mapping.platformStatus ?? "").toUpperCase()))) return false;

  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, masterProduct: { businessId }, isArchived: false },
    select: { id: true, masterProductId: true },
  });
  if (!variant) return false;

  await prisma.$transaction(async (tx) => {
    await tx.productVariant.update({ where: { id: variant.id }, data: { isArchived: true } });
    const remaining = await tx.productVariant.count({
      where: { masterProductId: variant.masterProductId, isArchived: false },
    });
    if (remaining === 0) {
      await tx.masterProduct.updateMany({
        where: { id: variant.masterProductId, businessId },
        data: { isActive: false },
      });
    }
  });
  return true;
}

export async function syncTikTokListings(businessId: string, accountId?: string): Promise<SyncAccountResult[]> {
  const accounts = await prisma.platformAccount.findMany({
    where: { platform: "TIKTOK_SHOP", businessId, ...(accountId ? { id: accountId } : {}) },
include: {
       productMapping: {
         include: {
           variant: { select: { id: true, sku: true, masterProductId: true } },
         },
       },
     },
   });

   const results: SyncAccountResult[] = [];
   for (const account of accounts) {
     const base = { accountId: account.id, label: account.label };
     if (account.isFrozen || !account.accessToken || !account.shopCipher) {
       results.push({ ...base, productsOnPlatform: 0, synced: 0, notFound: 0, deleted: 0, unmapped: [], error: account.isFrozen ? "Toko dibekukan. Hubungi admin." : "Koneksi toko belum lengkap. Hubungkan ulang melalui Pengaturan Toko." });
       continue;
     }

     try {
     const products = await enumerateAccountProducts(account, true);
     await refreshKnownProducts(account, account.productMapping, products);
     const skuKeys = buildSkuKeyMap(products);
     let synced = 0;
     let notFound = 0;
     let deleted = 0;
     let archivedVariants = 0;
     const deletedVariantIds = new Set<string>();

      for (const m of account.productMapping) {
       const product = skuKeys.get(m.channelSku) ?? null;
       if (!product) {
         // Mapping ada tapi tidak ditemukan di akun TikTok → tandai UNMATCHED agar
         // terlihat di tab "Perlu Tindakan".
         await prisma.productMapping.update({
           where: { id: m.id },
           data: {
             platformStatus: STATUS_UNMATCHED,
             platformStatusRaw: JSON.stringify({ not_found: true }),
             platformStock: null,
             platformProductId: null,
             lastSyncedAt: new Date(),
           },
         });
         notFound += 1;
         continue;
       }

       // TikTok search API sering tidak menyertakan field gambar (main_images).
       // Ambil detail produk untuk mendapatkan URL gambar utama bila search result kosong.
       if (!productMainImage(product) && String(product.id ?? "")) {
         try {
           const detail = await withRefreshedTiktokToken(account, (accessToken, creds) =>
             getProductDetail(accessToken, account.shopCipher ?? undefined, String(product.id), creds)
           );
           if (detail && productMainImage(detail)) {
             Object.assign(product, detail);
           }
          } catch {
            // Detail gagal diambil — lanjutkan tanpa gambar dari detail.
          }
        }

        const upd = applyProduct({ channelSku: m.channelSku }, product);
      const productStatusUpper = String(product.status ?? "").toUpperCase();
      if (productStatusUpper === "DELETED") {
        deleted += 1;
        if (m.variantId) deletedVariantIds.add(m.variantId);
      } else if (
        productStatusUpper === "SELLER_DEACTIVATED" ||
        productStatusUpper === "PLATFORM_DEACTIVATED"
      ) {
        // Non-aktifkan varian dan master product agar tidak tampil di halaman Produk
        if (m.variantId) deletedVariantIds.add(m.variantId);
      }
      await prisma.productMapping.update({ where: { id: m.id }, data: upd });
      if (upd.sellerSku) await prisma.$transaction((tx) => registerSellerSku(tx, { businessId, mappingId: m.id, sellerSku: upd.sellerSku! }));
      await backfillMasterImageUrl(m.variant?.masterProductId ?? null, productMainImage(product));
      synced += 1;
    }

    for (const variantId of deletedVariantIds) {
      if (await archiveVariantWhenNoActiveListing(businessId, variantId)) archivedVariants += 1;
    }

    const disconnected = findUnmappedProducts(products, account.productMapping.filter((mapping) => mapping.variantId !== null).map((mapping) => mapping.channelSku));
    synced += await autoLinkKnownTikTokSkus(businessId, account.id, disconnected);
    await prisma.syncLog.create({
      data: {
        direction: "in",
        kind: "listing_sync",
        status: "success",
        message: `Sync listing TikTok "${account.label}": ${synced} mapping diupdate, ${notFound} tidak ditemukan.`,
        payload: JSON.stringify({ productsOnPlatform: products.size, synced, notFound, deleted, archivedVariants }),
        accountId: account.id,
      },
    });
    const connected = await prisma.productMapping.findMany({ where: { accountId: account.id, account: { businessId }, variantId: { not: null } }, select: { channelSku: true } });
    const unmapped = findUnmappedProducts(products, connected.map((mapping) => mapping.channelSku));
    await enrichUnmappedImages(unmapped);
    results.push({ ...base, productsOnPlatform: products.size, synced, notFound, deleted, unmapped });
    } catch (e) {
      console.error(`[syncTikTokListings] Error sync akun ${account.label} (${account.id}):`, e);
      const rawMsg = e instanceof Error ? e.message : "Gagal memperbarui data toko.";
      const friendlyMsg = rawMsg.includes("fetch failed")
        ? "Koneksi ke TikTok terputus sementara (fetch timeout). Coba sinkronisasi lagi."
        : rawMsg;
      results.push({ ...base, productsOnPlatform: 0, synced: 0, notFound: 0, deleted: 0, unmapped: [], error: friendlyMsg });
    }
  }
  return results;
}

/* ==================== TIKTOK LISTING IMPORT → MASTER CATALOG ==================== */

const TIKTOK_IMPORT_DEFAULT_LIMIT = 100;
const TIKTOK_IMPORT_MAX_LIMIT = 500;

export type TikTokImportAccountResult = {
  accountId: string;
  label: string;
  importedItems: number;
  importedVariants: number;
  existing: number;
  orphan: number;
  duplicate: number;
  zeroStock: number;
  itemsScanned: number;
  hasMore: boolean;
  error?: string;
};

function isPrismaUniqueErrorTikTok(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    String((e as { code?: unknown }).code) === "P2002"
  );
}

function normalizeTikTokName(name: string | null | undefined): string | null {
  const t = (name ?? "").trim().replace(/\s+/g, " ");
  return t || null;
}

async function findExistingMasterByNameTikTok(
  tx: Prisma.TransactionClient,
  businessId: string,
  name: string | null | undefined
): Promise<string | null> {
  const normalized = normalizeTikTokName(name);
  if (!normalized) return null;
  const existing = await tx.masterProduct.findFirst({
    where: { businessId, name: { equals: normalized, mode: "insensitive" } },
    select: { id: true },
    take: 1,
  });
  return existing?.id ?? null;
}

export async function importTikTokListings(params: {
  businessId: string;
  accountIds?: string[];
  limit?: number;
}): Promise<TikTokImportAccountResult[]> {
  const limit = Math.min(Math.floor(Number(params.limit ?? TIKTOK_IMPORT_DEFAULT_LIMIT)), TIKTOK_IMPORT_MAX_LIMIT);
  const settings = await getCachedInventorySettings(params.businessId);

  const accounts = await prisma.platformAccount.findMany({
    where: {
      platform: "TIKTOK_SHOP",
      businessId: params.businessId,
      ...(params.accountIds?.length ? { id: { in: params.accountIds } } : {}),
    },
    orderBy: { label: "asc" },
  });

  const results: TikTokImportAccountResult[] = [];

  for (const summary of accounts) {
    const stats: TikTokImportAccountResult = {
      accountId: summary.id,
      label: summary.label,
      importedItems: 0,
      importedVariants: 0,
      existing: 0,
      orphan: 0,
      duplicate: 0,
      zeroStock: 0,
      itemsScanned: 0,
      hasMore: false,
    };
    results.push(stats);

    if (!summary.accessToken || !summary.shopCipher) {
      stats.error = "Koneksi toko belum lengkap. Hubungkan ulang melalui Pengaturan Toko.";
      continue;
    }

    try {
      const known = await prisma.productMapping.findMany({
        where: { accountId: summary.id },
        select: { id: true, channelSku: true, variantId: true, platformProductId: true },
      });
      const byChannelSku = new Map<string, { id: string; variantId: string | null; platformProductId: string | null }>(
        known.map((m) => [m.channelSku, { id: m.id, variantId: m.variantId, platformProductId: m.platformProductId }])
      );

      const account = {
        id: summary.id,
        label: summary.label,
        accessToken: summary.accessToken ?? null,
        refreshToken: null,
        tokenExpiresAt: null,
        shopCipher: summary.shopCipher ?? null,
      };

      const products = await enumerateAccountProducts(account, true);
      const unmapped = findUnmappedProducts(products, Array.from(byChannelSku.keys()));

      let scanned = 0;
      for (const product of unmapped) {
        if (stats.importedItems >= limit) { stats.hasMore = true; break; }
        await importOneTikTokProduct({ account, businessId: params.businessId, product, byChannelSku, threshold: settings.lowStockDefaultThreshold, stats });
        scanned += 1;
      }
      stats.itemsScanned = scanned;
    } catch (e) {
      stats.error = e instanceof Error ? e.message : String(e);
    }
  }

  return results;
}

async function importOneTikTokProduct(params: {
  account: { id: string; label: string; accessToken: string | null; refreshToken: string | null; tokenExpiresAt: Date | null; shopCipher: string | null };
  businessId: string;
  product: TikTokUnmappedProduct;
  byChannelSku: Map<string, { id: string; variantId: string | null; platformProductId: string | null }>;
  threshold: number;
  stats: TikTokImportAccountResult;
}) {
  const { account, businessId, product, byChannelSku, threshold, stats } = params;
  const title = normalizeTikTokName(product.title) ?? `Produk TikTok ${product.platformProductId}`;
  const mainImage = product.imageUrl ?? null;

  try {
    const delta = await prisma.$transaction(async (tx) => {
      let productId: string | null = await findExistingMasterByNameTikTok(tx, businessId, title);
      let createdMaster = false;
      let initializedCount = 0;

      for (const sku of product.skus) {
        const channelSku = (sku.skuId || sku.sellerSku) ?? sku.skuId;
        if (!channelSku) continue;

        if (byChannelSku.has(channelSku)) {
          stats.existing += 1;
          continue;
        }

        let variantId: string | null = null;
        if (sku.sellerSku) {
          await lockSellerSkus(tx, businessId, [sku.sellerSku]);
          const resolution = await findMasterSku(tx, businessId, sku.sellerSku);
          if (resolution?.variantId && !resolution.ambiguous) {
            variantId = resolution.variantId;
          }
        }

        if (!variantId && !productId) {
          const existingMasterId = await findExistingMasterByNameTikTok(tx, businessId, title);
          if (existingMasterId) {
            productId = existingMasterId;
          } else {
            const master = await tx.masterProduct.create({
              data: {
                name: title,
                businessId,
                importedFrom: `TIKTOK:${account.id}`,
                threshold,
                ...(mainImage ? { imageUrl: mainImage } : {}),
              },
            });
            productId = master.id;
            createdMaster = true;
          }
        }

        if (!variantId && productId) {
          const variant = await tx.productVariant.create({
            data: {
              masterProductId: productId,
              sku: sku.sellerSku ?? channelSku,
              name: sku.skuName ?? null,
              stock: Math.max(0, Math.floor(Number(sku.stock) || 0)),
            },
          });
          variantId = variant.id;
          initializedCount++;

          if (sku.sellerSku) {
            await tx.masterSkuKey.upsert({
              where: { businessId_sellerSku: { businessId, sellerSku: sku.sellerSku } },
              create: { businessId, sellerSku: sku.sellerSku, variantId },
              update: { variantId },
            });
          }

          await tx.stockLedger.create({
            data: {
              id: crypto.randomUUID(),
              variantId,
              changeQty: Math.max(0, Math.floor(Number(sku.stock) || 0)),
              reason: STOCK_REASONS.INIT,
              note: `Stok awal import listing TikTok #${product.platformProductId}.`,
              stockAfter: Math.max(0, Math.floor(Number(sku.stock) || 0)),
            },
          });
        }

        const mapping = await tx.productMapping.create({
          data: {
            id: crypto.randomUUID(),
            accountId: account.id,
            channelSku,
            sellerSku: sku.sellerSku ?? null,
            platformSkuId: sku.skuId ?? null,
            variantId: variantId ?? null,
            platformProductId: product.platformProductId,
            platformTitle: title,
            platformStatus: product.status ?? null,
            lastSyncedAt: new Date(),
            origin: "auto",
            updatedAt: new Date(),
          },
        });

        if (!variantId) {
          stats.orphan += 1;
          await queueSkuReview(tx, {
            businessId,
            mappingId: mapping.id,
            sellerSku: sku.sellerSku ?? channelSku,
            candidateIds: [],
            reason: "SKU belum memiliki varian master.",
          });
        } else {
          stats.importedVariants += 1;
        }
      }

      if (createdMaster) stats.importedItems += 1;
      return { items: createdMaster ? 1 : 0, variants: initializedCount };
    });

    stats.importedItems += delta.items;
    stats.importedVariants += delta.variants;
    stats.zeroStock += product.skus.filter((s) => Math.max(0, Math.floor(Number(s.stock) || 0)) === 0).length;

  } catch (e) {
    if (!isPrismaUniqueErrorTikTok(e)) throw e;
    stats.duplicate += product.skus.length;
  }
}

async function enrichUnmappedImages(products: TikTokUnmappedProduct[]): Promise<void> {
  const skusToEnrich = new Set<string>();
  for (const p of products) {
    for (const s of p.skus) {
      if (!s.imageUrl || !s.skuName) {
        if (s.skuId) skusToEnrich.add(s.skuId);
        if (s.sellerSku) skusToEnrich.add(s.sellerSku);
      }
    }
  }

  if (skusToEnrich.size > 0) {
    const skuArray = Array.from(skusToEnrich);
    const imageMap = new Map<string, string>();
    const nameMap = new Map<string, string>();

    for (let i = 0; i < skuArray.length; i += 500) {
      const chunk = skuArray.slice(i, i + 500);
      const items = await prisma.orderItem.findMany({
        where: {
          channelSku: { in: chunk },
          OR: [
            { imageUrl: { not: null } },
            { skuName: { not: null } },
          ],
        },
        select: { channelSku: true, imageUrl: true, skuName: true },
        orderBy: { order: { createTime: "desc" } },
      });
      for (const it of items) {
        if (it.imageUrl && !imageMap.has(it.channelSku)) {
          imageMap.set(it.channelSku, it.imageUrl);
        }
        if (it.skuName && !nameMap.has(it.channelSku)) {
          nameMap.set(it.channelSku, it.skuName);
        }
      }
    }

    for (const p of products) {
      for (const s of p.skus) {
        if (!s.imageUrl) {
          const hitImg = imageMap.get(s.skuId) ?? (s.sellerSku ? imageMap.get(s.sellerSku) : undefined);
          if (hitImg) s.imageUrl = hitImg;
        }
        if (!s.skuName) {
          const hitName = nameMap.get(s.skuId) ?? (s.sellerSku ? nameMap.get(s.sellerSku) : undefined);
          if (hitName) s.skuName = hitName;
        }
      }
      // Jika produk utama belum punya gambar, ambil dari varian pertama yang punya gambar
      if (!p.imageUrl) {
        const withImg = p.skus.find((s) => s.imageUrl);
        if (withImg?.imageUrl) p.imageUrl = withImg.imageUrl;
      }
    }
  }

  // Pastikan SEMUA varian memiliki foto (fallback ke gambar cover produk jika varian tidak punya foto spesifik)
  for (const p of products) {
    if (p.imageUrl) {
      for (const s of p.skus) {
        if (!s.imageUrl) {
          s.imageUrl = p.imageUrl;
        }
      }
    }
  }
}

/**
 * enrichUnmappedFromTikTokDetail — panggil detail TikTok API untuk melengkapi
 * gambar cover utama produk, nama varian asli (sales_attributes), serta foto
 * varian spesifik dari Seller Center yang tidak dikirim oleh endpoint search.
 */
async function enrichUnmappedFromTikTokDetail(
  account: { id: string; label: string; accessToken: string | null; refreshToken: string | null; tokenExpiresAt: Date | null; shopCipher: string | null },
  products: TikTokUnmappedProduct[]
): Promise<void> {
  const candidates = products
    .filter((p) => !p.imageUrl || p.skus.some((s) => !s.imageUrl || !s.skuName))
    .slice(0, 10);
  if (candidates.length === 0) return;

  const BATCH_SIZE = 5;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const chunk = candidates.slice(i, i + BATCH_SIZE);
    await Promise.all(
      chunk.map(async (prod) => {
        try {
          const detail = await withRefreshedTiktokToken(account, (token, creds) =>
            getProductDetail(token, account.shopCipher ?? undefined, prod.platformProductId, creds)
          );
          if (!detail || typeof detail !== "object") return;
          const detailRecord = detail as Record<string, unknown>;

          // 1. Gambar utama produk
          const mainImg = productMainImage(detailRecord);
          if (mainImg) prod.imageUrl = mainImg;

          // 2. Judul produk bila sebelumnya belum ada
          if (!prod.title && typeof detailRecord.title === "string") {
            prod.title = detailRecord.title;
          }

          // 3. Rincian SKU: nama varian & foto varian spesifik
          const detailSkus = (detailRecord.skus as Array<Record<string, unknown>>) ?? [];
          for (const s of prod.skus) {
            const ds = detailSkus.find(
              (item) => String(item.id ?? "") === s.skuId || (s.sellerSku && item.seller_sku === s.sellerSku)
            );
            if (ds) {
              const name = extractSkuName(ds);
              if (name && !s.skuName) s.skuName = name;

              const skuImg = extractSkuImage(ds);
              if (skuImg && !s.imageUrl) s.imageUrl = skuImg;

              if (!s.sellerSku && typeof ds.seller_sku === "string" && ds.seller_sku.trim()) {
                s.sellerSku = ds.seller_sku.trim();
              }
            }
            // Fallback ke foto produk utama jika varian tidak memiliki foto khusus tersendiri
            if (!s.imageUrl && prod.imageUrl) {
              s.imageUrl = prod.imageUrl;
            }
          }
        } catch (err) {
          console.warn(`[enrichUnmappedDetail] Gagal mengambil detail produk ${prod.platformProductId}:`, err);
        }
      })
    );
  }

  // Final check: pastikan setiap varian yang masih kosong fallback ke gambar produk
  for (const p of products) {
    if (p.imageUrl) {
      for (const s of p.skus) {
        if (!s.imageUrl) s.imageUrl = p.imageUrl;
      }
    }
  }
}

/**
 * getTikTokUnmapped — discovery read-only produk TikTok yang belum punya
 * mapping lokal (per akun, opsional filter 1 akun). Tidak menulis DB —
 * dipakai endpoint unmapped + section "belum ter-mapping" di UI.
 */
export async function getTikTokUnmapped(
  businessId: string,
  accountId?: string
): Promise<Array<{ accountId: string; label: string; unmapped: TikTokUnmappedProduct[] }>> {
  const accounts = await prisma.platformAccount.findMany({
    where: { platform: "TIKTOK_SHOP", businessId, ...(accountId ? { id: accountId } : {}) },
    include: {
      productMapping: { where: { variantId: { not: null } }, select: { channelSku: true } },
    },
  });
  const out: Array<{ accountId: string; label: string; unmapped: TikTokUnmappedProduct[] }> = [];
  for (const account of accounts) {
    if (!account.accessToken || !account.shopCipher) {
      out.push({ accountId: account.id, label: account.label, unmapped: [] });
      continue;
    }
    const products = await enumerateAccountProducts(account, true);
    const unmapped = findUnmappedProducts(
      products,
      account.productMapping.map((m) => m.channelSku)
    );
    await enrichUnmappedImages(unmapped);
    await enrichUnmappedFromTikTokDetail(account, unmapped);
    out.push({
      accountId: account.id,
      label: account.label,
      unmapped,
    });
  }
  return out;
}

/** syncTikTokMapping — sync ulang SATU mapping (by channelSku, 3 modus lookup). */
export async function syncTikTokMapping(
  mappingId: string,
  businessId: string
): Promise<{ ok: boolean; reason?: string }> {
  const m = await prisma.productMapping.findUnique({
    where: { id: mappingId },
    include: { account: true, variant: { select: { masterProductId: true } } },
  });
  if (!m) return { ok: false, reason: "Mapping tidak ditemukan." };
  if (m.account.businessId !== businessId) {
    return { ok: false, reason: "Mapping tidak ditemukan." };
  }
  if (m.account.platform !== "TIKTOK_SHOP") {
    return { ok: false, reason: "Mapping bukan milik akun Tokopedia." };
  }
  if (!m.account.accessToken) return { ok: false, reason: "Akun belum punya access token." };

  const product = await fetchProductRemote(m.account, m.channelSku);
  if (!product) {
    return { ok: false, reason: `Listing "${m.channelSku}" tidak ditemukan di Tokopedia.` };
  }

  await prisma.productMapping.update({
    where: { id: mappingId },
    data: applyProduct({ channelSku: m.channelSku }, product),
  });
  await backfillMasterImageUrl(m.variant?.masterProductId ?? null, productMainImage(product));
  return { ok: true };
}

/**
 * setListingActive — aktifkan/nonaktifkan listing di Tokopedia | Shop (API real),
 * DB lokal hanya di-update setelah API sukses. Berlaku product-level: semua
 * mapping dengan account+product yang sama ikut di-update statusnya.
 */
export async function setListingActive(
  mappingId: string,
  active: boolean,
  businessId: string
): Promise<{ ok: boolean; reason?: string }> {
  const m = await prisma.productMapping.findUnique({
    where: { id: mappingId },
    include: { account: true },
  });
  if (!m) return { ok: false, reason: "Mapping tidak ditemukan." };
  if (m.account.businessId !== businessId) {
    return { ok: false, reason: "Mapping tidak ditemukan." };
  }
  if (m.account.platform !== "TIKTOK_SHOP") {
    return { ok: false, reason: "Mapping bukan milik akun Tokopedia." };
  }
  if (!m.account.accessToken) return { ok: false, reason: "Akun belum punya access token." };
  if (!m.platformProductId) {
    return { ok: false, reason: "Listing belum pernah di-sync auto — klik tombol sync/refresh pada baris dulu." };
  }

  try {
    await updateProductStatus(
      m.account.accessToken,
      m.account.shopCipher ?? undefined,
      m.platformProductId,
      active
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.syncLog.create({
      data: {
        direction: "out",
        kind: "listing_status",
        status: "error",
        message: `${active ? "Aktivasi" : "Nonaktifkan"} produk ${m.platformProductId} (${m.account.label}) gagal.`,
        errorMessage: msg,
        payload: JSON.stringify({ productId: m.platformProductId, active }),
        accountId: m.account.id,
      },
    });
    return { ok: false, reason: msg };
  }

  const newStatus = active ? "ACTIVATE" : "SELLER_DEACTIVATED";
  await prisma.$transaction([
    prisma.productMapping.updateMany({
      where: { accountId: m.accountId, platformProductId: m.platformProductId },
      data: { platformStatus: newStatus, lastSyncedAt: new Date() },
    }),
  ]);

  await prisma.syncLog.create({
    data: {
      direction: "out",
      kind: "listing_status",
      status: "success",
      message: `${active ? "Aktifkan" : "Nonaktifkan"} produk ${m.platformProductId} (${m.account.label}).`,
      payload: JSON.stringify({ productId: m.platformProductId, active }),
      accountId: m.account.id,
    },
  });
  return { ok: true };
}

/* ------------------------------ Listing (query) ------------------------------ */

function tabOf(v: {
  status: string | null;
  platformStock: number | null;
  /** Stok varian lokal — null = varian lokal belum ada (mapping belum terhubung). */
  variantStock: number | null;
  lastSyncedAt: Date | null;
}): TikTokTabKey | null {
  // Unmapped = kategori sendiri ("Belum Terhubung"): jangan dicampur ke
  // "attention" (FREEZE/belum pernah sync) dan jangan dihitung dari stok yang
  // tak punya sumber — `variantStock ?? 0` dulu membuat ACTIVE+platformStock
  // NULL+varian NULL jatuh ke "out" seolah-olah barang habis.
  if (v.variantStock === null) return "unmapped";
  if (!v.status) return "attention"; // belum pernah di-sync → perlu tindakan
  const tab = mapTikTokStatusToTab(v.status);
  if (tab && tab === "active") {
    const stock = v.platformStock ?? v.variantStock;
    if (stock <= 0) return "out";
  }
  return tab;
}

export async function listTikTokProducts(
  params: ListTikTokParams
): Promise<{
  rows: TikTokListingRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<TikTokTabKey, number>;
}> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));

  const search = params.search?.trim();
  const mappings = await prisma.productMapping.findMany({
    where: {
      account: {
        platform: "TIKTOK_SHOP",
        businessId: params.businessId,
        ...(params.accountIds && params.accountIds.length > 0
          ? { id: { in: params.accountIds } }
          : {}),
      },
      ...(search
        ? {
            OR: [
              { channelSku: { contains: search } },
              { platformTitle: { contains: search } },
              { variant: { sku: { contains: search } } },
              { variant: { masterProduct: { name: { contains: search } } } },
            ],
          }
        : {}),
    },
    include: {
      account: { select: { id: true, label: true, platform: true, accessToken: true, shopCipher: true } },
      variant: {
        select: {
          id: true,
          sku: true,
          stock: true,
          price: true,
          masterProduct: { select: { id: true, name: true, category: true, imageUrl: true } },
        },
      },
    },
  }) as ListedMapping[];

  // Grup jadi "listing" per (account, product). Belum di-sync → per mapping.
  const listingMap = new Map<string, TikTokListingRow>();
  const groupKey = (m: ListedMapping) =>
    `${m.account.id}|${m.platformProductId ?? m.channelSku}`;

  for (const m of mappings) {
    const key = groupKey(m);
    let row = listingMap.get(key);
    if (!row) {
      const tab = tabOf({
        status: m.platformStatus,
        platformStock: m.platformStock,
        variantStock: m.variant?.stock ?? null,
        lastSyncedAt: m.lastSyncedAt,
      });
      row = {
        key,
        accountId: m.account.id,
        accountLabel: m.account.label,
        platformProductId: m.platformProductId,
        platformTitle: m.platformTitle,
        imageUrl: m.imageUrl,
        master: {
          id: m.variant?.masterProduct?.id ?? null,
          name: m.variant?.masterProduct?.name ?? null,
          imageUrl: m.variant?.masterProduct?.imageUrl ?? null,
          category: m.variant?.masterProduct?.category ?? null,
        },
        status: m.platformStatus,
        tab,
        variantCount: 0,
        channelSku: null,
        priceMin: null,
        priceMax: null,
        stockTotal: 0,
        sharedStock: false,
        lastSyncedAt: m.lastSyncedAt,
        variants: [],
      };
      listingMap.set(key, row);
    }

    const effPrice = m.price ?? m.variant?.price ?? null;
    const stock = m.platformStock ?? m.variant?.stock ?? 0;
    const variantRow: TikTokVariantRow = {
      mappingId: m.id,
      variantId: m.variantId,
      sku: m.variant?.sku ?? m.channelSku,
      sellerSku: m.sellerSku ?? null,
      channelSku: m.channelSku,
      status: m.platformStatus,
      tab: tabOf({
        status: m.platformStatus,
        platformStock: m.platformStock,
        variantStock: m.variant?.stock ?? null,
        lastSyncedAt: m.lastSyncedAt,
      }),
      price: effPrice,
      stock,
      platformStock: m.platformStock,
      accountId: m.account.id,
      accountLabel: m.account.label,
      lastSyncedAt: m.lastSyncedAt,
      imageUrl: m.imageUrl ?? null,
    };
    row.variants.push(variantRow);
    row.variantCount += 1;
    // Listing campur (banyak SKU per platformProductId): 1 SKU unmapped →
    // seluruh listing masuk "Belum Terhubung" — jangan disembunyikan di tab
    // lain walau varian mapped-nya aktif.
    if (variantRow.tab === "unmapped") row.tab = "unmapped";
    row.priceMin =
      row.priceMin === null || effPrice === null
        ? row.priceMin ?? null
        : Math.min(row.priceMin, effPrice ?? Infinity);
    row.priceMax =
      row.priceMax === null
        ? effPrice
        : Math.max(row.priceMax, effPrice ?? -Infinity);
    row.stockTotal += stock;
    if (m.lastSyncedAt && (!row.lastSyncedAt || m.lastSyncedAt > row.lastSyncedAt)) {
      row.lastSyncedAt = m.lastSyncedAt;
    }
  }

  const centralStocks = new Map(mappings.flatMap(mapping => mapping.variantId && mapping.variant ? [[mapping.variantId, mapping.variant.stock] as const] : []));
  const rows: TikTokListingRow[] = [...listingMap.values()].map((row) => {
    const uniqueVariants = new Map<string, number>();
    for (const variant of row.variants) {
      const key = variant.variantId ?? `unmapped:${variant.mappingId}`;
      uniqueVariants.set(key, Math.max(uniqueVariants.get(key) ?? 0, variant.stock));
    }
    row.sharedStock = uniqueVariants.size < row.variants.length;
    if (row.sharedStock) {
      for (const [key] of uniqueVariants) if (centralStocks.has(key)) uniqueVariants.set(key, centralStocks.get(key)!);
    }
    row.stockTotal = [...uniqueVariants.values()].reduce((sum, stock) => sum + stock, 0);
    const prices = row.variants
      .map((v) => v.price)
      .filter((v): v is number => v !== null);
    const min = prices.length > 0 ? Math.min(...prices) : null;
    const max = prices.length > 0 ? Math.max(...prices) : null;
    return {
      ...row,
      channelSku: row.variantCount === 1 ? row.variants[0].channelSku : null,
      priceMin: min,
      priceMax: max,
      titleUnsynced: row.platformTitle == null,
      platformTitle: row.platformTitle ?? row.master?.name ?? null,
    };
  });

  // Filter tab
  const tab = params.tab && params.tab !== "all" ? params.tab : null;
  const filtered = tab ? rows.filter((r) => r.tab === tab) : rows.filter((r) => r.tab !== null);

  // Counts (full set setelah filter account/search, sebelum pagination)
  const counts = {
    all: rows.length,
    active: rows.filter((r) => r.tab === "active").length,
    out: rows.filter((r) => r.tab === "out").length,
    archived: rows.filter((r) => r.tab === "archived").length,
    unmapped: rows.filter((r) => r.tab === "unmapped").length,
    attention: rows.filter((r) => r.tab === "attention").length,
    pending: rows.filter((r) => r.tab === "pending").length,
    draft: rows.filter((r) => r.tab === "draft").length,
    failed: rows.filter((r) => r.tab === "failed").length,
  };

  // Sort
  const sort = params.sort ?? "name_asc";
  const sortVal = (r: TikTokListingRow) => (r.platformTitle ?? r.master?.name ?? r.channelSku ?? "").toLowerCase();
  filtered.sort((a, b) => {
    switch (sort) {
      case "name_asc":
        return sortVal(a).localeCompare(sortVal(b), "id");
      case "name_desc":
        return sortVal(b).localeCompare(sortVal(a), "id");
      case "price_asc":
        return (a.priceMin ?? Infinity) - (b.priceMin ?? Infinity);
      case "price_desc":
        return (b.priceMin ?? -Infinity) - (a.priceMin ?? -Infinity);
      case "stock_asc":
        return a.stockTotal - b.stockTotal;
      case "stock_desc":
        return b.stockTotal - a.stockTotal;
      case "updated_desc":
        return (b.lastSyncedAt?.getTime() ?? 0) - (a.lastSyncedAt?.getTime() ?? 0);
      default:
        return 0;
    }
  });

  const total = filtered.length;
  const sliced = filtered.slice((page - 1) * pageSize, page * pageSize);
  return { rows: sliced, total, page, pageSize, counts };
}

/* ------------------------------ Metadata ------------------------------ */

export async function getTikTokAccounts(
  businessId: string
): Promise<Array<{ id: string; label: string }>> {
  const accounts = await prisma.platformAccount.findMany({
    where: { platform: "TIKTOK_SHOP", businessId },
    select: { id: true, label: true },
    orderBy: { label: "asc" },
  });
  return accounts;
}

/** Kategori marketplace tunggal saat ini:Tokopedia | Shop (TikTok+Tokopedia). */
export const MARKETPLACE_CHANNEL_LABEL = "TikTok Shop";

export async function getLastTiktokSyncTime(businessId: string): Promise<Date | null> {
  const log = await prisma.syncLog.findFirst({
    where: { kind: "listing_sync", status: "success", account: { businessId } },
    orderBy: { createdAt: "desc" },
  });
  return log?.createdAt ?? null;
}
