import assert from "node:assert/strict";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { setupTestDb } from "@/scripts/lib/test-db";
import { productStockSummary } from "@/lib/services/product-stock.policy";

const db = setupTestDb("master-products");
process.env.JWT_SECRET = "master-products-isolated-test-secret-0123456789";
const { prisma } = await import("@/lib/db/prisma");
const { createSessionToken } = await import("@/lib/services/auth.service");
const { saveProductCopyAsDraft } = await import("@/lib/services/product-copy.service");
const { addImages, listGallery, listProductImages, updateImage, deleteImage, applyMarketplaceCover } = await import("@/lib/services/gallery.service");
const { GET } = await import("@/app/api/products/route");
const { PATCH } = await import("@/app/api/products/[productId]/route");
const { POST: copy } = await import("@/app/api/product-copy/save/route");
const { POST: createBundle } = await import("@/app/api/products/bundle/route");
const { processBulkPrice, listPricing, updateVariantDefaultPrice, updateMappingPrice } = await import("@/lib/services/pricing.service");
const { POST: uploadPrices } = await import("@/app/api/products/pricing/bulk-upload/route");
const { POST: bulkImages } = await import("@/app/api/products/gallery/bulk/route");
const business = await prisma.business.create({ data: { name: "Master products" } });
const otherBusiness = await prisma.business.create({ data: { name: "Other brand" } });
await prisma.inventorySetting.create({ data: { id: business.id, businessId: business.id, lowStockDefaultThreshold: 3 } });
const user = await prisma.user.create({ data: { id: crypto.randomUUID(), username: "master-test", passwordHash: "unused", userBusiness: { create: { businessId: business.id, role: "owner" } } } });
const token = createSessionToken(user, business.id);
const context = (id = "") => ({ params: Promise.resolve({ productId: id }) });
function request(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const patch = (id: string, body: unknown) => PATCH(request(`/api/products/${id}`, "PATCH", body), context(id));
const product = (id: string) => prisma.masterProduct.findUniqueOrThrow({ where: { id }, include: { productImage: true, productVariant: true } });
let passed = 0;
async function check(name: string, fn: () => Promise<void>) { await fn(); console.log(`PASS ${++passed}: ${name}`); }
let copyId = "";
let bundleId = "";

try {
  await check("Product Copy persists description, prices, stock and one INIT entry per variant", async () => {
    const response = await copy(request("/api/product-copy/save", "POST", { name: "Copied", description: "  Deskripsi produk\nBaris kedua  ", imageUrl: "https://example.com/cover.jpg", images: ["https://example.com/other.jpg"], variants: [{ name: "Red", sku: "RED", stock: 10, price: 12000 }, { name: "Blue", sku: "BLUE", stock: 6, price: 15000 }] }), context());
    assert.equal(response.status, 200);
    copyId = (await response.json()).productId;
    const saved = await product(copyId);
    assert.equal(saved.description, "Deskripsi produk\nBaris kedua");
    assert.equal(saved.status, "draft");
    assert.equal(saved.threshold, 3);
    for (const variant of saved.productVariant) {
      const entries = await prisma.stockLedger.findMany({ where: { variantId: variant.id } });
      assert.equal(entries.length, 1);
      assert.equal(entries[0].reason, "INIT");
      assert.equal(entries[0].changeQty, variant.stock);
      assert.equal(entries[0].stockAfter, variant.stock);
      assert.ok(variant.price);
    }
    assert.equal(saved.productImage.filter(i => i.isCover).length, 1);
    assert.equal(saved.productImage.find(i => i.isCover)?.url, saved.imageUrl);
  });
  await check("single drafts with zero stock also have an auditable initial balance", async () => {
    const { id } = await saveProductCopyAsDraft({ businessId: business.id, name: "Zero draft" });
    const saved = await product(id);
    assert.equal(saved.productVariant.length, 1);
    assert.equal(await prisma.stockLedger.count({ where: { variantId: saved.productVariant[0].id, reason: "INIT", changeQty: 0, stockAfter: 0 } }), 1);
  });
  await check("ledger failure rolls back the entire draft and its variants", async () => {
    await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_audit_init() RETURNS trigger AS $$ BEGIN IF NEW.note LIKE '%ROLLBACK-TEST%' THEN RAISE EXCEPTION 'intentional audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_audit_init BEFORE INSERT ON "StockLedger" FOR EACH ROW EXECUTE FUNCTION reject_audit_init()`);
    try {
      await assert.rejects(saveProductCopyAsDraft({ businessId: business.id, name: "Rollback draft", variants: [{ sku: "ROLLBACK-TEST", stock: 9 }] }));
      assert.equal(await prisma.masterProduct.count({ where: { name: "Rollback draft" } }), 0);
      assert.equal(await prisma.productVariant.count({ where: { sku: "ROLLBACK-TEST" } }), 0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER reject_audit_init ON "StockLedger"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION reject_audit_init()`);
    }
  });
  await check("bundle stock uses the limiting component and respects safety stock", async () => {
    const variants = (await product(copyId)).productVariant;
    await prisma.productVariant.update({ where: { id: variants[0].id }, data: { safetyStock: 2 } });
    const response = await createBundle(request("/api/products/bundle", "POST", { name: "Bundle", imageUrl: "https://example.com/bundle.jpg", items: variants.map(v => ({ variantId: v.id, qty: 2 })) }), context());
    assert.equal(response.status, 201);
    bundleId = (await response.json()).product.id;
    const catalog = await GET(request("/api/products"), context());
    const bundle = (await catalog.json()).products.find((p: { id: string }) => p.id === bundleId);
    assert.equal(bundle.variants.length, 0);
    assert.equal(bundle.type, "bundle");
    assert.deepEqual(productStockSummary(bundle), { stock: 3, availableStock: 3, level: "low" });
    assert.equal((await product(bundleId)).productImage.find(i => i.isCover)?.url, "https://example.com/bundle.jpg");
    assert.deepEqual(productStockSummary({ ...bundle, threshold: 2 }), { stock: 3, availableStock: 3, level: "ok" });
    bundle.bundleItems[0].variant.safetyStock = bundle.bundleItems[0].variant.stock;
    assert.equal(productStockSummary(bundle).level, "out");
    assert.equal(productStockSummary({ ...bundle, bundleItems: [] }).level, "out");
    assert.equal(productStockSummary({ ...bundle, bundleItems: [{ qty: 0, variant: variants[0] }] }).stock, 0);
  });
  await check("single product stock keeps per-variant minimums and safety buffers", async () => {
    assert.deepEqual(productStockSummary({ threshold: 3, variants: [{ stock: 8, safetyStock: 2, minStock: 6 }, { stock: 5, safetyStock: 1 }] }), { stock: 13, availableStock: 10, level: "low" });
    assert.equal(productStockSummary({ threshold: 3, variants: [] }).level, "out");
  });
  await check("master image changes update gallery cover without deleting other images", async () => {
    assert.equal((await patch(copyId, { imageUrl: "https://example.com/new.jpg" })).status, 200);
    let saved = await product(copyId);
    assert.equal(saved.productImage.length, 3);
    assert.equal(saved.productImage.filter(i => i.isCover).length, 1);
    assert.equal(saved.productImage.find(i => i.isCover)?.url, saved.imageUrl);
    assert.equal((await listGallery({ businessId: business.id })).rows.find(p => p.id === copyId)?.imageUrl, saved.imageUrl);
    assert.equal((await patch(copyId, { imageUrl: "https://example.com/new.jpg" })).status, 200);
    saved = await product(copyId);
    assert.equal(saved.productImage.length, 3);
  });
  await check("clearing the master image also clears the cover and preserves gallery files", async () => {
    assert.equal((await patch(copyId, { imageUrl: null })).status, 200);
    const saved = await product(copyId);
    assert.equal(saved.imageUrl, null);
    assert.equal(saved.productImage.length, 3);
    assert.equal(saved.productImage.filter(i => i.isCover).length, 0);
    assert.equal((await listGallery({ businessId: business.id })).rows.find(p => p.id === copyId)?.imageUrl, null);
  });
  await check("parallel master image changes leave exactly one matching cover", async () => {
    const responses = await Promise.all([patch(copyId, { imageUrl: "https://example.com/concurrent-a.jpg" }), patch(copyId, { imageUrl: "https://example.com/concurrent-b.jpg" })]);
    assert.ok(responses.every(r => r.status === 200));
    const saved = await product(copyId);
    assert.equal(saved.productImage.filter(i => i.isCover).length, 1);
    assert.equal(saved.productImage.find(i => i.isCover)?.url, saved.imageUrl);
    assert.deepEqual(saved.productImage.map(i => i.order).sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  });
  await check("deleting a cover promotes its replacement in the same transaction", async () => {
    const saved = await product(copyId);
    assert.equal((await deleteImage(copyId, saved.productImage.find(i => i.isCover)!.id, business.id)).ok, true);
    const after = await product(copyId);
    assert.equal(after.productImage.length, saved.productImage.length - 1);
    assert.equal(after.productImage.filter(i => i.isCover).length, 1);
    assert.equal(after.productImage.find(i => i.isCover)?.url, after.imageUrl);
  });
  await check("deleting the final cover clears master and gallery together", async () => {
    const saved = await product(bundleId);
    await deleteImage(bundleId, saved.productImage[0].id, business.id);
    assert.equal((await product(bundleId)).imageUrl, null);
    assert.equal((await product(bundleId)).productImage.length, 0);
  });
  await check("marketplace cover backfill preserves an existing manual image under concurrent calls", async () => {
    const manual = await prisma.masterProduct.create({ data: { name: "Manual", businessId: business.id, imageUrl: "https://example.com/manual.jpg" } });
    await Promise.all([applyMarketplaceCover(manual.id, "https://example.com/remote.jpg"), applyMarketplaceCover(manual.id, "https://example.com/remote2.jpg"), listProductImages(manual.id, business.id)]);
    const saved = await product(manual.id);
    assert.equal(saved.imageUrl, manual.imageUrl);
    assert.equal(saved.productImage.length, 1);
    assert.equal(saved.productImage[0].url, manual.imageUrl);
  });
  await check("gallery cover selection also updates the master product", async () => {
    const saved = await product(copyId);
    const next = saved.productImage.find(i => !i.isCover)!;
    assert.equal((await updateImage(copyId, next.id, { isCover: true }, business.id)).ok, true);
    assert.equal((await product(copyId)).imageUrl, next.url);
  });
  await check("cross-brand products cannot be changed, listed or used as bundle components", async () => {
    const other = await prisma.masterProduct.create({ data: { name: "Foreign", businessId: otherBusiness.id, productVariant: { create: { sku: "FOREIGN", stock: 10 } } }, include: { productVariant: true } });
    assert.equal((await patch(other.id, { imageUrl: "https://example.com/wrong.jpg" })).status, 404);
    assert.equal((await addImages(other.id, [{ url: "https://example.com/wrong.jpg" }], business.id)).ok, false);
    assert.deepEqual(await listProductImages(other.id, business.id), []);
    assert.equal((await createBundle(request("/api/products/bundle", "POST", { name: "Forbidden", items: [{ variantId: other.productVariant[0].id, qty: 1 }] }), context())).status, 400);
    const response = await GET(request("/api/products"), context());
    assert.ok(!(await response.json()).products.some((p: { id: string }) => p.id === other.id));
  });
  await check("copying the same source again preserves the original gallery and stock", async () => {
    const before = await product(copyId);
    await assert.rejects(saveProductCopyAsDraft({ businessId: business.id, name: "Copied", images: ["https://example.com/replacement.jpg"] }));
    assert.deepEqual(await product(copyId), before);
  });
  await check("invalid CSV prices fail before changing any rows", async () => {
    const response = await uploadPrices(request("/api/products/pricing/bulk-upload", "POST", { csv: "sku,price,store\nRED,25000,\nBLUE,not-a-number,Toko" }), context());
    assert.equal(response.status, 400);
    assert.equal((await product(copyId)).productVariant.find((v) => v.sku === "RED")?.price, 12000);
  });
  await check("ambiguous central SKU never selects an arbitrary price target", async () => {
    for (const name of ["Duplicate price A", "Duplicate price B"]) await prisma.masterProduct.create({ data: { businessId: business.id, name, productVariant: { create: { sku: "DUP-PRICE", stock: 0, price: 100 } } } });
    const result = await processBulkPrice([{ row: 2, sku: "DUP-PRICE", price: 500, store: null, channelSku: null }], business.id);
    assert.equal(result.updated, 0); assert.equal(result.failed.length, 1);
    assert.ok((await prisma.productVariant.findMany({ where: { sku: "DUP-PRICE" } })).every((v) => v.price === 100));
    const prices = await listPricing({ businessId: business.id, pageSize: 1, page: 2 });
    assert.equal(prices.rows.length, 1); assert.ok(prices.total >= 2);
  });
  await check("bulk price matching requires both the store and channel SKU", async () => {
    const master = await prisma.masterProduct.create({ data: { businessId: business.id, name: "Store price safety", productVariant: { create: { sku: "STORE-PRICE", stock: 0, price: 1000 } } }, include: { productVariant: true } });
    for (const label of ["Price A", "Price B"]) {
      const account = await prisma.platformAccount.create({ data: { businessId: business.id, platform: "SHOPEE", label } });
      await prisma.productMapping.create({ data: { accountId: account.id, variantId: master.productVariant[0].id, channelSku: label === "Price A" ? "CHANNEL-A" : "CHANNEL-B", price: 2000, updatedAt: new Date() } });
    }
    const result = await processBulkPrice([{ row: 2, sku: "STORE-PRICE", price: 500, store: "Price A", channelSku: "CHANNEL-B" }], business.id);
    assert.equal(result.updated, 0); assert.equal(result.failed.length, 1);
    assert.ok((await prisma.productMapping.findMany({ where: { variantId: master.productVariant[0].id } })).every((mapping) => mapping.price === 2000));
  });
  await check("gallery pagination and repeated bulk upload preserve a single cover", async () => {
    const page = await listGallery({ businessId: business.id, pageSize: 1, page: 2 });
    assert.equal(page.rows.length, 1); assert.ok(page.total > 1);
    const body = { rows: [{ sku: "RED", url: "https://example.com/bulk.jpg" }] };
    for (let i = 0; i < 2; i++) assert.equal((await bulkImages(request("/api/products/gallery/bulk", "POST", body), context())).status, 200);
    const saved = await product(copyId);
    assert.equal(saved.productImage.filter((image) => image.url === body.rows[0].url).length, 1);
    assert.equal(saved.productImage.filter((image) => image.isCover).length, 1);
  });
  await check("draft and archived variants reject direct price mutations", async () => {
    const draft = await product(copyId);
    assert.equal((await updateVariantDefaultPrice(draft.productVariant[0].id, 999, business.id)).ok, false);
    const archived = await prisma.masterProduct.create({ data: { businessId: business.id, name: "Archived pricing", productVariant: { create: { sku: "ARCHIVED-PRICE", stock: 0, price: 1000, isArchived: true } } }, include: { productVariant: true } });
    const account = await prisma.platformAccount.create({ data: { businessId: business.id, platform: "SHOPEE", label: "Archived prices" } });
    const mapping = await prisma.productMapping.create({ data: { accountId: account.id, variantId: archived.productVariant[0].id, channelSku: "ARCHIVED-REMOTE", price: 2000, updatedAt: new Date() } });
    assert.equal((await updateVariantDefaultPrice(archived.productVariant[0].id, 999, business.id)).ok, false);
    assert.equal((await updateMappingPrice(mapping.id, 999, business.id)).ok, false);
    assert.equal((await product(archived.id)).productVariant[0].price, 1000);
    assert.equal((await prisma.productMapping.findUniqueOrThrow({ where: { id: mapping.id } })).price, 2000);
  });
  await check("invalid Product Copy price returns a validation error without creating a draft", async () => {
    const response = await copy(request("/api/product-copy/save", "POST", { name: "Invalid price draft", price: -500 }), context());
    assert.equal(response.status, 400);
    assert.equal(await prisma.masterProduct.count({ where: { name: "Invalid price draft", businessId: business.id } }), 0);
  });
  console.log(`${passed} master product checks passed on isolated PostgreSQL.`);
} finally {
  await prisma.$disconnect();
  db.cleanup();
}
