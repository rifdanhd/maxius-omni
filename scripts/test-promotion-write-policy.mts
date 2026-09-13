/**
 * [TEST] Unit test policy promotion WRITE — jalan tanpa DB & tanpa jaringan
 * (semua fungsi murni dari lib/services/promotion-write.policy.ts).
 *
 * Cara jalankan:  npx tsx scripts/test-promotion-write.policy.mts
 * Exit 0 = semua pass; exit 1 = ada assertion gagal.
 *
 * Cakupan sesuai permintaan reviewer (Tahap 2):
 * 1. Harga normal & pembulatan (G1 happy path)
 * 2. Ambang diskon 1% / 95% / 96%+ / 0% → G2 (extreme butuh konfirmasi eksplisit)
 * 3. Produk tanpa harga sumber → G1 ditolak
 * 4. Overlap activity AKTIF → G3 warn; activity BERAKHIR → tidak memblock
 */
import assert from "node:assert";
import {
  computePriceRow,
  classifyOverlap,
  extremeDiscountConfirmMessage,
  isActivePromotionStatus,
  validateDiscount,
  validateSchedule,
  type ExistingActivityLike,
} from "../lib/services/promotion-write.policy";

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("=== G1: computePriceRow ===");
ok("harga normal: 100.000 diskon 10% → 90.000, tanpa error", () => {
  const row = computePriceRow(
    { price: 100000, priceSource: "MAPPING_OVERRIDE", displayName: "Produk A", channelSku: "SKU-A", platformProductId: "p1" },
    10
  );
  assert.equal(row.error, null);
  assert.equal(row.finalPrice, 90000);
});
ok("pembulatan rupiah: 9.999 diskon 15% → 8.499", () => {
  const row = computePriceRow(
    { price: 9999, priceSource: "VARIANT_DEFAULT", displayName: "Produk B", channelSku: "SKU-B", platformProductId: "p2" },
    15
  );
  assert.equal(row.finalPrice, 8499);
});
ok("G1 DITOLAK: tanpa harga sumber (null) → finalPrice null + error", () => {
  const row = computePriceRow(
    { price: null, priceSource: null, displayName: "Produk C", channelSku: "SKU-C", platformProductId: "p3" },
    10
  );
  assert.equal(row.finalPrice, null);
  assert.ok(row.error && row.error.length > 0, "harus ada pesan error");
});
ok("G1 DITOLAK: harga 0 / negatif dianggap tidak valid", () => {
  for (const price of [0, -5000]) {
    const row = computePriceRow(
      { price, priceSource: "MAPPING_OVERRIDE", displayName: "X", channelSku: "S", platformProductId: "px" },
      10
    );
    assert.equal(row.finalPrice, null);
    assert.ok(row.error);
  }
});

console.log("=== G2: validateDiscount (ambang 1 / 95 / 96+ / 0) ===");
ok("1% = batas bawah → OK tanpa konfirmasi", () => {
  assert.equal(validateDiscount(1), null);
});
ok("95% = batas atas kebijakan → OK tanpa konfirmasi", () => {
  assert.equal(validateDiscount(95), null);
});
ok("96% TANPA konfirmasi → EXTREME_DISCOUNT (needsDoubleConfirm)", () => {
  const issue = validateDiscount(96);
  assert.ok(issue && issue.kind === "EXTREME_DISCOUNT");
  assert.equal((issue as { needsDoubleConfirm?: boolean }).needsDoubleConfirm, true);
});
ok("96% DENGAN konfirmasi eksplisit → lolos", () => {
  assert.equal(validateDiscount(96, true), null);
});
ok("0% → EXTREME (gratis), 100% + konfirmasi → lolos, -1% & 101% → OUT_OF_RANGE", () => {
  assert.ok(validateDiscount(0)?.kind === "EXTREME_DISCOUNT");
  assert.equal(validateDiscount(100, true), null);
  assert.ok(validateDiscount(-1)?.kind === "OUT_OF_RANGE");
  assert.ok(validateDiscount(101)?.kind === "OUT_OF_RANGE");
});
ok("12.5 (non-integer) → NOT_INTEGER, tidak bisa dikonfirmasi", () => {
  assert.ok(validateDiscount(12.5, true)?.kind === "NOT_INTEGER");
});
ok("pesan konfirmasi extreme MENYEBUT DAMPAK NYATA (hampir gratis / gratis + Rp)", () => {
  const almost = extremeDiscountConfirmMessage("Keripik RIKI", 96, 4000);
  assert.ok(almost.includes("HAMPIR GRATIS"), "harus sebut 'HAMPIR GRATIS'");
  assert.ok(almost.includes("Rp 4.000"), "harus sebut harga final");
  assert.ok(almost.includes("Keripik RIKI"), "harus sebut nama produk");
  const free = extremeDiscountConfirmMessage("Produk X", 0, 0);
  assert.ok(free.includes("GRATIS") && free.includes("Rp 0"));
});

