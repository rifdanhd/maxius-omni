/**
 * Pisahkan satu varian pusat yang menampung banyak channel SKU menjadi satu
 * varian per atribut marketplace (mis. warna). Pemetaan ditentukan dari
 * ProductMapping.platformStatusRaw — bukan dari tebakan nama SKU.
 *
 * Default DRY RUN. Contoh:
 *   npx tsx scripts/split-variant-by-attribute.mts --product=<masterProductId> --sku=CONE \
 *     --stock="Biru=18,Kuning=18,Hijau=18,Oren=17,Merah=17" --apply
 *
 * Tanpa --stock: stok dibagi rata (sisa ke warna pertama).
 * Varian lama dipakai ulang untuk warna pertama (--keep, default = warna
 * pertama) supaya riwayat pesanan/ledger tetap menempel; warna lain dibuat baru.
 */
import crypto from "node:crypto";
import { prisma } from "../lib/db/prisma";
import { STOCK_REASONS } from "../lib/services/central-stock.service";
import { variantAttributesFromRaw } from "../lib/services/variant-attributes";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const arg = args.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(arg.indexOf("=") + 1) : undefined;
};

const productId = value("product");
const sku = value("sku")?.trim();
const apply = flag("apply");
const keepColor = value("keep")?.trim();
const stockArg = value("stock");

if (!productId || !sku) {
  console.error('Wajib: --product=<masterProductId> --sku=<sku varian> [--stock="Biru=18,..."] [--keep=Biru] [--apply]');
  process.exit(1);
}

const colorOf = (raw: string | null, platform: string | null, channelSku: string) => {
  const label = variantAttributesFromRaw(platform, raw, channelSku);
  const color = label?.split(",")[0]?.trim();
  return color && color.length > 0 ? color : null;
};

const master = await prisma.masterProduct.findUnique({
  where: { id: productId },
  select: { id: true, name: true, businessId: true, productVariant: { select: { sku: true } } },
});
if (!master) {
  console.error(`Produk ${productId} tidak ditemukan.`);
  process.exit(1);
}
const variant = await prisma.productVariant.findFirst({
  where: { masterProductId: productId, sku },
  select: {
    id: true, sku: true, name: true, stock: true, safetyStock: true, minStock: true, price: true, masterProductId: true,
    productMapping: { select: { id: true, channelSku: true, platformStatusRaw: true, account: { select: { platform: true } } } },
  },
});
if (!variant) {
  console.error(`Varian ${sku} tidak ada di produk ${master.name}.`);
  process.exit(1);
}

const groups = new Map<string, typeof variant.productMapping>();
const unknown: string[] = [];
for (const mapping of variant.productMapping) {
  const color = colorOf(mapping.platformStatusRaw, mapping.account.platform, mapping.channelSku);
  if (!color) {
    unknown.push(mapping.channelSku);
    continue;
  }
  const rows = groups.get(color) ?? [];
  rows.push(mapping);
  groups.set(color, rows);
}

console.log(`Produk : ${master.name}`);
console.log(`Varian : ${variant.sku} (${variant.name ?? "-"}) · stok ${variant.stock} · safety ${variant.safetyStock}`);
console.log(`Mapping: ${variant.productMapping.length} (${groups.size} atribut)\n`);

if (unknown.length > 0) {
  console.error(`Tidak bisa menentukan atribut untuk: ${unknown.join(", ")}`);
  console.error("Batalkan — lengkapi payload/sinkron dulu agar pemisahan tidak salah tempat.");
  process.exit(1);
}
if (groups.size < 2) {
  console.error("Butuh minimal 2 atribut berbeda untuk dipisah.");
  process.exit(1);
}

const colors = [...groups.keys()];
const keep = keepColor && groups.has(keepColor) ? keepColor : colors[0];
const planned = new Map<string, number>();
if (stockArg) {
  for (const part of stockArg.split(",")) {
    const [color, qty] = part.split("=").map((item) => item.trim());
    const n = Number(qty);
    if (!color || !Number.isInteger(n) || n < 0) {
      console.error(`Format --stock tidak valid pada "${part}".`);
      process.exit(1);
    }
    if (!groups.has(color)) {
      console.error(`Warna "${color}" tidak ada di mapping varian ini.`);
      process.exit(1);
    }
    planned.set(color, n);
  }
  if (planned.size !== groups.size) {
    console.error("--stock harus menyebut semua atribut: " + colors.join(", "));
    process.exit(1);
  }
} else {
  const base = Math.floor(variant.stock / colors.length);
  const remainder = variant.stock - base * colors.length;
  for (const color of colors) {
    planned.set(color, color === keep ? base + remainder : base);
  }
}

