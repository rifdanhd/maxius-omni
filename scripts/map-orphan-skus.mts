/**
 * map-orphan-skus.mts — [DEPRECATED wrapper] cleanup backlog orphan SKU.
 *
 * Logika inti sudah pindah ke lib/services/orphan-sku.service.ts (satu sumber
 * kebenaran yang dipakai juga oleh UI panel "SKU Order Belum Ter-mapping" di
 * halaman Mapping + POST/PATCH /api/inventory/mappings untuk backfill historis).
 * Script ini tinggal pembungkus utk kebutuhan batch sekali-jalan (opsional).
 *
 * Jalankan: npx tsx scripts/map-orphan-skus.mts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
process.env.DATABASE_URL = process.env.DATABASE_URL ?? `file:${process.cwd()}/prisma/dev.db`;

/** Nama master yang ringkas + SKU master, diturunkan dari judul listing asli. */
const TARGETS = [
  {
    channelSku: "1737387131649624033",
    masterName: "RIKI Keripik Pedas",
    masterSku: "RIKI-KRIP-PEDAS",
    category: "Makanan Ringan",
  },
  {
    channelSku: "1737402388465027006",
    masterName: "Maxius Stiker Logo Elegan",
    masterSku: "MAX-STIKER-LOGO",
    category: "Stiker & Dekorasi",
  },
] as const;

async function main() {
  const { findOrphanSkus, mapOrphanToNewMaster } = await import(
    "@/lib/services/orphan-sku.service"
  );

  for (const t of TARGETS) {
    const orphan = (await findOrphanSkus("business-default")).find((o) => o.channelSku === t.channelSku);
    if (!orphan) {
      console.log(`= ${t.channelSku}: tidak ada OrderItem orphan — dilewati (sudah aman).`);
      continue;
    }
    console.log(`\n=== ${t.channelSku} (account=${orphan.accountId}, ${orphan.qty} pcs) ===`);
    const r = await mapOrphanToNewMaster({
      businessId: "business-default",
      accountId: orphan.accountId,
      channelSku: t.channelSku,
      newProductName: t.masterName,
      sku: t.masterSku,
      category: t.category,
      platformTitle: orphan.sampleProductName ?? undefined,
    });
    console.log(`  + master ${r.masterProductId}, varian ${r.variantId} (stok 0 — input via UI)`);
    console.log(`  ↳ ${r.backfilled} OrderItem historis di-backfill.`);
  }

  const remaining = await prisma.orderItem.count({ where: { variantId: null } });
  console.log(`\nOrderItem tanpa varian tersisa: ${remaining}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
