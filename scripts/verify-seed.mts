/* Verifikasi data seed — run: npx tsx scripts/verify-seed.mts */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [users, accounts, products, variants, productMapping] = await Promise.all([
    prisma.user.count(),
    prisma.platformAccount.findMany({ select: { id: true, platform: true, label: true, accessToken: true } }),
    prisma.masterProduct.findMany({
      include: { productVariant: { include: { productMapping: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.productVariant.count(),
    prisma.productMapping.count(),
  ]);

  console.log(`Users: ${users}`);
  console.log(`Toko (PlatformAccount): ${accounts.length}`);
  for (const a of accounts) {
    console.log(`  - [${a.platform}] ${a.label} (id=${a.id}, token=${a.accessToken ? "ada" : "kosong"})`);
  }
  console.log(`Produk master: ${products.length}, varian: ${variants}, mapping: ${productMapping}`);
  for (const p of products) {
    const v = p.productVariant[0];
    console.log(
      `  - ${p.name} (${p.type}, ${p.status}, isActive=${p.isActive}) → varian SKU=${v?.sku} stock=${v?.stock} threshold=${p.threshold}, mapping=${v?.productMapping?.length ?? 0}`
    );
  }

  // Sanity-check mirip harapan e2e: admin/admin123 bisa login (hash bcrypt valid).
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });
  const bcrypt = await import("bcryptjs");
  const ok = admin && bcrypt.compareSync("admin123", admin.passwordHash);
  console.log(`Login admin/admin123: ${ok ? "OK ✅" : "GAGAL ❌"}`);
  if (!ok) process.exit(1);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
