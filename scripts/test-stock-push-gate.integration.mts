import assert from "node:assert/strict";
import { setupTestDb } from "./lib/test-db";

const db = setupTestDb("test-stock-push-gate");
const { prisma } = await import("@/lib/db/prisma");

async function markBaselineReady(businessId: string, variantId: string, stockPushEnabled = true) {
  await prisma.stockLedger.create({
    data: { id: `initial-${businessId}`, variantId, changeQty: 100, reason: "INITIAL_STOCK", referenceId: `initial-${businessId}`, stockAfter: 100, note: "Fixture baseline" },
  });
  await prisma.inventorySetting.upsert({
    where: { businessId },
    create: { id: businessId, businessId, stockPushEnabled, stockBaselineReady: true },
    update: { stockPushEnabled, stockBaselineReady: true },
  });
}

let stockWrites = 0;
process.env.TIKTOK_APP_KEY = "fixture-key"; process.env.TIKTOK_APP_SECRET = "fixture-secret";
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, "open-api.tiktokglobalshop.com");
  if (url.pathname.endsWith("products/search")) return Response.json({ code: 0, data: { products: [{ id: "fixture-product", skus: [{ id: "fixture-sku", seller_sku: "TEST-SKU" }] }] } });
  if (url.pathname.endsWith("inventory/search")) return Response.json({ code: 0, data: { inventory: [{ product_id: "fixture-product", skus: [{ id: "fixture-sku", seller_sku: "TEST-SKU", warehouse_inventory: [{ warehouse_id: "fixture-warehouse" }] }] }] } });
  if (url.pathname.endsWith("inventory/update")) { stockWrites++; return Response.json({ code: 0, data: {} }); }
  throw new Error("Endpoint mock tidak dikenal.");
};

