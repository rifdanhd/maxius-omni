import { prisma } from "../lib/db/prisma";
import { backfillShopeeModels } from "../lib/services/shopee-model-backfill.service";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];

const limit = Number(value("limit") ?? "") || undefined;
const accountId = value("account");
const dryRun = flag("dry-run");

const businesses = process.env.BUSINESS_ID
  ? await prisma.business.findMany({ where: { id: process.env.BUSINESS_ID }, select: { id: true, name: true } })
  : await prisma.business.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });

console.log(
  `Backfill model Shopee → platformStatusRaw — ${businesses.length} bisnis | ` +
  `limit=${limit ?? "semua item"} | ${dryRun ? "DRY RUN" : "tulis"}${accountId ? ` | akun ${accountId}` : ""}\n`
);

for (const business of businesses) {
  const report = await backfillShopeeModels(business.id, { limit, accountId, dryRun });
  console.log(`# ${business.name} (${business.id})`);
  console.log(`  item perlu model : ${report.items}`);
  console.log(`  item dipanggil   : ${report.fetched}`);
  console.log(`  mapping ditulis  : ${report.updated}`);
  console.log(`  tanpa model      : ${report.withoutModels}`);
  console.log(`  gagal            : ${report.failed}`);
  for (const error of report.errors) console.log(`  ! ${error}`);
  console.log("");
}

await prisma.$disconnect();
