/**
 * clean-seed.mts — hapus data dummy/seed dengan safety-first design.
 *
 * IDENTIFIKASI: WHITELIST EKSPLISIT (disetujui owner) — BUKAN pattern matching.
 * Hanya baris persis di bawah ini yang dihapus. Data lain tidak disentuh.
 *
 * USAGE:
 *   npx tsx scripts/clean-seed.mts             → DRY-RUN (default, tidak menghapus apa pun)
 *   npx tsx scripts/clean-seed.mts --confirm   → eksekusi nyata + minta konfirmasi ketik
 *
 * GARANSI:
 *   - Semua akun BUKAN whitelist (4 akun SANDBOX_* dengan token asli) TIDAK disentuh.
 *     Script memverifikasi jumlah baris akun sandbox sebelum == sesudah.
 *   - Tabel User tidak pernah disentuh (admin dipertahankan — keputusan owner).
 *   - Sebelum eksekusi: jika jumlah baris yang match whitelist melebihi
 *     MAX_EXPECTED (sesuai seed.js), script STOP tanpa menghapus apa pun.
 *   - Delete urut child → parent mengikuti FK (BundleItem dulu — onDelete:
 *     Restrict pada componentVariant, pelajaran dari bug P2003 seed.js).
 *   - SyncLog milik akun dummy ikut dihapus sebagai tabel anak (scoped ketat
 *     accountId IN whitelist, disetujui owner 2026-09-14). Guard Restrict lain
 *     (SalesLog/Order/PromotionActivity/PromotionAuditLog pada akun dummy)
 *     tetap hard-stop.
 */
import { PrismaClient } from "@prisma/client";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const prisma = new PrismaClient();

/* ───────────── WHITELIST EKSPLISIT (disetujui owner) ───────────── */

const DUMMY_ACCOUNT_IDS = ["tiktok-1", "tiktok-2", "tiktok-3"] as const;

const DUMMY_PRODUCT_NAMES = [
  "Kaos kaki polos hitam",
  "Kaos kaki motif garis",
  "Kaos kaki olahraga putih",
  "Kaos kaki mata kaki abu",
] as const;

const DUMMY_VARIANT_SKUS = ["SOCK-BLK", "SOCK-STR", "SOCK-WHT", "SOCK-GRY"] as const;

/** Batas wajar sesuai seed.js: 3 akun, 4 produk, 4 varian. Mapping ≤ 3 akun × 4 varian. */
const MAX_EXPECTED = {
  accounts: 3,
  products: 4,
  variants: 4,
  mappings: 12,
};

/* ───────────── Snapshot target (sekali query, dipakai ulang) ───────────── */

async function snapshot() {
  const accounts = await prisma.platformAccount.findMany({
    where: { id: { in: [...DUMMY_ACCOUNT_IDS] } },
    select: { id: true, label: true, accessToken: true },
  });
  const products = await prisma.masterProduct.findMany({
    where: { name: { in: [...DUMMY_PRODUCT_NAMES] } },
    select: { id: true, name: true },
  });
  const variants = await prisma.productVariant.findMany({
    where: { sku: { in: [...DUMMY_VARIANT_SKUS] }, masterProductId: { in: products.map((p) => p.id) } },
    select: { id: true, sku: true, masterProductId: true },
  });
  const productIds = products.map((p) => p.id);
  const variantIds = variants.map((v) => v.id);
  const mappings = await prisma.productMapping.count({
    where: { OR: [{ accountId: { in: [...DUMMY_ACCOUNT_IDS] } }, { variantId: { in: variantIds } }] },
  });

  const bundleItems = await prisma.bundleItem.count({
    where: { OR: [{ bundleProductId: { in: productIds } }, { componentVariantId: { in: variantIds } }] },
  });
  const syncJobs = await prisma.syncJob.count({ where: { variantId: { in: variantIds } } });
  const salesLogs = await prisma.salesLog.count({ where: { variantId: { in: variantIds } } });
  const stockLedgers = await prisma.stockLedger.count({ where: { variantId: { in: variantIds } } });
  const orderItems = await prisma.orderItem.count({ where: { variantId: { in: variantIds } } });
  const productImages = await prisma.productImage.count({ where: { masterProductId: { in: productIds } } });
  const stockOpnameItems = await prisma.stockOpnameItem.count({ where: { variantId: { in: variantIds } } });

  // Anak scoped akun dummy: SyncLog ikut dihapus dulu (FK → PlatformAccount).
  const syncLogs = await prisma.syncLog.count({ where: { accountId: { in: [...DUMMY_ACCOUNT_IDS] } } });

  // Dependensi Restrict pada akun dummy: TIDAK BOLEH ada barisnya (harus 0).
  // SyncLog TIDAK termasuk — dihapus sebagai anak (lihat di atas).
  const accountRestrictDeps = {
    salesLogs: await prisma.salesLog.count({ where: { accountId: { in: [...DUMMY_ACCOUNT_IDS] } } }),
    orders: await prisma.order.count({ where: { accountId: { in: [...DUMMY_ACCOUNT_IDS] } } }),
    promotionActivities: await prisma.promotionActivity.count({ where: { accountId: { in: [...DUMMY_ACCOUNT_IDS] } } }),
    promotionAuditLogs: await prisma.promotionAuditLog.count({ where: { accountId: { in: [...DUMMY_ACCOUNT_IDS] } } }),
  };

  // Akun PROTEKSI (semua akun di luar whitelist) — untuk assertion before/after.
  const protectedAccountCount = await prisma.platformAccount.count({
    where: { id: { notIn: [...DUMMY_ACCOUNT_IDS] } },
  });

  return {
    accounts,
    products,
    variants,
    mappings,
    restrictChildren: {
      bundleItems,
      syncJobs,
      salesLogs,
      stockLedgers,
      orderItems,
      productImages,
      stockOpnameItems,
      syncLogs,
    },
    accountRestrictDeps,
    protectedAccountCount,
  };
}

