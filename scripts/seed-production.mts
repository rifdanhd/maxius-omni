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

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  if (isDryRun) {
    console.log("🔍 MODE DRY-RUN AKTIF: Tidak ada data yang akan diubah di database.\n");
  }

  const brands = [
    { id: "business-default", name: "Maxius", isDemo: false },
    { id: "business-raxen", name: "Raxen", isDemo: false },
    { id: "business-kaos-kaki-sport", name: "Kaos Kaki Sport", isDemo: false },
    { id: "business-den-sport", name: "Den Sport", isDemo: false },
    { id: "business-getobdg", name: "Geto.bdg", isDemo: false },
  ];

  console.log("1. Evaluasi Bisnis Produksi (5 Brand Fondasi):");
  for (const b of brands) {
    const existing = await prisma.business.findUnique({ where: { id: b.id } });
    if (existing) {
      console.log(`   - [EXISTING] Business id="${b.id}" name="${existing.name}" (isDemo: ${existing.isDemo}) -> update name: "${b.name}", isDemo: false`);
    } else {
      console.log(`   - [CREATE]   Business id="${b.id}" name="${b.name}" isDemo=false`);
    }
    if (!isDryRun) {
      await prisma.business.upsert({
        where: { id: b.id },
        update: { name: b.name, isDemo: false },
        create: { id: b.id, name: b.name, isDemo: false },
      });
    }
  }

  console.log("\n2. Evaluasi User Admin:");
  const existingAdmin = await prisma.user.findUnique({ where: { username: "admin" } });
  let adminId = existingAdmin?.id;
  if (existingAdmin) {
    console.log(`   - [EXISTING] User 'admin' id="${existingAdmin.id}" sudah ada. Password TIDAK diubah.`);
  } else {
    console.log("   - [CREATE]   User 'admin' belum ada -> akan dibuat dengan ID random dan password baru.");
    if (!isDryRun) {
      const adminPassword = crypto.randomBytes(18).toString("base64url");
      const passwordHash = bcrypt.hashSync(adminPassword, 10);
      adminId = crypto.randomUUID();
      await prisma.user.create({
        data: { id: adminId, username: "admin", passwordHash, canViewFullPii: true },
      });
      console.log(`\n⚠️  PASSWORD ADMIN (cetak sekali, catat sekarang):\n\n   ${adminPassword}\n`);
    }
  }

  console.log("\n3. Evaluasi InventorySetting:");
  const existingSetting = await prisma.inventorySetting.findUnique({ where: { id: "inventory-default" } });
  if (existingSetting) {
    console.log(`   - [EXISTING] InventorySetting id="inventory-default" sudah ada.`);
  } else {
    console.log(`   - [CREATE]   InventorySetting id="inventory-default" akan dibuat.`);
    if (!isDryRun) {
      await prisma.inventorySetting.create({ data: { id: "inventory-default" } });
    }
  }

  console.log("\n4. Evaluasi AppCredential (Shopee + TikTok Legacy ENV):");
  const creds = [
    { id: "app-cred-shopee-legacy", platform: "SHOPEE", label: "Legacy ENV (Seller app)" },
    { id: "app-cred-tiktok-legacy", platform: "TIKTOK_SHOP", label: "Legacy ENV" },
  ];
  for (const c of creds) {
    const existingCred = await prisma.appCredential.findUnique({
      where: { platform_label: { platform: c.platform, label: c.label } },
    });
    if (existingCred) {
      console.log(`   - [EXISTING] AppCredential platform="${c.platform}" label="${c.label}" id="${existingCred.id}"`);
    } else {
      console.log(`   - [CREATE]   AppCredential platform="${c.platform}" label="${c.label}" id="${c.id}"`);
      if (!isDryRun) {
        await prisma.appCredential.create({ data: c });
      }
    }
  }

  console.log("\n5. Evaluasi Hak Akses UserBusiness (Admin -> 5 Brand, Role: owner):");
  if (adminId) {
    for (const b of brands) {
      const existingUb = await prisma.userBusiness.findUnique({
        where: { userId_businessId: { userId: adminId, businessId: b.id } },
      });
      if (existingUb) {
        console.log(`   - [EXISTING] UserBusiness userId="${adminId}" businessId="${b.id}" role="${existingUb.role}"`);
      } else {
        console.log(`   - [CREATE]   UserBusiness userId="${adminId}" businessId="${b.id}" role="owner"`);
        if (!isDryRun) {
          await prisma.userBusiness.create({
            data: { userId: adminId, businessId: b.id, role: "owner" },
          });
        }
      }
    }
  }

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.business.count(),
    prisma.platformAccount.count(),
    prisma.appCredential.count(),
    prisma.userBusiness.count(),
  ]);

  console.log(
    `\nRingkasan Database Saat Ini: users=${counts[0]}, businesses=${counts[1]}, accounts=${counts[2]}, credentials=${counts[3]}, userBusiness=${counts[4]}`
  );
  if (isDryRun) {
    console.log("\n✅ HASIL DRY-RUN: Konfirmasi 100% aman — 0 baris database diubah.");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
