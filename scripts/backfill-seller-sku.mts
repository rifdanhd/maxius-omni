import { prisma } from "../lib/db/prisma";
import { backfillSellerSkus } from "../lib/services/seller-sku-backfill.service";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];

const limit = Number(value("limit") ?? "") || undefined;
const remote = flag("remote");
const dryRun = flag("dry-run");

const businesses = process.env.BUSINESS_ID
  ? await prisma.business.findMany({ where: { id: process.env.BUSINESS_ID }, select: { id: true, name: true } })
  : await prisma.business.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });

console.log(
  `Backfill ProductMapping.sellerSku (TikTok) — ${businesses.length} bisnis | ` +
  `limit=${limit ?? "semua"} | ${dryRun ? "DRY RUN" : "tulis"}${remote ? " | + API TikTok" : " | dari payload lokal"}\n`
);

for (const business of businesses) {
  const report = await backfillSellerSkus(business.id, { limit, remote, dryRun });
  console.log(`# ${business.name} (${business.id})`);
  console.log(`  kosong saat mulai  : ${report.scanned}`);
  console.log(`  dari payload lokal : ${report.filledFromPayload}`);
  console.log(`  dari API TikTok    : ${report.filledFromRemote}`);
  console.log(`  gagal              : ${report.failed}`);
  console.log(`  masih kosong       : ${report.remaining}`);
  for (const error of report.errors.slice(0, 10)) console.log(`  ! ${error}`);
  if (report.errors.length > 10) console.log(`  ! … ${report.errors.length - 10} error lain`);
  console.log("");
}

await prisma.$disconnect();
