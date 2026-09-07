/**
 * Anonimisasi PII pembeli (retensi 90 hari — UU PDP Pasal 19 & 26).
 *
 * Menghapus field PII pada Order yang sudah selesai (DELIVERED/COMPLETED)
 * lebih dari RETENTION_DAYS, dan menyimpan catatan ke PiiAccessLog (action
 * ANONYMIZE + SEMUA order lama) untuk akuntabilitas permintaan penghapusan.
 *
 * Non-destruktif: hanya meng-null-kan kolom PII (recipientName/Phone/Address,
 * buyerName, buyerEmail, buyerNote), data transaksi agregat tetap disimpan.
 *
 * Penggunaan:
 *   node scripts/anonymize-pii.cjs            # dry-run (default)
 *   node scripts/anonymize-pii.cjs --apply    # benar-benar eksekusi
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const RETENTION_DAYS = Number(process.env.PII_RETENTION_DAYS || 90);

const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
const STATUS_DONE = ["DELIVERED", "COMPLETED"];

const targets = await prisma.order.findMany({
  where: {
    status: { in: STATUS_DONE },
    piiAnonymizedAt: null,
    paidTime: { lt: cutoff },
  },
  select: { id: true, orderNo: true, buyerName: true },
});

console.log(`[anonymize-pii] mode=${APPLY ? "APPLY" : "DRY-RUN"} | cutoff=${cutoff.toISOString()}`);
console.log(`[anonymize-pii] order selesai >${RETENTION_DAYS}hr tersisa PII: ${targets.length}`);

// Log untuk SEMUA order yang memenuhi syarat (legal basis permintaan/retensi),
// terlepas dari mode apply (akuntabilitas audit ditulis saat boulevard benar-benar
// menghapus; pada dry-run hanya dilaporkan via console). 
if (!APPLY) {
  for (const t of targets) console.log(`  - ${t.orderNo} (${t.buyerName ?? "-"})`);
  await prisma.$disconnect();
  process.exit(0);
}

for (const t of targets) {
  await prisma.$transaction([
    prisma.order.update({
      where: { id: t.id },
      data: {
        recipientName: null,
        recipientPhone: null,
        recipientAddress: null,
        buyerName: null,
        buyerEmail: null,
        buyerNote: null,
        piiAnonymizedAt: new Date(),
      },
    }),
    prisma.piiAccessLog.create({
      data: {
        userId: "system",
        username: "retention-job",
        orderId: t.id,
        orderNo: t.orderNo,
        action: "ANONYMIZE",
        detail: `PII pembeli di-anonimkan otomatis ${RETENTION_DAYS} hari setelah selesai.`,
      },
    }),
  ]);
}

console.log(`[anonymize-pii] selesai: ${targets.length} order di-anonimkan.`);
await prisma.$disconnect();
