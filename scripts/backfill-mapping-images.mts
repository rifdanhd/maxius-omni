import { prisma } from "../lib/db/prisma";
import { backfillMappingImages, type MappingImageBackfillPlatform } from "../lib/services/mapping-image-backfill.service";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];

const platformArg = value("platform")?.toUpperCase();
const platform: MappingImageBackfillPlatform | undefined =
  platformArg === "SHOPEE" || platformArg === "TIKTOK" ? (platformArg === "TIKTOK" ? "TIKTOK_SHOP" : "SHOPEE") : undefined;
const limit = Number(value("limit") ?? "") || undefined;
const localOnly = flag("local-only");
const dryRun = flag("dry-run");

const businesses = process.env.BUSINESS_ID
  ? await prisma.business.findMany({ where: { id: process.env.BUSINESS_ID }, select: { id: true, name: true } })
  : await prisma.business.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });

console.log(
  `Backfill ProductMapping.imageUrl — ${businesses.length} bisnis | platform=${platform ?? "semua"} | ` +
  `limit=${limit ?? 300} | ${dryRun ? "DRY RUN" : "tulis"}${localOnly ? " | lokal saja" : ""}\n`
);

for (const business of businesses) {
  const report = await backfillMappingImages(business.id, { platform, limit, localOnly, dryRun });
  console.log(`# ${business.name} (${business.id})`);
  console.log(`  kosong saat mulai : ${report.scanned}`);
  console.log(`  dari riwayat order: ${report.filledFromOrders}`);
  console.log(`  dari Shopee       : ${report.filledFromShopee}`);
  console.log(`  dari TikTok       : ${report.filledFromTiktok}`);
  console.log(`  listing dipanggil : ${report.platformFetches}`);
  console.log(`  gagal             : ${report.failed}`);
  console.log(`  masih kosong      : ${report.remaining}`);
  for (const error of report.errors.slice(0, 10)) console.log(`  ! ${error}`);
  if (report.errors.length > 10) console.log(`  ! … ${report.errors.length - 10} error lain`);
  console.log("");
}

await prisma.$disconnect();
