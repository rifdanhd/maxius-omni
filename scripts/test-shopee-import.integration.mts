/**
 * [TEST] Import listing Shopee → master catalog (marketplace-shopee-import).
 *
 * API Shopee DI-MOCK lewat patch globalThis.fetch (host
 * partner.shopeemobile.com) — tanpa jaringan. Assert:
 *  I1  import awal multi-varian: master+varian+mapping+ledger INIT;
 *      platformStock diisi hanya bila Shopee melaporkan stock_info
 *  I2  idempoten: run ulang → nol master baru, existing naik, ledger tak ganda
 *  I3  single-variant tanpa model → ID teknis terpisah dari seller SKU
 *  I4  dua model SKU identik → antrean tinjauan, stok tidak digabung
 *  I5  mapping orphan (variantId NULL) TIDAK dipoint ke master baru;
 *      SKU lain di item yang sama tetap diimpor
 *  I6  scoping: akun brand lain tidak ikut (businessId pada findMany);
 *      accountIds brand lain → hasil kosong
 *  I7  limit → itemsScanned terpotong + hasMore=true
 *  I8  akun tanpa OAuth → error jelas; API error → pesan TIDAK memuat token
 *
 * Jalankan: npx tsx scripts/test-shopee-import.integration.mts
 */
import assert from "node:assert";
import { setupTestDb } from "@/scripts/lib/test-db";

const db = setupTestDb("test-shopee-import");

// Env wajib SEBELUM import service (crypto.service melempar saat import;
// postShopApi membaca creds dari env saat dipanggil).
process.env.PII_ENC_KEY ??= "ab".repeat(32);
process.env.SHOPEE_PARTNER_ID ??= "999888";
process.env.SHOPEE_PARTNER_KEY ??= "test-partner-key";

const { prisma } = await import("@/lib/db/prisma");
const { importShopeeListings } = await import(
  "@/lib/services/marketplace-shopee-import.service"
);

let passed = 0;
async function ok(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/* ─────────────────────── Mock API Shopee ─────────────────────── */

type ModelRow = {
  model_id: number;
  model_sku?: string;
  model_status?: string;
  stock_info?: Array<{ stock?: number }>;
};
const fixture = {
  items: [] as Array<{ item_id: number }>,
  info: {} as Record<number, Record<string, unknown>>,
  models: {} as Record<number, { model: ModelRow[]; item_sku?: string }>,
  hasMore: false,
  failList: false,
  listCalls: 0,
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : ((input as { url?: string }).url ?? input)
  );
  if (!url.includes("partner.shopeemobile.com")) {
    return realFetch(input as never, init as never);
  }
  const pathname = new URL(url).pathname;
  if (pathname === "/api/v2/product/get_item_list") {
    fixture.listCalls += 1;
    if (fixture.failList) {
      const raw = JSON.stringify({
        error: "error_server",
        message: "internal error",
        request_id: "req-import-test",
      });
      return { ok: false, status: 500, text: async () => raw, json: async () => JSON.parse(raw) };
    }
    const raw = JSON.stringify({
      response: {
        item: fixture.items,
        total_count: fixture.items.length,
        has_more: fixture.hasMore,
      },
    });
    return { ok: true, status: 200, text: async () => raw, json: async () => JSON.parse(raw) };
  }
  if (pathname === "/api/v2/product/get_item_base_info") {
    const itemIds = (new URL(url).searchParams.get("item_id_list") ?? "")
      .split(",")
      .filter(Boolean)
      .map(Number);
    const raw = JSON.stringify({
      response: {
        item_list: itemIds.map((id) => fixture.info[id]).filter(Boolean),
      },
    });
    return { ok: true, status: 200, text: async () => raw, json: async () => JSON.parse(raw) };
  }
  if (pathname === "/api/v2/product/get_model_list") {
    const itemId = new URL(url).searchParams.get("item_id");
    const m = fixture.models[Number(itemId)] ?? { model: [] };
    const raw = JSON.stringify({ response: m });
    return { ok: true, status: 200, text: async () => raw, json: async () => JSON.parse(raw) };
  }
  const notFound = JSON.stringify({ error: "error_path", message: pathname });
  return {
    ok: false,
    status: 404,
    text: async () => notFound,
    json: async () => JSON.parse(notFound),
  };
}) as typeof fetch;

/* ─────────────────────── Fixture ─────────────────────── */

