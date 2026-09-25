/**
 * [TEST] Null-variant:
 *   Batch 1 — listing Shopee & TikTok null-safe + recordSale throw path.
 *   Batch 2 — pricing override, promotion preview/create, TikTok edit load/submit.
 *   Batch 3 — draft harga promo: key/matching per mappingId (bukan variantId mentah).
 *   Batch 4 — tab TikTok: produk unmapped tidak salah jatuh ke tab "Habis" (backlog).
 *
 * Jalankan: npx tsx scripts/test-null-variant.mts
 */

const { prisma } = await import("@/lib/db/prisma");
const { listShopeeProducts } = await import("@/lib/services/marketplace-shopee.service");
const { listTikTokProducts } = await import("@/lib/services/marketplace-tiktok.service");
const { recordSale } = await import("@/lib/services/sales.service");
const { updateMappingPrice } = await import("@/lib/services/pricing.service");
const { previewPromotion } = await import("@/lib/services/promotion-write.service");
const { revalidateForCreate } = await import("@/lib/services/promotion-write.service-create");
const { loadTikTokEditData, submitTikTokEdit } = await import(
  "@/lib/services/marketplace-tiktok-edit.service"
);
const { applyVariantPrice, isSameVariant, setVariantDraft, variantIdentityKey } = await import(
  "@/lib/services/promotion-listing-identity"
);

let passed = 0;
const ok = (cond: boolean, label: string) => {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
};

/**
 * Widening ke string — assertion tab bisa ditulis SEBELUM tipe TikTokTabKey
 * diperkaya (run merah), tetap valid sesudahnya tanpa `as`.
 */
const tabStr = (r: { tab: string | null } | undefined) => r?.tab ?? "(tidak ada baris)";
const countOf = (counts: Record<string, number>, key: string) => counts[key] ?? -1;

/* ── Fixture ── */
const BIZ = "b1-test-null-variant";
await prisma.business.create({ data: { id: BIZ, name: "B1 Null Variant Test" } });
await prisma.platformAccount.create({
  data: { id: "b1-acct-shopee", platform: "SHOPEE", label: "B1 Shopee", businessId: BIZ },
});
await prisma.platformAccount.create({
  data: { id: "b1-acct-tiktok", platform: "TIKTOK_SHOP", label: "B1 TikTok", businessId: BIZ },
});
await prisma.masterProduct.create({
  data: { id: "b1-master", name: "B1 Product", businessId: BIZ },
});
await prisma.productVariant.create({
  data: { id: "b1-var1", sku: "B1-SKU-1", stock: 42, price: 1000, masterProductId: "b1-master" },
});
// Shopee: 1 unmapped (variantId NULL, platformStock NULL) + 1 mapped
await prisma.productMapping.create({
  data: { id: "b1-map-shopee-null", channelSku: "B1-SH-NULL", variantId: null, accountId: "b1-acct-shopee", updatedAt: new Date() },
});
await prisma.productMapping.create({
  data: { id: "b1-map-shopee-real", channelSku: "B1-SH-REAL", variantId: "b1-var1", accountId: "b1-acct-shopee", updatedAt: new Date() },
});
// TikTok: 1 unmapped dgn platformStock=7 (uji precedence) + 1 mapped
await prisma.productMapping.create({
  data: { id: "b1-map-ttk-null", channelSku: "B1-TT-NULL", variantId: null, accountId: "b1-acct-tiktok", platformStock: 7, platformStatus: "ACTIVE", updatedAt: new Date() },
});
await prisma.productMapping.create({
  data: { id: "b1-map-ttk-real", channelSku: "B1-TT-REAL", variantId: "b1-var1", accountId: "b1-acct-tiktok", platformStatus: "ACTIVE", updatedAt: new Date() },
});

// Batch 2 — bisnis terpisah supaya assertion listing Batch 1 (total=2) tak terpengaruh.
const BIZ2 = "b2-test-null-variant";
await prisma.business.create({ data: { id: BIZ2, name: "B2 Null Variant Test" } });
await prisma.platformAccount.create({
  data: {
    id: "b2-acct-tiktok",
    platform: "TIKTOK_SHOP",
    label: "B2 TikTok",
    businessId: BIZ2,
    accessToken: "fake-token",
    shopCipher: "fake-cipher",
  },
});
// unmapped tanpa harga sumber
await prisma.productMapping.create({
  data: { id: "b2-tt-noprice", channelSku: "B2-TT-NOPRICE", variantId: null, accountId: "b2-acct-tiktok", platformProductId: "B2-P1", platformStatus: "ACTIVE", updatedAt: new Date() },
});
// unmapped TAPI punya harga override mapping
await prisma.productMapping.create({
  data: { id: "b2-tt-override", channelSku: "B2-TT-OVERRIDE", variantId: null, accountId: "b2-acct-tiktok", platformProductId: "B2-P2", platformStatus: "ACTIVE", price: 50000, updatedAt: new Date() },
});

