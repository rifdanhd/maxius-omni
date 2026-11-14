/**
 * Isi ProductMapping.variantAttributes dari payload mentah yang sudah tersimpan.
 * Idempoten: hanya menulis bila label berubah/kosong. Default DRY RUN.
 *
 *   npx tsx scripts/backfill-mapping-attributes.mts [--dry-run] [--batch=200]
 */
import { prisma } from "../lib/db/prisma";
import { variantAttributesFromRaw } from "../lib/services/variant-attributes";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const batch = Math.max(1, Math.min(500, Number(args.find((arg) => arg.startsWith("--batch="))?.split("=")[1] ?? "") || 200));

console.log(`Backfill ProductMapping.variantAttributes — batch ${batch} — ${dryRun ? "DRY RUN" : "tulis"}\n`);

let cursor: string | undefined;
let scanned = 0;
let labeled = 0;
let written = 0;
let withoutPayload = 0;

for (;;) {
  const rows = await prisma.productMapping.findMany({
    select: {
      id: true, channelSku: true, platformStatusRaw: true, variantAttributes: true,
      account: { select: { platform: true } },
    },
    orderBy: { id: "asc" },
    take: batch,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  if (rows.length === 0) break;
  cursor = rows[rows.length - 1].id;

  for (const row of rows) {
    scanned += 1;
    if (!row.platformStatusRaw) {
      withoutPayload += 1;
      continue;
    }
    const label = variantAttributesFromRaw(row.account.platform, row.platformStatusRaw, row.channelSku);
    if (!label) continue;
    labeled += 1;
    if (label === row.variantAttributes) continue;
    if (!dryRun) {
      await prisma.productMapping.update({ where: { id: row.id }, data: { variantAttributes: label } });
    }
    written += 1;
  }
}

console.log(`  dipindai        : ${scanned}`);
console.log(`  punya label     : ${labeled}`);
console.log(`  ${dryRun ? "akan ditulis" : "ditulis"}        : ${written}`);
console.log(`  tanpa payload   : ${withoutPayload}`);

await prisma.$disconnect();
