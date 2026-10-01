/**
 * [TEST] M8b — A6: Shopee order sync & webhook.
 *
 * API Shopee DI-MOCK lewat patch globalThis.fetch (host
 * partner.shopeemobile.com) — tanpa jaringan. Assert:
 *  T1  A1  peta kanonisasi status Shopee (webhook & ingest memakai SATU peta)
 *  T2      ingest idempotent: create 1×, deduct stok 1× (ledger), run ulang skip
 *  T3      A4 refresh progress-only: status naik tanpa re-create / re-deduct
 *  T4      cancel → restore stok; run ulang tidak menggandakan restore
 *  T5      A2 auto-ingest dari push (mapping belum ada) + dobel-fire → 1× ingest
 *  T6      cancel via webhook dobel-fire → 1× restore, fire ulang stale-skip
 *  T7      A5 cap pagination: has_more tak-berujung → berhenti di
 *          SHOPEE_ORDER_MAX_PAGES (bukan loop selamanya)
 *  T8      A5 rate limit → error + SyncLog kind=order_sync (tidak senyap)
 *  T9      A3 anti double-pull: sync paralel → satu ditolak PullInProgressError
 *  T10     A2 push utk akun tanpa token → SyncLog auto_ingest error + hint
 *          "sinkronisasi order manual", tanpa partial state
 *
 * Jalankan: npx tsx scripts/test-shopee-order-sync.integration.mts
 */
import assert from "node:assert";
import { setupTestDb } from "@/scripts/lib/test-db";

const db = setupTestDb("test-shopee-order-sync");

// Env wajib SEBELUM import service (crypto.service melempar saat import;
// postShopApi membaca creds dari env saat dipanggil).
process.env.PII_ENC_KEY ??= "ab".repeat(32);
process.env.SHOPEE_PARTNER_ID ??= "999888";
process.env.SHOPEE_PARTNER_KEY ??= "test-partner-key";

const { prisma } = await import("@/lib/db/prisma");
const { syncOrdersShopee } = await import("@/lib/services/shopee-order-sync.service");
const { handleShopeeOrderUpdate } = await import(
  "@/lib/services/shopee-order-webhook.service"
);
const { SHOPEE_STATUS_MAP, canonicalShopeeStatus } = await import(
  "@/lib/services/shopee-order-status.service"
);

let passed = 0;
async function ok(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/* ─────────────────────── Mock API Shopee ─────────────────────── */

type Summary = { order_sn: string; order_status: string };
const fixture = {
  summaries: [] as Summary[],
  hasMore: false,
  details: {} as Record<string, Record<string, unknown>>,
  listCalls: 0,
  detailCalls: 0,
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
  if (pathname === "/api/v2/order/get_order_list") {
    fixture.listCalls += 1;
    const raw = JSON.stringify({
      response: {
        order_list: fixture.summaries,
        has_more: fixture.hasMore,
        total_count: fixture.summaries.length,
      },
    });
    return { ok: true, status: 200, text: async () => raw, json: async () => JSON.parse(raw) };
  }
  if (pathname === "/api/v2/order/get_order_detail") {
    fixture.detailCalls += 1;
    const body = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as {
      order_sn_list?: string[];
    };
    const list = (body.order_sn_list ?? [])
      .map((sn) => fixture.details[sn])
      .filter((d): d is Record<string, unknown> => Boolean(d));
    const raw = JSON.stringify({ response: { order_list: list } });
    return { ok: true, status: 200, text: async () => raw, json: async () => JSON.parse(raw) };
  }
  const notFound = JSON.stringify({ error: "unknown_path", message: pathname });
  return {
    ok: false,
    status: 404,
    text: async () => notFound,
    json: async () => JSON.parse(notFound),
  };
}) as typeof fetch;

/* ─────────────────────────── Fixture ─────────────────────────── */

const SN1 = "SHP-M8B-001";
const SN2 = "SHP-M8B-002";
const T1 = Math.floor(Date.now() / 1000) - 7200;
const T0 = T1 - 600;

