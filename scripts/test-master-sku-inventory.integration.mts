import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { setupTestDb } from "./lib/test-db";

const database = setupTestDb("master_sku", { migrate: false });
const migration = "20261025_010000_master_sku_inventory";
const execute = (sql: string) => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "execute", "--url", database.url, "--stdin"], { input: sql, stdio: ["pipe", "pipe", "pipe"] });
execute(readdirSync("prisma/migrations").filter((name) => /^\d/.test(name) && name !== migration).sort()
  .map((name) => readFileSync(path.join("prisma/migrations", name, "migration.sql"), "utf8")).join("\n"));
execute(`
  INSERT INTO "Business" (id,name,"updatedAt") VALUES ('tenant-a','A',NOW()),('tenant-b','B',NOW());
  INSERT INTO "MasterProduct" (id,name,"businessId") VALUES ('product-a','Kaos Kaki','tenant-a'),('product-b','Rahasia B','tenant-b'),('dup-a','Duplikat A','tenant-a'),('dup-b','Duplikat B','tenant-a');
  INSERT INTO "ProductVariant" (id,sku,stock,"safetyStock","masterProductId","updatedAt") VALUES
    ('variant-a','SOCK',100,10,'product-a',NOW()),('variant-b','SOCK',400,0,'product-b',NOW()),
    ('duplicate-a','DUP',5,0,'dup-a',NOW()),('duplicate-b','DUP',9,0,'dup-b',NOW());
`);
execute(readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"));
process.env.PII_ENC_KEY = "ab".repeat(32);
process.env.SHOPEE_PARTNER_ID = "999888";
process.env.SHOPEE_PARTNER_KEY = "fixture-key";
process.env.TIKTOK_APP_KEY = "fixture-app";
process.env.TIKTOK_APP_SECRET = "fixture-secret";
const { prisma } = await import("../lib/db/prisma");
const { changeMasterStock, retryMasterStock, setStockAllocation } = await import("../lib/services/master-stock-mutation.service");
const { getMasterStock } = await import("../lib/services/master-stock.service");
const { drainStockOutbox } = await import("../lib/services/stock-outbox.service");
const { processDueSyncJobs } = await import("../lib/services/sync-job.service");
const { deductStockForOrder, restoreStockForCanceledOrder } = await import("../lib/services/central-stock.service");
const { exportMasterStock, previewMasterStockImport } = await import("../lib/services/master-stock-spreadsheet.service");
const { allocationQuantity } = await import("../lib/services/stock-allocation.policy");
const { ingestTikTokOrdersPage } = await import("../lib/services/order-sync.service");
const { syncTikTokListings } = await import("../lib/services/marketplace-tiktok.service");
const { registerSellerSku } = await import("../lib/services/master-sku.service");
const realFetch = globalThis.fetch;
const calls: Array<{ shop: string | null; quantity: number }> = [];
let failShop = "102";
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === "open-api.tiktokglobalshop.com") {
    assert.equal(url.pathname, "/product/202309/products/search");
    return Response.json({ code: 0, data: { total_count: 2, products: [
      { id: "tt-product", title: "Kaos kaki TikTok", status: "ACTIVATE", skus: [{ id: "tt-sku", seller_sku: "SOCK", inventory: [{ quantity: 99999 }] }] },
      { id: "tt-duplicate", title: "Konflik TikTok", status: "ACTIVATE", skus: [{ id: "tt-dup-1", seller_sku: "DUP" }, { id: "tt-dup-2", seller_sku: "DUP" }] },
    ] } });
  }
  assert.equal(url.hostname, "partner.shopeemobile.com", "Pengujian tidak boleh mengakses layanan asli");
  assert.equal(url.pathname, "/api/v2/product/update_stock");
  const body = JSON.parse(String(init?.body)) as { stock_list: Array<{ seller_stock: Array<{ stock: number }> }> };
  calls.push({ shop: url.searchParams.get("shop_id"), quantity: body.stock_list[0].seller_stock[0].stock });
  return Response.json(url.searchParams.get("shop_id") === failShop
    ? { error: "error_server", message: "Toko fixture gagal" } : { error: "", response: { failure_list: [] } });
};

