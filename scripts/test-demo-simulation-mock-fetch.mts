/**
 * test-demo-simulation-mock-fetch.mts
 *
 * Menguji guard simulasi untuk akun dengan business.isDemo === true.
 * Memasang mock/spy pada globalThis.fetch untuk menghitung jumlah panggilan keluar
 * ke endpoint resmi TikTok Shop dan Shopee.
 *
 * Bukti yang dihasilkan:
 * 1. Panggilan API untuk Akun Demo menghasilkan persis 0 panggilan HTTP (fetch calls = 0).
 * 2. Operasi tetap mengembalikan response terstruktur sukses (simulasi transparan).
 * 3. Panggilan API untuk Akun Non-Demo / Produksi memicu fetch keluar (fetch calls > 0).
 */
import { PrismaClient } from "@prisma/client";

if (!process.env.SHOPEE_PARTNER_KEY) {
  process.env.SHOPEE_PARTNER_KEY = "shpk6b417272715175674768757846507471464d4749675a6b744274797a7046";
  process.env.SHOPEE_PARTNER_ID = "2045228";
}

const prisma = new PrismaClient();

const DEMO_BIZ_ID = `demo_sim_biz_${Date.now()}`;
const REAL_BIZ_ID = `real_sim_biz_${Date.now()}`;

const DEMO_ACC_SHOPEE = `acc_shopee_demo_${Date.now()}`;
const DEMO_ACC_TIKTOK = `acc_tiktok_demo_${Date.now()}`;

const REAL_ACC_SHOPEE = `acc_shopee_real_${Date.now()}`;
const REAL_ACC_TIKTOK = `acc_tiktok_real_${Date.now()}`;

interface CallLog {
  url: string;
  method: string;
}

const recordedCalls: CallLog[] = [];
const originalFetch = globalThis.fetch;