const TOKEN_A = "tok-shopee-import-secret-A";

await prisma.business.create({ data: { id: "business-default", name: "Default" } });
const bizA = await prisma.business.create({ data: { name: "Import Brand A" } });
const bizB = await prisma.business.create({ data: { name: "Import Brand B" } });

const acctA = await prisma.platformAccount.create({
  data: {
    platform: "SHOPEE",
    label: "Shopee Import A",
    businessId: bizA.id,
    accessToken: TOKEN_A,
    externalShopId: "888001",
  },
});
const acctA2 = await prisma.platformAccount.create({
  data: {
    platform: "SHOPEE",
    label: "Shopee Import A2",
    businessId: bizA.id,
    accessToken: "tok-shopee-import-A2",
    externalShopId: "888002",
  },
});
const acctB = await prisma.platformAccount.create({
  data: {
    platform: "SHOPEE",
    label: "Shopee Import B",
    businessId: bizB.id,
    accessToken: "tok-shopee-import-B",
    externalShopId: "999001",
  },
});
const acctNoToken = await prisma.platformAccount.create({
  data: { platform: "SHOPEE", label: "Shopee Import tanpa OAuth", businessId: bizA.id },
});

const mastersOf = (businessId: string) =>
  prisma.masterProduct.count({ where: { businessId } });

console.log("=== Import listing Shopee ===");

await ok("I1: import awal multi-varian → master+varian+mapping+ledger INIT", async () => {
  fixture.items = [{ item_id: 1001 }];
  fixture.info[1001] = {
    item_id: 1001,
    item_name: "Kaos Kaki Sport",
    item_status: "NORMAL",
    item_sku: "IGNORED-WHEN-MODELS",
  };
  fixture.models[1001] = {
    model: [
      { model_id: 11, model_sku: "SK-A", model_status: "NORMAL", stock_info: [{ stock: 5 }] },
      { model_id: 12, model_sku: "SK-B", model_status: "NORMAL" }, // tanpa stock_info
    ],
  };

  const [res] = await importShopeeListings({
    businessId: bizA.id,
    accountIds: [acctA.id],
  });
  assert.equal(res.error, undefined);
  assert.equal(res.importedItems, 1);
  assert.equal(res.importedVariants, 2);
  assert.equal(res.zeroStock, 1); // SK-B tak dilaporkan Shopee → 0

  const master = await prisma.masterProduct.findFirstOrThrow({
    where: { businessId: bizA.id },
    include: { productVariant: true },
  });
  assert.equal(master.name, "Kaos Kaki Sport");
  assert.equal(master.importedFrom, "SHOPEE:888001");
  assert.equal(master.productVariant.length, 2);

  const mapA = await prisma.productMapping.findUniqueOrThrow({
    where: { accountId_channelSku: { accountId: acctA.id, channelSku: "1001:11" } },
  });
  const mapB = await prisma.productMapping.findUniqueOrThrow({
    where: { accountId_channelSku: { accountId: acctA.id, channelSku: "1001:12" } },
  });
  assert.ok(mapA.variantId, "SK-A harus tertaut varian");
  assert.ok(mapB.variantId, "SK-B harus tertaut varian");
  assert.equal(mapA.sellerSku, "SK-A");
  assert.equal(mapB.sellerSku, "SK-B");
  assert.equal(mapA.platformStock, 5, "stock_info dilaporkan → platformStock=5");
  assert.equal(
    mapB.platformStock,
    null,
    "stock TIDAK dilaporkan → platformStock null (bukan 0)"
  );
  assert.equal(mapA.platformProductId, "1001");

  const ledgers = await prisma.stockLedger.findMany({
    where: { variantId: mapA.variantId!, reason: "INIT" },
  });
  assert.equal(ledgers.length, 1);
  assert.equal(ledgers[0].stockAfter, 5);

  const varB = await prisma.productVariant.findUniqueOrThrow({
    where: { id: mapB.variantId! },
  });
  assert.equal(varB.stock, 0);
});

await ok("I2: idempoten → run ulang nol master baru, ledger tidak ganda", async () => {
  const before = await mastersOf(bizA.id);
  const ledgersBefore = await prisma.stockLedger.count({ where: { reason: "INIT" } });
  const [res] = await importShopeeListings({
    businessId: bizA.id,
    accountIds: [acctA.id],
  });
  assert.equal(res.error, undefined);
  assert.equal(res.importedItems, 0);
  assert.equal(res.existing, 2);
  assert.equal(await mastersOf(bizA.id), before);
  assert.equal(await prisma.stockLedger.count({ where: { reason: "INIT" } }), ledgersBefore);
});