/* ───────────── Tampilan ───────────── */

function printPlan(s: Awaited<ReturnType<typeof snapshot>>, dryRun: boolean) {
  const mode = dryRun ? "DRY-RUN (tidak ada yang dihapus)" : "EKSEKUSI NYATA";
  console.log(`\n=== clean-seed — ${mode} ===\n`);

  console.log("Akun dummy (whitelist):");
  for (const a of s.accounts) console.log(`  - ${a.id} "${a.label}"`);
  console.log(`Produk dummy: ${s.products.length} → ${s.products.map((p) => p.name).join(", ")}`);
  console.log(`Varian dummy: ${s.variants.length} → ${s.variants.map((v) => v.sku).join(", ")}`);
  console.log(`ProductMapping terdampak: ${s.mappings}`);

  const r = s.restrictChildren;
  console.log(`\nBaris anak (akan dihapus dulu bila ada):`);
  console.log(
    `  BundleItem=${r.bundleItems}, SyncJob=${r.syncJobs}, SalesLog=${r.salesLogs}, ` +
      `StockLedger=${r.stockLedgers}, OrderItem=${r.orderItems}, ProductImage=${r.productImages}, ` +
      `StockOpnameItem=${r.stockOpnameItems}, SyncLog=${r.syncLogs}`
  );

  const d = s.accountRestrictDeps;
  const depTotal = Object.values(d).reduce((a, b) => a + b, 0);
  console.log(`\nDependensi Restrict pada akun dummy (HARUS 0):`);
  console.log(
    `  SalesLog=${d.salesLogs}, Order=${d.orders}, ` +
      `PromotionActivity=${d.promotionActivities}, PromotionAuditLog=${d.promotionAuditLogs}`
  );

  console.log(`\nAkun proteksi (bukan whitelist): ${s.protectedAccountCount} baris — dijamin utuh.`);
  console.log(`Tabel User: TIDAK disentuh (admin dipertahankan).`);
  return { depTotal };
}

function fail(msg: string): never {
  console.error(`\n❌ STOP: ${msg}`);
  console.error("Tidak ada data yang dihapus.");
  process.exit(1);
}

function checkGuards(s: Awaited<ReturnType<typeof snapshot>>) {
  if (s.accounts.length > MAX_EXPECTED.accounts)
    fail(`akun dummy match ${s.accounts.length} > batas wajar ${MAX_EXPECTED.accounts}. DB mungkin salah target.`);
  if (s.products.length > MAX_EXPECTED.products)
    fail(`produk dummy match ${s.products.length} > batas wajar ${MAX_EXPECTED.products}.`);
  if (s.variants.length > MAX_EXPECTED.variants)
    fail(`varian dummy match ${s.variants.length} > batas wajar ${MAX_EXPECTED.variants}.`);
  if (s.mappings > MAX_EXPECTED.mappings)
    fail(`mapping terdampak ${s.mappings} > batas wajar ${MAX_EXPECTED.mappings}.`);

  const d = s.accountRestrictDeps;
  const blocked = Object.entries(d).filter(([, n]) => n > 0);
  if (blocked.length > 0)
    fail(
      `akun dummy punya dependensi Restrict: ${blocked
        .map(([k, n]) => `${k}=${n}`)
        .join(", ")}. Lepaskan dulu secara manual — script menolak menghapus akun yang masih dipakai.`
    );
  if (s.protectedAccountCount < 4)
    fail(
      `akun proteksi hanya ${s.protectedAccountCount} (diharapkan ≥ 4 akun SANDBOX asli). ` +
        `DB salah target atau data asli sudah hilang — eksekusi dibatalkan.`
    );
}

