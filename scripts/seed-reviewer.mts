import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

const DEMO_BUSINESS_ID = "business-demo-reviewer";
const REVIEWER_USERNAME = "reviewer";
const DEMO_ACCOUNT_IDS = [
  "demo-shopee-1",
  "demo-shopee-2",
  "demo-tiktok-1",
  "demo-tiktok-2",
];

const now = new Date();
const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

const SEED_CONFIRM = process.env.SEED_CONFIRM === "yes";
const DRY_RUN = !SEED_CONFIRM;

type VariantDef = { sku: string; name: string; stock: number; safetyStock: number };
type ProductDef = {
  name: string;
  sku: string;
  stock: number;
  threshold: number;
  variants: VariantDef[];
};

const products: ProductDef[] = [
  {
    name: "DEMO-Kaos Kaki Ortus Hitam S",
    sku: "DEMO-ORTUS-BLK-S",
    stock: 120,
    threshold: 20,
    variants: [
      { sku: "DEMO-ORTUS-BLK-S", name: "Hitam Ukuran S", stock: 60, safetyStock: 10 },
      { sku: "DEMO-ORTUS-BLK-M", name: "Hitam Ukuran M", stock: 60, safetyStock: 10 },
    ],
  },
  {
    name: "DEMO-Kaos Kaki Ortus Hitam M",
    sku: "DEMO-ORTUS-BLK-MD",
    stock: 80,
    threshold: 20,
    variants: [
      { sku: "DEMO-ORTUS-BLK-MD", name: "Hitam Ukuran M", stock: 80, safetyStock: 10 },
      { sku: "DEMO-ORTUS-BLK-L", name: "Hitam Ukuran L", stock: 0, safetyStock: 5 },
    ],
  },
  {
    name: "DEMO-Kaos Kaki Ortus Putih S",
    sku: "DEMO-ORTUS-WHT-S",
    stock: 45,
    threshold: 15,
    variants: [
      { sku: "DEMO-ORTUS-WHT-S", name: "Putih Ukuran S", stock: 45, safetyStock: 8 },
      { sku: "DEMO-ORTUS-WHT-M", name: "Putih Ukuran M", stock: 45, safetyStock: 8 },
    ],
  },
  {
    name: "DEMO-Kaos Kaki Ortus Biru L",
    sku: "DEMO-ORTUS-BLU-L",
    stock: 30,
    threshold: 15,
    variants: [
      { sku: "DEMO-ORTUS-BLU-L", name: "Biru Ukuran L", stock: 30, safetyStock: 5 },
      { sku: "DEMO-ORTUS-BLU-XL", name: "Biru Ukuran XL", stock: 30, safetyStock: 5 },
    ],
  },
  {
    name: "DEMO-Kaos Kaki Ortus Merah S (stok menipis)",
    sku: "DEMO-ORTUS-RED-S",
    stock: 3,
    threshold: 20,
    variants: [
      { sku: "DEMO-ORTUS-RED-S", name: "Merah Ukuran S", stock: 3, safetyStock: 10 },
      { sku: "DEMO-ORTUS-RED-M", name: "Merah Ukuran M", stock: 3, safetyStock: 10 },
    ],
  },
  {
    name: "DEMO-Kaos Kaki Ortus Hijau XL",
    sku: "DEMO-ORTUS-GRN-XL",
    stock: 200,
    threshold: 20,
    variants: [
      { sku: "DEMO-ORTUS-GRN-XL", name: "Hijau Ukuran XL", stock: 100, safetyStock: 20 },
      { sku: "DEMO-ORTUS-GRN-XXL", name: "Hijau Ukuran XXL", stock: 100, safetyStock: 20 },
    ],
  },
];

const accounts = [
  { id: "demo-shopee-1", platform: "SHOPEE", label: "DEMO-Shopee Toko A" },
  { id: "demo-shopee-2", platform: "SHOPEE", label: "DEMO-Shopee Toko B" },
  { id: "demo-tiktok-1", platform: "TIKTOK_SHOP", label: "DEMO-TikTok Toko A" },
  { id: "demo-tiktok-2", platform: "TIKTOK_SHOP", label: "DEMO-TikTok Toko B" },
];

