/**
 * seed-reviewer-demo.mts
 *
 * Seed TERPISAH untuk akun reviewer pihak ketiga + bisnis demo "[Maxius Demo]".
 *
 * Yang dibuat:
 *   1. Business "[Maxius Demo]" (isDemo: true) — TIDAK menyentuh 5 brand produksi
 *   2. InventorySetting untuk bisnis demo
 *   3. PlatformAccount TikTok Shop demo (tanpa accessToken = guard demo aktif)
 *   4. 15 MasterProduct kaos kaki dengan varian ukuran (S/M/L/XL), stok wajar
 *   5. ProductMapping (SKU terhubung ke toko demo)
 *   6. 18 Order dengan berbagai status (UNPAID, AWAITING_SHIPMENT, IN_TRANSIT,
 *      DELIVERED, COMPLETED, CANCELLED, ON_HOLD)
 *   7. User "reviewer" (canViewFullPii: false, password hash statis)
 *   8. UserBusiness: reviewer hanya ke "[Maxius Demo]", bukan 5 brand produksi
 *
 * Keamanan:
 *   - Password reviewer: hash bcrypt cost 12, hardcoded — TIDAK dicetak ke terminal
 *   - canViewFullPii: false → data pembeli selalu tersamar
 *   - isDemo: true → guard demo mencegah panggilan API marketplace asli
 *
 * Idempoten: aman dijalankan berulang — upsert semua, tidak menghapus data ada.
 *
 * USAGE:
 *   npx tsx --env-file=.env scripts/seed-reviewer-demo.mts
 *   npx tsx --env-file=.env scripts/seed-reviewer-demo.mts --dry-run
 */

import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();
const isDryRun = process.argv.includes("--dry-run");

// ── Konstanta ID deterministik (stabil lintas run) ──────────────────────────
const DEMO_BIZ_ID = "business-maxius-demo";
const DEMO_TIKTOK_ACC_ID = "acc-demo-tiktok-maxius";
const DEMO_INV_SETTING_ID = "inventory-demo-maxius";
const REVIEWER_USERNAME = "reviewer";

// bcrypt hash dari "MaxiusReviewer2026" (cost 12)
// Password TIDAK dicetak ke terminal saat runtime — lihat dokumentasi internal
const REVIEWER_PASSWORD_HASH =
  "$2b$12$dPpTxPlbL8jMMIw2QmBHze/s4isdPwN0BwoZ382i8Xv1XZV3gzvc2";

// ── Data produk kaos kaki (15 SKU) ──────────────────────────────────────────
const PRODUCTS = [
  { name: "Kaos Kaki Ankle Sport Unisex", category: "Kaos Kaki", skuPrefix: "KK-ANKLE-SPORT" },
  { name: "Kaos Kaki Crew Casual Putih", category: "Kaos Kaki", skuPrefix: "KK-CREW-WHT" },
  { name: "Kaos Kaki Crew Casual Hitam", category: "Kaos Kaki", skuPrefix: "KK-CREW-BLK" },
  { name: "Kaos Kaki Anti Slip Gym", category: "Kaos Kaki", skuPrefix: "KK-ANTISL-GYM" },
  { name: "Kaos Kaki Lari Compression Biru", category: "Kaos Kaki", skuPrefix: "KK-COMP-BLUE" },
  { name: "Kaos Kaki Ankle Fashion Warna-Warni", category: "Kaos Kaki", skuPrefix: "KK-ANK-CLR" },
  { name: "Kaos Kaki Panjang Hiking Trail", category: "Kaos Kaki", skuPrefix: "KK-LONG-HIKE" },
  { name: "Kaos Kaki Pendek No-Show Wanita", category: "Kaos Kaki", skuPrefix: "KK-NOSH-WMN" },
  { name: "Kaos Kaki Bola Futsal Pro", category: "Kaos Kaki", skuPrefix: "KK-FUTSAL-PRO" },
  { name: "Kaos Kaki Lucu Print Kucing", category: "Kaos Kaki", skuPrefix: "KK-LUCU-CAT" },
  { name: "Kaos Kaki Bambu Eco Anti Bau", category: "Kaos Kaki", skuPrefix: "KK-BAMBU-ECO" },
  { name: "Kaos Kaki Thermal Winter", category: "Kaos Kaki", skuPrefix: "KK-THERMAL" },
  { name: "Kaos Kaki Anak TK-SD Motif", category: "Kaos Kaki Anak", skuPrefix: "KK-ANAK-MOTIF" },
  { name: "Kaos Kaki Senam Aerobic Grip", category: "Kaos Kaki", skuPrefix: "KK-SENAM-GRIP" },
  { name: "Kaos Kaki Business Formal Abu", category: "Kaos Kaki", skuPrefix: "KK-FORMAL-GRY" },
];