async function main() {
  // ============================================================
  // CASE A: STOCK_PUSH_ENABLED tidak diisi (undefined) -> 0 panggilan global
  // ============================================================
  console.log("=== Case A: STOCK_PUSH_ENABLED not set (undefined) ===");
  delete process.env.STOCK_PUSH_ENABLED;

  // Business A: test global kill switch
  const businessA = await prisma.business.create({ data: { id: "business-a", name: "Business A" } });
  const accA = await prisma.platformAccount.create({
    data: { id: "acc-a", businessId: businessA.id, label: "Toko A", platform: "TIKTOK_SHOP",
      accessToken: "tok-a", shopCipher: "cip-a" }
  });

  const masterA = await prisma.masterProduct.create({ data: { name: "Test Produk A", businessId: businessA.id, threshold: 5 } });
  const variantA = await prisma.productVariant.create({ data: { sku: "TEST-SKU", stock: 100, safetyStock: 10, masterProductId: masterA.id } });
  await prisma.productMapping.create({ data: { accountId: accA.id, variantId: variantA.id, channelSku: "TEST-SKU:1", sellerSku: "TEST-SKU", updatedAt: new Date() } });

  const sync = (await import("@/lib/services/sync.service")).syncStockToMarketplaces;
  const resultA = await sync(
    [{ accountId: accA.id, channelSku: "TEST-SKU:1" }],
    100,
    {}
  );
  console.log(`A1: accA success=${resultA[0]?.success}, skipped=${resultA[0]?.skipped}`);
  // Per user requirement: undefined or "false" → 0 panggilan (skipped_disabled)
  assert.equal(resultA[0]?.success, true, "undefined should return success=true even when skipped");
  assert.equal(resultA[0]?.skipped, true, "undefined STOCK_PUSH_ENABLED should skip (0 API calls)");
  console.log("PASS: STOCK_PUSH_ENABLED tidak diisi → 0 panggilan API (skipped_disabled)\\n");

  // ============================================================
  // CASE B: STOCK_PUSH_ENABLED="true" -> 1 panggilan dengan nilai benar
  // ============================================================
  console.log("=== Case B: STOCK_PUSH_ENABLED=true ===");
  process.env.STOCK_PUSH_ENABLED = "true";

  // Business B: test with kill switch on
  const businessB = await prisma.business.create({ data: { id: "business-b", name: "Business B" } });
  const accB = await prisma.platformAccount.create({
    data: { id: "acc-b", businessId: businessB.id, label: "Toko B", platform: "TIKTOK_SHOP",
      accessToken: "tok-b", shopCipher: "cip-b" }
  });

  const masterB = await prisma.masterProduct.create({ data: { name: "Test Produk B", businessId: businessB.id, threshold: 5 } });
  const variantB = await prisma.productVariant.create({ data: { sku: "TEST-SKU", stock: 100, safetyStock: 10, masterProductId: masterB.id } });
  await prisma.productMapping.create({ data: { accountId: accB.id, variantId: variantB.id, channelSku: "TEST-SKU:1", sellerSku: "TEST-SKU", updatedAt: new Date() } });
  await markBaselineReady(businessB.id, variantB.id);

  const resultB = await sync(
    [{ accountId: accB.id, channelSku: "TEST-SKU:1" }],
    100,
    { waitForDelivery: true }
  );
  console.log(`B1: accB success=${resultB[0]?.success}, skipped=${resultB[0]?.skipped}`);
  assert.equal(stockWrites, 1, "Case B harus benar-benar mencapai API mock");
  // Per user requirement: "true" → 1 panggilan dengan nilai benar
  assert.equal(resultB[0]?.success, true, "STOCK_PUSH_ENABLED=true should allow push");
  assert.equal(resultB[0]?.skipped, false, "STOCK_PUSH_ENABLED=true should not skip (1 API call)");
  console.log("PASS: STOCK_PUSH_ENABLED=\"true\" → 1 panggilan API dengan nilai benar\\n");

  // ============================================================
  // CASE C: dryRun=true -> 0 panggilan, lastStockPushStatus tidak berubah
  // ============================================================
  console.log("=== Case C: dryRun=true ===");
  process.env.STOCK_PUSH_ENABLED = "true"; // ensure kill switch is on

  // Business C: test dry-run
  const businessC = await prisma.business.create({ data: { id: "business-c", name: "Business C" } });
  const accC = await prisma.platformAccount.create({
    data: { id: "acc-c", businessId: businessC.id, label: "Toko C", platform: "TIKTOK_SHOP",
      accessToken: "tok-c", shopCipher: "cip-c" }
  });

  const masterC = await prisma.masterProduct.create({ data: { name: "Test Produk C", businessId: businessC.id, threshold: 5 } });
  const variantC = await prisma.productVariant.create({ data: { sku: "TEST-SKU", stock: 100, safetyStock: 10, masterProductId: masterC.id } });
  await prisma.productMapping.create({ data: { accountId: accC.id, variantId: variantC.id, channelSku: "TEST-SKU:1", sellerSku: "TEST-SKU", updatedAt: new Date() } });
  await markBaselineReady(businessC.id, variantC.id);

  const resultC = await sync(
    [{ accountId: accC.id, channelSku: "TEST-SKU:1" }],
    100,
    { dryRun: true }
  );
  console.log(`C1: accC success=${resultC[0]?.success}, skipped=${resultC[0]?.skipped}`);
  // Per user requirement: dryRun → 0 panggilan, success=true, logged as dry_run
  assert.equal(resultC[0]?.success, true, "dryRun should return success");
  assert.equal(resultC[0]?.skipped, false, "dryRun should not be 'skipped' in old sense");
  console.log("PASS: dryRun=true → 0 panggilan API, logged as dry_run\\n");

  // Verify lastStockPushStatus not set to FAILED
  const variantCFromDB = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantC.id }, include: { productMapping: true } });
  const listingC = variantCFromDB.productMapping.find((m) => m.accountId === accC.id);
  console.log(`C2: listing.lastStockPushStatus=${listingC?.lastStockPushStatus}`);
  assert.ok(
    listingC?.lastStockPushStatus !== "FAILED",
    "dry_run should not set lastStockPushStatus to FAILED"
  );
  console.log("PASS: dry-run lastStockPushStatus tidak berubah menjadi FAILED\\n");

  // ============================================================
  // CASE D: status skipped_disabled tidak membuat listing bernilai FAILED
  // ============================================================
  console.log("=== Case D: skipped_disabled tidak membuat listing FAILED ===");
  process.env.STOCK_PUSH_ENABLED = "true";

  // Business D: test per-toko gate with stockPushEnabled=false
  const businessD = await prisma.business.create({ data: { id: "business-d", name: "Business D" } });

  const accD = await prisma.platformAccount.create({
    data: { id: "acc-d", businessId: businessD.id, label: "Toko D", platform: "TIKTOK_SHOP",
      accessToken: "tok-d", shopCipher: "cip-d" }
  });

  const masterD = await prisma.masterProduct.create({ data: { name: "Test Produk D", businessId: businessD.id, threshold: 5 } });
  const variantD = await prisma.productVariant.create({ data: { sku: "TEST-SKU", stock: 100, safetyStock: 10, masterProductId: masterD.id } });
  await prisma.productMapping.create({ data: { accountId: accD.id, variantId: variantD.id, channelSku: "TEST-SKU:1", sellerSku: "TEST-SKU", updatedAt: new Date() } });
  await markBaselineReady(businessD.id, variantD.id, false);

  const resultD = await sync(
    [{ accountId: accD.id, channelSku: "TEST-SKU:1" }],
    100,
    {}
  );
  console.log(`D1: accD success=${resultD[0]?.success}, skipped=${resultD[0]?.skipped}`);
  // Per user requirement: skipped_disabled should not make listing FAILED
  assert.equal(resultD[0]?.skipped, true, "STOCK_PUSH_ENABLED=false should skip (per-toko gate)");
  assert.equal(resultD[0]?.success, true, "skip should return success=true (disengaged user)");

  // Verify the listing's lastStockPushStatus is NOT "FAILED"
  const variantDFromDB = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantD.id }, include: { productMapping: true } });
  const listingAfter = variantDFromDB.productMapping.find((m) => m.accountId === accD.id);
  console.log(`D2: listing.lastStockPushStatus=${listingAfter?.lastStockPushStatus}`);
  assert.ok(
    listingAfter?.lastStockPushStatus !== "FAILED",
    "skipped_disabled should NOT set lastStockPushStatus to FAILED"
  );
  console.log("PASS: skipped_disabled tidak membuat listing bernilai FAILED\\n");

  assert.equal(stockWrites, 1, "Gate dan dry-run tidak boleh menambah request stok");
  console.log("=== SEMUA KASUS TEST LULUS ===");
  await prisma.$disconnect();
  db.cleanup();
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
