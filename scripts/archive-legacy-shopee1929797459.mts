import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { prisma } from "../lib/db/prisma";

const businessId = "business-default";
const importedFrom = "SHOPEE:1929797459";
const expected = ["57268048019:0", "57868052585:0", "57268048000:0", "57868052506:0", "53568056824:0", "57268047998:0", "57268048010:0", "57268047947:0", "57868052499:0", "51618043670:0", "57868052507:0", "57868052538:0", "57868052519:0", "57868052582:0", "57868052544:0", "57868052536:0", "51618043676:0", "57868052500:0", "50818052606:0"];
const expectedStock = [469, 992, 88885, 6584, 9936, 9990, 8957, 9968, 987, 995, 7854, 125, 888, 9990, 9999, 9477, 9999, 9529, 10000];
const [mode, snapshotPath] = process.argv.slice(2);
if (!["apply", "restore"].includes(mode) || !snapshotPath) throw new Error("Usage: apply|restore SNAPSHOT.json");
type Snapshot = { masters: Array<{ id: string; status: string; isActive: boolean; variants: Array<{ id: string; sku: string; stock: number; isArchived: boolean }> }> };
try {
  const result = await prisma.$transaction(async (tx) => {
    const masters = await tx.$queryRaw<Array<{ id: string; status: string; isActive: boolean }>>`SELECT id,status,"isActive" FROM "MasterProduct" WHERE "businessId"=${businessId} AND "importedFrom"=${importedFrom} ORDER BY id FOR UPDATE`;
    assert.equal(masters.length, 19, "Scope master berubah");
    const variants = await tx.productVariant.findMany({ where: { masterProductId: { in: masters.map((p) => p.id) } }, orderBy: { id: "asc" } });
    assert.equal(variants.length, 19, "Scope varian berubah");
    await tx.$queryRaw`SELECT v.id FROM "ProductVariant" v JOIN "MasterProduct" p ON p.id=v."masterProductId" WHERE p."businessId"=${businessId} AND p."importedFrom"=${importedFrom} FOR UPDATE OF v`;
    assert.deepEqual(variants.map((v) => v.sku).sort(), [...expected].sort(), "Daftar SKU berbeda dari preview");
    for (const v of variants) assert.equal(v.stock, expectedStock[expected.indexOf(v.sku)], `Stok ${v.sku} berubah dari preview`);
    const variantIds = variants.map((v) => v.id);
    assert.equal(await tx.productMapping.count({ where: { variantId: { in: variantIds } } }), 0, "Ada mapping baru");
    assert.equal(await tx.orderItem.count({ where: { variantId: { in: variantIds } } }), 0, "Ada item pesanan baru");
    assert.equal(await tx.bundleItem.count({ where: { OR: [{ componentVariantId: { in: variantIds } }, { bundleProductId: { in: masters.map((p) => p.id) } }] } }), 0, "Ada bundle baru");
    const ledgerBefore = await tx.stockLedger.count();
    const masterBefore = await tx.masterProduct.count();
    if (mode === "apply") {
      if (masters.every((p) => !p.isActive && p.status === "archived") && variants.every((v) => v.isArchived)) return { alreadyArchived: true, masters: 19, variants: 19 };
      assert.ok(masters.every((p) => p.isActive && p.status === "active") && variants.every((v) => !v.isArchived), "Status berbeda dari preview");
      const snapshot: Snapshot = { masters: masters.map((p) => ({ ...p, variants: variants.filter((v) => v.masterProductId === p.id).map((v) => ({ id: v.id, sku: v.sku, stock: v.stock, isArchived: v.isArchived })) })) };
      await writeFile(snapshotPath, JSON.stringify({ businessId, importedFrom, ...snapshot }, null, 2), { flag: "wx", mode: 0o600 });
      const changed = await tx.masterProduct.updateMany({ where: { id: { in: masters.map((p) => p.id) }, businessId, importedFrom }, data: { isActive: false, status: "archived" } });
      const changedVariants = await tx.productVariant.updateMany({ where: { id: { in: variantIds }, masterProduct: { businessId, importedFrom } }, data: { isArchived: true } });
      assert.equal(changed.count, 19); assert.equal(changedVariants.count, 19);
    } else {
      const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as Snapshot & { businessId: string; importedFrom: string };
      assert.equal(snapshot.businessId, businessId); assert.equal(snapshot.importedFrom, importedFrom);
      assert.deepEqual(snapshot.masters.map((p) => p.id).sort(), masters.map((p) => p.id).sort());
      assert.deepEqual(snapshot.masters.flatMap((p) => p.variants.map((v) => v.id)).sort(), [...variantIds].sort());
      assert.ok(masters.every((p) => !p.isActive && p.status === "archived") && variants.every((v) => v.isArchived));
      for (const p of snapshot.masters) {
        await tx.masterProduct.update({ where: { id: p.id }, data: { status: p.status, isActive: p.isActive } });
        for (const v of p.variants) await tx.productVariant.update({ where: { id: v.id }, data: { isArchived: v.isArchived } });
      }
    }
    assert.equal(await tx.stockLedger.count(), ledgerBefore);
    assert.equal(await tx.masterProduct.count(), masterBefore);
    return { mode, masters: 19, variants: 19, ledgerBefore, ledgerAfter: await tx.stockLedger.count(), masterBefore, masterAfter: await tx.masterProduct.count() };
  }, { timeout: 60000 });
  console.log(JSON.stringify(result));
} finally { await prisma.$disconnect(); }