fixture.details[SN1] = {
  order_sn: SN1,
  order_status: "READY_TO_SHIP",
  create_time: T0,
  payment_time: T0 + 60,
  payment_method: "COD",
  currency: "IDR",
  amount: 100000,
  buyer_username: "buyer-m8b",
  shipping_address: {
    name: "Budi",
    phone: "0812000000",
    address: "Jl. Kenanga No 1",
    district: "Cilandak",
    city: "Jakarta Selatan",
    province: "DKI Jakarta",
  },
  items: [
    { item_id: 111, model_id: 222, sku: "SPU-1", name: "Kaos Kaki Sport", original_price: 50000, quantity: 2 },
  ],
  packages: [{ package_number: "PKG-M8B-1", logistics_status: "PENDING" }],
};
fixture.details[SN2] = {
  ...fixture.details[SN1],
  order_sn: SN2,
  items: [
    { item_id: 111, model_id: 333, sku: "SPU-1", name: "Kaos Kaki Sport", original_price: 50000, quantity: 3 },
  ],
  packages: [{ package_number: "PKG-M8B-2", logistics_status: "PENDING" }],
};
fixture.summaries = [{ order_sn: SN1, order_status: "READY_TO_SHIP" }];

await prisma.business.create({ data: { id: "business-default", name: "Default" } });
const business = await prisma.business.create({ data: { name: "M8b Order Sync" } });
const acct = await prisma.platformAccount.create({
  data: {
    platform: "SHOPEE",
    label: "Shopee M8b utama",
    businessId: business.id,
    accessToken: "tok-shopee-m8b",
    externalShopId: "777888",
  },
});
const acct2 = await prisma.platformAccount.create({
  data: {
    platform: "SHOPEE",
    label: "Shopee M8b rate-limit",
    businessId: business.id,
    accessToken: "tok-shopee-m8b-2",
    externalShopId: "777999",
  },
});
const acct3 = await prisma.platformAccount.create({
  data: { platform: "SHOPEE", label: "Shopee M8b tanpa token", businessId: business.id },
});
const master = await prisma.masterProduct.create({
  data: { name: "Produk M8b", businessId: business.id, threshold: 2 },
});
const variant = await prisma.productVariant.create({
  data: { sku: "SPU-1", stock: 10, masterProductId: master.id },
});
await prisma.productMapping.create({
  data: { channelSku: "SPU-1", variantId: variant.id, accountId: acct.id, updatedAt: new Date() },
});

const stockOf = async () =>
  (await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock;
const ledgerCount = (reason: string) => prisma.stockLedger.count({ where: { reason } });

console.log("=== M8b A6: Shopee order sync & webhook ===");

await ok("T1 A1: peta kanonisasi — webhook & ingest memakai SATU peta", () => {
  assert.equal(SHOPEE_STATUS_MAP.READY_TO_SHIP, "AWAITING_SHIPMENT");
  assert.equal(SHOPEE_STATUS_MAP.SHIPPED, "IN_TRANSIT");
  assert.equal(SHOPEE_STATUS_MAP.CANCELLED, "CANCELLED");
  assert.equal(SHOPEE_STATUS_MAP.REFUNDED, "REFUNDED");
  assert.equal(SHOPEE_STATUS_MAP.RETURNED, "CANCELLED"); // retur → restore
  assert.equal(canonicalShopeeStatus("TOTALLY_UNKNOWN"), "TOTALLY_UNKNOWN"); // fallback
});

await ok("T2: ingest idempotent — create 1×, deduct 1×; run ulang skip", async () => {
  const res = await syncOrdersShopee(acct.id);
  assert.equal(res.errors.length, 0, JSON.stringify(res.errors));
  assert.equal(res.created, 1);
  assert.equal(res.fetched, 1);

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: (await prisma.order.findFirstOrThrow({ where: { orderNo: SN1 } })).id },
  });
  assert.equal(order.status, "AWAITING_SHIPMENT"); // kanonik, bukan RAW
  const mapping = await prisma.platformOrderMapping.findUniqueOrThrow({
    where: { accountId_externalOrderId: { accountId: acct.id, externalOrderId: SN1 } },
  });
  assert.equal(mapping.rawStatus, "READY_TO_SHIP"); // RAW tetap bahasa Shopee
  assert.equal(await stockOf(), 8); // 10 - 2
  assert.equal(await ledgerCount("ORDER"), 1);
  const shipment = await prisma.shipment.findFirstOrThrow({
    where: { accountId: acct.id, externalId: "PKG-M8B-1" },
  });
  assert.equal(shipment.status, "PENDING");

  const run2 = await syncOrdersShopee(acct.id);
  assert.equal(run2.created, 0);
  assert.equal(run2.skipped, 1);
  assert.equal(await stockOf(), 8);
  assert.equal(await ledgerCount("ORDER"), 1); // tidak menggandakan
  assert.equal(await prisma.order.count({ where: { orderNo: SN1 } }), 1);
});

