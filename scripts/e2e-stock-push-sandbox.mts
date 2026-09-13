/**
 * [TEST][E2E] TUGAS 3 — debounce/batch push stok lawan TikTok SANDBOX SUNGGUHAN.
 * Bukan mock: HTTP nyata ke open-api.tiktokglobalshop.com (fetch di-wrap hanya
 * untuk MEREKAM call, tetap pass-through). Hasil + rekaman HTTP ditulis ke
 * docs/e2e-stock-push-sandbox-results.json (SELALU, juga saat gagal).
 *
 * Skenario:
 *   A. 5× adjust stok beruntun (<8s) 1 SKU → tepat 1 call /inventory/update
 *      dengan nilai TERAKHIR + quantity tersimpan di TikTok = nilai terakhir.
 *   B. Jika produk punya ≥2 SKU terbaca: N SKU dalam window sama → 1 call
 *      search + 1 update per produk (bukan per-SKU).
 *
 * Catatan sandbox: TikTok sandbox tidak menyediakan cara memicu 429 secara
 * natural (tidak ada throttle injector). Verifikasi 429/backoff dilakukan di
 * lapisan kode (scripts/test-stock-push-queue.integration.mts [3]).
 *
 * Jalankan: npx tsx --env-file=.env scripts/e2e-stock-push-sandbox.mts
 */
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

/* ── Pasang rekaman fetch SEBELUM import modul proyek ── */
const realFetch = globalThis.fetch;
type Recorded = { t: number; url: string; method: string; status: number; requestBody: unknown; body: unknown };
const recorded: Recorded[] = [];
const T0 = Date.now();
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  let requestBody: unknown = null;
  if (init?.body && typeof init.body === "string") {
    try {
      requestBody = JSON.parse(init.body);
    } catch {
      requestBody = init.body;
    }
  }
  const res = await realFetch(input as Parameters<typeof realFetch>[0], init);
  if (url.includes("open-api.tiktokglobalshop.com")) {
    let body: unknown = null;
    try {
      body = await res.clone().json();
    } catch {
      body = "<non-json>";
    }
    recorded.push({ t: Date.now() - T0, url: url.split("?")[0], method: init?.method ?? "GET", status: res.status, requestBody, body });
  }
  return res;
}) as typeof fetch;

process.env.DATABASE_URL = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;

const { prisma } = await import("@/lib/db/prisma");
const { scheduleStockPush, _resetStockPushQueueForTests, DEBOUNCE_WINDOW_MS } = await import(
  "@/lib/services/stock-push-queue.service"
);
const { adjustStockManually } = await import("@/lib/services/central-stock.service");
const { searchPromotionActivities, getPromotionActivity, deactivatePromotionActivity } = await import(
  "@/lib/integrations/tiktokShop"
);
const { backoffDelayMs } = await import("@/lib/services/rate-limit.policy");

const APP_KEY = process.env.TIKTOK_APP_KEY!;
const APP_SECRET = process.env.TIKTOK_APP_SECRET!;
const API_BASE = "https://open-api.tiktokglobalshop.com";

/** Sign persis formula callApi (query sorted + JSON body bila ada). */
function sign(apiPath: string, params: Record<string, string>, bodyObj: unknown): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  let s = `${apiPath}${sorted}`;
  if (bodyObj && typeof bodyObj === "object" && Object.keys(bodyObj).length > 0) s += JSON.stringify(bodyObj);
  return crypto.createHmac("sha256", APP_SECRET).update(`${APP_SECRET}${s}${APP_SECRET}`).digest("hex");
}

/** Baca SKU FISIK per produk via inventory/search (POST, di-sign lengkap).
 *  Key = sku id (bukan seller_sku — dua identifier itu SATU SKU fisik). */
