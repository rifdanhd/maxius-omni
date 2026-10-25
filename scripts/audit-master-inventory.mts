import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
const flag = process.argv.indexOf("--business-id");
const businessId = flag >= 0 ? process.argv[flag + 1] : "business-default";
if (!businessId) throw new Error("Isi --business-id dengan ID customer yang diperiksa.");
try {
  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } });
  if (!business) throw new Error("Customer tidak ditemukan.");
  const columns = await db.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema()
      AND ((table_name = 'Order' AND column_name = 'importOnly') OR (table_name = 'ProductVariant' AND column_name = 'isArchived'))
  `;
  const hasImportOnly = columns.some((column) => column.column_name === "importOnly");
  const hasArchive = columns.some((column) => column.column_name === "isArchived");
  const active = Prisma.sql`mp."isActive" AND upper(mp.status) NOT IN ('INACTIVE','ARCHIVED','DELETED','DRAFT')
    ${hasArchive ? Prisma.sql`AND NOT pv."isArchived"` : Prisma.empty}`;
  const totals = await db.$queryRaw(Prisma.sql`
    SELECT COUNT(*) AS "skuTotal", SUM(pv.stock)::text AS "stokGudang",
      SUM(GREATEST(pv.stock-pv."safetyStock",0))::text AS "siapJual",
      COUNT(*) FILTER (WHERE GREATEST(pv.stock-pv."safetyStock",0)=0) AS "habisTotal",
      COUNT(*) FILTER (WHERE GREATEST(pv.stock-pv."safetyStock",0)=0 AND ${active}) AS "habisProdukAktif",
      COUNT(*) FILTER (WHERE GREATEST(pv.stock-pv."safetyStock",0)=0 AND NOT (${active})) AS "habisNonaktifArsip",
      COUNT(*) FILTER (WHERE pv.sku ~ '^[0-9]+:[0-9]+$') AS "skuBerbentukIdMarketplace",
      COUNT(*) FILTER (WHERE pv.stock=888888) AS "varianStok888888"
    FROM "ProductVariant" pv JOIN "MasterProduct" mp ON mp.id=pv."masterProductId" WHERE mp."businessId"=${businessId}
  `);
  const logs = await db.$queryRaw`
    SELECT COUNT(*) AS "logPotongStokGagal", COUNT(*) FILTER (WHERE sl."handledAt" IS NULL) AS "logBelumDitangani",
      COUNT(DISTINCT substring(sl.payload FROM '"orderId"[[:space:]]*:[[:space:]]*"([^"]+)"')) AS "orderUnikPadaLog"
    FROM "SyncLog" sl JOIN "PlatformAccount" a ON a.id=sl."accountId"
    WHERE a."businessId"=${businessId} AND sl.kind='central_stock_deduct'
  `;
  const shortage = await db.$queryRaw(Prisma.sql`
    SELECT count(*) AS "skuOversellAktif" FROM (
      SELECT pv.id FROM "OrderItem" oi JOIN "Order" o ON o.id=oi."orderId"
      JOIN "PlatformAccount" a ON a.id=o."accountId" JOIN "ProductVariant" pv ON pv.id=oi."variantId"
      JOIN "MasterProduct" mp ON mp.id=pv."masterProductId"
      WHERE a."businessId"=${businessId} AND mp."businessId"=${businessId} AND ${active}
        AND o.status IN ('UNPAID','ON_HOLD','AWAITING_SHIPMENT','PARTIALLY_SHIPPING')
        ${hasImportOnly ? Prisma.sql`AND NOT o."importOnly"` : Prisma.empty}
        AND NOT EXISTS (SELECT 1 FROM "StockLedger" sl WHERE sl."referenceId"=o.id AND sl."variantId"=pv.id AND sl.reason='ORDER')
      GROUP BY pv.id,pv.stock,pv."safetyStock" HAVING SUM(oi.qty)>GREATEST(pv.stock-pv."safetyStock",0)
    ) shortages
  `);
  const statuses = await db.order.groupBy({ by: ["status"], where: { account: { businessId } }, _count: { _all: true } });
  const duplicates = await db.$queryRaw`
    SELECT count(*) AS "kelompokSkuGanda" FROM (
      SELECT trim(pv.sku) FROM "ProductVariant" pv JOIN "MasterProduct" mp ON mp.id=pv."masterProductId"
      WHERE mp."businessId"=${businessId} AND pv.sku !~ '^[0-9]+(:[0-9]+)?$'
      GROUP BY trim(pv.sku) HAVING COUNT(*)>1
    ) groups
  `;
  console.log(JSON.stringify({ business, historicalFlagAvailable: hasImportOnly,
    totals, logs, shortage, duplicates, statuses,
    note: "Baca saja. Angka habis aktif/nonaktif ini berdasarkan status produk induk dan arsip SKU; status listing diperiksa lebih lanjut setelah sinkronisasi metadata." },
  (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
} catch (error) {
  console.error("Audit belum selesai:", error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.name : "ERROR");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
