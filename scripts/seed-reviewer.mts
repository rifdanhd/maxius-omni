import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const prisma = new PrismaClient();

const DEMO_BUSINESS_ID = "business-demo-reviewer";
const REVIEWER_USERNAME = "reviewer";
const REVIEWER_PASSWORD = crypto.randomBytes(24).toString("base64url");

const now = new Date();
const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

async function main() {
  console.log("=== SEED REVIEWER DEMO (idempoten) ===");

  // ── Cleanup data demo lama (idempoten) ──
  const demoVariantSkus = await prisma.productVariant.findMany({
    where: { sku: { startsWith: "DEMO-ORTUS-" } },
    select: { id: true, masterProductId: true },
  });
  const demoVariantIds = demoVariantSkus.map((v) => v.id);
  const demoMasterIds = Array.from(new Set(demoVariantSkus.map((v) => v.masterProductId)));

  const demoOrderNos = await prisma.order.findMany({
    where: { orderNo: { startsWith: "DEMO-" } },
    select: { id: true },
  });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: demoOrderNos.map((o) => o.id) } } });
  await prisma.shipment.deleteMany({ where: { orderId: { in: demoOrderNos.map((o) => o.id) } } });
  await prisma.platformOrderMapping.deleteMany({ where: { orderId: { in: demoOrderNos.map((o) => o.id) } } });
  await prisma.order.deleteMany({ where: { orderNo: { startsWith: "DEMO-" } } });

  await prisma.stockLedger.deleteMany({ where: { reason: { startsWith: "DEMO" } } });
  await prisma.stockOpnameItem.deleteMany({ where: { opname: { code: { startsWith: "DEMO-" } } } });
  await prisma.stockOpname.deleteMany({ where: { code: { startsWith: "DEMO-" } } });
  await prisma.productMapping.deleteMany({ where: { channelSku: { startsWith: "DEMO-" } } });
  await prisma.productVariant.deleteMany({ where: { id: { in: demoVariantIds } } });
  await prisma.masterProduct.deleteMany({ where: { id: { in: demoMasterIds } } });
  await prisma.platformAccount.deleteMany({ where: { id: { in: ["demo-shopee-1", "demo-shopee-2", "demo-tiktok-1", "demo-tiktok-2"] } } });
  const existingReviewer = await prisma.user.findUnique({ where: { username: REVIEWER_USERNAME }, select: { id: true } });
  if (existingReviewer) {
    await prisma.userBusiness.deleteMany({ where: { userId: existingReviewer.id, businessId: DEMO_BUSINESS_ID } });
    await prisma.user.delete({ where: { id: existingReviewer.id } });
  }
  await prisma.inventoryWarehouse.deleteMany({ where: { businessId: DEMO_BUSINESS_ID } });
  await prisma.inventorySetting.deleteMany({ where: { businessId: DEMO_BUSINESS_ID } });
  await prisma.stockOutbox.deleteMany({ where: { businessId: DEMO_BUSINESS_ID } });
  await prisma.syncRun.deleteMany({ where: { businessId: DEMO_BUSINESS_ID } });
  await prisma.business.delete({ where: { id: DEMO_BUSINESS_ID } });

  console.log("🧹 Cleanup data demo lama selesai");

  // 1. Bisnis demo (isDemo: true) — hanya reviewer yang memiliki akses
  await prisma.business.create({
    data: { id: DEMO_BUSINESS_ID, name: "Maxius Demo (Reviewer)", isDemo: true },
  });
  console.log("✅ Business demo siap:", DEMO_BUSINESS_ID);

  // 2. User reviewer — tanpa captcha, OTP, password tidak kedaluwarsa
  const passwordHash = bcrypt.hashSync(REVIEWER_PASSWORD, 12);
  const reviewer = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      username: REVIEWER_USERNAME,
      passwordHash,
      canViewFullPii: false,
    },
  });
  console.log("✅ User reviewer siap:", reviewer.id);

  // 3. Link reviewer ke business demo dengan role "reviewer"
  await prisma.userBusiness.create({
    data: { userId: reviewer.id, businessId: DEMO_BUSINESS_ID, role: "reviewer" },
  });
  console.log("✅ UserBusiness reviewer → role reviewer");

  // 4. Akun toko: 2 Shopee + 2 TikTok Shop, semua demo
  const accounts = [
    { id: "demo-shopee-1", platform: "SHOPEE", label: "DEMO-Shopee Toko A" },
    { id: "demo-shopee-2", platform: "SHOPEE", label: "DEMO-Shopee Toko B" },
    { id: "demo-tiktok-1", platform: "TIKTOK_SHOP", label: "DEMO-TikTok Toko A" },
    { id: "demo-tiktok-2", platform: "TIKTOK_SHOP", label: "DEMO-TikTok Toko B" },
  ];
  for (const acc of accounts) {
    await prisma.platformAccount.create({
      data: { id: acc.id, platform: acc.platform, label: acc.label, businessId: DEMO_BUSINESS_ID },
    });
  }
  console.log(`✅ ${accounts.length} akun toko demo siap`);

  // 5. Produk master "Kaos Kaki Ortus" — 6 produk, variasi ukuran/warna
  type VariantDef = { sku: string; name: string; stock: number; safetyStock: number };
  type ProductDef = {
    name: string; sku: string; stock: number; threshold: number;
    variants: VariantDef[];
  };
  const products: ProductDef[] = [
    {
      name: "DEMO-Kaos Kaki Ortus Hitam S", sku: "DEMO-ORTUS-BLK-S", stock: 120, threshold: 20,
      variants: [
        { sku: "DEMO-ORTUS-BLK-S", name: "Hitam Ukuran S", stock: 60, safetyStock: 10 },
        { sku: "DEMO-ORTUS-BLK-M", name: "Hitam Ukuran M", stock: 60, safetyStock: 10 },
      ],
    },
    {
      name: "DEMO-Kaos Kaki Ortus Hitam M", sku: "DEMO-ORTUS-BLK-M", stock: 80, threshold: 20,
      variants: [
        { sku: "DEMO-ORTUS-BLK-MD", name: "Hitam Ukuran M", stock: 80, safetyStock: 10 },
        { sku: "DEMO-ORTUS-BLK-L", name: "Hitam Ukuran L", stock: 0, safetyStock: 5 },
      ],
    },
    {
      name: "DEMO-Kaos Kaki Ortus Putih S", sku: "DEMO-ORTUS-WHT-S", stock: 45, threshold: 15,
      variants: [
        { sku: "DEMO-ORTUS-WHT-S", name: "Putih Ukuran S", stock: 45, safetyStock: 8 },
        { sku: "DEMO-ORTUS-WHT-M", name: "Putih Ukuran M", stock: 45, safetyStock: 8 },
      ],
    },
    {
      name: "DEMO-Kaos Kaki Ortus Biru L", sku: "DEMO-ORTUS-BLU-L", stock: 30, threshold: 15,
      variants: [
        { sku: "DEMO-ORTUS-BLU-L", name: "Biru Ukuran L", stock: 30, safetyStock: 5 },
        { sku: "DEMO-ORTUS-BLU-XL", name: "Biru Ukuran XL", stock: 30, safetyStock: 5 },
      ],
    },
    {
      name: "DEMO-Kaos Kaki Ortus Merah S (stok menipis)", sku: "DEMO-ORTUS-RED-S", stock: 3, threshold: 20,
      variants: [
        { sku: "DEMO-ORTUS-RED-S", name: "Merah Ukuran S", stock: 3, safetyStock: 10 },
        { sku: "DEMO-ORTUS-RED-M", name: "Merah Ukuran M", stock: 3, safetyStock: 10 },
      ],
    },
    {
      name: "DEMO-Kaos Kaki Ortus Hijau XL", sku: "DEMO-ORTUS-GRN-XL", stock: 200, threshold: 20,
      variants: [
        { sku: "DEMO-ORTUS-GRN-XL", name: "Hijau Ukuran XL", stock: 100, safetyStock: 20 },
        { sku: "DEMO-ORTUS-GRN-XXL", name: "Hijau Ukuran XXL", stock: 100, safetyStock: 20 },
      ],
    },
  ];

  const createdVariants: { id: string; sku: string; masterId: string; stock: number }[] = [];

  for (const p of products) {
    const mp = await prisma.masterProduct.create({
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
      const pv = await prisma.productVariant.create({
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
  console.log(`✅ ${products.length} produk master + varian siap`);

  // 6. Mapping setiap produk ke listing di setiap toko
  for (const variant of createdVariants) {
    for (const acc of accounts) {
      const channelSku = `DEMO-${acc.platform}-${variant.sku}`;
      await prisma.productMapping.upsert({
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
  console.log("✅ Product mapping untuk semua toko selesai");

  // 7. 25 pesanan dalam 30 hari terakhir, status campur
  const statusesWeights = ["NEW", "NEW", "READY_TO_SHIP", "READY_TO_SHIP", "SHIPPED", "SHIPPED", "COMPLETED", "COMPLETED", "COMPLETED", "CANCELLED"];
  const orderIds: string[] = [];

  for (let i = 1; i <= 25; i++) {
    const account = accounts[(i - 1) % accounts.length];
    const daysAgo = Math.floor(Math.random() * 30);
    const createTime = new Date(Date.now() - daysAgo * 86_400_000);
    const status = statusesWeights[Math.floor(Math.random() * statusesWeights.length)];
    const orderNo = `DEMO-ORD-${String(i).padStart(3, "0")}`;

    const order = await prisma.order.create({
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
    await prisma.orderItem.create({
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

    await prisma.platformOrderMapping.create({
      data: {
        id: crypto.randomUUID(),
        externalOrderId: `DEMO-EXT-${orderNo}`,
        rawStatus: status,
        orderId: order.id,
        accountId: account.id,
      },
    });

    if (status === "SHIPPED" || status === "COMPLETED") {
      await prisma.shipment.create({
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
  console.log(`✅ 25 pesanan demo dibuat`);

  // 8. Stock Ledger: stok masuk awal, pengurangan karena pesanan, penyesuaian opname
  for (const variant of createdVariants) {
    const initialStock = variant.stock > 0 ? Math.floor(variant.stock * 1.2) : 0;
    await prisma.stockLedger.create({
      data: {
        id: crypto.randomUUID(),
        changeQty: initialStock,
        reason: "DEMO-STOK_MASUK_AWAL",
        referenceId: `DEMO-INIT-${variant.sku}`,
        stockAfter: variant.stock,
        variantId: variant.id,
        userId: reviewer.id,
        createdAt: thirtyDaysAgo,
      },
    });
  }

  // Pengurangan stok untuk setiap order item yang SHIPPED/COMPLETED
  const completedOrderItems = await prisma.orderItem.findMany({
    where: {
      order: { status: { in: ["SHIPPED", "COMPLETED"] }, orderNo: { startsWith: "DEMO-" } },
      variantId: { not: null },
    },
    include: { variant: true, order: true },
  });
  for (const item of completedOrderItems) {
    if (!item.variantId) continue;
    const variant = await prisma.productVariant.findUnique({ where: { id: item.variantId } });
    if (!variant) continue;
    await prisma.stockLedger.create({
      data: {
        id: crypto.randomUUID(),
        changeQty: -item.qty,
        reason: "DEMO-PENGURANGAN_PESANAN",
        referenceId: `${item.order.orderNo}-${item.id}`,
        stockAfter: Math.max(0, variant.stock - item.qty),
        variantId: item.variantId,
        userId: reviewer.id,
        createdAt: item.order.createTime ?? now,
      },
    });
  }

  // Penyesuaian stok opname untuk varian Merah S
  const redVariant = createdVariants.find((v) => v.sku === "DEMO-ORTUS-RED-S");
  if (redVariant) {
    await prisma.stockLedger.create({
      data: {
        id: crypto.randomUUID(),
        changeQty: 2,
        reason: "DEMO-OPNAME_PENYESUAIAN",
        referenceId: "DEMO-OPNAME-001",
        stockAfter: 5,
        variantId: redVariant.id,
        userId: reviewer.id,
        createdAt: new Date(Date.now() - 5 * 86_400_000),
      },
    });
  }
  console.log("✅ Stock Ledger (stok masuk, pengurangan, penyesuaian) selesai");

  // 9. Stock Opname dengan selisih (stok mismatch)
  const mismatchVariant = createdVariants.find((v) => v.sku === "DEMO-ORTUS-BLU-L");
  if (mismatchVariant) {
    await prisma.stockOpname.create({
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
              systemStock: mismatchVariant.stock,
              countedStock: mismatchVariant.stock - 2,
            },
          ],
        },
      },
    });
    console.log("✅ Stock Opname DEMO-OPNAME-001 dengan selisih 2 unit");
  }

  console.log("=== SEED SELESAI ===");
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
