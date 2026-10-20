/**
 * reset-demo-data.mts — Skrip pembersih HANYA untuk data demo.
 *
 * KRITERIA KETAT & FAIL-SAFE:
 * - Hanya menghapus Business yang memiliki `isDemo === true`.
 * - Bisnis produksi (isDemo === false, seperti Maxius, Raxen, dsb.) TIDAK PERNAH DISENTUH.
 * - Idempotent dan aman dijalankan kapan saja.
 *
 * USAGE:
 *   npx tsx scripts/reset-demo-data.mts [--force]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("\n========================================================");
  console.log("       PEMBERSIHAN DATA DEMO (RESET DEMO DATA)         ");
  console.log("========================================================\n");

  // 1. Cari semua bisnis yang bertanda demo
  const demoBusinesses = await prisma.business.findMany({
    where: { isDemo: true },
    select: { id: true, name: true },
  });

  if (demoBusinesses.length === 0) {
    console.log("ℹ️  Tidak ada bisnis demo (isDemo = true) yang ditemukan di database.");
    console.log("   Data produksi tetap bersih dan utuh 100%.\n");
    return;
  }

  console.log(`Ditemukan ${demoBusinesses.length} bisnis demo untuk dibersihkan:`);
  for (const b of demoBusinesses) {
    console.log(`   - ID: "${b.id}" | Nama: "${b.name}"`);
  }

  const demoBusinessIds = demoBusinesses.map((b) => b.id);

  // 2. Kumpulkan akun platform milik bisnis demo
  const demoAccounts = await prisma.platformAccount.findMany({
    where: { businessId: { in: demoBusinessIds } },
    select: { id: true },
  });
  const demoAccountIds = demoAccounts.map((a) => a.id);

  // 3. Kumpulkan produk milik bisnis demo
  const demoProducts = await prisma.masterProduct.findMany({
    where: { businessId: { in: demoBusinessIds } },
    select: { id: true },
  });
  const demoProductIds = demoProducts.map((p) => p.id);

  console.log("\nMemulai pembersihan berurutan (FK-Safe Transaction)...");

  await prisma.$transaction(async (tx) => {
    // 3a. Hapus pesanan dan order items
    const deletedOrders = await tx.order.deleteMany({
      where: { accountId: { in: demoAccountIds } },
    });
    console.log(`   ✅ Dihapus: ${deletedOrders.count} Order demo`);

    // 3b. Hapus varian dan produk
    const deletedVariants = await tx.productVariant.deleteMany({
      where: { masterProductId: { in: demoProductIds } },
    });
    console.log(`   ✅ Dihapus: ${deletedVariants.count} ProductVariant demo`);

    const deletedProducts = await tx.masterProduct.deleteMany({
      where: { id: { in: demoProductIds } },
    });
    console.log(`   ✅ Dihapus: ${deletedProducts.count} MasterProduct demo`);

    // 3c. Hapus akun platform demo
    const deletedAccounts = await tx.platformAccount.deleteMany({
      where: { id: { in: demoAccountIds } },
    });
    console.log(`   ✅ Dihapus: ${deletedAccounts.count} PlatformAccount demo`);

    // 3d. Hapus membership UserBusiness ke bisnis demo
    const deletedUserBiz = await tx.userBusiness.deleteMany({
      where: { businessId: { in: demoBusinessIds } },
    });
    console.log(`   ✅ Dihapus: ${deletedUserBiz.count} UserBusiness link demo`);

    // 3e. Hapus record Business demo
    const deletedBiz = await tx.business.deleteMany({
      where: { id: { in: demoBusinessIds } },
    });
    console.log(`   ✅ Dihapus: ${deletedBiz.count} Business demo record`);
  });

  console.log("\n========================================================");
  console.log("   PEMBERSIHAN SELESAI: SEMUA DATA DEMO TELAH DIRESET   ");
  console.log("   Seluruh data bisnis produksi (isDemo = false) UTUH.  ");
  console.log("========================================================\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Gagal membersihkan data demo:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
