/**
 * [TEST] Import listing Shopee → master catalog (marketplace-shopee-import).
 *
 * API Shopee DI-MOCK lewat patch globalThis.fetch (host
 * partner.shopeemobile.com) — tanpa jaringan. Assert:
 *  I1  import awal multi-varian: master+varian+mapping+ledger INIT;
 *      platformStock diisi hanya bila Shopee melaporkan stock_info
 *  I2  idempoten: run ulang → nol master baru, existing naik, ledger tak ganda
 *  I3  single-variant tanpa model → channelSku pakai item_sku
 *  I4  dua model SKU identik → yang kedua jadi `itemId:model_id` (bukan index)
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
      return {
        ok: false,
        status: 500,
        json: async () => ({
          error: "error_server",
          message: "internal error",
          request_id: "req-import-test",
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        response: {
          item: fixture.items,
          total_count: fixture.items.length,
          has_more: fixture.hasMore,
        },
      }),
    };
  }
  if (pathname === "/api/v2/product/get_item_base_info") {
    const raw = (init as { body?: string } | undefined)?.body ?? "{}";
    const body = JSON.parse(raw) as { item_id_list?: number[] };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        response: {
          item_list: (body.item_id_list ?? [])
            .map((id) => fixture.info[id])
            .filter(Boolean),
        },
      }),
    };
  }
  if (pathname === "/api/v2/product/get_model_list") {
    const raw = (init as { body?: string } | undefined)?.body ?? "{}";
    const body = JSON.parse(raw) as { item_id?: number };
    const m = fixture.models[Number(body.item_id)] ?? { model: [] };
    return {
      ok: true,
      status: 200,
      json: async () => ({ response: m }),
    };
  }
  return {
    ok: false,
    status: 404,
    json: async () => ({ error: "error_path", message: pathname }),
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
    where: { accountId_channelSku: { accountId: acctA.id, channelSku: "SK-A" } },
  });
  const mapB = await prisma.productMapping.findUniqueOrThrow({
    where: { accountId_channelSku: { accountId: acctA.id, channelSku: "SK-B" } },
  });
  assert.ok(mapA.variantId, "SK-A harus tertaut varian");
  assert.ok(mapB.variantId, "SK-B harus tertaut varian");
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

await ok("I3: single-variant tanpa model → channelSku pakai item_sku", async () => {
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
    where: { accountId_channelSku: { accountId: acctA.id, channelSku: "SOLE-1" } },
  });
  assert.ok(map.variantId);
});

await ok("I4: SKU kembar → fallback `itemId:model_id` (bukan index urutan)", async () => {
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
  assert.equal(res.importedItems, 1);
  assert.equal(res.importedVariants, 2);
  await prisma.productMapping.findUniqueOrThrow({
    where: { accountId_channelSku: { accountId: acctA.id, channelSku: "DUP-SKU" } },
  });
  const second = await prisma.productMapping.findUniqueOrThrow({
    where: { accountId_channelSku: { accountId: acctA.id, channelSku: "1003:66" } },
  });
  assert.ok(second.variantId, "model_id 66 harus terpetakan, bukan `1003:1`");
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
  // Tanpa accountIds → hanya akun milik bizA (findMany businessId filter).
  const all = await importShopeeListings({ businessId: bizA.id });
  const ids = all.map((r) => r.accountId);
  assert.ok(!ids.includes(acctB.id), "akun brand B tidak boleh ikut");
  assert.ok(ids.includes(acctA.id));
  assert.ok(ids.includes(acctA2.id), "semua akun brand A ikut (termasuk A2)");
  // accountIds brand B dipaksa dari luar → hasil kosong (filter tetap menang).
  const foreign = await importShopeeListings({
    businessId: bizA.id,
    accountIds: [acctB.id],
  });
  assert.equal(foreign.length, 0, "accountIds lintas brand diabaikan oleh filter");
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

db.cleanup();
console.log(`\nPASS: ${passed} test group (shopee-import). DB fixture dihapus.`);