await ok("I3: single-variant menyimpan seller SKU terpisah dari alamat listing", async () => {
  fixture.items = [{ item_id: 1002 }];
  fixture.info[1002] = {
    item_id: 1002,
    item_name: "Produk Single",
    item_status: "NORMAL",
    item_sku: "SOLE-1",
  };
  fixture.models[1002] = { model: [{ model_id: 0, model_sku: "" }], item_sku: "SOLE-1" };

  const [res] = await importShopeeListings({
    businessId: bizA.id,
    accountIds: [acctA.id],
  });
  assert.equal(res.importedItems, 1);
  assert.equal(res.importedVariants, 1);
  const map = await prisma.productMapping.findUniqueOrThrow({
    where: { accountId_channelSku: { accountId: acctA.id, channelSku: "1002:0" } },
  });
  assert.ok(map.variantId);
  assert.equal(map.sellerSku, "SOLE-1");
});

await ok("I4: SKU seller kembar masuk tinjauan tanpa membuat stok ganda", async () => {
  fixture.items = [{ item_id: 1003 }];
  fixture.info[1003] = {
    item_id: 1003,
    item_name: "Produk Dup SKU",
    item_status: "NORMAL",
  };
  fixture.models[1003] = {
    model: [
      { model_id: 55, model_sku: "DUP-SKU", model_status: "NORMAL" },
      { model_id: 66, model_sku: "DUP-SKU", model_status: "NORMAL" },
    ],
  };

  const [res] = await importShopeeListings({
    businessId: bizA.id,
    accountIds: [acctA.id],
  });
  assert.equal(res.importedItems, 0);
  assert.equal(res.importedVariants, 0);
  assert.equal(res.orphan, 2);
  await prisma.productMapping.findUniqueOrThrow({
    where: { accountId_channelSku: { accountId: acctA.id, channelSku: "1003:55" } },
  });
  const second = await prisma.productMapping.findUniqueOrThrow({
    where: { accountId_channelSku: { accountId: acctA.id, channelSku: "1003:66" } },
  });
  assert.equal(second.variantId, null, "SKU seller ganda menunggu keputusan user");
  assert.equal(await prisma.skuMappingReview.count({ where: { businessId: bizA.id, sellerSku: "DUP-SKU", status: "PENDING" } }), 2);
});

await ok("I5: orphan (variantId NULL) tak dipoint; SKU lain tetap diimpor", async () => {
  const orphan = await prisma.productMapping.create({
    data: {
      channelSku: "ORPHAN-SKU",
      variantId: null,
      accountId: acctA.id,
      updatedAt: new Date(),
    },
  });
  fixture.items = [{ item_id: 1004 }];
  fixture.info[1004] = {
    item_id: 1004,
    item_name: "Produk Orphan",
    item_status: "NORMAL",
  };
  fixture.models[1004] = {
    model: [
      { model_id: 7, model_sku: "ORPHAN-SKU", model_status: "NORMAL" },
      { model_id: 8, model_sku: "ORPHAN-NEW", model_status: "NORMAL" },
    ],
  };

  const mastersBefore = await mastersOf(bizA.id);
  const [res] = await importShopeeListings({
    businessId: bizA.id,
    accountIds: [acctA.id],
  });
  assert.equal(res.orphan, 1, "SKU orphan dihitung, tidak diproses jadi baru");
  assert.equal(res.importedItems, 1, "SKU baru di item yang sama tetap masuk");
  assert.equal(res.importedVariants, 1);

  const after = await prisma.productMapping.findUniqueOrThrow({
    where: { id: orphan.id },
  });
  assert.equal(after.variantId, null, "orphan TIDAK dipoint ke master import");
  assert.equal(await mastersOf(bizA.id), mastersBefore + 1);
});

await ok("I6: scoping — akun brand lain tidak diimpor walau accountIds disodorkan", async () => {
  fixture.items = [{ item_id: 1001 }];
  const callsBefore = fixture.listCalls;
  await assert.rejects(importShopeeListings({ businessId: bizA.id }), /tepat satu akun/);
  await assert.rejects(importShopeeListings({ businessId: bizA.id, accountIds: [acctA.id, acctA2.id] }), /tepat satu akun/);
  await assert.rejects(importShopeeListings({
    businessId: bizA.id,
    accountIds: [acctB.id],
  }), /tidak ditemukan di bisnis aktif/);
  assert.equal(fixture.listCalls, callsBefore, "Penolakan terjadi sebelum API marketplace dipanggil");
});