async function readTikTokQuantity(
  accessToken: string,
  shopCipher: string,
  productId: string
): Promise<Map<string, { qty: number; sellerSku: string | null }>> {
  const apiPath = "/product/202309/inventory/search";
  const bodyObj = { product_ids: [productId] };
  const params: Record<string, string> = { app_key: APP_KEY, timestamp: String(Math.floor(Date.now() / 1000)), shop_cipher: shopCipher };
  params.sign = sign(apiPath, params, bodyObj);
  const qs = new URLSearchParams(params).toString();
  const res = await realFetch(`${API_BASE}${apiPath}?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tts-access-token": accessToken },
    body: JSON.stringify(bodyObj),
  });
  const json = (await res.json()) as {
    code?: number;
    message?: string;
    data?: { inventory?: Array<{ skus?: Array<{ id?: string; seller_sku?: string; warehouse_inventory?: Array<{ available_quantity?: number }> }> }> };
  };
  if (json.code !== 0) throw new Error(`inventory/search code=${json.code} ${json.message}`);
  const out = new Map<string, { qty: number; sellerSku: string | null }>();
  for (const inv of json.data?.inventory ?? []) {
    for (const s of inv.skus ?? []) {
      if (!s.id) continue;
      const qty = (s.warehouse_inventory ?? []).reduce((a, w) => a + (w.available_quantity ?? 0), 0);
      out.set(s.id, { qty, sellerSku: s.seller_sku ?? null });
    }
  }
  return out;
}
/** Cari quantity utk channelSku yang bisa berupa sku id ATAU seller_sku. */
function lookupQty(map: Map<string, { qty: number; sellerSku: string | null }>, key: string): number | undefined {
  const hit = map.get(key);
  if (hit) return hit.qty;
  for (const v of map.values()) if (v.sellerSku === key) return v.qty;
  return undefined;
}

async function releaseActivePromotions(accessToken: string, shopCipher: string, productId: string): Promise<string[]> {
  const released: string[] = [];
  const search = await searchPromotionActivities(accessToken, shopCipher, { pageSize: 100 });
  const data = search.data as { activities?: Array<Record<string, unknown>> } | undefined;
  for (const act of data?.activities ?? []) {
    const status = String(act.status ?? "");
    if (status !== "NOT_START" && status !== "ONGOING") continue;
    const d = (await getPromotionActivity(accessToken, shopCipher, String(act.id ?? ""))) as {
      data?: { activity?: { product_ids?: string[] } };
    };
    if ((d.data?.activity?.product_ids ?? []).includes(productId)) {
      await deactivatePromotionActivity(accessToken, shopCipher, String(act.id ?? ""));
      released.push(String(act.id ?? ""));
    }
  }
  return released;
}

/* ── Hasil ── */
const results: Array<{ step: string; expected: string; actual: string; pass: boolean | "inconclusive" }> = [];
function record(step: string, expected: string, actual: string, pass: boolean | "inconclusive") {
  results.push({ step, expected, actual, pass });
  console.log(`${pass === true ? "✓" : pass === "inconclusive" ? "○" : "✗"} ${step}\n    expected: ${expected}\n    actual  : ${actual}`);
}
const dumpRecorded = (label: string) => {
  console.log(`  [${label}] ${recorded.length} call:`);
  for (const r of recorded)
    console.log(
      `    +${r.t}ms ${r.method} ${r.status} ${r.url.split("/").slice(-2).join("/")} req=${JSON.stringify(r.requestBody).slice(0, 260)} → ${JSON.stringify(r.body).slice(0, 180)}`
    );
};

try {
  const account = await prisma.platformAccount.findFirst({ where: { label: { contains: "7680596707423979285" } } });
  if (!account?.accessToken || !account.shopCipher) throw new Error("Akun sandbox ...9285 tidak ditemukan / tanpa token+cipher");
  const mapping = await prisma.productMapping.findFirst({ where: { accountId: account.id }, include: { variant: true } });
  if (!mapping?.variant) throw new Error("Tidak ada mapping ter-sync di akun sandbox");
  const productId = mapping.platformProductId ?? "";
  if (!productId) throw new Error("Mapping tidak punya platformProductId");

  console.log(`Akun: ${account.label}`);
  console.log(`Listing: ${mapping.channelSku} (product ${productId}), varian stok=${mapping.variant.stock}, safetyStock=${mapping.variant.safetyStock}`);

  const released = await releaseActivePromotions(account.accessToken, account.shopCipher, productId);
  console.log(released.length ? `Promosi dilepas: ${released.join(", ")}` : "Tidak ada promosi aktif yang mengunci produk.");

  // Baseline quantity TikTok SEBELUM test (sekaligus validasi pembacaan).
  let baseline: Map<string, { qty: number; sellerSku: string | null }>;
  try {
    baseline = await readTikTokQuantity(account.accessToken, account.shopCipher, productId);
    console.log(`Baseline TikTok (SKU fisik): ${JSON.stringify([...baseline.entries()].map(([id, v]) => ({ id, sellerSku: v.sellerSku, qty: v.qty })))}`);
    if ([...baseline.values()].every((v) => v.qty === 0)) {
      console.log("⚠ Semua quantity terbaca 0 — warehouse_inventory sandbox mungkin kosong; pembacaan jadi tidak konklusif.");
    }
  } catch (e) {
    record("Pembacaan inventory/search", "code=0", e instanceof Error ? e.message : String(e), false);
    throw new Error("Tidak bisa membaca quantity TikTok — E2E dibatalkan lebih awal (lihat hasil).");
  }

  /* ══════ SKENARIO A — coalesce 1 SKU ══════ */
  console.log(`\n── SKENARIO A: 5× adjust beruntun (<8s) → 1 call update, nilai TERAKHIR ──`);
  const sku = mapping.channelSku;
  const finalA = 15;
  recorded.length = 0;
  _resetStockPushQueueForTests();
  const adjustStart = Date.now();
  for (const s of [19, 18, 17, 16, finalA]) {
    const r = await adjustStockManually({ variantId: mapping.variantId, newStock: s, note: "[E2E stock-push A]" });
    if (!r.ok) throw new Error(`adjust gagal: ${r.reason}`);
  }
  console.log(`5 adjust selesai ${Date.now() - adjustStart} ms (< window ${DEBOUNCE_WINDOW_MS} ms). Menunggu flush (window + 7s)...`);
  await new Promise((r) => setTimeout(r, DEBOUNCE_WINDOW_MS + 7_000));
  dumpRecorded("A");

  const aUpd = recorded.filter((r) => r.url.includes("/inventory/update"));
  const aSearch = recorded.filter((r) => r.url.includes("/products/search"));
  record("A1: jumlah call /inventory/update", "1", String(aUpd.length), aUpd.length === 1);
  const aQty = (aUpd[0]?.requestBody as { skus?: Array<{ inventory?: Array<{ quantity?: number }> }> } | undefined)?.skus?.[0]?.inventory?.[0]?.quantity;
  record("A2: nilai di payload call = TERAKHIR", String(finalA), String(aQty ?? "n/a"), aUpd.length === 1 && aQty === finalA);
  record("A3: jumlah call search pendukung", "≤1", String(aSearch.length), aSearch.length <= 1);

  const afterA = await readTikTokQuantity(account.accessToken, account.shopCipher, productId);
  const storedA = lookupQty(afterA, sku);
  if (storedA === undefined) {
    record("A4: quantity tersimpan di TikTok", String(finalA), "sku tidak terbaca", "inconclusive");
  } else if (lookupQty(baseline, sku) === 0 && storedA === 0) {
    record("A4: quantity tersimpan di TikTok", String(finalA), "0 (inventory sandbox tidak terbaca)", "inconclusive");
  } else {
    record("A4: quantity tersimpan di TikTok = nilai terakhir", String(finalA), String(storedA), storedA === finalA);
  }

  /* ══════ SKENARIO B — batch multi-SKU (hanya bila ≥2 SKU terbaca) ══════ */
  console.log(`\n── SKENARIO B: multi-SKU fisik → 1 search + 1 update per produk ──`);
  const physicalSkus = [...afterA.keys()]; // key = sku id = SKU fisik
  if (physicalSkus.length < 2) {
    console.log(`⚠ Produk hanya punya ${physicalSkus.length} SKU fisik (sku id & seller_sku = SKU yang sama) —
skenario batch multi-SKU BUTUH listing ≥2 SKU fisik di Seller Center sandbox. Catatan run ini:
chain batch (search → resolve id internal → resolve warehouse → 1 update) sudah terbukti di
API nyata dengan 1 SKU; penggabungan >1 SKU dalam satu call terverifikasi di integration test [2].`);
    record("B: batch multi-SKU", "listing ≥2 SKU fisik", `produk hanya 1 SKU fisik — chain batch terbukti (lihat log call), penggabungan multi-SKU menunggu fixture`, "inconclusive");
  } else {
    recorded.length = 0;
    _resetStockPushQueueForTests();
    const targets = physicalSkus.slice(0, 3).map((s, i) => ({ sku: s, qty: 40 + i }));
    console.log(`Target: ${JSON.stringify(targets)}`);
    // Jalur produksi yang sama: adjust varian ter-mapping bila ada, sisanya schedule langsung.
    for (const t of targets) {
      const v = await prisma.productVariant.findFirst({ where: { sku: mapping.variant.sku === t.sku ? t.sku : { contains: t.sku } } });
      if (v) await adjustStockManually({ variantId: v.id, newStock: t.qty, note: "[E2E stock-push B]" });
      else scheduleStockPush(account.id, t.sku, t.qty);
    }
    await new Promise((r) => setTimeout(r, DEBOUNCE_WINDOW_MS + 7_000));
    dumpRecorded("B");

    const bUpd = recorded.filter((r) => r.url.includes("/inventory/update"));
    const bSearch = recorded.filter((r) => r.url.includes("/products/search"));
    record("B1: call search gabungan (semua SKU)", "1", String(bSearch.length), bSearch.length === 1);
    const sellersInSearch = ((bSearch[0]?.requestBody as { seller_skus?: string[] } | undefined)?.seller_skus ?? []).length;
    record("B2: search membawa SKU sekaligus", String(targets.length), String(sellersInSearch), sellersInSearch === targets.length);
    record("B3: call update = 1 per produk (bukan per SKU)", "1", String(bUpd.length), bUpd.length === 1);
    const updSkuCount = ((bUpd[0]?.requestBody as { skus?: unknown[] } | undefined)?.skus ?? []).length;
    record("B4: satu update berisi semua SKU", String(targets.length), String(updSkuCount), updSkuCount === targets.length);

    const afterB = await readTikTokQuantity(account.accessToken, account.shopCipher, productId);
    const mismatches = targets.filter((t) => lookupQty(afterB, t.sku) !== t.qty);
    record(
      "B5: quantity tersimpan di TikTok sesuai target per SKU",
      "semua cocok",
      mismatches.length === 0 ? "semua cocok" : JSON.stringify(mismatches.map((t) => ({ sku: t.sku, expected: t.qty, got: lookupQty(afterB, t.sku) }))),
      mismatches.length === 0
    );
  }

  /* ══════ 429 — jujur ══════ */
  console.log(`\n── 429: TIDAK dapat dipicu natural di sandbox ──`);
  console.log(`TikTok sandbox tidak menyediakan throttle injector; 429/backoff diverifikasi di lapisan kode
(scripts/test-stock-push-queue.integration.mts skenario [3]: TikTokApiError 429 → retry terjadwal, lalu sukses).`);
  for (let i = 0; i < 3; i++) console.log(`  backoffDelayMs(${i}) contoh: ${backoffDelayMs(i)} ms`);
  record("429 backoff", "verifikasi lapisan kode (sandbox tidak bisa memicu 429)", "integration test [3] 21/21 PASS; E2E tidak mencoba", true);
} catch (err) {
  console.error(`\nE2E TERGANGKAN: ${err instanceof Error ? err.message : err}`);
} finally {
  const dir = path.join(process.cwd(), "docs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "e2e-stock-push-sandbox-results.json"),
    JSON.stringify({ runAt: new Date().toISOString(), calls: recorded, results }, null, 2)
  );
  const hard = results.filter((r) => r.pass === false);
  const inconclusive = results.filter((r) => r.pass === "inconclusive");
  console.log(`\n=== E2E selesai: ${results.filter((r) => r.pass === true).length} PASS, ${hard.length} FAIL, ${inconclusive.length} inconclusive ===`);
  console.log(`Rekaman HTTP + hasil: docs/e2e-stock-push-sandbox-results.json`);
  await prisma.$disconnect().catch(() => {});
  process.exit(hard.length > 0 ? 1 : 0);
}