console.log("=== G3: classifyOverlap (aktif vs berakhir) ===");
const NOW = new Date("2026-09-10T12:00:00Z");
const d = (iso: string) => new Date(iso);
const newWindow = { start: d("2026-09-12T00:00:00Z"), end: d("2026-09-20T00:00:00Z") };

function act(
  id: string,
  status: string,
  startsAt: Date,
  endsAt: Date,
  productIds: string[]
): ExistingActivityLike {
  return { externalActivityId: id, title: `T ${id}`, status, startsAt, endsAt, productIds: new Set(productIds) };
}

ok("activity ONGOING tumpang tindih → ACTIVE (warn), FULL bila window lama di dalam baru", () => {
  const verdict = classifyOverlap(
    "p1",
    newWindow.start,
    newWindow.end,
    [act("a1", "ONGOING", d("2026-09-13T00:00:00Z"), d("2026-09-15T00:00:00Z"), ["p1"])],
    NOW
  );
  assert.equal(verdict.active.length, 1);
  assert.equal(verdict.active[0].overlapKind, "FULL");
  assert.equal(verdict.past.length, 0);
});
ok("activity ONGOING menempel sebagian → PARTIAL", () => {
  const verdict = classifyOverlap("p1", newWindow.start, newWindow.end, [
    act("a2", "ONGOING", d("2026-09-10T00:00:00Z"), d("2026-09-13T00:00:00Z"), ["p1"]),
    ],
    NOW
  );
  assert.equal(verdict.active.length, 1);
  assert.equal(verdict.active[0].overlapKind, "PARTIAL");
});
ok("G3 KUNCI: activity BERAKHIR (DEACTIVATED) tumpang tindih → TIDAK memblock (past saja)", () => {
  const verdict = classifyOverlap("p1", newWindow.start, newWindow.end, [
    act("a3", "DEACTIVATED", d("2026-09-13T00:00:00Z"), d("2026-09-15T00:00:00Z"), ["p1"]),
    ],
    NOW
  );
  assert.equal(verdict.active.length, 0, "produk tidak boleh diblok oleh activity berakhir");
  assert.equal(verdict.past.length, 1);
});
ok("G3 KUNCI: EXPIRED/NOT_EFFECTIVE → past; ONGOING tapi jadwal sudah lewat → past", () => {
  const verdict = classifyOverlap("p1", newWindow.start, newWindow.end, [
    act("a4", "EXPIRED", d("2026-09-13T00:00:00Z"), d("2026-09-15T00:00:00Z"), ["p1"]),
    act("a5", "NOT_EFFECTIVE", d("2026-09-13T00:00:00Z"), d("2026-09-16T00:00:00Z"), ["p1"]),
    act("a6", "ONGOING", d("2026-09-01T00:00:00Z"), d("2026-09-02T00:00:00Z"), ["p1"]),
    ],
    NOW
  );
  assert.equal(verdict.active.length, 0);
  assert.equal(verdict.past.length, 3);
});
ok("G3: NOT_START (akan datang) tumpang tindih → ACTIVE; tanpa overlap waktu → tidak ada warn", () => {
  const overlapping = classifyOverlap("p1", newWindow.start, newWindow.end, [
    act("a7", "NOT_START", d("2026-09-19T00:00:00Z"), d("2026-09-25T00:00:00Z"), ["p1"]),
    ],
    NOW
  );
  assert.equal(overlapping.active.length, 1);
  const disjoint = classifyOverlap("p1", newWindow.start, newWindow.end, [
    act("a8", "NOT_START", d("2026-10-01T00:00:00Z"), d("2026-10-05T00:00:00Z"), ["p1"]),
    ],
    NOW
  );
  assert.equal(disjoint.active.length, 0);
  assert.equal(disjoint.past.length, 0);
});
ok("STABIL: hasil hanya tergantung `now` injeksi, bukan jam sistem", () => {
  const fixture = [act("a2", "ONGOING", d("2026-09-10T00:00:00Z"), d("2026-09-13T00:00:00Z"), ["p1"])];
  const atFixtureTime = classifyOverlap("p1", newWindow.start, newWindow.end, fixture, NOW);
  assert.equal(atFixtureTime.active.length, 1, "now=fixture → ACTIVE/PARTIAL");
  assert.equal(atFixtureTime.active[0].overlapKind, "PARTIAL");
  const farFuture = classifyOverlap(
    "p1",
    newWindow.start,
    newWindow.end,
    fixture,
    d("2027-01-01T00:00:00Z")
  );
  assert.equal(farFuture.active.length, 0, "now jauh setelah endsAt → past");
  assert.equal(farFuture.past.length, 1);
  // Deterministik: now yang sama → hasil sama, kapan pun test dijalankan.
  const repeat = classifyOverlap("p1", newWindow.start, newWindow.end, fixture, NOW);
  assert.deepEqual(repeat, atFixtureTime);
});
ok("produk lain (p2) tidak terpengaruh activity yang hanya memuat p1", () => {
  const verdict = classifyOverlap("p2", newWindow.start, newWindow.end, [
    act("a9", "ONGOING", d("2026-09-13T00:00:00Z"), d("2026-09-15T00:00:00Z"), ["p1"]),
    ],
    NOW
  );
  assert.equal(verdict.active.length, 0);
});
ok("isActivePromotionStatus: hanya ONGOING & NOT_START", () => {
  assert.equal(isActivePromotionStatus("ONGOING"), true);
  assert.equal(isActivePromotionStatus("NOT_START"), true);
  for (const s of ["DEACTIVATED", "ENDED", "EXPIRED", "NOT_EFFECTIVE", "DRAFT"]) {
    assert.equal(isActivePromotionStatus(s), false);
  }
});

