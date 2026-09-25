/**
 * [TEST] Null-variant:
 *   Batch 1 — listing Shopee & TikTok null-safe + recordSale throw path.
 *   Batch 2 — pricing override, promotion preview/create, TikTok edit load/submit.
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

let passed = 0;
const ok = (cond: boolean, label: string) => {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
};

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
  data: { id: "b2-tt-override", channelSku: "B2-TT-OVERRIDE", variantId: null, accountId: "b2-acct-tiktok", price: 50000, platformProductId: "B2-P2", platformStatus: "ACTIVE", updatedAt: new Date() },
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
  ok(tkNull.tab === "active" && tkNull.stockTotal === 7, "tiktok unmapped: tab dari status, stockTotal 7");
  const tkRealVar = tkReal.variants.find((v) => v.mappingId === "b1-map-ttk-real")!;
  ok(tkRealVar.sku === "B1-SKU-1" && tkRealVar.price === 1000 && tkRealVar.stock === 42, "tiktok mapped: sku/price/stock normal");
  ok(tkReal.master?.name === "B1 Product", "tiktok mapped: master normal");

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

  console.log(`\nALL ${passed} ASSERTIONS PASS`);
} finally {
  /* ── Cleanup ── */
  const accts = ["b1-acct-shopee", "b1-acct-tiktok", "b2-acct-tiktok"];
  await prisma.productMapping.deleteMany({ where: { accountId: { in: accts } } });
  await prisma.productVariant.deleteMany({ where: { masterProductId: "b1-master" } });
  await prisma.masterProduct.delete({ where: { id: "b1-master" } }).catch(() => {});
  await prisma.platformAccount.deleteMany({ where: { id: { in: accts } } });
  await prisma.business.delete({ where: { id: BIZ } }).catch(() => {});
  await prisma.business.delete({ where: { id: BIZ2 } }).catch(() => {});
  const rest = await prisma.productMapping.count();
  console.log(`cleanup: ProductMapping sisa = ${rest}`);
}
