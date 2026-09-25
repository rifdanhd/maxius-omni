import { prisma } from "@/lib/db/prisma";
import {
  searchProducts,
  getProduct,
  updateProductStatus,
  productSkuStock,
  productMainImage,
} from "@/lib/integrations/tiktokShop";

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
  channelSku: string;
  status: string | null;
  tab: TikTokTabKey | null;
  price: number | null; // harga efektif (mapping.price ?? variant.price)
  stock: number; // platformStock ?? variant.stock
  platformStock: number | null;
  accountId: string;
  accountLabel: string;
  lastSyncedAt: Date | null;
}

export interface TikTokListingRow {
  key: string;
  accountId: string;
  accountLabel: string;
  platformProductId: string | null;
  platformTitle: string | null;
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
  lastSyncedAt: Date | null;
  variants: TikTokVariantRow[];
}

interface ListedMapping {
  id: string;
  channelSku: string;
  variantId: string | null;
  platformProductId: string | null;
  platformStatus: string | null;
  platformStatusRaw: string | null;
  platformStock: number | null;
  platformTitle: string | null;
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
    (mapping.channelSku === productId ? skus[0] : undefined);

  const stock = matchingSku
    ? productSkuStock(matchingSku)
    : skus.reduce((sum, s) => sum + productSkuStock(s), 0);

  return {
    platformProductId: productId || null,
    platformStatus: (product.status as string | undefined) ?? null,
    platformStatusRaw: JSON.stringify(product),
    platformStock: stock,
    platformTitle: (product.title as string | undefined) ?? null,
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
  accessToken: string | null;
  shopCipher: string | null;
}): Promise<Map<string, Record<string, unknown>>> {
  const byId = new Map<string, Record<string, unknown>>();
  let token: string | null = null;
  for (let page = 0; page < 100; page++) {
    const res = await searchProducts(account.accessToken!, account.shopCipher ?? undefined, {
      pageSize: 100,
      pageToken: token ?? undefined,
    });
    for (const p of res.products) {
      const id = String(p.id ?? "");
      if (id) byId.set(id, p);
    }
    if (!res.nextPageToken) break;
    token = res.nextPageToken;
  }
  return byId;
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
  stock: number;
  price: number | null;
}

export interface TikTokUnmappedProduct {
  platformProductId: string;
  title: string | null;
  status: string | null;
  imageUrl: string | null;
  skus: TikTokUnmappedSku[];
}

function toUnmappedProduct(product: Record<string, unknown>): TikTokUnmappedProduct {
  const skus = ((product.skus as Array<Record<string, unknown>>) ?? []).map((s) => ({
    skuId: String(s.id ?? ""),
    // TikTok kadang mengembalikan seller_sku berupa string kosong — normalkan
    // ke null agar konsumen (?? skuId) jatuh ke sku.id. Tanpa ini channelSku
    // jadi "" dan POST /api/inventory/mappings menolak dengan 400.
    sellerSku: ((s.seller_sku as string | undefined) || null) as string | null,
    stock: productSkuStock(s),
    price: skuPrice(s),
  }));
  return {
    platformProductId: String(product.id ?? ""),
    title: (product.title as string | undefined) ?? null,
    status: (product.status as string | undefined) ?? null,
    imageUrl: productMainImage(product),
    skus,
  };
}

/**
 * findUnmappedProducts — produk TikTok yang tidak match mapping lokal mana pun.
 * Produk dianggap termapping bila MINIMAL satu kunci (sku.id / seller_sku /
 * product.id) cocok dengan channelSku sebuah mapping. Murni discovery (tanpa
 * tulis DB) — mapping baru hanya boleh dibuat lewat aksi eksplisit user.
 */
function findUnmappedProducts(
  products: Map<string, Record<string, unknown>>,
  channelSkus: string[]
): TikTokUnmappedProduct[] {
  const skuKeys = buildSkuKeyMap(products);
  const matchedProductIds = new Set<string>();
  for (const channelSku of channelSkus) {
    const product = skuKeys.get(channelSku);
    if (product) matchedProductIds.add(String(product.id ?? ""));
  }
  return [...products.values()]
    .filter((p) => !matchedProductIds.has(String(p.id ?? "")))
    .map(toUnmappedProduct);
}

