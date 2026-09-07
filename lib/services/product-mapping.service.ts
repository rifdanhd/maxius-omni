import { prisma as defaultPrisma } from "@/lib/db/prisma";

type PrismaLike = typeof defaultPrisma;

export type MappingInput = {
  accountId: string;
  variantId: string;
  channelSku: string;
};

function validate(input: MappingInput) {
  if (!input.accountId) throw new Error("accountId wajib diisi.");
  if (!input.variantId) throw new Error("variantId wajib diisi.");
  if (!input.channelSku) throw new Error("channelSku wajib diisi.");
}

/**
 * createProductMapping — insert satu mapping varian ⇆ SKU eksternal per akun.
 * Generic untuk semua platform (Shopee / TikTok Shop / Tokopedia): channelSku
 * menampung identifier eksternal apa pun (seller_sku TikTok, SKU Shopee, dll).
 */
export function createProductMapping(input: MappingInput, prisma: PrismaLike = defaultPrisma) {
  validate(input);
  return prisma.productMapping.create({ data: input });
}

/**
 * bulkCreateProductMappings — import banyak mapping sekaligus (idempotent per akun).
 * Cocok untuk hasil GetProductList TikTok / CSV lintas platform.
 * Baris yang sudah ada (akun+SKU) di-skip, bukan gagal.
 */
export async function bulkCreateProductMappings(
  inputs: MappingInput[],
  prisma: PrismaLike = defaultPrisma
) {
  const result = { created: 0, skipped: 0 };
  for (const input of inputs) {
    validate(input);
    const existing = await prisma.productMapping.findUnique({
      where: { accountId_channelSku: { accountId: input.accountId, channelSku: input.channelSku } },
    });
    if (existing) {
      result.skipped += 1;
      continue;
    }
    await prisma.productMapping.create({ data: input });
    result.created += 1;
  }
  return result;
}

/**
 * updateProductMapping — ubah variantId / channelSku dari mapping yang ada (by id).
 */
export function updateProductMapping(
  id: string,
  data: { variantId?: string; channelSku?: string },
  prisma: PrismaLike = defaultPrisma
) {
  return prisma.productMapping.update({ where: { id }, data });
}

/**
 * deleteProductMapping — hapus mapping by id.
 */
export function deleteProductMapping(id: string, prisma: PrismaLike = defaultPrisma) {
  return prisma.productMapping.delete({ where: { id } });
}

/**
 * getProductMappingsByAccount — ambil semua mapping milik satu akun.
 */
export function getProductMappingsByAccount(accountId: string, prisma: PrismaLike = defaultPrisma) {
  return prisma.productMapping.findMany({
    where: { accountId },
    include: { variant: { include: { masterProduct: true } } },
  });
}

/**
 * normalizeTikTokProduct — ubah hasil getProduct() TikTok (product object) menjadi
 * array MappingInput untuk setiap SKU-nya. Hanya menyertakan SKU yang punya seller_sku
 * (identifier yang dipakai updateStock/getProduct).
 */
export function normalizeTikTokProduct(
  product: Record<string, unknown>,
  accountId: string,
  variantId: string
): MappingInput[] {
  const skus = (product?.skus as Array<Record<string, unknown>>) || [];
  const productId = product?.id as string | undefined;

  const mappings: MappingInput[] = [];
  for (const sku of skus) {
    // seller_sku adalah identifier yang dipakai lookup di updateStock/getProduct.
    const sellerSku = sku?.seller_sku as string | undefined;
    if (!sellerSku) continue;
    mappings.push({ accountId, variantId, channelSku: sellerSku });
  }

  // Produk tanpa SKU terpisah: fallback ke product-level identifier bila ada.
  if (mappings.length === 0 && productId && variantId) {
    mappings.push({ accountId, variantId, channelSku: productId });
  }
  return mappings;
}
