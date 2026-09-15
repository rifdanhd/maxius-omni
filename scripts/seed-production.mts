/**
 * seed-production.mts — seed MINIMAL untuk database production (Postgres).
 *
 * Hanya membuat baris fondasi, TANPA data dummy:
 *   1. Business id="business-default" (wajib ada — default FK PlatformAccount/MasterProduct)
 *   2. User admin (admin/admin123 — GANTI password setelah login pertama)
 *   3. InventorySetting id="inventory-default" (singleton pengaturan inventori)
 *
 * Idempotent: aman dijalankan berulang (upsert semua).
 *
 * USAGE (POSTGRES_URL harus menunjuk ke Postgres production):
 *   POSTGRES_URL="postgres://..." npx tsx scripts/seed-production.mts
 *
 * JANGAN jalankan prisma/seed.js ke production — itu seed dummy dev
 * (kaos kaki + akun tiktok-1..3) untuk testing lokal saja.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const business = await prisma.business.upsert({
    where: { id: "business-default" },
    update: {},
    create: { id: "business-default", name: "Bisnis Utama" },
  });
  console.log(`✅ Business: id=${business.id} name="${business.name}"`);

  const passwordHash = bcrypt.hashSync("admin123", 10);
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: { username: "admin", passwordHash, canViewFullPii: true },
  });
  console.log(`✅ User: username=${admin.username} (password awal: admin123)`);

  const setting = await prisma.inventorySetting.upsert({
    where: { id: "inventory-default" },
    update: {},
    create: { id: "inventory-default" },
  });
  console.log(`✅ InventorySetting: id=${setting.id}`);

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.business.count(),
    prisma.platformAccount.count(),
  ]);
  console.log(
    `\nRingkasan DB: users=${counts[0]}, businesses=${counts[1]}, accounts=${counts[2]}`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