// Batch 4 — listing campur 1 platformProductId: 1 varian mapped + 1 unmapped.
await prisma.masterProduct.create({ data: { id: "b4-master", name: "B4 Product", businessId: BIZ2 } });
await prisma.productVariant.create({
  data: { id: "b4-var", sku: "B4-SKU-1", stock: 10, price: 7000, masterProductId: "b4-master" },
});
await prisma.productMapping.create({
  data: { id: "b4-tt-mapped", channelSku: "B4-TT-MAPPED", variantId: "b4-var", accountId: "b2-acct-tiktok", platformProductId: "B4-P1", platformStatus: "ACTIVE", updatedAt: new Date() },
});
await prisma.productMapping.create({
  data: { id: "b4-tt-unmapped", channelSku: "B4-TT-UNMAPPED", variantId: null, accountId: "b2-acct-tiktok", platformProductId: "B4-P1", platformStatus: "ACTIVE", updatedAt: new Date() },
});

try {
  console.log("=== listShopeeProducts ===");
  const shopee = await listShopeeProducts({ businessId: BIZ });
  ok(shopee.total === 2, "shopee: 2 rows (mapped + unmapped) tanpa crash");
  const shNull = shopee.rows.find((r) => r.key === "b1-map-shopee-null")!;
  const shReal = shopee.rows.find((r) => r.key === "b1-map-shopee-real")!;
  ok(shNull !== undefined && shNull.variantId === null, "shopee unmapped: variantId null");
  ok(shNull.stockTotal === 0, "shopee unmapped: stockTotal fallback 0 (platformStock null)");
  ok(shReal.variantId === "b1-var1" && shReal.stockTotal === 42, "shopee mapped: variantId + stock variant normal");

  console.log("=== listTikTokProducts ===");
  const tiktok = await listTikTokProducts({ businessId: BIZ });
  ok(tiktok.total === 2, "tiktok: 2 rows tanpa crash");
  const tkNull = tiktok.rows.find((r) => r.channelSku === "B1-TT-NULL" || r.variants.some((v) => v.mappingId === "b1-map-ttk-null"))!;
  const tkReal = tiktok.rows.find((r) => r.variants.some((v) => v.mappingId === "b1-map-ttk-real"))!;
  ok(tkNull !== undefined, "tiktok unmapped: row ada");
  const tkNullVar = tkNull.variants.find((v) => v.mappingId === "b1-map-ttk-null")!;
  ok(tkNullVar.variantId === null, "tiktok unmapped: variantId null");
  ok(tkNullVar.sku === "B1-TT-NULL", "tiktok unmapped: sku fallback = channelSku");
  ok(tkNullVar.price === null, "tiktok unmapped: price null (tanpa variant, tanpa override)");
  ok(tkNullVar.stock === 7, "tiktok unmapped: stock = platformStock (precedence)");
  ok(tkNull.master?.name === null, "tiktok unmapped: master null");
  ok(tkNull.tab === "unmapped" && tkNull.stockTotal === 7, 'tiktok unmapped: tab "Belum Terhubung" (bukan ikut status), stockTotal 7');
  const tkRealVar = tkReal.variants.find((v) => v.mappingId === "b1-map-ttk-real")!;
  ok(tkRealVar.sku === "B1-SKU-1" && tkRealVar.price === 1000 && tkRealVar.stock === 42, "tiktok mapped: sku/price/stock normal");
  ok(tkReal.master?.name === "B1 Product", "tiktok mapped: master normal");
  ok(
    tkReal.tab === "active" && tkReal.stockTotal === 42,
    "tiktok mapped: platformStock NULL → pakai stok varian (42): tab aktif, bukan out/unmapped"
  );

  console.log("=== recordSale throw path (mapping ada, variant NULL) ===");
  let threw = "";
  try {
    await recordSale({ accountId: "b1-acct-shopee", channelSku: "B1-SH-NULL", qty: 1 });
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  ok(threw.includes("belum di-mapping ke varian"), `recordSale unmapped → throw jelas (dapat: "${threw}")`);
  const varAfter = await prisma.productVariant.findUnique({ where: { id: "b1-var1" }, select: { stock: true } });
  ok(varAfter?.stock === 42, "stok varian tidak tersentuh oleh sale unmapped");

  console.log("=== Batch 2: pricing override (updateMappingPrice) ===");
  const priceUnmapped = await updateMappingPrice("b2-tt-override", 60000, BIZ2);
  ok(
    priceUnmapped.ok === false && (priceUnmapped.reason ?? "").includes("belum terhubung ke varian"),
    `pricing unmapped → ok:false + alasan jelas (dapat: "${priceUnmapped.reason ?? ""}")`
  );
  const priceStill = await prisma.productMapping.findUnique({ where: { id: "b2-tt-override" }, select: { price: true } });
  ok(priceStill?.price === 50000, "pricing unmapped: harga override TIDAK ditulis (ditolak sebelum update)");
  const priceWrongBiz = await updateMappingPrice("b2-tt-override", 70000, BIZ);
  ok(
    priceWrongBiz.ok === false && priceWrongBiz.reason === "Mapping toko tidak ditemukan.",
    "pricing: businessId salah → tetap ditolak (scope check via varian/akun utuh)"
  );
  const priceMapped = await updateMappingPrice("b1-map-ttk-real", null, BIZ);
  ok(priceMapped.ok === true, "pricing mapped (varian ada) tetap lolos — tidak ikut terblokir");

  console.log("=== Batch 2: promotion preview ===");
  const begin = new Date(Date.now() + 3 * 3600_000);
  const end = new Date(Date.now() + 4 * 86_400_000);
  const pv = await previewPromotion({
    accountId: "b2-acct-tiktok",
    mappingIds: ["b2-tt-noprice", "b2-tt-override"],
    discountByMappingId: { "b2-tt-noprice": 10, "b2-tt-override": 10 },
    beginAt: begin,
    endAt: end,
  });
  const pvNo = pv.items.find((i) => i.mappingId === "b2-tt-noprice")!;
  ok(!!pvNo.error && pvNo.error.includes("harga"), `preview unmapped tanpa harga → blocking error (dapat: "${pvNo.error}")`);
  ok(pvNo.masterProductName === null && pvNo.variantName === null, "preview unmapped: masterProductName & variantName = null (bukan string kosong)");
  const pvOvr = pv.items.find((i) => i.mappingId === "b2-tt-override")!;
  ok(pvOvr.error === null && pvOvr.finalPrice === 45000, `preview unmapped + override → tetap dihitung (dapat: ${pvOvr.finalPrice})`);
  ok(pvOvr.input.priceSource === "MAPPING_OVERRIDE", "preview unmapped + override → priceSource MAPPING_OVERRIDE");

  console.log("=== Batch 2: revalidateForCreate (G1 harga dicek sebelum G2) ===");
  const reqBase = {
    accountId: "b2-acct-tiktok",
    userId: "u",
    username: "tester",
    beginAt: begin.toISOString(),
    endAt: end.toISOString(),
    confirmationWord: "BUAT",
  };
  const rcExtreme = await revalidateForCreate({
    ...reqBase,
    mappingIds: ["b2-tt-noprice"],
    discountByMappingId: { "b2-tt-noprice": 96 },
  });
  const rcErr = !rcExtreme.ok ? (rcExtreme.itemErrors?.[0]?.error ?? "") : "";
  ok(
    !rcExtreme.ok && rcErr.includes("harga sumber") && !rcErr.includes("GRATIS"),
    `create unmapped tanpa harga + diskon 96% → ditolak krn TIDAK ADA HARGA, bukan "Rp 0 GRATIS" (dapat: "${rcErr}")`
  );
  const rcOvr = await revalidateForCreate({
    ...reqBase,
    mappingIds: ["b2-tt-override"],
    discountByMappingId: { "b2-tt-override": 10 },
  });
  ok(rcOvr.ok === true, "create unmapped + override + platformProductId → lolos revalidasi (promo murni platform-side)");

  console.log("=== Batch 2: TikTok edit load/submit ===");
  let loadErr = "";
  try {
    await loadTikTokEditData("b2-tt-noprice");
  } catch (e) {
    loadErr = e instanceof Error ? e.message : String(e);
  }
  ok(loadErr.includes("belum terhubung ke varian"), `edit load unmapped → throw jelas, bukan TypeError (dapat: "${loadErr}")`);
  const sub = await submitTikTokEdit("b2-tt-noprice", {} as unknown as Parameters<typeof submitTikTokEdit>[1]);
  ok(sub.ok === false && (sub.error ?? "").includes("belum terhubung ke varian"), `edit submit unmapped → ok:false (dapat: "${sub.error ?? ""}")`);

  console.log("=== Batch 3: draft harga promo tidak tabrakan antar unmapped ===");
  type Row = { mappingId: string; variantId: string | null; channelSku: string; price: number | null };
  const unmappedA: Row = { mappingId: "b3-map-a", variantId: null, channelSku: "SKU-A", price: null };
  const unmappedB: Row = { mappingId: "b3-map-b", variantId: null, channelSku: "SKU-B", price: null };
  ok(unmappedA.variantId === unmappedB.variantId, "referensi: variantId mentah memang sama (null === null) — inilah bug lama");
  ok(variantIdentityKey(unmappedA) !== variantIdentityKey(unmappedB), "key draft per-mapping → dua unmapped tidak kembar");
  ok(!isSameVariant(unmappedA, unmappedB), "matching per-mapping → dua unmapped tidak dianggap varian yang sama");

  let draft = setVariantDraft({}, unmappedA, "100000");
  draft = setVariantDraft(draft, unmappedB, "250000");
  ok(draft[variantIdentityKey(unmappedA)] === "100000" && draft[variantIdentityKey(unmappedB)] === "250000", "draft kedua unmapped tersimpan terpisah");
  const draftWithoutA = setVariantDraft({ [variantIdentityKey(unmappedB)]: "250000" }, unmappedA, "100000");
  ok(draftWithoutA[variantIdentityKey(unmappedB)] === "250000", "menulis draft A tidak menimpa draft B");

  const variants: Row[] = [unmappedA, unmappedB];
  const updated = applyVariantPrice(variants, unmappedA, 100000);
  ok(updated[0].price === 100000 && updated[1].price === null, "update harga A → hanya A berubah, B tetap tanpa harga");

  console.log("=== Batch 4: tab TikTok — produk unmapped tidak salah klasifikasi (backlog) ===");
  // Skenario backlog: platformStatus=ACTIVE + platformStock=NULL + variant=NULL.
  const list4 = await listTikTokProducts({ businessId: BIZ2 });
  const rowNoprice = list4.rows.find((r) => r.variants.some((v) => v.mappingId === "b2-tt-noprice"));
  ok(
    tabStr(rowNoprice) === "unmapped",
    `ACTIVE + platformStock NULL + variant NULL → tab "unmapped", bukan "out" (dapat: "${tabStr(rowNoprice)}")`
  );
  ok(
    tabStr(list4.rows.find((r) => r.variants.some((v) => v.mappingId === "b2-tt-override"))) === "unmapped",
    'unmapped + harga override → tab "unmapped" (bukan ikut status harga)'
  );
  ok(
    tabStr(rowNoprice?.variants.find((v) => v.mappingId === "b2-tt-noprice")) === "unmapped",
    'variant row ikut tab "unmapped"'
  );
  ok(list4.counts.out === 0, `counts.out = 0 — tak ada lagi yang jatuh ke tab "Habis" (dapat: ${list4.counts.out})`);
  ok(countOf(list4.counts, "unmapped") === 3, `counts.unmapped = 3 (noprice, override, listing campur) — dapat: ${countOf(list4.counts, "unmapped")}`);
  const onlyUnmapped = await listTikTokProducts({ businessId: BIZ2, tab: "unmapped" });
  ok(
    onlyUnmapped.total === countOf(list4.counts, "unmapped") && onlyUnmapped.rows.every((r) => r.tab === "unmapped"),
    `filter tab=unmapped → ${onlyUnmapped.total} baris, semua unmapped, cocok dg counts`
  );
  const mixed = list4.rows.find((r) => r.variants.some((v) => v.mappingId === "b4-tt-mapped"));
  ok(
    tabStr(mixed) === "unmapped",
    `listing campur (1 mapped + 1 unmapped) → tab "unmapped", tidak disembunyikan di "Aktif" (dapat: "${tabStr(mixed)}")`
  );
  ok(
    tabStr(mixed?.variants.find((v) => v.mappingId === "b4-tt-mapped")) === "active",
    `varian mapped di listing campur tetap tab "active" (dapat: "${tabStr(mixed?.variants.find((v) => v.mappingId === "b4-tt-mapped"))}")`
  );

  console.log(`\nALL ${passed} ASSERTIONS PASS`);
} finally {
  /* ── Cleanup ── */
  const accts = ["b1-acct-shopee", "b1-acct-tiktok", "b2-acct-tiktok"];
  await prisma.productMapping.deleteMany({ where: { accountId: { in: accts } } });
  await prisma.productVariant.deleteMany({ where: { masterProductId: { in: ["b1-master", "b4-master"] } } });
  await prisma.masterProduct.deleteMany({ where: { id: { in: ["b1-master", "b4-master"] } } });
  await prisma.platformAccount.deleteMany({ where: { id: { in: accts } } });
  await prisma.business.delete({ where: { id: BIZ } }).catch(() => {});
  await prisma.business.delete({ where: { id: BIZ2 } }).catch(() => {});
  const rest = await prisma.productMapping.count();
  console.log(`cleanup: ProductMapping sisa = ${rest}`);
}