try {
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } })).stock, 100);
  assert.deepEqual(await prisma.variantWarehouseStock.findUnique({ where: { variantId_warehouseId: { variantId: "variant-a", warehouseId: "warehouse-tenant-a" } }, select: { stock: true, safetyStock: true } }), { stock: 100, safetyStock: 10 });
  assert.equal(await prisma.masterSkuKey.count({ where: { sellerSku: "SOCK" } }), 2);
  assert.equal((await prisma.masterSkuKey.findUniqueOrThrow({ where: { businessId_sellerSku: { businessId: "tenant-a", sellerSku: "DUP" } } })).variantId, null);
  assert.equal(await prisma.skuMappingReview.count({ where: { businessId: "tenant-a" } }), 1);
  console.log("PASS: migrasi menjaga stok lama, memisahkan tenant, dan mengantrekan SKU ganda tanpa penggabungan");

  await prisma.user.create({ data: { id: "test-user", username: "fixture", passwordHash: "fixture-only" } });
  for (let index = 1; index <= 3; index++) {
    const accountId = `shop-${index}`;
    await prisma.platformAccount.create({ data: { id: accountId, businessId: "tenant-a", label: `Toko ${index}`, platform: "SHOPEE", externalShopId: String(100 + index), accessToken: `fixture-${index}`, tokenExpiresAt: new Date(Date.now() + 86400000) } });
    await prisma.productMapping.create({ data: { accountId, variantId: "variant-a", channelSku: `${1000 + index}:1`, sellerSku: "SOCK", updatedAt: new Date() } });
  }
  const change = { variantId: "variant-a", expectedVersion: 0, warehouseId: "warehouse-tenant-a", kind: "IN" as const,
    quantity: 10, reason: "Restok fixture", requestId: "fixture-stock-1" };
  await changeMasterStock("tenant-a", "test-user", [change]);
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } })).stock, 110);
  await changeMasterStock("tenant-a", "test-user", [change]);
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } })).stock, 110, "Retry idempoten");
  await assert.rejects(changeMasterStock("tenant-a", "test-user", [{ ...change, quantity: 99 }]));
  await drainStockOutbox();
  const dispatched = await processDueSyncJobs({ businessId: "tenant-a" });
  assert.equal(dispatched.succeeded, 2);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.quantity === 100));
  let result = await getMasterStock("tenant-a", new URLSearchParams());
  let row = result.rows.find((row) => row.id === "variant-a")!;
  assert.equal(row.listings.filter((listing) => listing.status === "SUCCESS").length, 2);
  assert.equal(row.listings.filter((listing) => listing.status === "FAILED").length, 1);
  assert.equal(result.counts.failed, 1);
  assert.ok(!result.rows.some((row) => row.id === "variant-b"));
  console.log("PASS: satu perubahan terkirim ke tiga toko; kegagalan satu toko tidak menggagalkan dua lainnya");
  const failedListing = row.listings.find((listing) => listing.status === "FAILED")!;
  await retryMasterStock("tenant-a", ["variant-a"], failedListing.id);
  const retried = await getMasterStock("tenant-a", new URLSearchParams());
  const retriedRow = retried.rows.find((item) => item.id === "variant-a")!;
  assert.equal(retriedRow.listings.find((listing) => listing.id === failedListing.id)?.status, "PENDING");
  assert.equal(retriedRow.listings.filter((listing) => listing.status === "SUCCESS").length, 2);
  assert.equal(retried.counts.failed, 0);
  console.log("PASS: retry manual mengganti gagal menjadi menunggu hanya pada listing yang dipilih");

  const version = (await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } })).version;
  const concurrent = await Promise.allSettled([1, 2].map((index) => changeMasterStock("tenant-a", "test-user", [{ ...change, expectedVersion: version, quantity: 1, requestId: `concurrent-${index}` }])));
  assert.equal(concurrent.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((item) => item.status === "rejected").length, 1);
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } })).stock, 111);
  await assert.rejects(changeMasterStock("tenant-a", "test-user", [{ ...change, variantId: "variant-b", requestId: "cross-tenant-change" }]));
  await assert.rejects(prisma.productMapping.create({ data: { accountId: "shop-1", variantId: "variant-b", channelSku: "9000:1", updatedAt: new Date() } }));
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-b" } })).stock, 400);
  console.log("PASS: versi menolak penimpaan perubahan bersamaan dan tenant lain tidak dapat diubah");

  const fresh = await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } });
  await assert.rejects(changeMasterStock("tenant-a", "test-user", [{ ...change, expectedVersion: fresh.version, kind: "OUT", quantity: 1000, requestId: "negative-fixture" }]));
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } })).stock, fresh.stock);
  for (const [id, status, importOnly, qty] of [["active", "AWAITING_SHIPMENT", false, 200], ["history", "AWAITING_SHIPMENT", true, 999], ["finished", "COMPLETED", false, 999], ["shipped", "IN_TRANSIT", false, 999]] as const) {
    await prisma.order.create({ data: { id, orderNo: id, status, importOnly, accountId: "shop-1", items: { create: { id: `${id}-item`, channelSku: "1001:1", qty, variantId: "variant-a" } } } });
  }
  await prisma.syncLog.createMany({ data: Array.from({ length: 30 }, (_, index) => ({ accountId: "shop-1", kind: "central_stock_deduct", direction: "in", status: "skipped", message: `log ${index}` })) });
  const beforeHistory = (await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } })).stock;
  assert.ok((await deductStockForOrder("history")).already);
  assert.ok((await restoreStockForCanceledOrder("history", "ORDER_CANCELLED")).already);
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } })).stock, beforeHistory);
  result = await getMasterStock("tenant-a", new URLSearchParams());
  row = result.rows.find((row) => row.id === "variant-a")!;
  assert.equal(row.pending, 200);
  assert.equal(result.counts.oversells, 1);
  assert.ok(result.counts.oversells <= result.counts.all);
  await prisma.productVariant.update({ where: { id: "duplicate-a" }, data: { stock: 0, isArchived: true } });
  assert.equal((await getMasterStock("tenant-a", new URLSearchParams())).counts.empty, 0);
  assert.equal((await getMasterStock("tenant-a", new URLSearchParams("archives=true"))).counts.empty, 1);
  console.log("PASS: oversell per SKU aktif; log berulang, selesai, dikirim dan import_only tidak menambah permintaan; arsip terpisah");

  await prisma.inventoryWarehouse.create({ data: { id: "warehouse-2", businessId: "tenant-a", name: "Gudang kedua" } });
  await prisma.variantWarehouseStock.create({ data: { variantId: "variant-a", warehouseId: "warehouse-2", stock: 30, safetyStock: 0 } });
  const balancesBefore = await prisma.variantWarehouseStock.findMany({ where: { variantId: "variant-a" }, orderBy: { warehouseId: "asc" } });
  const quantity = balancesBefore.find((balance) => balance.warehouseId === "warehouse-tenant-a")!.stock + 10;
  await prisma.order.create({ data: { id: "warehouse-order", orderNo: "warehouse-order", status: "AWAITING_SHIPMENT", accountId: "shop-1", items: { create: { id: "warehouse-item", channelSku: "1001:1", variantId: "variant-a", qty: quantity } } } });
  assert.ok((await deductStockForOrder("warehouse-order")).ok);
  assert.equal(await prisma.warehouseOrderAllocation.count({ where: { orderId: "warehouse-order" } }), 2);
  await prisma.order.update({ where: { id: "warehouse-order" }, data: { status: "CANCELLED" } });
  assert.ok((await restoreStockForCanceledOrder("warehouse-order", "ORDER_CANCELLED")).ok);
  assert.deepEqual(await prisma.variantWarehouseStock.findMany({ where: { variantId: "variant-a" }, orderBy: { warehouseId: "asc" } }), balancesBefore);
  console.log("PASS: pemotongan lintas gudang dan pembatalan kembali ke gudang asal");

  assert.equal(allocationQuantity(100, { mode: "PERCENT", value: 50, buffer: 10 }, 3), 45);
  assert.equal(allocationQuantity(100, { mode: "EQUAL", value: 0, buffer: 10 }, 3), 30);
  assert.equal(allocationQuantity(100, { mode: "FIXED", value: 200, buffer: 10 }, 3), 90);
  const listing = await prisma.productMapping.findFirstOrThrow({ where: { accountId: "shop-1" } });
  await setStockAllocation("tenant-a", { listingId: listing.id, mode: "PERCENT", value: 50, buffer: 10 });
  failShop = "";
  await retryMasterStock("tenant-a", ["variant-a"], listing.id);
  await processDueSyncJobs({ businessId: "tenant-a" });
  assert.ok(calls.some((call) => call.shop === "101" && call.quantity === Math.floor((141 - 10 - 10) / 2)));
  const bytes = await exportMasterStock("tenant-a", new URLSearchParams("q=SOCK"));
  const preview = await previewMasterStockImport("tenant-a", "warehouse-tenant-a", Buffer.from(bytes));
  assert.equal(preview.length, 1);
  assert.equal(preview[0].variantId, "variant-a");
  await assert.rejects(previewMasterStockImport("tenant-b", "warehouse-tenant-a", Buffer.from(bytes)));
  console.log("PASS: alokasi dan buffer diterapkan ke API; Excel ekspor/impor menjaga versi dan tenant");

  const stockBeforeImport = (await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } })).stock;
  const imported = { fetched: 1, created: 0, skipped: 0, errors: [] as string[], reconciled: 0, reconcileScan: 0, trackingEvents: 0 };
  await ingestTikTokOrdersPage(prisma, "shop-1", [{ id: "historical-ingest", status: "AWAITING_SHIPMENT", line_items: [
    { id: "historical-line", sku_id: "1001:1", seller_sku: "SOCK", product_name: "Fixture" },
  ] }], imported, { importOnly: true });
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.created, 1);
  const importedOrder = await prisma.order.findFirstOrThrow({ where: { orderNo: "historical-ingest" } });
  assert.equal(importedOrder.importOnly, true);
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } })).stock, stockBeforeImport);
  assert.equal(await prisma.stockLedger.count({ where: { referenceId: importedOrder.id, reason: "ORDER" } }), 0);
  console.log("PASS: ingest riwayat aktif ditandai import_only tanpa pemotongan stok");

  for (const tenant of ["tenant-a", "tenant-b"]) {
    const account = await prisma.platformAccount.create({ data: { id: `tiktok-${tenant}`, businessId: tenant, platform: "TIKTOK_SHOP", label: `TikTok ${tenant}`,
      accessToken: "fixture-tiktok", shopCipher: `cipher-${tenant}`, tokenExpiresAt: new Date(Date.now() + 86400000) } });
    const [synced] = await syncTikTokListings(tenant, account.id);
    assert.equal(synced.error, undefined);
    const mapping = await prisma.productMapping.findUniqueOrThrow({ where: { accountId_channelSku: { accountId: account.id, channelSku: "tt-sku" } } });
    assert.equal(mapping.variantId, tenant === "tenant-a" ? "variant-a" : "variant-b");
  }
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: "variant-a" } })).stock, stockBeforeImport);
  assert.equal(await prisma.productMapping.count({ where: { accountId: "tiktok-tenant-a", sellerSku: "DUP", variantId: null } }), 2);
  console.log("PASS: TikTok memakai SKU master sesuai customer; SKU ganda ditinjau tanpa mengubah stok fisik");
  const orphan = await prisma.productMapping.create({ data: { accountId: "shop-1", channelSku: "orphan-fixture", sellerSku: "SOCK", updatedAt: new Date() } });
  await prisma.$transaction((tx) => registerSellerSku(tx, { businessId: "tenant-a", mappingId: orphan.id, sellerSku: "SOCK" }));
  const orphanReview = await prisma.skuMappingReview.findFirstOrThrow({ where: { mappingId: orphan.id, status: "PENDING" } });
  assert.deepEqual(orphanReview.candidateIds, ["variant-a"]);
  assert.equal((await prisma.productMapping.findUniqueOrThrow({ where: { id: orphan.id } })).variantId, null);
  console.log("PASS: listing orphan tetap dalam tinjauan meskipun satu stok acuan sudah tersedia");

  await prisma.productVariant.createMany({ data: Array.from({ length: 3600 }, (_, index) => ({ id: `scale-${index}`, masterProductId: "product-a", sku: `SCALE-${index}`, stock: index % 5, safetyStock: 0 })) });
  const started = performance.now();
  const scale = await getMasterStock("tenant-a", new URLSearchParams("limit=50"));
  assert.equal(scale.rows.length, 50);
  assert.ok(scale.total >= 3600);
  const elapsed = performance.now() - started;
  console.log(`PASS: ${scale.total} SKU, respons dibatasi 50 baris, query ${Math.round(elapsed)} ms`);
  const audit = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/audit-master-inventory.mts", "--business-id", "tenant-a"], {
    encoding: "utf8", env: { ...process.env, POSTGRES_URL: database.url },
  }));
  assert.equal(audit.business.id, "tenant-a");
  assert.equal(audit.historicalFlagAvailable, true);
  console.log("PASS: skrip audit hanya membaca agregat customer yang dipilih");
} finally {
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
  database.cleanup();
}
