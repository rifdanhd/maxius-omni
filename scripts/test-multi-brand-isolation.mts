/**
 * test-multi-brand-isolation.mts
 *
 * Uji isolasi dengan data riil (2 bisnis, baris > 0):
 * - Bisnis Prod: business-prod-isolated (isDemo: false) dengan data produk, varian, akun, order
 * - Bisnis Demo: business-demo-isolated (isDemo: true) dengan data produk, varian, akun, order
 * - User Reviewer/Demo hanya terikat ke Bisnis Demo
 *
 * Bukti yang diuji:
 * 1. List endpoint (/api/products, /api/accounts, /api/orders) hanya mengembalikan data demo
 * 2. Detail/tulis dengan ID bisnis produksi menghasilkan 403 atau 404
 * 3. Snapshot hitungan baris DB sebelum vs sesudah membuktikan data produksi tidak berubah
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const ORIGIN = BASE;

const PROD_BIZ_ID = `biz_prod_${Date.now()}`;
const DEMO_BIZ_ID = `biz_demo_${Date.now()}`;
const REVIEWER_USER = `rev_iso_${Date.now()}`;
const REVIEWER_PASS = "ReviewerPass2026!";

let reviewerUserId = "";
let prodProductId = "";
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`     ✅ ${label}`);
  } else {
    failCount++;
    console.error(`     ❌ ${label}${detail ? `: ${detail}` : ""}`);
  }
}
let prodAccountId = "";
let demoProductId = "";
let demoAccountId = "";

async function loginUser(username: string, pass: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ username, password: pass }),
  });
  const cookie = res.headers.get("set-cookie") || "";
  const match = cookie.match(/maxius_session=([^;]+)/);
  if (!match) throw new Error(`Login failed for ${username}, status ${res.status}`);
  return match[1];
}

async function api(path: string, token: string, method = "GET", body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: ORIGIN,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function getCounts() {
  const [prodProducts, prodVariants, prodAccounts, prodOrders, demoProducts, demoVariants, demoAccounts, demoOrders] = await Promise.all([
    prisma.masterProduct.count({ where: { businessId: PROD_BIZ_ID } }),
    prisma.productVariant.count({ where: { masterProduct: { businessId: PROD_BIZ_ID } } }),
    prisma.platformAccount.count({ where: { businessId: PROD_BIZ_ID } }),
    prisma.order.count({ where: { account: { businessId: PROD_BIZ_ID } } }),
    prisma.masterProduct.count({ where: { businessId: DEMO_BIZ_ID } }),
    prisma.productVariant.count({ where: { masterProduct: { businessId: DEMO_BIZ_ID } } }),
    prisma.platformAccount.count({ where: { businessId: DEMO_BIZ_ID } }),
    prisma.order.count({ where: { account: { businessId: DEMO_BIZ_ID } } }),
  ]);
  return {
    prod: { products: prodProducts, variants: prodVariants, accounts: prodAccounts, orders: prodOrders },
    demo: { products: demoProducts, variants: demoVariants, accounts: demoAccounts, orders: demoOrders },
  };
}

async function main() {
  console.log("\n========================================================");
  console.log("   UJI ISOLASI MULTI-BRAND & INTEGRITAS DATA PRODUKSI  ");
  console.log("========================================================\n");

  // 1. SETUP DUA BISNIS (PROD & DEMO) DENGAN DATA > 0
  console.log("1. Menyiapkan 2 Bisnis di Database:");
  await prisma.business.create({
    data: { id: PROD_BIZ_ID, name: "Production Brand Real", isDemo: false },
  });
  await prisma.business.create({
    data: { id: DEMO_BIZ_ID, name: "Demo Showcase Brand", isDemo: true },
  });

  // Data Bisnis Produksi (Real)
  const prodAcc = await prisma.platformAccount.create({
    data: { id: `acc_prod_${Date.now()}`, businessId: PROD_BIZ_ID, platform: "SHOPEE", label: "Shopee Toko Official Real" },
  });
  prodAccountId = prodAcc.id;

  const prodProd1 = await prisma.masterProduct.create({
    data: {
      businessId: PROD_BIZ_ID,
      name: "Produk Produksi Rahasia 1",
      productVariant: { create: [{ sku: "PROD-REAL-01", stock: 500 }] },
    },
  });
  const prodProd2 = await prisma.masterProduct.create({
    data: {
      businessId: PROD_BIZ_ID,
      name: "Produk Produksi Rahasia 2",
      productVariant: { create: [{ sku: "PROD-REAL-02", stock: 350 }] },
    },
  });
  prodProductId = prodProd1.id;

  await prisma.order.create({
    data: {
      id: `ord_prod_${Date.now()}`,
      orderNo: "ORD-REAL-001",
      accountId: prodAccountId,
      status: "COMPLETED",
      amount: 1500000,
    },
  });

  // Data Bisnis Demo
  const demoAcc = await prisma.platformAccount.create({
    data: { id: `acc_demo_${Date.now()}`, businessId: DEMO_BIZ_ID, platform: "TIKTOK_SHOP", label: "TikTok Demo Store" },
  });
  demoAccountId = demoAcc.id;

  const demoProd = await prisma.masterProduct.create({
    data: {
      businessId: DEMO_BIZ_ID,
      name: "Produk Demo Sample Kaos",
      productVariant: { create: [{ sku: "DEMO-SAMPLE-01", stock: 10 }] },
    },
  });
  demoProductId = demoProd.id;

  await prisma.order.create({
    data: {
      id: `ord_demo_${Date.now()}`,
      orderNo: "ORD-DEMO-999",
      accountId: demoAccountId,
      status: "TO_SHIP",
      amount: 45000,
    },
  });

  // Buat user reviewer yang HANYA memiliki akses ke DEMO_BIZ_ID
  reviewerUserId = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(REVIEWER_PASS, 10);
  await prisma.user.create({
    data: { id: reviewerUserId, username: REVIEWER_USER, passwordHash, canViewFullPii: false },
  });
  await prisma.userBusiness.create({
    data: { userId: reviewerUserId, businessId: DEMO_BIZ_ID, role: "reviewer" },
  });

  console.log(`  - Bisnis Produksi: ID = ${PROD_BIZ_ID} (isDemo = false)`);
  console.log(`  - Bisnis Demo    : ID = ${DEMO_BIZ_ID} (isDemo = true)`);
  console.log(`  - User Reviewer  : ${REVIEWER_USER} (terikat HANYA ke Bisnis Demo)\n`);

  // 2. SNAPSHOT SEBELUM PENGUJIAN
  console.log("2. Snapshot Hitungan Baris SEBELUM Panggilan API:");
  const beforeCounts = await getCounts();
  console.log("   [Bisnis Produksi (isDemo=false)]");
  console.log(`     - MasterProduct : ${beforeCounts.prod.products} baris`);
  console.log(`     - ProductVariant: ${beforeCounts.prod.variants} baris`);
  console.log(`     - PlatformAccount: ${beforeCounts.prod.accounts} baris`);
  console.log(`     - Order          : ${beforeCounts.prod.orders} baris`);
  console.log("   [Bisnis Demo (isDemo=true)]");
  console.log(`     - MasterProduct : ${beforeCounts.demo.products} baris`);
  console.log(`     - ProductVariant: ${beforeCounts.demo.variants} baris`);
  console.log(`     - PlatformAccount: ${beforeCounts.demo.accounts} baris`);
  console.log(`     - Order          : ${beforeCounts.demo.orders} baris\n`);

  // 3. LOGIN REVIEWER
  console.log("3. Login Reviewer:");
  const token = await loginUser(REVIEWER_USER, REVIEWER_PASS);
  console.log("   - Status: Login Sukses (Token Diperoleh)\n");

  // 4. PENGUJIAN LIST ENDPOINT
  console.log("4. Panggilan List Endpoint dengan Token Reviewer:");

  // 4a. Products
  const resProducts = await api("/api/products", token);
  const productsList = resProducts.data?.products || [];
  const prodNames = productsList.map((p: any) => p.name);
  console.log(`   GET /api/products -> Status ${resProducts.status}`);
  console.log(`     Total item diterima: ${productsList.length}`);
  console.log(`     Nama item: [${prodNames.join(", ")}]`);
  const containsProdReal = prodNames.some((n: string) => n.includes("Produksi Rahasia"));
  console.log(`     Data produksi bocor? ${containsProdReal ? "YA (GAGAL!)" : "TIDAK (LULUS)"}`);
  assert(resProducts.status === 200, `GET /api/products → ${resProducts.status} (expect 200)`);
  assert(!containsProdReal, "List produk tidak memuat data bisnis produksi");
  assert(
    prodNames.length === beforeCounts.demo.products,
    `Hanya ${beforeCounts.demo.products} produk demo yang terlihat (diterima ${prodNames.length})`
  );

  // 4b. Accounts
  const resAccounts = await api("/api/accounts", token);
  const accountsList = resAccounts.data?.accounts || [];
  console.log(`   GET /api/accounts -> Status ${resAccounts.status}`);
  console.log(`     Total toko diterima: ${accountsList.length}`);
  console.log(`     Label toko: [${accountsList.map((a: any) => a.label).join(", ")}]`);
  assert(resAccounts.status === 200, `GET /api/accounts → ${resAccounts.status} (expect 200)`);
  assert(
    !accountsList.some((a: any) => a.label.includes("Produksi")),
    "List toko tidak memuat akun bisnis produksi"
  );

  // 4c. Orders
  const resOrders = await api("/api/orders", token);
  const ordersList = resOrders.data?.orders || [];
  console.log(`   GET /api/orders -> Status ${resOrders.status}`);
  console.log(`     Total order diterima: ${ordersList.length}`);
  assert(resOrders.status === 200, `GET /api/orders → ${resOrders.status} (expect 200)`);
  assert(
    !ordersList.some((o: any) => o.orderNo === "ORD-REAL-001"),
    "List order tidak memuat order bisnis produksi"
  );

  // 5. PENGUJIAN AKSES KE ID BISNIS PRODUKSI
  console.log("\n5. Percobaan Akses/Tulis ke Resource Milik Bisnis Produksi:");

  // 5a. Update Produk Bisnis Produksi (detail route hanya PATCH)
  const resProdUpdate = await api(`/api/products/${prodProductId}`, token, "PATCH", { name: "Hacked Name" });
  console.log(`   PATCH /api/products/${prodProductId} (Tulis ke Prod)   -> Status: ${resProdUpdate.status} (Harus 403/404)`);
  assert([403, 404].includes(resProdUpdate.status), `PATCH produk bisnis produksi ditolak (${resProdUpdate.status})`);

  // 5b. Delete Store Bisnis Produksi
  const resStoreDelete = await api(`/api/stores/${prodAccountId}`, token, "DELETE");
  console.log(`   DELETE /api/stores/${prodAccountId} (Hapus Toko Prod) -> Status: ${resStoreDelete.status} (Harus 403/404)`);
  assert([403, 404].includes(resStoreDelete.status), `DELETE toko bisnis produksi ditolak (${resStoreDelete.status})`);

  // 5c. Switch Brand Ilegal ke Bisnis Produksi
  const resSwitch = await api("/api/auth/business", token, "POST", { businessId: PROD_BIZ_ID });
  console.log(`   POST /api/auth/business (Switch ke Prod ID)  -> Status: ${resSwitch.status} (Harus 403)`);
  assert(resSwitch.status === 403, `Switch brand ilegal ditolak (${resSwitch.status})`);

  // 6. SNAPSHOT SESUDAH PENGUJIAN
  console.log("\n6. Snapshot Hitungan Baris SESUDAH Panggilan API:");
  const afterCounts = await getCounts();
  console.log("   [Bisnis Produksi (isDemo=false)]");
  console.log(`     - MasterProduct : ${beforeCounts.prod.products} -> ${afterCounts.prod.products} (Perubahan: ${afterCounts.prod.products - beforeCounts.prod.products})`);
  console.log(`     - ProductVariant: ${beforeCounts.prod.variants} -> ${afterCounts.prod.variants} (Perubahan: ${afterCounts.prod.variants - beforeCounts.prod.variants})`);
  console.log(`     - PlatformAccount: ${beforeCounts.prod.accounts} -> ${afterCounts.prod.accounts} (Perubahan: ${afterCounts.prod.accounts - beforeCounts.prod.accounts})`);
  console.log(`     - Order          : ${beforeCounts.prod.orders} -> ${afterCounts.prod.orders} (Perubahan: ${afterCounts.prod.orders - beforeCounts.prod.orders})`);

  const prodUnchanged =
    beforeCounts.prod.products === afterCounts.prod.products &&
    beforeCounts.prod.variants === afterCounts.prod.variants &&
    beforeCounts.prod.accounts === afterCounts.prod.accounts &&
    beforeCounts.prod.orders === afterCounts.prod.orders;

  console.log(`\n   Kesimpulan Integritas Data Produksi: ${prodUnchanged ? "✅ TIDAK ADA PERUBAHAN SAMA SEKALI" : "❌ DATA BERUBAH!"}`);
  assert(prodUnchanged, "Snapshot data bisnis produksi tidak berubah");

  // 7. CLEANUP
  console.log("\n7. Membersihkan Data Uji...");
  await prisma.order.deleteMany({ where: { accountId: { in: [prodAccountId, demoAccountId] } } });
  await prisma.productVariant.deleteMany({ where: { masterProduct: { businessId: { in: [PROD_BIZ_ID, DEMO_BIZ_ID] } } } });
  await prisma.masterProduct.deleteMany({ where: { businessId: { in: [PROD_BIZ_ID, DEMO_BIZ_ID] } } });
  await prisma.platformAccount.deleteMany({ where: { id: { in: [prodAccountId, demoAccountId] } } });
  await prisma.userBusiness.deleteMany({ where: { userId: reviewerUserId } });
  await prisma.user.delete({ where: { id: reviewerUserId } });
  await prisma.business.deleteMany({ where: { id: { in: [PROD_BIZ_ID, DEMO_BIZ_ID] } } });
  console.log("   Data uji berhasil dibersihkan.\n");

  console.log(`${"═".repeat(50)}`);
  console.log(`  ✅ Passed: ${passCount}  |  ❌ Failed: ${failCount}`);
  console.log(`${"═".repeat(50)}\n`);

  await prisma.$disconnect();
  if (failCount > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("Test failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