const SIZES = ["S", "M", "L", "XL"];
const STOCK_BY_SIZE: Record<string, number> = { S: 45, M: 80, L: 65, XL: 30 };
const PRICE_BY_SIZE: Record<string, number> = { S: 18500, M: 19500, L: 20500, XL: 22000 };

const ORDER_STATUSES = [
  "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED",
  "DELIVERED", "DELIVERED", "DELIVERED",
  "IN_TRANSIT", "IN_TRANSIT", "IN_TRANSIT",
  "AWAITING_SHIPMENT", "AWAITING_SHIPMENT",
  "AWAITING_COLLECTION",
  "UNPAID",
  "ON_HOLD",
  "CANCELLED", "CANCELLED",
  "COMPLETED",
];

const BUYER_NAMES = [
  "Budi Santoso", "Dewi Rahayu", "Eko Prasetyo", "Fitri Handayani",
  "Gunawan Wibowo", "Hani Kurniawati", "Irwan Mulyadi", "Junita Sari",
  "Kasim Arifin", "Lestari Wahyu", "Muhamad Rizki", "Nadia Permata",
  "Oded Fauzi", "Putri Laksmi", "Qodir Rahman", "Rini Susanti",
  "Sapto Nugroho", "Tari Anggraini",
];

async function main() {
  console.log("\n════════════════════════════════════════════════════════");
  console.log("   SEED REVIEWER DEMO — [Maxius Demo] Business Setup  ");
  console.log("════════════════════════════════════════════════════════");
  if (isDryRun) {
    console.log("\n⚠️  MODE DRY-RUN AKTIF: Tidak ada data yang diubah di database.\n");
  }
  console.log("");

  // ── 1. Business [Maxius Demo] ─────────────────────────────────────────────
  console.log("1. Business [Maxius Demo]:");
  const existingBiz = await prisma.business.findUnique({ where: { id: DEMO_BIZ_ID } });
  if (existingBiz) {
    console.log(`   - [EXISTING] id="${DEMO_BIZ_ID}" name="${existingBiz.name}" isDemo=${existingBiz.isDemo}`);
    if (!isDryRun && (!existingBiz.isDemo || existingBiz.name !== "[Maxius Demo]")) {
      await prisma.business.update({
        where: { id: DEMO_BIZ_ID },
        data: { name: "[Maxius Demo]", isDemo: true },
      });
      console.log(`   - [UPDATED] name → "[Maxius Demo]", isDemo → true`);
    }
  } else {
    console.log(`   - [CREATE]  id="${DEMO_BIZ_ID}" name="[Maxius Demo]" isDemo=true`);
    if (!isDryRun) {
      await prisma.business.create({
        data: { id: DEMO_BIZ_ID, name: "[Maxius Demo]", isDemo: true },
      });
    }
  }

  // ── 2. InventorySetting untuk bisnis demo ─────────────────────────────────
  console.log("\n2. InventorySetting bisnis demo:");
  const existingInv = await prisma.inventorySetting.findUnique({ where: { id: DEMO_INV_SETTING_ID } });
  if (existingInv) {
    console.log(`   - [EXISTING] InventorySetting id="${DEMO_INV_SETTING_ID}"`);
  } else {
    console.log(`   - [CREATE]  InventorySetting id="${DEMO_INV_SETTING_ID}"`);
    if (!isDryRun) {
      await prisma.inventorySetting.create({
        data: {
          id: DEMO_INV_SETTING_ID,
          businessId: DEMO_BIZ_ID,
          lowStockDefaultThreshold: 10,
          notifyLowStock: true,
        },
      });
    }
  }

  // ── 3. PlatformAccount TikTok Shop Demo ──────────────────────────────────
  console.log("\n3. PlatformAccount TikTok Shop Demo:");
  const existingAcc = await prisma.platformAccount.findUnique({ where: { id: DEMO_TIKTOK_ACC_ID } });
  if (existingAcc) {
    console.log(`   - [EXISTING] id="${DEMO_TIKTOK_ACC_ID}" label="${existingAcc.label}" accessToken=${existingAcc.accessToken ? "set" : "null (demo guard aktif ✅)"}`);
  } else {
    console.log(`   - [CREATE]  id="${DEMO_TIKTOK_ACC_ID}" platform=TIKTOK_SHOP (tanpa accessToken = demo guard aktif)`);
    if (!isDryRun) {
      await prisma.platformAccount.create({
        data: {
          id: DEMO_TIKTOK_ACC_ID,
          businessId: DEMO_BIZ_ID,
          platform: "TIKTOK_SHOP",
          label: "TikTok Shop Demo [Maxius Demo]",
          externalShopId: "demo-shop-maxius-9999",
          accessToken: null,
          refreshToken: null,
        },
      });
    }
  }

  // ── 4. Produk & Varian ────────────────────────────────────────────────────
  console.log(`\n4. Produk & Varian (${PRODUCTS.length} produk × ${SIZES.length} ukuran):`);
  const productIds: string[] = [];
  const variantMap: Record<string, { id: string; sku: string }[]> = {};

  for (const prod of PRODUCTS) {
    const existing = await prisma.masterProduct.findFirst({
      where: { businessId: DEMO_BIZ_ID, name: prod.name },
      include: { productVariant: true },
    });

    if (existing) {
      console.log(`   - [EXISTING] "${prod.name}" id="${existing.id}" (${existing.productVariant.length} varian)`);
      productIds.push(existing.id);
      variantMap[existing.id] = existing.productVariant.map((v) => ({ id: v.id, sku: v.sku }));
    } else {
      console.log(`   - [CREATE]  "${prod.name}" → ${SIZES.length} varian`);
      if (!isDryRun) {
        const created = await prisma.masterProduct.create({
          data: {
            businessId: DEMO_BIZ_ID,
            name: prod.name,
            category: prod.category,
            status: "active",
            isActive: true,
            productVariant: {
              create: SIZES.map((size) => ({
                sku: `${prod.skuPrefix}-${size}`,
                name: `${prod.name} - ${size}`,
                stock: STOCK_BY_SIZE[size],
                safetyStock: 5,
                price: PRICE_BY_SIZE[size],
              })),
            },
          },
          include: { productVariant: true },
        });
        productIds.push(created.id);
        variantMap[created.id] = created.productVariant.map((v) => ({ id: v.id, sku: v.sku }));
      } else {
        const pid = `dry-run-${prod.skuPrefix}`;
        productIds.push(pid);
        variantMap[pid] = SIZES.map((size) => ({
          id: `dry-var-${prod.skuPrefix}-${size}`,
          sku: `${prod.skuPrefix}-${size}`,
        }));
      }
    }
  }

  // ── 5. ProductMapping (5 produk pertama → TikTok Shop Demo) ──────────────
  console.log("\n5. ProductMapping (5 produk pertama → TikTok Shop Demo):");
  for (let i = 0; i < Math.min(5, productIds.length); i++) {
    const pid = productIds[i];
    const variants = variantMap[pid] ?? [];
    for (const variant of variants) {
      if (isDryRun) {
        console.log(`   - [DRY-RUN] Mapping SKU "${variant.sku}"`);
        continue;
      }
      const existing = await prisma.productMapping.findUnique({
        where: { accountId_channelSku: { accountId: DEMO_TIKTOK_ACC_ID, channelSku: variant.sku } },
      });
      if (!existing) {
        const sizeKey = variant.sku.split("-").at(-1) ?? "M";
        await prisma.productMapping.create({
          data: {
            accountId: DEMO_TIKTOK_ACC_ID,
            channelSku: variant.sku,
            variantId: variant.id,
            platformProductId: `demo-prod-${i + 1}`,
            platformStatus: "ACTIVATE",
            platformStock: STOCK_BY_SIZE[sizeKey] ?? 50,
            platformTitle: PRODUCTS[i].name,
            price: PRICE_BY_SIZE[sizeKey] ?? 19500,
            updatedAt: new Date(),
            lastSyncedAt: new Date(),
          },
        });
        console.log(`   - [CREATE]  Mapping SKU "${variant.sku}"`);
      } else {
        console.log(`   - [EXISTING] Mapping SKU "${variant.sku}"`);
      }
    }
  }

  // ── 6. Orders (18 pesanan berbagai status) ────────────────────────────────
  console.log(`\n6. Orders (${ORDER_STATUSES.length} pesanan dengan berbagai status):`);
  let createdOrders = 0;
  let skippedOrders = 0;
  const now = Date.now();

  for (let i = 0; i < ORDER_STATUSES.length; i++) {
    const orderId = `ord-demo-maxius-${String(i + 1).padStart(3, "0")}`;
    const orderNo = `DEMO-${1000 + i + 1}`;
    const status = ORDER_STATUSES[i];

    const existingOrder = await prisma.order.findUnique({ where: { id: orderId } });
    if (existingOrder) {
      skippedOrders++;
      continue;
    }

    if (!isDryRun) {
      const pid = productIds[i % Math.max(productIds.length, 1)];
      const variants = variantMap[pid] ?? [];
      const variant = variants[i % Math.max(variants.length, 1)];
      const sizeKey = variant?.sku.split("-").at(-1) ?? "M";
      const daysAgo = i * 3 + 1; // pesanan tersebar dalam 54 hari terakhir
      const createTime = new Date(now - daysAgo * 86400000);
      const qty = (i % 3) + 1;

      await prisma.order.create({
        data: {
          id: orderId,
          orderNo,
          status,
          accountId: DEMO_TIKTOK_ACC_ID,
          amount: (PRICE_BY_SIZE[sizeKey] ?? 19500) * qty,
          currency: "IDR",
          createTime,
          buyerName: BUYER_NAMES[i % BUYER_NAMES.length],
          buyerEmail: null,
          recipientName: BUYER_NAMES[i % BUYER_NAMES.length],
          recipientPhone: null,
          recipientAddress: null,
          paymentMethodName: i % 3 === 0 ? "COD" : "Transfer Bank",
          isCod: i % 3 === 0,
          ...(variant
            ? {
                items: {
                  create: [
                    {
                      id: `item-${orderId}`,
                      qty,
                      price: PRICE_BY_SIZE[sizeKey] ?? 19500,
                      channelSku: variant.sku,
                      variantId: variant.id,
                      productName: PRODUCTS[i % PRODUCTS.length].name,
                      skuName: variant.sku,
                    },
                  ],
                },
              }
            : {}),
        },
      });
      createdOrders++;
    } else {
      console.log(`   - [DRY-RUN] Order "${orderNo}" status=${status}`);
      createdOrders++;
    }
  }
  console.log(`   - Dibuat: ${createdOrders} order baru`);
  console.log(`   - Dilewati (sudah ada): ${skippedOrders} order`);

  // ── 7. User "reviewer" ────────────────────────────────────────────────────
  console.log("\n7. User 'reviewer':");
  const existingUser = await prisma.user.findUnique({ where: { username: REVIEWER_USERNAME } });
  let reviewerUserId: string;

  if (existingUser) {
    reviewerUserId = existingUser.id;
    console.log(`   - [EXISTING] id="${existingUser.id}" canViewFullPii=${existingUser.canViewFullPii}`);
    if (existingUser.canViewFullPii && !isDryRun) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { canViewFullPii: false },
      });
      console.log(`   - [FIXED]   canViewFullPii → false`);
    }
  } else {
    reviewerUserId = crypto.randomUUID();
    console.log(`   - [CREATE]  id="${reviewerUserId}" username="reviewer" canViewFullPii=false`);
    console.log(`   - Password : hash bcrypt cost-12 hardcoded (tidak dicetak ke terminal)`);
    if (!isDryRun) {
      await prisma.user.create({
        data: {
          id: reviewerUserId,
          username: REVIEWER_USERNAME,
          passwordHash: REVIEWER_PASSWORD_HASH,
          canViewFullPii: false,
        },
      });
    }
  }

  // ── 8. UserBusiness: reviewer → [Maxius Demo] SAJA ───────────────────────
  console.log("\n8. UserBusiness (reviewer hanya ke [Maxius Demo]):");
  if (!isDryRun) {
    const existingUb = await prisma.userBusiness.findUnique({
      where: { userId_businessId: { userId: reviewerUserId, businessId: DEMO_BIZ_ID } },
    });
    if (existingUb) {
      console.log(`   - [EXISTING] role="${existingUb.role}"`);
      if (existingUb.role !== "reviewer") {
        await prisma.userBusiness.update({
          where: { userId_businessId: { userId: reviewerUserId, businessId: DEMO_BIZ_ID } },
          data: { role: "reviewer" },
        });
        console.log(`   - [FIXED]   role → "reviewer"`);
      }
    } else {
      await prisma.userBusiness.create({
        data: { userId: reviewerUserId, businessId: DEMO_BIZ_ID, role: "reviewer" },
      });
      console.log(`   - [CREATE]  userId="${reviewerUserId}" businessId="${DEMO_BIZ_ID}" role="reviewer"`);
    }

    // Guard: pastikan reviewer TIDAK punya akses ke 5 brand produksi
    console.log("\n   Guard: Pastikan reviewer tidak terhubung ke brand produksi...");
    const prodBrandIds = [
      "business-default", "business-raxen", "business-kaos-kaki-sport",
      "business-den-sport", "business-getobdg",
    ];
    const illegalLinks = await prisma.userBusiness.findMany({
      where: { userId: reviewerUserId, businessId: { in: prodBrandIds } },
    });
    if (illegalLinks.length > 0) {
      console.log(`   ⚠️  Ditemukan ${illegalLinks.length} link ilegal ke brand produksi — menghapus...`);
      await prisma.userBusiness.deleteMany({
        where: { userId: reviewerUserId, businessId: { in: prodBrandIds } },
      });
      console.log(`   ✅ Link ilegal dihapus`);
    } else {
      console.log(`   ✅ Reviewer tidak terhubung ke brand produksi mana pun`);
    }
  } else {
    console.log(`   - [DRY-RUN] UserBusiness reviewer → "${DEMO_BIZ_ID}" role="reviewer" akan dibuat`);
  }

  // ── Ringkasan akhir ───────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════════════════");
  if (isDryRun) {
    console.log("  ✅ DRY-RUN SELESAI — 0 baris database diubah");
  } else {
    const [products, variants, orders, mappings, userBiz] = await Promise.all([
      prisma.masterProduct.count({ where: { businessId: DEMO_BIZ_ID } }),
      prisma.productVariant.count({ where: { masterProduct: { businessId: DEMO_BIZ_ID } } }),
      prisma.order.count({ where: { account: { businessId: DEMO_BIZ_ID } } }),
      prisma.productMapping.count({ where: { accountId: DEMO_TIKTOK_ACC_ID } }),
      prisma.userBusiness.count({ where: { businessId: DEMO_BIZ_ID } }),
    ]);
    console.log(`  Ringkasan [Maxius Demo]:`);
    console.log(`    Produk      : ${products} MasterProduct`);
    console.log(`    Varian      : ${variants} ProductVariant`);
    console.log(`    Pesanan     : ${orders} Order`);
    console.log(`    Mapping SKU : ${mappings} ProductMapping (TikTok Demo)`);
    console.log(`    UserBusiness: ${userBiz} link`);
    console.log(`\n  ✅ SEED SELESAI`);
    console.log(`  Username : reviewer`);
    console.log(`  Password : [lihat dokumentasi internal — tidak dicetak ke terminal]`);
    console.log(`  Role     : reviewer (read-only)`);
    console.log(`  Akses    : [Maxius Demo] SAJA`);
  }
  console.log("════════════════════════════════════════════════════════\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Seed gagal:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