await ok("I7: limit → itemsScanned terpotong + hasMore=true", async () => {
  fixture.items = [{ item_id: 1001 }, { item_id: 1002 }, { item_id: 1003 }];
  const [res] = await importShopeeListings({
    businessId: bizA.id,
    accountIds: [acctA.id],
    limit: 1,
  });
  assert.equal(res.itemsScanned, 1);
  assert.equal(res.hasMore, true);
});

await ok("I8: tanpa OAuth → error jelas; API error tidak membocorkan token", async () => {
  const [noOauth] = await importShopeeListings({
    businessId: bizA.id,
    accountIds: [acctNoToken.id],
  });
  assert.match(noOauth.error ?? "", /Belum OAuth/);

  fixture.failList = true;
  const [failed] = await importShopeeListings({
    businessId: bizA.id,
    accountIds: [acctA.id],
  });
  fixture.failList = false;
  assert.ok(failed.error, "error API harus dilaporkan per akun");
  assert.ok(!failed.error!.includes(TOKEN_A), "token akses tidak boleh ada di error");
  assert.ok(!failed.error!.includes("tok-shopee"), "token lain juga tidak boleh bocor");
});

await ok("I9: seller SKU sama di tiga toko memakai satu stok; customer lain tetap terpisah", async () => {
  const third = await prisma.platformAccount.create({ data: { platform: "SHOPEE", label: "Toko ketiga", businessId: bizA.id, accessToken: "fixture-third", externalShopId: "888003" } });
  fixture.items = [{ item_id: 1001 }];
  fixture.models[1001].model[0].stock_info = [{ stock: 888888 }];
  for (const account of [acctA2, third]) {
    const [result] = await importShopeeListings({ businessId: bizA.id, accountIds: [account.id] });
    assert.equal(result.error, undefined);
    assert.equal(result.importedVariants, 0);
  }
  const linked = await prisma.productMapping.findMany({ where: { accountId: { in: [acctA.id, acctA2.id, third.id] }, sellerSku: "SK-A" }, include: { variant: true } });
  assert.equal(linked.length, 3);
  assert.equal(new Set(linked.map((mapping) => mapping.variantId)).size, 1);
  assert.equal(linked[0].variant!.stock, 5, "Listing tambahan tidak menimpa stok gudang");
  const [other] = await importShopeeListings({ businessId: bizB.id, accountIds: [acctB.id] });
  assert.equal(other.error, undefined);
  const isolated = await prisma.productMapping.findFirstOrThrow({ where: { accountId: acctB.id, sellerSku: "SK-A" } });
  assert.notEqual(isolated.variantId, linked[0].variantId);
});

await ok("I10: varian baru membatalkan baseline dan push bisnis tanpa mengubah bisnis lain", async () => {
  fixture.items = [{ item_id: 9001 }];
  fixture.info[9001] = { item_id: 9001, item_name: "New unverified product", item_status: "NORMAL", item_sku: "NEW-UNVERIFIED", stock_info: [{ stock: 99999 }] };
  fixture.models[9001] = { model: [], item_sku: "NEW-UNVERIFIED" };
  await prisma.inventorySetting.update({ where: { businessId: bizA.id }, data: { stockBaselineReady: true, stockPushEnabled: true } });
  const beforeB = await prisma.inventorySetting.findUniqueOrThrow({ where: { businessId: bizB.id } });
  const [result] = await importShopeeListings({ businessId: bizA.id, accountIds: [acctA.id] });
  assert.equal(result.error, undefined);
  assert.equal(result.importedVariants, 1);
  const afterA = await prisma.inventorySetting.findUniqueOrThrow({ where: { businessId: bizA.id } });
  assert.equal(afterA.stockBaselineReady, false);
  assert.equal(afterA.stockPushEnabled, false);
  assert.deepEqual(await prisma.inventorySetting.findUniqueOrThrow({ where: { businessId: bizB.id } }), beforeB);
});

db.cleanup();
console.log(`\nPASS: ${passed} test group (shopee-import). DB fixture dihapus.`);
