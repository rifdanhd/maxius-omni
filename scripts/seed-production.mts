/**
 * seed-production.mts — seed MINIMAL untuk database production (Postgres).
 *
 * Hanya membuat baris fondasi, TANPA data dummy:
 *   1. 5 Business fase 1 (business-default = "Maxius" + 4 brand lain)
 *   2. User admin (password RANDOM dicetak sekali ke terminal — ganti setelah login)
 *   3. InventorySetting id="inventory-default" (singleton pengaturan inventori)
 *   4. AppCredential "Legacy ENV" per platform (secret null = baca dari env)
 *   5. UserBusiness: semua user akses semua brand (fase 1, tanpa role)
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
import crypto from "crypto";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const brands = [
    { id: "business-default", name: "Maxius" },
    { id: "business-raxen", name: "Raxen" },
    { id: "business-kaos-kaki-sport", name: "Kaos Kaki Sport" },
    { id: "business-den-sport", name: "Den Sport" },
    { id: "business-getobdg", name: "Geto.bdg" },
  ];
  for (const b of brands) {
    // business-default existing di production di-rename (bukan duplikat).
    await prisma.business.upsert({
      where: { id: b.id },
      update: { name: b.name },
      create: { id: b.id, name: b.name },
    });
  }
  console.log(`✅ Business: ${brands.map((b) => b.name).join(", ")}`);

  // Password RANDOM — dicetak SEKALI ke terminal ini saja, tidak disimpan di
  // file/log manapun. Operator wajib mencatatnya lalu ganti setelah login pertama.
  const adminPassword = crypto.randomBytes(18).toString("base64url");
  const passwordHash = bcrypt.hashSync(adminPassword, 10);
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: { id: crypto.randomUUID(), username: "admin", passwordHash, canViewFullPii: true },
  });
  const adminCreated = admin.passwordHash === passwordHash;
  if (adminCreated) {
    console.log(`✅ User: username=admin`);
    console.log(`\n⚠️  PASSWORD ADMIN (cetak sekali, catat sekarang):\n\n   ${adminPassword}\n`);
  } else {
    console.log(`✅ User: username=admin (sudah ada — password TIDAK diubah)`);
  }

  const setting = await prisma.inventorySetting.upsert({
    where: { id: "inventory-default" },
    update: {},
    create: { id: "inventory-default" },
  });
  console.log(`✅ InventorySetting: id=${setting.id}`);

  for (const c of [
    { id: "app-cred-shopee-legacy", platform: "SHOPEE", label: "Legacy ENV (Seller app)" },
    { id: "app-cred-tiktok-legacy", platform: "TIKTOK_SHOP", label: "Legacy ENV" },
  ]) {
    await prisma.appCredential.upsert({
      where: { platform_label: { platform: c.platform, label: c.label } },
      update: {},
      create: { id: c.id, platform: c.platform, label: c.label },
    });
  }
  console.log(`✅ AppCredential: Legacy ENV (Shopee + TikTok)`);

  // Fase 1: semua user akses semua brand.
  const [users, businesses] = await Promise.all([
    prisma.user.findMany({ select: { id: true, username: true } }),
    prisma.business.findMany({ select: { id: true } }),
  ]);
  for (const u of users) {
    for (const b of businesses) {
      await prisma.userBusiness.upsert({
        where: { userId_businessId: { userId: u.id, businessId: b.id } },
        update: {},
        create: { userId: u.id, businessId: b.id },
      });
    }
  }
  console.log(`✅ UserBusiness: ${users.length} user × ${businesses.length} brand`);

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.business.count(),
    prisma.platformAccount.count(),
    prisma.appCredential.count(),
    prisma.userBusiness.count(),
  ]);
  console.log(
    `\nRingkasan DB: users=${counts[0]}, businesses=${counts[1]}, accounts=${counts[2]}, credentials=${counts[3]}, userBusiness=${counts[4]}`
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
