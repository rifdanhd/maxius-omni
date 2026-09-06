import { prisma } from "@/lib/db/prisma";
import { syncStockToMarketplaces } from "@/lib/services/sync.service";

/**
 * recordSale({ accountId, channelSku, qty })
 *
 * Logika inti sinkronisasi stok:
 *  1. Validasi input
 *  2. Cari produk master via mapping SKU
 *  3. Kurangi stok di DB (atomik)
 *  4. Catat log penjualan
 *  5. Kirim update stok ke marketplace lain di background
 */
export async function recordSale({
  accountId,
  channelSku,
  qty,
}: {
  accountId: string;
  channelSku: string;
  qty: number | string;
}) {
  const quantity = Number(qty);

  if (!channelSku) throw new Error("SKU wajib diisi.");
  if (!quantity || quantity <= 0) throw new Error("Jumlah tidak valid.");

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Akun tidak ditemukan.");

  const mapping = await prisma.productMapping.findUnique({
    where: { accountId_channelSku: { accountId, channelSku } },
    include: { masterProduct: true },
  });

  if (!mapping) {
    throw new Error(
      `SKU "${channelSku}" belum di-mapping ke produk master manapun untuk akun ini.`
    );
  }

  const product = mapping.masterProduct;

  if (product.stock < quantity) {
    throw new Error(
      `Stok tidak cukup. Sisa stok "${product.name}" tinggal ${product.stock}.`
    );
  }

  // Update stok secara atomik
  const updatedProduct = await prisma.masterProduct.update({
    where: { id: product.id },
    data: { stock: { decrement: quantity } },
  });

  const isCritical = updatedProduct.stock <= updatedProduct.threshold;

  const allMappings = await prisma.productMapping.findMany({
    where: { masterProductId: product.id },
  });
  const otherListings = allMappings.length - 1;

  const entry = await prisma.salesLog.create({
    data: {
      masterProductId: product.id,
      accountId: account.id,
      channelSku,
      qty: quantity,
      stockAfter: updatedProduct.stock,
      critical: isCritical,
      text: `${quantity} pcs "${product.name}" (SKU ${channelSku}) terjual di ${account.label} — stok pusat jadi ${updatedProduct.stock}, tersinkron ke ${otherListings} listing lain.`,
    },
  });

  // Sinkronisasi ke marketplace lain (background, non-blocking)
  const otherMappings = allMappings.filter((m) => m.accountId !== accountId);
  syncStockToMarketplaces(otherMappings, updatedProduct.stock).catch((err) =>
    console.error("[Sync] Unexpected error:", err)
  );

  return { product: updatedProduct, entry };
}
