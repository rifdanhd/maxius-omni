import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import { variantAttributesFromRaw } from "@/lib/services/variant-attributes";

/**
 * product-list.service — daftar Produk Master (Katalog Pusat) versi
 * server-side pagination. Semua filter/urutan dieksekusi di DB; halaman
 * hanya menerima satu window (pageSize) sehingga payload & render tetap
 * kecil walau katalog puluhan ribu SKU.
 *
 * Definisi level stok (out/low/ok) dan ringkasan bundle dirender ulang ke
 * SQL di sini dan HARUS tetap identik dengan:
 * - stock-level.policy + product-stock.policy (sumber kebenaran definisi)
 * - lowStockSql di central-stock.service (fragmen level per varian)
 * Kalau policy-nya berubah, fragmen SQL di file ini WAJIB ikut diubah.
 */

export type ProductListTab = "single" | "bundle";
export type ProductListLevel = "low" | "out";
export type ProductListSort =
  | "name_asc"
  | "name_desc"
  | "stock_desc"
  | "stock_asc"
  | "links_desc";

export interface ListProductsParams {
  businessId: string;
  includeInactive?: boolean;
  q?: string;
  tab?: ProductListTab;
  level?: ProductListLevel;
  category?: string;
  platform?: string;
  store?: string;
  sort?: ProductListSort;
  page?: number;
  pageSize?: number;
}

export interface ProductListFacets {
  categories: string[];
  stores: Array<{ id: string; label: string; platform: string }>;
}

export interface ListProductsResult {
  products: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  counts: { all: number; single: number; bundle: number };
  facets: ProductListFacets;
}

// ---------- Fragmen SQL (mengasumsikan alias produk = mp") ----------

// Bundle = type "bundle" ATAU punya baris BundleItem.
const fragIsBundle = Prisma.sql`(
  EXISTS (SELECT 1 FROM "BundleItem" ib WHERE ib."bundleProductId" = mp."id")
  OR mp."type" = 'bundle'
)`;
const fragHasItems = Prisma.sql`EXISTS (SELECT 1 FROM "BundleItem" ih WHERE ih."bundleProductId" = mp."id")`;
// Varian milik produk sendiri (bukan komponen bundle), belum diarsipkan.
const fragOwnVariant = Prisma.sql`EXISTS (
  SELECT 1 FROM "ProductVariant" ov
  WHERE ov."masterProductId" = mp."id" AND ov."isArchived" = false
)`;
// Sama dgn lowStockSql(): tersedia <= COALESCE(minStock, threshold).
const fragOwnLow = Prisma.sql`EXISTS (
  SELECT 1 FROM "ProductVariant" lx
  WHERE lx."masterProductId" = mp."id" AND lx."isArchived" = false
    AND (lx.stock - lx."safetyStock") <= COALESCE(lx."minStock", mp."threshold")
)`;
const fragOwnAnyOut = Prisma.sql`EXISTS (
  SELECT 1 FROM "ProductVariant" ox
  WHERE ox."masterProductId" = mp."id" AND ox."isArchived" = false
    AND ox.stock <= ox."safetyStock"
)`;
// Polisi bundle: qty <= 0 pada komponen mana pun => habis (mirror product-stock.policy).
const fragBundleInvalid = Prisma.sql`EXISTS (
  SELECT 1 FROM "BundleItem" iy WHERE iy."bundleProductId" = mp."id" AND iy.qty <= 0
)`;
// MIN(FLOOR(GREATEST(stok fisik - cadangan, 0) / qty)) atas komponen.
const fragBundleAvail = Prisma.sql`(
  SELECT COALESCE(MIN(FLOOR(GREATEST(cv.stock - cv."safetyStock", 0) / bi.qty)), 0)
  FROM "BundleItem" bi
  JOIN "ProductVariant" cv ON cv."id" = bi."componentVariantId"
  WHERE bi."bundleProductId" = mp."id"
)`;
const fragBundleStock = Prisma.sql`(
  SELECT COALESCE(MIN(FLOOR(GREATEST(cv.stock, 0) / bi.qty)), 0)
  FROM "BundleItem" bi
  JOIN "ProductVariant" cv ON cv."id" = bi."componentVariantId"
  WHERE bi."bundleProductId" = mp."id"
)`;

const fragLevel = Prisma.sql`CASE
  WHEN ${fragHasItems} THEN
    CASE
      WHEN ${fragBundleInvalid} THEN 'out'
      WHEN ${fragBundleAvail} <= 0 THEN 'out'
      WHEN ${fragBundleAvail} <= mp."threshold" THEN 'low'
      ELSE 'ok'
    END
  WHEN NOT ${fragOwnVariant} THEN 'out'
  WHEN ${fragOwnAnyOut} THEN 'out'
  WHEN ${fragOwnLow} THEN 'low'
  ELSE 'ok'
END`;