await ok("T3 A4: refresh progress-only — naik status tanpa re-create / re-deduct", async () => {
  const detailCallsBefore = fixture.detailCalls;
  fixture.summaries = [{ order_sn: SN1, order_status: "SHIPPED" }];
  const res = await syncOrdersShopee(acct.id);
  assert.equal(res.errors.length, 0, JSON.stringify(res.errors));
  assert.equal(res.created, 0);
  const order = await prisma.order.findFirstOrThrow({ where: { orderNo: SN1 } });
  assert.equal(order.status, "IN_TRANSIT");
  const mapping = await prisma.platformOrderMapping.findUniqueOrThrow({
    where: { accountId_externalOrderId: { accountId: acct.id, externalOrderId: SN1 } },
  });
  assert.equal(mapping.rawStatus, "SHIPPED");
  assert.equal(fixture.detailCalls, detailCallsBefore); // A4: tanpa tarik detail
  assert.equal(await prisma.order.count({ where: { orderNo: SN1 } }), 1); // tanpa duplikat
  assert.equal(await stockOf(), 8);
  assert.equal(await ledgerCount("ORDER"), 1); // deduct tidak diulang
});

await ok("T4: cancel → restore; run ulang tidak menggandakan restore", async () => {
  fixture.summaries = [{ order_sn: SN1, order_status: "CANCELLED" }];
  const res = await syncOrdersShopee(acct.id);
  assert.equal(res.errors.length, 0, JSON.stringify(res.errors));
  const order = await prisma.order.findFirstOrThrow({ where: { orderNo: SN1 } });
  assert.equal(order.status, "CANCELLED");
  assert.equal(await stockOf(), 10); // 8 + 2
  assert.equal(await ledgerCount("ORDER_CANCELLED"), 1);

  const run2 = await syncOrdersShopee(acct.id);
  assert.equal(run2.created, 0);
  assert.equal(await stockOf(), 10); // tidak double-restore
  assert.equal(await ledgerCount("ORDER_CANCELLED"), 1);
  assert.equal(await ledgerCount("ORDER"), 1);
});

const push = (sn: string, status: string, updateTime: number) => {
  const data = { order_sn: sn, order_status: status, update_time: updateTime };
  return { data, raw: JSON.stringify({ code: 3, shop_id: "777888", data }) };
};

await ok("T5 A2: push utk order belum pernah di-sync → auto-ingest 1×", async () => {
  const { data, raw } = push(SN2, "READY_TO_SHIP", T1);
  await handleShopeeOrderUpdate(acct.id, raw, data);

  assert.equal(await prisma.order.count({ where: { orderNo: SN2 } }), 1);
  const mapping = await prisma.platformOrderMapping.findUniqueOrThrow({
    where: { accountId_externalOrderId: { accountId: acct.id, externalOrderId: SN2 } },
  });
  assert.equal(mapping.rawStatus, "READY_TO_SHIP");
  assert.equal(mapping.lastWebhookUpdateTime, T1);
  const order = await prisma.order.findFirstOrThrow({ where: { orderNo: SN2 } });
  assert.equal(order.status, "AWAITING_SHIPMENT"); // kanonik
  const autoLogs = await prisma.syncLog.count({
    where: { accountId: acct.id, kind: "order_auto_ingest", status: "success" },
  });
  assert.equal(autoLogs, 1);
  assert.equal(await stockOf(), 7); // 10 - 3 (qty SN2) — efek stok dari push
  assert.equal(await ledgerCount("ORDER"), 2); // order1 + order2

  // Dobel-fire (payload identik) → stale-skip, tanpa ingest/deduct ganda.
  await handleShopeeOrderUpdate(acct.id, raw, data);
  assert.equal(await prisma.order.count({ where: { orderNo: SN2 } }), 1);
  assert.equal(
    await prisma.syncLog.count({
      where: { accountId: acct.id, kind: "order_auto_ingest", status: "success" },
    }),
    1,
    "auto-ingest tidak boleh jalan dua kali"
  );
  const skipped = await prisma.syncLog.findFirst({
    where: { accountId: acct.id, kind: "order_status_change", status: "skipped" },
    orderBy: { createdAt: "desc" },
  });
  assert.ok((skipped?.message ?? "").includes("stale/duplicate"));
  assert.equal(await stockOf(), 7);
  assert.equal(await ledgerCount("ORDER"), 2);
});