async function main() {
  console.log("=== SEED REVIEWER DEMO ===");
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (tidak akan menulis ke database)" : "EKSEKUSI NYATA (SEED_CONFIRM=yes)"}\n`);

  // ── 1. Cari user reviewer — TIDAK boleh dibuat, diubah, atau dihapus ──
  const reviewer = await prisma.user.findUnique({ where: { username: REVIEWER_USERNAME } });
  if (!reviewer) {
    console.error(`ERROR: User '${REVIEWER_USERNAME}' tidak ditemukan di database.`);
    console.error(
      "Jangan membuat user baru — password sudah dikirim ke Shopee dan harus tetap sama.",
    );
    console.error("Buat user secara manual atau tanyakan admin sebelum menjalankan seed ini.");
    process.exit(1);
  }
  console.log(`User reviewer ditemukan: id=${reviewer.id}`);

  // ── 2. Cetak daftar UserBusiness milik reviewer ──
  const memberships = await prisma.userBusiness.findMany({
    where: { userId: reviewer.id },
    include: { business: { select: { id: true, name: true, isDemo: true } } },
  });
  console.log("\n--- UserBusiness milik reviewer ---");
  if (memberships.length === 0) {
    console.log("  (tidak ada keanggotaan business)");
  }
  for (const m of memberships) {
    console.log(
      `  businessId=${m.business.id} name="${m.business.name}" isDemo=${m.business.isDemo} role=${m.role}`,
    );
  }

  const nonDemoMemberships = memberships.filter((m) => m.businessId !== DEMO_BUSINESS_ID);
  if (nonDemoMemberships.length > 0) {
    console.error(
      "\nERROR: Reviewer punya keanggotaan di business selain demo. Seed tidak boleh mengubah reviewer.",
    );
    for (const m of nonDemoMemberships) {
      console.error(`  - ${m.business.id} (${m.business.name})`);
    }
    console.error("Hard stop: hapus keanggautan non-demo terlebih dahulu. Tidak ada opsi bypass.");
    process.exit(1);
  }

  // ── 3. Hitung jumlah yang akan terpengaruh (info dry-run) ──
  const demoOrders = await prisma.order.findMany({
    where: { accountId: { in: DEMO_ACCOUNT_IDS } },
    select: { id: true },
  });
  const demoOrderIds = demoOrders.map((o) => o.id);

  const counts = {
    deleteOrderItem: await prisma.orderItem.count({ where: { orderId: { in: demoOrderIds } } }),
    deleteShipment: await prisma.shipment.count({ where: { orderId: { in: demoOrderIds } } }),
    deletePlatformOrderMapping: await prisma.platformOrderMapping.count({
      where: { orderId: { in: demoOrderIds } },
    }),
    deleteOrder: await prisma.order.count({ where: { accountId: { in: DEMO_ACCOUNT_IDS } } }),
    deleteStockLedger: await prisma.stockLedger.count({
      where: { variant: { masterProduct: { businessId: DEMO_BUSINESS_ID } } },
    }),
    deleteStockOpnameItem: await prisma.stockOpnameItem.count({
      where: { variant: { masterProduct: { businessId: DEMO_BUSINESS_ID } } },
    }),
    deleteStockOpname: await prisma.stockOpname.count({
      where: { items: { some: { variant: { masterProduct: { businessId: DEMO_BUSINESS_ID } } } } },
    }),
    deleteProductMapping: await prisma.productMapping.count({
      where: { accountId: { in: DEMO_ACCOUNT_IDS } },
    }),
    deleteProductVariant: await prisma.productVariant.count({
      where: { masterProduct: { businessId: DEMO_BUSINESS_ID } },
    }),
    deleteMasterProduct: await prisma.masterProduct.count({
      where: { businessId: DEMO_BUSINESS_ID },
    }),
    deletePlatformAccount: await prisma.platformAccount.count({
      where: { id: { in: DEMO_ACCOUNT_IDS } },
    }),
    deleteInventoryWarehouse: await prisma.inventoryWarehouse.count({
      where: { businessId: DEMO_BUSINESS_ID },
    }),
    deleteInventorySetting: await prisma.inventorySetting.count({
      where: { businessId: DEMO_BUSINESS_ID },
    }),
    deleteStockOutbox: await prisma.stockOutbox.count({ where: { businessId: DEMO_BUSINESS_ID } }),
    deleteSyncRun: await prisma.syncRun.count({ where: { businessId: DEMO_BUSINESS_ID } }),
    createBusiness: 1,
    createAccounts: accounts.length,
    createMasterProducts: products.length,
    createVariants: products.reduce((s, p) => s + p.variants.length, 0),
    createMappings: products.reduce((s, p) => s + p.variants.length * accounts.length, 0),
    createOrders: 25,
    createOrderItems: 25,
    createPlatformOrderMappings: 25,
    createStockLedger: products.reduce((s, p) => s + p.variants.length, 0) + 25 + 1,
    createStockOpname: 1,
  };

  console.log("\n=== Rencana perubahan (hanya hitungan, belum ditulis) ===");
  console.log("Delete:");
  console.log(`  orderItem: ${counts.deleteOrderItem}`);
  console.log(`  shipment: ${counts.deleteShipment}`);
  console.log(`  platformOrderMapping: ${counts.deletePlatformOrderMapping}`);
  console.log(`  order: ${counts.deleteOrder}`);
  console.log(`  stockLedger: ${counts.deleteStockLedger}`);
  console.log(`  stockOpnameItem: ${counts.deleteStockOpnameItem}`);
  console.log(`  stockOpname: ${counts.deleteStockOpname}`);
  console.log(`  productMapping: ${counts.deleteProductMapping}`);
  console.log(`  productVariant: ${counts.deleteProductVariant}`);
  console.log(`  masterProduct: ${counts.deleteMasterProduct}`);
  console.log(`  platformAccount: ${counts.deletePlatformAccount}`);
  console.log(`  inventoryWarehouse: ${counts.deleteInventoryWarehouse}`);
  console.log(`  inventorySetting: ${counts.deleteInventorySetting}`);
  console.log(`  stockOutbox: ${counts.deleteStockOutbox}`);
  console.log(`  syncRun: ${counts.deleteSyncRun}`);
  console.log("Create:");
  console.log(`  business: ${counts.createBusiness}`);
  console.log(`  platformAccount: ${counts.createAccounts}`);
  console.log(`  masterProduct: ${counts.createMasterProducts}`);
  console.log(`  productVariant: ${counts.createVariants}`);
  console.log(`  productMapping: ${counts.createMappings}`);
  console.log(`  order: ${counts.createOrders}`);
  console.log(`  orderItem: ${counts.createOrderItems}`);
  console.log(`  platformOrderMapping: ${counts.createPlatformOrderMappings}`);
  console.log(`  stockLedger: ${counts.createStockLedger}`);
  console.log(`  stockOpname: ${counts.createStockOpname}`);
  console.log(`  stockOpnameItem: ${counts.createVariants}`);

  if (DRY_RUN) {
    console.log("\n=== DRY-RUN SELESAI (tidak ada data yang diubah) ===");
    console.log("Jalankan lagi dengan SEED_CONFIRM=yes untuk eksekusi nyata.");
    await prisma.$disconnect();
    return;
  }

  // ── 4. Eksekusi dalam satu transaksi ──
  await prisma.$transaction(
    async (tx) => {
    // --- Cleanup (urutan FK-safe) ---
    await tx.stockOpnameItem.deleteMany({
      where: { variant: { masterProduct: { businessId: DEMO_BUSINESS_ID } } },
    });
    await tx.stockOpname.deleteMany({
      where: { items: { some: { variant: { masterProduct: { businessId: DEMO_BUSINESS_ID } } } } },
    });
    await tx.orderItem.deleteMany({ where: { orderId: { in: demoOrderIds } } });
    await tx.shipment.deleteMany({ where: { orderId: { in: demoOrderIds } } });
    await tx.platformOrderMapping.deleteMany({ where: { orderId: { in: demoOrderIds } } });
    await tx.order.deleteMany({ where: { accountId: { in: DEMO_ACCOUNT_IDS } } });
    await tx.stockLedger.deleteMany({
      where: { variant: { masterProduct: { businessId: DEMO_BUSINESS_ID } } },
    });
    await tx.productMapping.deleteMany({ where: { accountId: { in: DEMO_ACCOUNT_IDS } } });
    await tx.productVariant.deleteMany({
      where: { masterProduct: { businessId: DEMO_BUSINESS_ID } },
    });
    await tx.masterProduct.deleteMany({ where: { businessId: DEMO_BUSINESS_ID } });
    await tx.platformAccount.deleteMany({ where: { id: { in: DEMO_ACCOUNT_IDS } } });
    await tx.inventoryWarehouse.deleteMany({ where: { businessId: DEMO_BUSINESS_ID } });
    await tx.inventorySetting.deleteMany({ where: { businessId: DEMO_BUSINESS_ID } });
    await tx.stockOutbox.deleteMany({ where: { businessId: DEMO_BUSINESS_ID } });
    await tx.syncRun.deleteMany({ where: { businessId: DEMO_BUSINESS_ID } });

    // --- Upsert business demo (tidak ada delete business) ---
    await tx.business.upsert({
      where: { id: DEMO_BUSINESS_ID },
      update: { name: "Maxius Demo (Reviewer)", isDemo: true },
      create: { id: DEMO_BUSINESS_ID, name: "Maxius Demo (Reviewer)", isDemo: true },
    });

    // --- Upsert UserBusiness reviewer → business demo, role reviewer ---
    await tx.userBusiness.upsert({
      where: { userId_businessId: { userId: reviewer.id, businessId: DEMO_BUSINESS_ID } },
      update: { role: "reviewer" },
      create: { userId: reviewer.id, businessId: DEMO_BUSINESS_ID, role: "reviewer" },
    });

    // --- Create akun toko (upsert) ---
    for (const acc of accounts) {
      await tx.platformAccount.upsert({
        where: { id: acc.id },
        update: { label: acc.label, platform: acc.platform, businessId: DEMO_BUSINESS_ID },
        create: { id: acc.id, platform: acc.platform, label: acc.label, businessId: DEMO_BUSINESS_ID },
      });
    }

    // --- Create produk master + varian ---
    const createdVariants: { id: string; sku: string; masterId: string; stock: number }[] = [];
    for (const p of products) {
      const mp = await tx.masterProduct.create({
        data: {
          id: crypto.randomUUID(),
          name: p.name,
          threshold: p.threshold,
          isActive: true,
          status: "active",
          businessId: DEMO_BUSINESS_ID,
        },
      });
      for (const v of p.variants) {
        const pv = await tx.productVariant.create({
          data: {
            id: crypto.randomUUID(),
            sku: v.sku,
            stock: v.stock,
            safetyStock: v.safetyStock,
            name: v.name,
            isArchived: false,
            masterProductId: mp.id,
          },
        });
        createdVariants.push({ id: pv.id, sku: v.sku, masterId: mp.id, stock: v.stock });
      }
    }

    // --- Mapping setiap varian ke setiap toko demo ---
    for (const variant of createdVariants) {
      for (const acc of accounts) {
        const channelSku = `DEMO-${acc.platform}-${variant.sku}`;
        await tx.productMapping.upsert({
          where: { accountId_channelSku: { accountId: acc.id, channelSku } },
          update: {
            variantId: variant.id,
            platformSkuId: `DEMO-PS-${variant.sku}`,
            platformProductId: `DEMO-PP-${variant.sku}`,
            platformTitle: `DEMO Listing ${variant.sku}`,
            platformStock: variant.stock,
            platformStatus: "ACTIVE",
            lastSyncedAt: now,
            updatedAt: now,
          },
          create: {
            id: crypto.randomUUID(),
            channelSku,
            sellerSku: variant.sku,
            platformSkuId: `DEMO-PS-${variant.sku}`,
            variantId: variant.id,
            accountId: acc.id,
            platformProductId: `DEMO-PP-${variant.sku}`,
            platformTitle: `DEMO Listing ${variant.sku}`,
            platformStock: variant.stock,
            platformStatus: "ACTIVE",
            lastSyncedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }

    // --- 25 pesanan demo ---
    const statusesWeights = [
      "NEW",
      "NEW",
      "READY_TO_SHIP",
      "READY_TO_SHIP",
      "SHIPPED",
      "SHIPPED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "CANCELLED",
    ];
    const orderIds: string[] = [];
    for (let i = 1; i <= 25; i++) {
      const account = accounts[(i - 1) % accounts.length];
      const daysAgo = Math.floor(Math.random() * 30);
      const createTime = new Date(Date.now() - daysAgo * 86_400_000);
      const status = statusesWeights[Math.floor(Math.random() * statusesWeights.length)];
      const orderNo = `DEMO-ORD-${String(i).padStart(3, "0")}`;

      const order = await tx.order.create({
        data: {
          id: crypto.randomUUID(),
          orderNo,
          status,
          accountId: account.id,
          buyerName: "Pembeli Demo",
          amount: 75000 + i * 1000,
          currency: "IDR",
          createTime,
          isCod: i % 5 === 0,
          paymentMethodName: i % 3 === 0 ? "COD" : "Virtual Account",
          createdAt: createTime,
          updatedAt: createTime,
        },
      });
      orderIds.push(order.id);

      const variant = createdVariants[Math.floor(Math.random() * createdVariants.length)];
      const qty = 1 + (i % 3);
      await tx.orderItem.create({
        data: {
          id: crypto.randomUUID(),
          orderId: order.id,
          channelSku: `DEMO-${account.platform}-${variant.sku}`,
          productId: variant.masterId,
          variantId: variant.id,
          productName: `DEMO Produk ${variant.sku}`,
          skuName: variant.sku,
          qty,
          price: 75000,
        },
      });

      await tx.platformOrderMapping.create({
        data: {
          id: crypto.randomUUID(),
          externalOrderId: `DEMO-EXT-${orderNo}`,
          rawStatus: status,
          orderId: order.id,
          accountId: account.id,
        },
      });

      if (status === "SHIPPED" || status === "COMPLETED") {
        await tx.shipment.create({
          data: {
            id: crypto.randomUUID(),
            externalId: `DEMO-SHP-${orderNo}`,
            carrier: "JNE",
            trackingNo: `DEMO-TRK-${String(i).padStart(4, "0")}`,
            status: status === "COMPLETED" ? "DELIVERED" : "IN_TRANSIT",
            shippedAt: new Date(createTime.getTime() + 86_400_000),
            orderId: order.id,
            accountId: account.id,
          },
        });
      }
    }

    // --- Stock Ledger dengan stockAfter konsisten (running balance per varian) ---
    const runningBalance = new Map<string, number>();
    for (const v of createdVariants) {
      runningBalance.set(v.id, 0);
    }

    // Stok masuk awal
    for (const variant of createdVariants) {
      const initialStock = variant.stock > 0 ? variant.stock : 0;
      await tx.stockLedger.create({
        data: {
          id: crypto.randomUUID(),
          changeQty: initialStock,
          reason: "DEMO-STOK_MASUK_AWAL",
          referenceId: `DEMO-INIT-${variant.sku}`,
          stockAfter: initialStock,
          variantId: variant.id,
          userId: reviewer.id,
          createdAt: thirtyDaysAgo,
        },
      });
      runningBalance.set(variant.id, initialStock);
    }

    // Ambil order item yang SHIPPED/COMPLETED untuk pengurangan stok
    const completedItems = await tx.orderItem.findMany({
      where: {
        order: { status: { in: ["SHIPPED", "COMPLETED"] }, accountId: { in: DEMO_ACCOUNT_IDS } },
        variantId: { not: null },
      },
      include: { variant: true, order: true },
    });
    // Urutkan agar running balance konsisten (urut by createTime)
    completedItems.sort((a, b) => {
      const ta = a.order.createTime?.getTime() ?? 0;
      const tb = b.order.createTime?.getTime() ?? 0;
      return ta - tb;
    });
    for (const item of completedItems) {
      if (!item.variantId) continue;
      const current = runningBalance.get(item.variantId) ?? 0;
      const after = Math.max(0, current - item.qty);
      await tx.stockLedger.create({
        data: {
          id: crypto.randomUUID(),
          changeQty: -item.qty,
          reason: "DEMO-PENGURANGAN_PESANAN",
          referenceId: `${item.order.orderNo}-${item.id}`,
          stockAfter: after,
          variantId: item.variantId,
          userId: reviewer.id,
          createdAt: item.order.createTime ?? now,
        },
      });
      runningBalance.set(item.variantId, after);
    }

    // Penyesuaian stok opname untuk varian Merah S
    const redVariant = createdVariants.find((v) => v.sku === "DEMO-ORTUS-RED-S");
    if (redVariant) {
      const current = runningBalance.get(redVariant.id) ?? 0;
      const after = current + 2;
      await tx.stockLedger.create({
        data: {
          id: crypto.randomUUID(),
          changeQty: 2,
          reason: "DEMO-OPNAME_PENYESUAIAN",
          referenceId: "DEMO-OPNAME-001",
          stockAfter: after,
          variantId: redVariant.id,
          userId: reviewer.id,
          createdAt: new Date(Date.now() - 5 * 86_400_000),
        },
      });
      runningBalance.set(redVariant.id, after);
    }

    // --- Stock Opname dengan selisih ---
    const mismatchVariant = createdVariants.find((v) => v.sku === "DEMO-ORTUS-BLU-L");
    if (mismatchVariant) {
      const current = runningBalance.get(mismatchVariant.id) ?? 0;
      await tx.stockOpname.create({
        data: {
          id: crypto.randomUUID(),
          code: "DEMO-OPNAME-001",
          status: "FINALIZED",
          note: "DEMO - Opname rutin, ditemukan selisih 2 unit",
          userId: reviewer.id,
          startedAt: new Date(Date.now() - 5 * 86_400_000),
          finalizedAt: new Date(Date.now() - 4 * 86_400_000),
          items: {
            create: [
              {
                id: crypto.randomUUID(),
                variantId: mismatchVariant.id,
                systemStock: current,
                countedStock: Math.max(0, current - 2),
              },
            ],
          },
        },
      });
    }

    // --- Sinkronkan ProductVariant.stock dengan saldo ledger akhir ---
    for (const variant of createdVariants) {
      const finalStock = runningBalance.get(variant.id) ?? 0;
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { stock: finalStock },
      });
    }
  },
  { timeout: 120_000, maxWait: 10_000 }
);

  console.log("\n=== SEED SELESAI ===");
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
