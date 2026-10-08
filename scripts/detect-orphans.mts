import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
try {
  // Read-only transaction: this script can never repair/delete data.
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return {
      settingsWithoutBusiness: await tx.$queryRaw`SELECT s."id", s."businessId" FROM "InventorySetting" s LEFT JOIN "Business" b ON b."id"=s."businessId" WHERE b."id" IS NULL`,
      runsWithoutBusiness: await tx.$queryRaw`SELECT s."id", s."businessId" FROM "SyncRun" s LEFT JOIN "Business" b ON b."id"=s."businessId" WHERE b."id" IS NULL`,
      mastersWithoutVariants: await tx.masterProduct.findMany({ where: { type: "single", productVariant: { none: {} } }, select: { id: true, businessId: true } }),
      variantsWithoutMappings: await tx.productVariant.findMany({ where: { productMapping: { none: {} } }, select: { id: true, masterProductId: true } }),
      crossBusinessMappings: await tx.$queryRaw`SELECT m."id" FROM "ProductMapping" m JOIN "PlatformAccount" a ON a."id"=m."accountId" JOIN "ProductVariant" v ON v."id"=m."variantId" JOIN "MasterProduct" p ON p."id"=v."masterProductId" WHERE a."businessId" <> p."businessId"`,
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await prisma.$disconnect(); }