await ok("T6: cancel via webhook dobel-fire → 1× restore, fire ulang stale-skip", async () => {
  const { data, raw } = push(SN2, "CANCELLED", T1 + 100);
  await handleShopeeOrderUpdate(acct.id, raw, data);
  const order = await prisma.order.findFirstOrThrow({ where: { orderNo: SN2 } });
  assert.equal(order.status, "CANCELLED");
  assert.equal(await stockOf(), 10); // 7 + 3
  assert.equal(await ledgerCount("ORDER_CANCELLED"), 2); // order1 (T4) + order2

  await handleShopeeOrderUpdate(acct.id, raw, data); // fire ulang
  assert.equal(await stockOf(), 10); // tidak double-restore
  assert.equal(await ledgerCount("ORDER_CANCELLED"), 2);
  assert.equal(await ledgerCount("ORDER"), 2);
});

await ok("T7 A5: has_more tak-berujung → berhenti di SHOPEE_ORDER_MAX_PAGES", async () => {
  process.env.SHOPEE_ORDER_MAX_PAGES = "3";
  fixture.summaries = [{ order_sn: SN1, order_status: "CANCELLED" }];
  fixture.hasMore = true; // selalu true — loop wajib dibatasi cap
  const before = fixture.listCalls;
  const res = await syncOrdersShopee(acct.id);
  const delta = fixture.listCalls - before;
  delete process.env.SHOPEE_ORDER_MAX_PAGES;
  fixture.hasMore = false;
  assert.equal(delta, 3, `list dipanggil ${delta}× (harus = cap 3, bukan tak-berujung)`);
  assert.equal(res.errors.length, 0);
  assert.equal(await prisma.order.count({ where: { orderNo: SN1 } }), 1); // SN1 CANCELLED == status → skip
  assert.equal(await stockOf(), 10); // tanpa efek tambahan
});

await ok("T8 A5: rate limit → result.errors + SyncLog kind=order_sync error", async () => {
  process.env.SHOPEE_ORDER_RATE_MAX = "1";
  fixture.hasMore = true; // paksa ≥2 panggilan list dalam 1 run
  const res = await syncOrdersShopee(acct2.id);
  delete process.env.SHOPEE_ORDER_RATE_MAX;
  fixture.hasMore = false;
  assert.equal(res.created, 0);
  assert.ok(
    res.errors.some((e) => e.includes("rate limit")),
    JSON.stringify(res.errors)
  );
  const log = await prisma.syncLog.findFirstOrThrow({
    where: { accountId: acct2.id, kind: "order_sync", status: "error" },
  });
  assert.equal(log.direction, "in");
  assert.ok((log.errorMessage ?? "").includes("rate limit"));
});

await ok("T9 A3: sync paralel per akun → satu ditolak PullInProgressError", async () => {
  fixture.summaries = [{ order_sn: SN1, order_status: "CANCELLED" }];
  const [a, b] = await Promise.allSettled([
    syncOrdersShopee(acct.id),
    syncOrdersShopee(acct.id),
  ]);
  const rejected = [a, b].filter(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  );
  const fulfilled = [a, b].filter(
    (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof syncOrdersShopee>>> =>
      r.status === "fulfilled"
  );
  assert.equal(rejected.length, 1, "harus ada tepat satu yang ditolak");
  assert.equal(fulfilled.length, 1, "harus ada tepat satu yang jalan");
  assert.equal((rejected[0].reason as Error).name, "PullInProgressError");
  assert.ok((rejected[0].reason as Error).message.includes("sedang berjalan"));
  assert.ok(fulfilled[0].value.skipped >= 1); // sync yang jalan tetap selesai
});

await ok("T10 A2: push utk akun tanpa token → SyncLog auto_ingest error + hint", async () => {
  const { data, raw } = push("SHP-M8B-NO-TOKEN", "READY_TO_SHIP", T1 + 200);
  await handleShopeeOrderUpdate(acct3.id, raw, data);
  const log = await prisma.syncLog.findFirstOrThrow({
    where: { accountId: acct3.id, kind: "order_auto_ingest", status: "error" },
  });
  assert.ok((log.errorMessage ?? "").includes("sinkronisasi order manual"));
  // Tanpa partial state — order/mapping tidak ada.
  assert.equal(
    await prisma.order.count({ where: { orderNo: "SHP-M8B-NO-TOKEN" } }),
    0
  );
  assert.equal(
    await prisma.platformOrderMapping.count({
      where: { accountId: acct3.id, externalOrderId: "SHP-M8B-NO-TOKEN" },
    }),
    0
  );
});

await prisma.$disconnect();
db.cleanup();
console.log(`\nPASS: ${passed} test group (shopee-order-sync). DB fixture dihapus.`);
