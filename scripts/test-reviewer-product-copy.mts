/**
 * test-reviewer-product-copy.mts
 *
 * Menguji pembatasan endpoint /api/product-copy/parse khusus untuk role reviewer.
 * Membuktikan bahwa request dari reviewer ditolak dengan status 403 Forbidden.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const ORIGIN = BASE;

const REVIEWER_USER = `rev_copy_${Date.now()}`;
const REVIEWER_PASS = "ReviewerCopy2026!";
let reviewerUserId = "";

async function loginUser(username: string, pass: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ username, password: pass }),
  });
  const cookie = res.headers.get("set-cookie") || "";
  const match = cookie.match(/maxius_session=([^;]+)/);
  if (!match) throw new Error(`Login failed for ${username}, status ${res.status}`);
  return match[1];
}

async function main() {
  console.log("\n========================================================");
  console.log("   UJI PEMBATASAN /api/product-copy/parse UNTUK REVIEWER ");
  console.log("========================================================\n");

  // 1. Buat user reviewer di DB
  reviewerUserId = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(REVIEWER_PASS, 10);
  await prisma.user.create({
    data: { id: reviewerUserId, username: REVIEWER_USER, passwordHash, canViewFullPii: false },
  });
  await prisma.userBusiness.create({
    data: { userId: reviewerUserId, businessId: "business-default", role: "reviewer" },
  });

  console.log(`1. User reviewer dibuat: ${REVIEWER_USER} (role: reviewer)`);

  // 2. Login reviewer
  const token = await loginUser(REVIEWER_USER, REVIEWER_PASS);
  console.log("2. Login reviewer sukses. Token sesi diperoleh.");

  // 3. Panggil /api/product-copy/parse
  console.log("3. Memanggil POST /api/product-copy/parse dengan token reviewer:");
  const testUrl = "https://shopee.co.id/Kaos-Kaki-Polos-Hitam-i.12345678.98765432";
  const res = await fetch(`${BASE}/api/product-copy/parse`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: testUrl }),
  });

  const status = res.status;
  let body: any = null;
  try { body = await res.json(); } catch {}

  console.log(`   - HTTP Status : ${status} (Harus 403 Forbidden)`);
  console.log(`   - Response Body: ${JSON.stringify(body)}`);

  const passed = status === 403;
  console.log(`\n   Hasil Pengujian: ${passed ? "✅ LULUS (403 Forbidden - Akses Ditolak)" : "❌ GAGAL (Tidak 403)"}\n`);

  // 4. Cleanup
  await prisma.userBusiness.deleteMany({ where: { userId: reviewerUserId } });
  await prisma.user.delete({ where: { id: reviewerUserId } });
  await prisma.$disconnect();

  if (!passed) process.exit(1);
}

main().catch(async (e) => {
  console.error("Test failed:", e);
  if (reviewerUserId) {
    await prisma.userBusiness.deleteMany({ where: { userId: reviewerUserId } });
    await prisma.user.delete({ where: { id: reviewerUserId } });
  }
  await prisma.$disconnect();
  process.exit(1);
});
