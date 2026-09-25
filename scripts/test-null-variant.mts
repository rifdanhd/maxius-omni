/**
 * [TEST] Null-variant: listing Shopee & TikTok (Batch 1) + recordSale throw path.
 *
 * Jalankan: npx tsx scripts/test-null-variant.mts
 */

const { prisma } = await import("@/lib/db/prisma");
const { listShopeeProducts } = await import("@/lib/services/marketplace-shopee.service");
const { listTikTokProducts } = await import("@/lib/services/marketplace-tiktok.service");
const { recordSale } = await import("@/lib/services/sales.service");

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

  console.log(`\nALL ${passed} ASSERTIONS PASS`);
} finally {
  /* ── Cleanup ── */
  await prisma.productMapping.deleteMany({ where: { accountId: { in: ["b1-acct-shopee", "b1-acct-tiktok"] } } });
  await prisma.productVariant.deleteMany({ where: { masterProductId: "b1-master" } });
  await prisma.masterProduct.delete({ where: { id: "b1-master" } }).catch(() => {});
  await prisma.platformAccount.deleteMany({ where: { id: { in: ["b1-acct-shopee", "b1-acct-tiktok"] } } });
  await prisma.business.delete({ where: { id: BIZ } }).catch(() => {});
  const rest = await prisma.productMapping.count();
  console.log(`cleanup: ProductMapping sisa = ${rest}`);
}