const plannedTotal = [...planned.values()].reduce((sum, n) => sum + n, 0);
if (plannedTotal !== variant.stock) {
  console.error(`Total pembagian (${plannedTotal}) harus sama dengan stok varian (${variant.stock}).`);
  process.exit(1);
}

/** SKU lokal unik per warna, mis. CONE-BIRU. Dipakai juga saat --apply. */
const colorSku = (color: string) =>
  `${variant.sku}-${color.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

const preview = new Map<string, string>();
{
  const used = new Set(master.productVariant.map((item) => item.sku));
  for (const color of colors) {
    const base = colorSku(color);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${base}-${suffix++}`;
    used.add(candidate);
    preview.set(color, candidate);
  }
}

for (const [color, rows] of groups) {
  const reuse = color === keep;
  console.log(`- ${color}${reuse ? " (varian lama dipakai ulang)" : " (varian baru)"} → SKU ${preview.get(color)} · stok ${planned.get(color)} · ${rows.length} mapping`);
  for (const row of rows) console.log(`    ${row.account.platform} ${row.channelSku}`);
}
console.log("");

if (!apply) {
  console.log("DRY RUN — tidak ada yang ditulis. Tambahkan --apply untuk menyimpan.");
  await prisma.$disconnect();
  process.exit(0);
}

const batch = `split-${variant.id.slice(-6)}-${Date.now()}`;
const note = `Pemisahan varian ${variant.sku} per atribut (${colors.join(", ")}).`;
const created: Array<{ color: string; variantId: string; sku: string; stock: number }> = [];
let keepSkuFinal = "";

await prisma.$transaction(async (tx) => {
  const used = new Set(master.productVariant.map((item) => item.sku));
  const uniqueSku = (color: string) => {
    const base = colorSku(color);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${base}-${suffix++}`;
    used.add(candidate);
    return candidate;
  };

  // Varian lama → warna pertama: riwayat pesanan/ledger tetap menempel.
  const keepSku = uniqueSku(keep);
  keepSkuFinal = keepSku;
  await tx.productVariant.update({
    where: { id: variant.id },
    data: { sku: keepSku, name: keep, stock: planned.get(keep)!, version: { increment: 1 } },
  });
  const warehouseRows = await tx.variantWarehouseStock.findMany({ where: { variantId: variant.id } });
  for (const row of warehouseRows) {
    await tx.variantWarehouseStock.update({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: row.warehouseId } },
      data: { stock: planned.get(keep)! },
    });
  }
  await tx.stockLedger.create({
    data: {
      id: crypto.randomUUID(),
      variantId: variant.id,
      changeQty: planned.get(keep)! - variant.stock,
      reason: STOCK_REASONS.MANUAL_ADJUSTMENT,
      referenceId: batch,
      note,
      stockAfter: planned.get(keep)!,
    },
  });

  for (const [color, rows] of groups) {
    if (color === keep) {
      await tx.productMapping.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { variantId: variant.id },
      });
      continue;
    }
    const nextSku = uniqueSku(color);
    const stock = planned.get(color)!;
    const createdVariant = await tx.productVariant.create({
      data: {
        sku: nextSku,
        name: color,
        stock,
        safetyStock: variant.safetyStock,
        minStock: variant.minStock,
        price: variant.price,
        masterProductId: variant.masterProductId,
      },
      select: { id: true },
    });
    for (const row of warehouseRows) {
      await tx.variantWarehouseStock.create({
        data: { variantId: createdVariant.id, warehouseId: row.warehouseId, stock, safetyStock: row.safetyStock },
      });
    }
    await tx.stockLedger.create({
      data: {
        id: crypto.randomUUID(),
        variantId: createdVariant.id,
        changeQty: stock,
        reason: STOCK_REASONS.MANUAL_ADJUSTMENT,
        referenceId: `${batch}-${color}`,
        note,
        stockAfter: stock,
      },
    });
    await tx.productMapping.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { variantId: createdVariant.id },
    });
    created.push({ color, variantId: createdVariant.id, sku: nextSku, stock });
  }
});

console.log(`SELESAI — batch ${batch}`);
console.log(`- ${keep}: varian lama ${variant.id} → SKU ${keepSkuFinal} · stok ${planned.get(keep)}`);
for (const item of created) console.log(`- ${item.color}: ${item.variantId} → SKU ${item.sku} · stok ${item.stock}`);
console.log("MasterSkuKey (seller SKU) tetap di varian lama; mapping channel tetap memakai seller SKU aslinya.");
await prisma.$disconnect();
