const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("Mulai proses seeding database...");

  // 1. Buat User Admin
  const passwordHash = bcrypt.hashSync("admin123", 10);
  await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash,
    },
  });
  console.log("✅ User 'admin' dibuat/diperbarui.");

  // 2. Buat Akun Toko (PlatformAccount)
  const accountsData = [
    { id: "shopee-1", platform: "SHOPEE", label: "Shopee - Kaos Kaki A" },
    { id: "shopee-2", platform: "SHOPEE", label: "Shopee - Kaos Kaki B" },
    { id: "shopee-3", platform: "SHOPEE", label: "Shopee - Kaos Kaki C" },
    { id: "shopee-4", platform: "SHOPEE", label: "Shopee - Kaos Kaki D" },
    { id: "shopee-5", platform: "SHOPEE", label: "Shopee - Kaos Kaki E" },
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
        { accountId: "shopee-1", channelSku: "SHP1-BLK01" },
        { accountId: "shopee-2", channelSku: "SHP2-HTM-01" },
        { accountId: "shopee-3", channelSku: "SHP3-BLACK1" },
        { accountId: "shopee-4", channelSku: "SHP4-BLK-S" },
        { accountId: "shopee-5", channelSku: "SHP5-01BLK" },
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
        { accountId: "shopee-1", channelSku: "SHP1-STR01" },
        { accountId: "shopee-2", channelSku: "SHP2-GRS-02" },
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
        { accountId: "shopee-1", channelSku: "SHP1-WHT01" },
        { accountId: "shopee-3", channelSku: "SHP3-PTH-03" },
        { accountId: "shopee-5", channelSku: "SHP5-03WHT" },
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
        { accountId: "shopee-2", channelSku: "SHP2-ABU-04" },
        { accountId: "shopee-4", channelSku: "SHP4-GRY-S" },
        { accountId: "tiktok-2", channelSku: "TTS2-ABU04" },
        { accountId: "tiktok-3", channelSku: "TTS3-GRY-D" },
      ],
    },
  ];

  // Hapus semua produk lama untuk mencegah duplikasi (karena seed ini berjalan setiap reset)
  await prisma.masterProduct.deleteMany();

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