/* ───────────── Eksekusi ───────────── */

async function execute(s: Awaited<ReturnType<typeof snapshot>>) {
  const productIds = s.products.map((p) => p.id);
  const variantIds = s.variants.map((v) => v.id);
  const before = {
    protected: s.protectedAccountCount,
    totalAccounts: await prisma.platformAccount.count(),
  };

  // Child dulu → parent (urutan FK; BundleItem paling awal karena Restrict).
  const r = s.restrictChildren;
  const counts: Record<string, number> = {};
  counts.BundleItem = r.bundleItems ? (await prisma.bundleItem.deleteMany({ where: { OR: [{ bundleProductId: { in: productIds } }, { componentVariantId: { in: variantIds } }] } })).count : 0;
  counts.SyncJob = r.syncJobs ? (await prisma.syncJob.deleteMany({ where: { variantId: { in: variantIds } } })).count : 0;
  counts.SalesLog = r.salesLogs ? (await prisma.salesLog.deleteMany({ where: { variantId: { in: variantIds } } })).count : 0;
  counts.StockLedger = r.stockLedgers ? (await prisma.stockLedger.deleteMany({ where: { variantId: { in: variantIds } } })).count : 0;
  counts.OrderItem = r.orderItems ? (await prisma.orderItem.deleteMany({ where: { variantId: { in: variantIds } } })).count : 0;
  counts.StockOpnameItem = r.stockOpnameItems ? (await prisma.stockOpnameItem.deleteMany({ where: { variantId: { in: variantIds } } })).count : 0;
  counts.ProductImage = r.productImages ? (await prisma.productImage.deleteMany({ where: { masterProductId: { in: productIds } } })).count : 0;
  counts.SyncLog = r.syncLogs ? (await prisma.syncLog.deleteMany({ where: { accountId: { in: [...DUMMY_ACCOUNT_IDS] } } })).count : 0;
  counts.ProductMapping = (await prisma.productMapping.deleteMany({ where: { OR: [{ accountId: { in: [...DUMMY_ACCOUNT_IDS] } }, { variantId: { in: variantIds } }] } })).count;
  counts.ProductVariant = (await prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } })).count;
  counts.MasterProduct = (await prisma.masterProduct.deleteMany({ where: { id: { in: productIds } } })).count;
  counts.PlatformAccount = (await prisma.platformAccount.deleteMany({ where: { id: { in: [...DUMMY_ACCOUNT_IDS] } } })).count;

  // Assertion proteksi: akun asli tidak berkurang.
  const afterProtected = await prisma.platformAccount.count({ where: { id: { notIn: [...DUMMY_ACCOUNT_IDS] } } });
  if (afterProtected !== before.protected) {
    fail(`PELANGGARAN PROTEKSI: akun asli berkurang ${before.protected} → ${afterProtected}!`);
  }

  console.log("\n=== Ringkasan (sebelum → dihapus → sisa) ===");
  for (const [table, deleted] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(16)} — dihapus: ${deleted}`);
  }
  console.log(`\nAkun asli tersisa: ${afterProtected} (sebelum: ${before.protected}) ✅`);
  console.log(`Total akun: ${before.totalAccounts} → ${await prisma.platformAccount.count()}`);
  console.log(`User: tidak disentuh ✅`);
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const s = await snapshot();
  const { depTotal } = printPlan(s, !confirm);
  checkGuards(s);

  if (!confirm) {
    console.log(`\n✔ DRY-RUN selesai. Dependensi Restrict total: ${depTotal}.`);
    console.log(`  Jalankan dengan --confirm untuk eksekusi nyata (akan diminta konfirmasi ketik).`);
    return;
  }

  const dbPath = process.env.DATABASE_URL ?? "(default prisma/dev.db)";
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`\nKetik "HAPUS" untuk konfirmasi eksekusi di ${dbPath}: `);
  await rl.close();
  if (answer.trim() !== "HAPUS") {
    console.log("Dibatalkan — tidak ada yang dihapus.");
    return;
  }

  await execute(s);
  console.log("\n✅ Cleanup selesai.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
