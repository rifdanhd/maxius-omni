import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setupTestDb } from "./lib/test-db";

const database = setupTestDb("maxspeed_reset");
const temporary = mkdtempSync(path.join(os.tmpdir(), "maxius-reset-test-"));
const script = path.resolve("scripts/reset-maxspeed.mts");
process.env.TIKTOK_APP_KEY = "fixture-key";
process.env.TIKTOK_APP_SECRET = "fixture-secret";
process.env.ORDER_SYNC_INITIAL_DAYS_BY_SHOP = '{"7495918791259228955":90}';
const { prisma } = await import("../lib/db/prisma");
const originalFetch = globalThis.fetch;
const calls: Array<{ cipher: string | null; body: Record<string, unknown> }> = [];

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, "open-api.tiktokglobalshop.com");
  assert.match(url.pathname, /orders\/search$/);
  calls.push({ cipher: url.searchParams.get("shop_cipher"), body: JSON.parse(String(init?.body)) });
  return Response.json({ code: 0, data: { orders: [], next_page_token: "", total_count: 0 } });
};

function runScript(...args: string[]) {
  return spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), script, ...args], {
    cwd: temporary,
    env: { ...process.env, POSTGRES_URL: database.url, DATABASE_URL: database.url },
    encoding: "utf8", timeout: 120_000,
  });
}

try {
  await prisma.business.create({ data: { id: "business-default", name: "Fixture", isDemo: false } });
  await prisma.platformAccount.createMany({ data: [
    { id: "cmus674za00g5ezfjtm65451v", businessId: "business-default", platform: "TIKTOK_SHOP", label: "Maxspeed Indonesia",
      externalShopId: "7495918791259228955", accessToken: "fixture-maxspeed-token", shopCipher: "fixture-maxspeed-cipher" },
    { id: "protected-shop", businessId: "business-default", platform: "TIKTOK_SHOP", label: "Toko Dilindungi",
      externalShopId: "111", accessToken: "fixture-protected-token", shopCipher: "fixture-protected-cipher" },
    { id: "frozen-shop", businessId: "business-default", platform: "TIKTOK_SHOP", label: "Toko Dibekukan",
      externalShopId: "222", accessToken: "fixture-frozen-token", shopCipher: "fixture-frozen-cipher", isFrozen: true },
  ] });

  const { autoSyncOrdersOnce } = await import("../lib/services/auto-sync.service");
  await autoSyncOrdersOnce();
  const deadline = Date.now() + 30_000;
  while (await prisma.syncRun.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) {
    assert.ok(Date.now() < deadline, "Background bootstrap harus selesai");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const runs = await prisma.syncRun.findMany();
  assert.equal(runs.length, 2);
  for (const run of runs) {
    assert.equal(run.status, "DONE", run.error ?? "Run harus berhasil");
    assert.equal(run.rangeField, "create_time");
    assert.equal((run.startedAt.getTime() - run.windowFrom!.getTime()) / 86_400_000,
      run.accountId === "cmus674za00g5ezfjtm65451v" ? 90 : 30);
  }
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.ok("create_time_ge" in call.body);
    assert.ok(!("update_time_ge" in call.body));
  }
  await autoSyncOrdersOnce();
  assert.equal(await prisma.syncRun.count(), 2, "Delta tidak membuat bootstrap baru");
  assert.ok(calls.slice(2).every((call) => "update_time_ge" in call.body));
  console.log("PASS: bootstrap Maxspeed 90 hari, toko lain 30, frozen dilewati, lalu delta");

  const product = await prisma.masterProduct.create({ data: { id: "protected-product", name: "Produk Pusat", businessId: "business-default" } });
  await prisma.productVariant.create({ data: { id: "protected-variant", sku: "KEEP", stock: 123, safetyStock: 3, masterProductId: product.id } });
  for (const [id, accountId] of [["target-order", "cmus674za00g5ezfjtm65451v"], ["keep-order", "protected-shop"]]) {
    await prisma.order.create({ data: { id, orderNo: id, status: "COMPLETED", accountId } });
    await prisma.orderItem.create({ data: { id: `${id}-item`, orderId: id, channelSku: "KEEP", qty: 1, variantId: "protected-variant" } });
    await prisma.platformOrderMapping.create({ data: { id: `${id}-mapping`, orderId: id, accountId, externalOrderId: id, rawStatus: "COMPLETED" } });
  }
  await prisma.productMapping.create({ data: { accountId: "cmus674za00g5ezfjtm65451v", channelSku: "KEEP", variantId: "protected-variant", updatedAt: new Date() } });
  await prisma.stockLedger.create({ data: { id: "keep-ledger", accountId: "cmus674za00g5ezfjtm65451v", variantId: "protected-variant", changeQty: 0, reason: "INIT", stockAfter: 123 } });
  writeFileSync(path.join(temporary, ".env"), `POSTGRES_URL=${database.url}\n`, { mode: 0o600 });

  const preview = runScript();
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.equal(await prisma.platformAccount.count(), 3);
  const reset = runScript("--execute");
  assert.equal(reset.status, 0, reset.stdout + reset.stderr);
  assert.equal(await prisma.platformAccount.count({ where: { id: "cmus674za00g5ezfjtm65451v" } }), 0);
  assert.equal(await prisma.order.count({ where: { id: "target-order" } }), 0);
  assert.equal(await prisma.order.count({ where: { id: "keep-order" } }), 1);
  assert.equal(await prisma.platformAccount.count({ where: { id: "protected-shop" } }), 1);
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: "protected-variant" } })).stock, 123);
  assert.equal((await prisma.stockLedger.findUniqueOrThrow({ where: { id: "keep-ledger" } })).accountId, null);
  assert.match(readFileSync(path.join(temporary, ".env"), "utf8"), /7495918791259228955.*90/);
  assert.match(reset.stdout, /Backup:/);
  assert.match(reset.stdout, /Sisa akun target: 0/);
  assert.equal(runScript("--execute").status, 0, "Reset ulang harus aman");
  console.log("PASS: pratinjau, backup, hapus target saja, stok/ledger/toko lain tetap, pengaturan 90 hari, idempoten");
} finally {
  globalThis.fetch = originalFetch;
  await prisma.$disconnect();
  database.cleanup();
  rmSync(temporary, { recursive: true, force: true });
}