function setupMockFetch() {
  recordedCalls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method || "GET";

    recordedCalls.push({ url, method });

    // Mock response standar untuk non-demo agar tidak benar-benar menghubungi server luar saat pengujian
    return new Response(JSON.stringify({ response: {}, code: 0, data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

async function main() {
  console.log("\n========================================================");
  console.log("   UJI GUARD SIMULASI AKUN DEMO (MOCK FETCH VERIFIKASI)  ");
  console.log("========================================================\n");

  // 1. SETUP DATABASE
  console.log("1. Menyiapkan Akun Demo dan Akun Produksi di DB...");
  await prisma.business.create({
    data: { id: DEMO_BIZ_ID, name: "Bisnis Demo Showcase", isDemo: true },
  });
  await prisma.business.create({
    data: { id: REAL_BIZ_ID, name: "Bisnis Produksi Asli", isDemo: false },
  });

  const demoShopId = `demo_shop_${Date.now()}`;
  const demoCipher = `demo_ciph_${Date.now()}`;
  const realShopId = `real_shop_${Date.now()}`;
  const realCipher = `real_ciph_${Date.now()}`;

  // Akun Demo Shopee & TikTok
  await prisma.platformAccount.create({
    data: {
      id: DEMO_ACC_SHOPEE,
      businessId: DEMO_BIZ_ID,
      platform: "SHOPEE",
      label: "Demo Shopee Store",
      externalShopId: demoShopId,
      accessToken: "demo_shopee_token_xyz",
    },
  });
  await prisma.platformAccount.create({
    data: {
      id: DEMO_ACC_TIKTOK,
      businessId: DEMO_BIZ_ID,
      platform: "TIKTOK_SHOP",
      label: "Demo TikTok Store",
      shopCipher: demoCipher,
      accessToken: "demo_tiktok_token_xyz",
    },
  });

  // Akun Real Shopee & TikTok
  await prisma.platformAccount.create({
    data: {
      id: REAL_ACC_SHOPEE,
      businessId: REAL_BIZ_ID,
      platform: "SHOPEE",
      label: "Real Shopee Store",
      externalShopId: realShopId,
      accessToken: "real_shopee_token_123",
    },
  });
  await prisma.platformAccount.create({
    data: {
      id: REAL_ACC_TIKTOK,
      businessId: REAL_BIZ_ID,
      platform: "TIKTOK_SHOP",
      label: "Real TikTok Store",
      shopCipher: realCipher,
      accessToken: "real_tiktok_token_123",
    },
  });

  console.log("   Akun berhasil disiapkan di database.\n");

  // Load modules
  const { clearDemoCache } = await import("../lib/services/demo-guard.service");
  clearDemoCache();

  const { getOrderDetail: getShopeeOrder, getOrderList: getShopeeOrderList } = await import("../lib/integrations/shopee");
  const { getOrders: getTikTokOrders, searchProducts: searchTikTokProducts } = await import("../lib/integrations/tiktokShop");

  setupMockFetch();

  // 2. UJI AKUN DEMO SHOPEE
  console.log("2. Memanggil Operasi Shopee untuk Akun DEMO (isDemo = true):");
  const initialCallCount = recordedCalls.length;
  
  const nowSec = Math.floor(Date.now() / 1000);
  const shopeeListRes = await getShopeeOrderList("demo_shopee_token_xyz", demoShopId, { createTimeFrom: nowSec - 86400, createTimeTo: nowSec });
  const shopeeDetailRes = await getShopeeOrder("demo_shopee_token_xyz", demoShopId, ["ORD-DEMO-001"]);

  const shopeeDemoCalls = recordedCalls.length - initialCallCount;
  console.log(`   - Output getOrderList   : ${JSON.stringify(shopeeListRes)}`);
  console.log(`   - Output getOrderDetail: ${JSON.stringify(shopeeDetailRes)}`);
  console.log(`   - Panggilan fetch keluar ke server Shopee: ${shopeeDemoCalls} KALI`);
  console.log(`   - Status Guard: ${shopeeDemoCalls === 0 ? "✅ LULUS (0 panggilan keluar)" : "❌ GAGAL (bocor panggilan)"}\n`);

  // 3. UJI AKUN DEMO TIKTOK
  console.log("3. Memanggil Operasi TikTok Shop untuk Akun DEMO (isDemo = true):");
  const countBeforeTikTok = recordedCalls.length;

  const tiktokOrdersRes = await getTikTokOrders("demo_tiktok_token_xyz", demoCipher, { createTimeGe: nowSec - 86400, createTimeLt: nowSec });
  const tiktokProductsRes = await searchTikTokProducts("demo_tiktok_token_xyz", demoCipher, { pageSize: 10 });

  const tiktokDemoCalls = recordedCalls.length - countBeforeTikTok;
  console.log(`   - Output getOrders      : ${JSON.stringify(tiktokOrdersRes)}`);
  console.log(`   - Output searchProducts : ${JSON.stringify(tiktokProductsRes)}`);
  console.log(`   - Panggilan fetch keluar ke server TikTok: ${tiktokDemoCalls} KALI`);
  console.log(`   - Status Guard: ${tiktokDemoCalls === 0 ? "✅ LULUS (0 panggilan keluar)" : "❌ GAGAL (bocor panggilan)"}\n`);

  // 4. KONTROL VALIDASI: PANGGILAN UNTUK AKUN PRODUKSI / NON-DEMO
  console.log("4. Kontrol Pembanding: Memanggil Operasi untuk Akun PRODUKSI (isDemo = false):");
  const countBeforeReal = recordedCalls.length;

  await getShopeeOrderList("real_shopee_token_123", realShopId, { createTimeFrom: nowSec - 86400, createTimeTo: nowSec });
  await getTikTokOrders("real_tiktok_token_123", realCipher, { createTimeGe: nowSec - 86400, createTimeLt: nowSec });

  const realCalls = recordedCalls.length - countBeforeReal;
  console.log(`   - Panggilan fetch keluar untuk akun produksi: ${realCalls} KALI (diteruskan ke network)`);
  console.log(`   - Log URL panggilan produksi:`);
  for (const c of recordedCalls.slice(countBeforeReal)) {
    console.log(`       [${c.method}] ${c.url.substring(0, 70)}...`);
  }

  // 5. REKAPITULASI
  console.log("\n========================================================");
  console.log("   REKAPITULASI JUMLAH PANGGILAN HTTP EXTERNAL (FETCH) ");
  console.log("========================================================");
  console.log(`   - Akun Demo (Shopee + TikTok)   : ${shopeeDemoCalls + tiktokDemoCalls} KALI PANGGILAN KELUAR`);
  console.log(`   - Akun Produksi (Shopee + TikTok): ${realCalls} KALI PANGGILAN KELUAR`);
  console.log("========================================================");

  const testPassed = (shopeeDemoCalls + tiktokDemoCalls === 0) && (realCalls > 0);
  console.log(`   Hasil Akhir: ${testPassed ? "✅ LULUS 100%" : "❌ GAGAL"}\n`);

  restoreFetch();

  // 6. CLEANUP
  await prisma.platformAccount.deleteMany({ where: { id: { in: [DEMO_ACC_SHOPEE, DEMO_ACC_TIKTOK, REAL_ACC_SHOPEE, REAL_ACC_TIKTOK] } } });
  await prisma.business.deleteMany({ where: { id: { in: [DEMO_BIZ_ID, REAL_BIZ_ID] } } });
  await prisma.$disconnect();

  if (!testPassed) process.exit(1);
}

main().catch(async (e) => {
  restoreFetch();
  console.error("Test error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
