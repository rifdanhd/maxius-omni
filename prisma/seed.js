/* eslint-disable @typescript-eslint/no-require-imports -- script seed CJS, dijalankan via `node prisma/seed.js` */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("Mulai proses seeding database...");

  // 1. Buat User Admin
  const passwordHash = bcrypt.hashSync("admin123", 10);
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash,
    },
  });
  console.log("✅ User 'admin' dibuat/diperbarui.");

  // 1b. Fase multi-brand: pastikan Business default + akses admin ke semua brand
  // (tanpa ini semua /api/* me-return 403 untuk user seed ini).
  await prisma.business.upsert({
    where: { id: "business-default" },
    update: {},
    create: { id: "business-default", name: "Maxius" },
  });
  const allBusinesses = await prisma.business.findMany({ select: { id: true } });
  for (const b of allBusinesses) {
    await prisma.userBusiness.upsert({
      where: { userId_businessId: { userId: admin.id, businessId: b.id } },
      update: {},
      create: { userId: admin.id, businessId: b.id },
    });
  }
  console.log(`✅ Admin di-link ke ${allBusinesses.length} brand.`);

  // 2. Buat Akun Toko (PlatformAccount)
  const accountsData = [
    { id: "tiktok-1", platform: "TIKTOK_SHOP", label: "TikTok Shop - Kaos Kaki A" },
    { id: "tiktok-2", platform: "TIKTOK_SHOP", label: "TikTok Shop - Kaos Kaki B" },
    { id: "tiktok-3", platform: "TIKTOK_SHOP", label: "TikTok Shop - Kaos Kaki C" },
  ];

  for (const acc of accountsData) {
    await prisma.platformAccount.upsert({
      where: { id: acc.id },
      update: { label: acc.label, platform: acc.platform },
      create: acc,
    });
  }
  console.log(`✅ ${accountsData.length} akun toko dibuat/diperbarui.`);

  // 3. Buat Produk Master + Varian dan Mapping
  // Stok dilacak di varian; setiap produk seed memakai 1 varian default.
  const masterProductsData = [
    {
      name: "Kaos kaki polos hitam",
      sku: "SOCK-BLK",
      stock: 120,
      threshold: 20,
      mappings: [
        { accountId: "tiktok-1", channelSku: "TTS1-BLACK01" },
        { accountId: "tiktok-2", channelSku: "TTS2-HTM01" },
        { accountId: "tiktok-3", channelSku: "TTS3-BLK-A" },
      ],
    },
    {
      name: "Kaos kaki motif garis",
      sku: "SOCK-STR",
      stock: 18,
      threshold: 20,
      mappings: [
        { accountId: "tiktok-1", channelSku: "TTS1-STRIPE01" },
        { accountId: "tiktok-2", channelSku: "TTS2-GRS02" },
      ],
    },
    {
      name: "Kaos kaki olahraga putih",
      sku: "SOCK-WHT",
      stock: 64,
      threshold: 15,
      mappings: [
        { accountId: "tiktok-1", channelSku: "TTS1-WHITE01" },
        { accountId: "tiktok-3", channelSku: "TTS3-PTH-C" },
      ],
    },
    {
      name: "Kaos kaki mata kaki abu",
      sku: "SOCK-GRY",
      stock: 40,
      threshold: 15,
      mappings: [
        { accountId: "tiktok-2", channelSku: "TTS2-ABU04" },
        { accountId: "tiktok-3", channelSku: "TTS3-GRY-D" },
      ],
    },
  ];

  // SCOPE PENGHAPUSAN: WHITELIST DUMMY SAJA — sama persis dengan scripts/clean-seed.mts.
  // Jangan pernah deleteMany() tanpa where: data asli (RIKI, Stiker, bundle user,
  // mapping manual) harus selamat dari seed. (Insiden 2026-09: delete tanpa filter
  // menghapus produk asli.)
  const DUMMY_PRODUCT_NAMES = [
    "Kaos kaki polos hitam",
    "Kaos kaki motif garis",
    "Kaos kaki olahraga putih",
    "Kaos kaki mata kaki abu",
  ];
  const DUMMY_VARIANT_SKUS = ["SOCK-BLK", "SOCK-STR", "SOCK-WHT", "SOCK-GRY"];

  // Hapus subtree dummy untuk state fresh — TAPI scoped ketat ke whitelist.
  // Urutan FK-safe: BundleItem dulu (componentVariant = Restrict, P2003),
  // lalu produk dummy (Cascade membersihkan varian + mapping dummy).
  const dummyProducts = await prisma.masterProduct.findMany({
    where: { name: { in: DUMMY_PRODUCT_NAMES } },
    select: { id: true },
  });
  const dummyProductIds = dummyProducts.map((p) => p.id);
  const dummyVariants = await prisma.productVariant.findMany({
    where: { sku: { in: DUMMY_VARIANT_SKUS }, masterProductId: { in: dummyProductIds } },
    select: { id: true },
  });
  const dummyVariantIds = dummyVariants.map((v) => v.id);
  await prisma.bundleItem.deleteMany({
    where: {
      OR: [{ bundleProductId: { in: dummyProductIds } }, { componentVariantId: { in: dummyVariantIds } }],
    },
  });
  await prisma.masterProduct.deleteMany({ where: { id: { in: dummyProductIds } } });

  for (const mp of masterProductsData) {
    await prisma.masterProduct.create({
      data: {
        name: mp.name,
        threshold: mp.threshold,
        variants: {
          create: [
            {
              sku: mp.sku,
              stock: mp.stock,
              mappings: {
                create: mp.mappings,
              },
            },
          ],
        },
      },
    });
  }
  console.log(`✅ ${masterProductsData.length} produk master beserta varian & SKU mapping-nya berhasil dibuat.`);

  console.log("Seeding database selesai!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