console.log("=== validateSchedule (review #5: default besok, minimal +2 jam) ===");
ok("begin +1 jam → LEAD_TIME_TOO_SHORT; begin tepat +2 jam → OK", () => {
  const now = NOW;
  const tooSoon = validateSchedule(new Date(now.getTime() + 3600000), d("2026-09-13T00:00:00Z"), now);
  assert.equal(tooSoon?.kind, "LEAD_TIME_TOO_SHORT");
  const exact = validateSchedule(new Date(now.getTime() + 2 * 3600000), d("2026-09-13T00:00:00Z"), now);
  assert.equal(exact, null);
});
ok("end <= begin → END_BEFORE_START; durasi 91 hari → TOO_LONG; normal → OK", () => {
  const now = NOW;
  assert.equal(validateSchedule(d("2026-09-12T00:00:00Z"), d("2026-09-11T00:00:00Z"), now)?.kind, "END_BEFORE_START");
  const long = validateSchedule(
    d("2026-09-12T00:00:00Z"),
    new Date(d("2026-09-12T00:00:00Z").getTime() + 91 * 86400000),
    now
  );
  assert.equal(long?.kind, "TOO_LONG");
  assert.equal(validateSchedule(d("2026-09-13T00:00:00Z"), d("2026-09-15T00:00:00Z"), now), null);
});

console.log(`\nPASS: ${passed} test group, semua assertion lolos.`);