const fragStock = Prisma.sql`CASE
  WHEN ${fragHasItems} THEN (CASE WHEN ${fragBundleInvalid} THEN 0 ELSE ${fragBundleStock} END)
  ELSE COALESCE((
    SELECT SUM(ss.stock) FROM "ProductVariant" ss
    WHERE ss."masterProductId" = mp."id" AND ss."isArchived" = false
  ), 0)
END`;

const fragLinks = Prisma.sql`COALESCE((
  SELECT COUNT(*) FROM "ProductVariant" lv
  JOIN "ProductMapping" lm ON lm."variantId" = lv."id"
  WHERE lv."masterProductId" = mp."id" AND lv."isArchived" = false
), 0)`;

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function buildWhere(p: ListProductsParams): Prisma.Sql {
  const conds: Prisma.Sql[] = [
    Prisma.sql`mp."businessId" = ${p.businessId}`,
  ];
  if (!p.includeInactive) conds.push(Prisma.sql`mp."isActive" = true AND lower(mp.status) = 'active'`);
  if (p.tab === "bundle") conds.push(fragIsBundle);
  else if (p.tab === "single") conds.push(Prisma.sql`NOT ${fragIsBundle}`);
  if (p.category) conds.push(Prisma.sql`mp."category" = ${p.category}`);
  if (p.platform) {
    conds.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductVariant" fpv
      JOIN "ProductMapping" fpm ON fpm."variantId" = fpv."id"
      JOIN "PlatformAccount" fpa ON fpa."id" = fpm."accountId"
      WHERE fpv."masterProductId" = mp."id" AND fpv."isArchived" = false
        AND fpa.platform = ${p.platform}
    )`);
  }
  if (p.store) {
    conds.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "ProductVariant" spv
      JOIN "ProductMapping" spm ON spm."variantId" = spv."id"
      JOIN "PlatformAccount" spa ON spa."id" = spm."accountId"
      WHERE spv."masterProductId" = mp."id" AND spv."isArchived" = false
        AND spa."id" = ${p.store}
    )`);
  }
  const search = p.q?.trim();
  if (search) {
    const pat = likePattern(search);
    conds.push(Prisma.sql`(
      mp.name ILIKE ${pat} ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM "ProductVariant" qv
        LEFT JOIN "ProductMapping" qm ON qm."variantId" = qv."id"
        WHERE qv."masterProductId" = mp."id"
          AND (qv.sku ILIKE ${pat} ESCAPE '\\' OR qm."channelSku" ILIKE ${pat} ESCAPE '\\')
      )
    )`);
  }
  if (p.level === "low") conds.push(Prisma.sql`${fragLevel} <> 'ok'`);
  else if (p.level === "out") conds.push(Prisma.sql`${fragLevel} = 'out'`);
  return Prisma.join(conds, " AND ");
}

function buildOrder(sort?: ProductListSort): Prisma.Sql {
  switch (sort) {
    case "name_desc":
      return Prisma.sql`mp.name DESC, mp."id" ASC`;
    case "stock_desc":
      return Prisma.sql`${fragStock} DESC, mp.name ASC, mp."id" ASC`;
    case "stock_asc":
      return Prisma.sql`${fragStock} ASC, mp.name ASC, mp."id" ASC`;
    case "links_desc":
      return Prisma.sql`${fragLinks} DESC, mp.name ASC, mp."id" ASC`;
    default:
      return Prisma.sql`mp.name ASC, mp."id" ASC`;
  }
}

async function loadCounts(
  params: ListProductsParams
): Promise<ListProductsResult["counts"]> {
  // Count per tab memakai SEMUA filter (q/level/category/platform/store) —
  // kecuali filter tab itu sendiri — supaya badge "Semua Produk/ Satuan /
  // Bundle" berubah sesuai konteks filter yang aktif di halaman.
  const baseWhere = buildWhere({ ...params, tab: undefined });
  const allPromise = prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`SELECT COUNT(*)::int AS count FROM "MasterProduct" mp WHERE ${baseWhere}`
  );
  const bundlePromise = prisma.$queryRaw<Array<{ count: number }>>(
    Prisma.sql`SELECT COUNT(*)::int AS count FROM "MasterProduct" mp
      WHERE ${baseWhere} AND ${fragIsBundle}`
  );
  const [allRows, bundleRows] = await Promise.all([allPromise, bundlePromise]);
  const all = allRows[0]?.count ?? 0;
  const bundle = bundleRows[0]?.count ?? 0;
  return { all, bundle, single: all - bundle };
}