type SyncAccountResult = {
  accountId: string;
  label: string;
  productsOnPlatform: number;
  synced: number;
  notFound: number;
  deleted: number;
  unmapped: TikTokUnmappedProduct[];
};

/**
 * syncTikTokListing — tarik semua produk TikTok (per akun) & update status
 * seluruh ProductMapping milik akun itu. Idempoten terhadap totalCount.
 */
export async function syncTikTokListings(businessId: string): Promise<SyncAccountResult[]> {
  const accounts = await prisma.platformAccount.findMany({
    where: { platform: "TIKTOK_SHOP", businessId },
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
     if (!account.accessToken || !account.shopCipher) {
       results.push({ ...base, productsOnPlatform: 0, synced: 0, notFound: 0, deleted: 0, unmapped: [] });
       continue;
     }

     const products = await enumerateAccountProducts(account);
     const skuKeys = buildSkuKeyMap(products);
     const matchedProductIds = new Set<string>();
     let synced = 0;
     let notFound = 0;
     let deleted = 0;

     for (const m of account.productMapping) {
      const product = skuKeys.get(m.channelSku) ?? null;
      if (product) matchedProductIds.add(String(product.id ?? ""));
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

      const upd = applyProduct({ channelSku: m.channelSku }, product);
      if (String(product.status ?? "").toUpperCase() === "DELETED") deleted += 1;
      await prisma.productMapping.update({ where: { id: m.id }, data: upd });
      synced += 1;
    }

    await prisma.syncLog.create({
      data: {
        direction: "in",
        kind: "listing_sync",
        status: "success",
        message: `Sync listing TikTok "${account.label}": ${synced} mapping diupdate, ${notFound} tidak ditemukan.`,
        payload: JSON.stringify({ productsOnPlatform: products.size, synced, notFound, deleted }),
        accountId: account.id,
      },
    });
    const unmapped = [...products.values()]
      .filter((p) => !matchedProductIds.has(String(p.id ?? "")))
      .map(toUnmappedProduct);
    results.push({ ...base, productsOnPlatform: products.size, synced, notFound, deleted, unmapped });
  }
  return results;
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
       productMapping: { select: { channelSku: true } },
     },
   });
   const out: Array<{ accountId: string; label: string; unmapped: TikTokUnmappedProduct[] }> = [];
   for (const account of accounts) {
     if (!account.accessToken || !account.shopCipher) {
       out.push({ accountId: account.id, label: account.label, unmapped: [] });
       continue;
     }
     const products = await enumerateAccountProducts(account);
     out.push({
       accountId: account.id,
       label: account.label,
       unmapped: findUnmappedProducts(
         products,
         account.productMapping.map((m) => m.channelSku)
       ),
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

  const product = await fetchProductRemote(m.account, m.channelSku);
  if (!product) {
    return { ok: false, reason: `Listing "${m.channelSku}" tidak ditemukan di Tokopedia.` };
  }

  await prisma.productMapping.update({
    where: { id: mappingId },
    data: applyProduct({ channelSku: m.channelSku }, product),
  });
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
  variantStock: number;
  lastSyncedAt: Date | null;
}): TikTokTabKey | null {
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
        variantStock: m.variant?.stock ?? 0,
        lastSyncedAt: m.lastSyncedAt,
      });
      row = {
        key,
        accountId: m.account.id,
        accountLabel: m.account.label,
        platformProductId: m.platformProductId,
        platformTitle: m.platformTitle,
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
      channelSku: m.channelSku,
      status: m.platformStatus,
      tab: tabOf({
        status: m.platformStatus,
        platformStock: m.platformStock,
        variantStock: m.variant?.stock ?? 0,
        lastSyncedAt: m.lastSyncedAt,
      }),
      price: effPrice,
      stock,
      platformStock: m.platformStock,
      accountId: m.account.id,
      accountLabel: m.account.label,
      lastSyncedAt: m.lastSyncedAt,
    };
    row.variants.push(variantRow);
    row.variantCount += 1;
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

  const rows: TikTokListingRow[] = [...listingMap.values()].map((row) => {
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