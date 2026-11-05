import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setupTestDb } from "./lib/test-db";

const db = setupTestDb("test-legacy-shopee-archive");
const { prisma } = await import("../lib/db/prisma");
const snapshot = join(await mkdtemp(join(tmpdir(), "maxius-archive-test-")), "snapshot.json");
try {
  const doc = await readFile("docs/ops/preview-archive-shopee1929797459-20261105.md", "utf8");
  const rows = [...doc.matchAll(/^\| (\d+:0) \| (.+?) \| (\d+) \|$/gm)];
  assert.equal(rows.length, 19);
  await prisma.business.create({ data: { id: "business-default", name: "Archive fixture" } });
  for (const [, sku, name, stock] of rows) {
    await prisma.masterProduct.create({ data: { name, businessId: "business-default", importedFrom: "SHOPEE:1929797459",
      productVariant: { create: { sku, stock: Number(stock), stockLedger: { create: { id: randomUUID(), reason: "INIT", stockAfter: Number(stock), changeQty: Number(stock) } } } } } });
  }
  const foreign = await prisma.business.create({ data: { name: "Unrelated business" } });
  const outside = await prisma.masterProduct.create({ data: { name: "Untouched", businessId: foreign.id, importedFrom: "SHOPEE:1929797459" } });
  const run = (mode: string) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/archive-legacy-shopee1929797459.mts", mode, snapshot], { encoding: "utf8", env: process.env }));
  assert.equal(run("apply").masters, 19);
  assert.equal(await prisma.masterProduct.count({ where: { businessId: "business-default", isActive: false } }), 19);
  assert.equal(run("apply").alreadyArchived, true);
  assert.equal(await prisma.stockLedger.count(), 19);
  assert.equal((await prisma.masterProduct.findUniqueOrThrow({ where: { id: outside.id } })).isActive, true);
  run("restore");
  assert.equal(await prisma.masterProduct.count({ where: { businessId: "business-default", isActive: true } }), 19);
  assert.equal(await prisma.productVariant.count({ where: { isArchived: true } }), 0);
  const variant = await prisma.productVariant.findFirstOrThrow();
  const account = await prisma.platformAccount.create({ data: { businessId: "business-default", label: "Fixture", platform: "SHOPEE" } });
  await prisma.productMapping.create({ data: { accountId: account.id, channelSku: "fixture", variantId: variant.id, updatedAt: new Date() } });
  assert.throws(() => run("apply"));
  assert.equal(await prisma.masterProduct.count({ where: { businessId: "business-default", isActive: false } }), 0);
  console.log("PASS: 19-row archive, repeat-safe apply, restore, unrelated business preserved, new mapping aborts");
} finally { await prisma.$disconnect(); db.cleanup(); }