async function loadFacets(
  businessId: string,
  includeInactive: boolean
): Promise<ProductListFacets> {
  const base = {
    businessId,
    ...(includeInactive ? {} : { isActive: true, status: "active" }),
  };
  const [categoryRows, storeRows] = await Promise.all([
    prisma.masterProduct.findMany({
      where: { ...base, category: { not: null } },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
    prisma.platformAccount.findMany({
      where: {
        businessId,
        productMapping: { some: { variant: { isArchived: false } } },
      },
      select: { id: true, label: true, platform: true },
      orderBy: { label: "asc" },
    }),
  ]);
  return {
    categories: categoryRows
      .map((row) => row.category)
      .filter((c): c is string => Boolean(c)),
    stores: storeRows,
  };
}

export async function listProducts(
  params: ListProductsParams
): Promise<ListProductsResult> {
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(params.pageSize ?? 25)));

  const where = buildWhere(params);
  const offset = (page - 1) * pageSize;

  const [rows, countRows, counts, facets] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT mp."id" FROM "MasterProduct" mp
        WHERE ${where}
        ORDER BY ${buildOrder(params.sort)}
        LIMIT ${pageSize} OFFSET ${offset}`
    ),
    prisma.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS count FROM "MasterProduct" mp WHERE ${where}`
    ),
    loadCounts(params),
    loadFacets(params.businessId, Boolean(params.includeInactive)),
  ]);

  const ids = rows.map((row) => row.id);
  const products =
    ids.length === 0
      ? []
      : await prisma.masterProduct.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            imageUrl: true,
            type: true,
            status: true,
            isActive: true,
            threshold: true,
            productVariant: {
              where: params.includeInactive ? {} : { isArchived: false },
              select: {
                id: true,
                sku: true,
                stock: true,
                safetyStock: true,
                minStock: true,
                name: true,
                price: true,
                productMapping: {
                  select: {
                    id: true,
                    channelSku: true,
                    imageUrl: true,
                    account: { select: { id: true, platform: true, label: true } },
                  },
                  orderBy: { updatedAt: "desc" },
                },
              },
            },
            bundleItem: {
              select: {
                id: true,
                qty: true,
                variant: {
                  select: {
                    id: true,
                    sku: true,
                    stock: true,
                    safetyStock: true,
                    masterProduct: { select: { id: true, name: true } },
                  },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        });

  // Atribut varian marketplace (mis. "Biru, 10 Buah") diambil dari payload
  // mentah agar varian yang foto & SKU-nya sama tetap bisa dibedakan. Query
  // terpisah supaya payload mentah tidak ikut terkirim ke klien.
  const variantIds = products.flatMap((product) => product.productVariant.map((variant) => variant.id));
  const attributeRows = variantIds.length > 0
    ? await prisma.productMapping.findMany({
      where: { variantId: { in: variantIds }, platformStatusRaw: { not: null } },
      select: { variantId: true, channelSku: true, platformStatusRaw: true, account: { select: { platform: true } } },
    })
    : [];
  const attributesByVariant = new Map<string, string[]>();
  for (const row of attributeRows) {
    if (!row.variantId) continue;
    const label = variantAttributesFromRaw(row.account.platform, row.platformStatusRaw, row.channelSku);
    if (!label) continue;
    const labels = attributesByVariant.get(row.variantId) ?? [];
    if (!labels.includes(label)) labels.push(label);
    attributesByVariant.set(row.variantId, labels);
  }

  const byId = new Map(products.map((product) => [product.id, product]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((product): product is (typeof products)[number] => Boolean(product))
    .map(({ productVariant, bundleItem, ...product }) => ({
      ...product,
      // Kontrak API lama memakai "mappings" (bukan "productMapping") —
      // halaman Produk & modal lain membaca variant.mappings.
      variants: productVariant.map(({ productMapping, ...variant }) => ({
        ...variant,
        // Gambar varian diambil dari listing marketplace yang punya foto;
        // gambar master tetap dikirim terpisah untuk fallback di UI.
        imageUrl: productMapping.find((mapping) => mapping.imageUrl)?.imageUrl ?? null,
        masterImageUrl: product.imageUrl ?? null,
        attributes: attributesByVariant.get(variant.id) ?? [],
        mappings: productMapping,
      })),
      bundleItems: bundleItem,
      type: product.type === "bundle" || bundleItem.length > 0 ? "bundle" : "single",
    }));

  return {
    products: ordered,
    total: countRows[0]?.count ?? 0,
    page,
    pageSize,
    counts,
    facets,
  };
}
