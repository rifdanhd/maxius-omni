/**
 * test-stage5-role-guard.mts — Stage 5 role guard verification.
 *
 * Verifikasi:
 *   1. Buat user "reviewer" di DB lokal (UserBusiness role=reviewer)
 *   2. Login reviewer → dapat token
 *   3. Panggil endpoint produksi dgn token reviewer → GET = 200 OK,
 *      semua write (termasuk admin routes & product-copy) = 403
 *   4. Login admin → verify data produksi tidak berubah (product count, user count)
 *   5. Bersihkan user reviewer di akhir
 *
 * USAGE:
 *   npx tsx scripts/test-stage5-role-guard.mts
 *
 * Perlu dev server berjalan di port 3000 dan POSTGRES_URL ke maxius_dev.
 */
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const ORIGIN = BASE; // same-origin for CSRF
const JWT_SECRET = process.env.JWT_SECRET!;

if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET environment variable wajib diisi.");
  process.exit(1);
}

const REVIEWER_USERNAME = `__test_reviewer_${Date.now()}`;
const REVIEWER_PASSWORD = "ReviewerTest-2026!";

let reviewerUserId = "";
let passCount = 0;
let failCount = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  ✅ ${label}`);
  } else {
    failCount++;
    console.error(`  ❌ ${label}${detail ? `: ${detail}` : ""}`);
  }
}

async function apiRequest(
  path: string,
  opts: {
    method?: string;
    token?: string;
    cookie?: string;
    body?: unknown;
  } = {}
): Promise<{ status: number; data: unknown; headers: Headers }> {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
  };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  if (opts.body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: res.headers };
}

async function loginUser(
  username: string,
  password: string
): Promise<{ token: string; cookie: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
    },
    body: JSON.stringify({ username, password }),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const cookieMatch = setCookie.match(/maxius_session=([^;]+)/);
  const cookie = cookieMatch ? `maxius_session=${cookieMatch[1]}` : "";
  // Extract token from cookie (it's the JWT)
  const token = cookieMatch ? cookieMatch[1] : "";
  if (res.status !== 200) {
    throw new Error(`Login gagal (status ${res.status}) untuk ${username}`);
  }
  return { token, cookie };
}

async function snapshotCounts() {
  const [products, users, businesses, variants] = await Promise.all([
    prisma.masterProduct.count(),
    prisma.user.count(),
    prisma.business.count(),
    prisma.productVariant.count(),
  ]);
  return { products, users, businesses, variants };
}

async function main() {
  console.log("\n🔬 Stage 5 — Role Guard Verification\n");
  console.log(`   Base URL : ${BASE}`);
  console.log(`   DB       : ${process.env.POSTGRES_URL?.replace(/:([^@]+)@/, ":***@") || "(from env)"}\n`);

  // ── 0. Snapshot data produksi SEBELUM test ────────────────────────────
  console.log("── 0. Snapshot data sebelum test ──");
  const before = await snapshotCounts();
  console.log(`   Products: ${before.products}, Users: ${before.users}, Businesses: ${before.businesses}, Variants: ${before.variants}\n`);

  // ── 1. Buat user reviewer di DB ───────────────────────────────────────
  console.log("── 1. Buat user reviewer ──");
  const passwordHash = bcrypt.hashSync(REVIEWER_PASSWORD, 10);
  reviewerUserId = crypto.randomUUID();
  await prisma.user.create({
    data: {
      id: reviewerUserId,
      username: REVIEWER_USERNAME,
      passwordHash,
      canViewFullPii: false,
    },
  });
  // Assign as reviewer to business-default
  await prisma.userBusiness.create({
    data: {
      userId: reviewerUserId,
      businessId: "business-default",
      role: "reviewer",
    },
  });
  console.log(`   Created: ${REVIEWER_USERNAME} (role=reviewer) → business-default\n`);

  // ── 1b. Verifikasi DB CHECK constraint menerima reviewer, menolak role asing ──
  console.log("── 1b. Verifikasi DB CHECK constraint ──");
  const reviewerMembership = await prisma.userBusiness.findUnique({
    where: { userId_businessId: { userId: reviewerUserId, businessId: "business-default" } },
  });
  assert(reviewerMembership?.role === "reviewer", "DB menerima role 'reviewer'");

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "UserBusiness" ("userId", "businessId", "role", "createdAt") VALUES ($1, $2, 'superadmin', NOW())`,
      reviewerUserId,
      "business-raxen"
    );
    assert(false, "DB CHECK harus menolak role 'superadmin'", "INSERT berhasil padahal seharusnya gagal");
    await prisma.$executeRawUnsafe(
      `DELETE FROM "UserBusiness" WHERE "userId"=$1 AND "businessId"=$2`,
      reviewerUserId,
      "business-raxen"
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    assert(
      msg.includes("UserBusiness_role_check") || msg.includes("check"),
      "DB CHECK menolak role asing 'superadmin'",
      msg.substring(0, 120)
    );
  }

  // ── 2. Login reviewer ─────────────────────────────────────────────────
  console.log("\n── 2. Login reviewer ──");
  let reviewerCreds: { token: string; cookie: string };
  try {
    reviewerCreds = await loginUser(REVIEWER_USERNAME, REVIEWER_PASSWORD);
    assert(true, "Login reviewer berhasil");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`   ❌ Login reviewer gagal: ${msg}`);
    failCount++;
    await cleanup();
    process.exit(1);
  }

  // ── 3. Test endpoint produksi dengan token reviewer ───────────────────
  console.log("\n── 3. Panggil endpoint dgn token reviewer (read-only) ──");

  // 3a. GET /api/products — reviewer boleh baca → 200
  const getProducts = await apiRequest("/api/products", { token: reviewerCreds.token });
  assert(getProducts.status === 200, `GET /api/products → ${getProducts.status} (expect 200)`);

  // 3b. GET /api/auth/me — informasi user
  const getMe = await apiRequest("/api/auth/me", { token: reviewerCreds.token });
  assert(getMe.status === 200, `GET /api/auth/me → ${getMe.status} (expect 200)`);
  if (getMe.status === 200) {
    const meData = getMe.data as { user?: { role?: string } };
    assert(meData?.user?.role === "reviewer", `User role = "${meData?.user?.role}" (expect "reviewer")`);
  }

  // 3c. POST /api/sales — operasi tulis staff, reviewer read-only → 403
  const postSales = await apiRequest("/api/sales", {
    method: "POST",
    token: reviewerCreds.token,
    body: { variantId: "fake-variant", qty: 1 },
  });
  assert(
    postSales.status === 403,
    `POST /api/sales → ${postSales.status} (expect 403)`,
    JSON.stringify(postSales.data)
  );

  // 3d. POST /api/product-copy/parse — selalu dilarang untuk reviewer → 403
  const postCopy = await apiRequest("/api/product-copy/parse", {
    method: "POST",
    token: reviewerCreds.token,
    body: { url: "https://shopee.co.id/Kaos-Kaki-Polos-Hitam-i.12345678.98765432" },
  });
  assert(
    postCopy.status === 403,
    `POST /api/product-copy/parse → ${postCopy.status} (expect 403)`,
    JSON.stringify(postCopy.data)
  );

  // 3e. DELETE /api/stores/fake-id — admin-only route → reviewer harus 403
  const deleteStores = await apiRequest("/api/stores/fake-id", {
    method: "DELETE",
    token: reviewerCreds.token,
  });
  assert(
    deleteStores.status === 403,
    `DELETE /api/stores/fake-id → ${deleteStores.status} (expect 403)`,
    JSON.stringify(deleteStores.data)
  );

  // 3f. PUT /api/inventory/settings — admin-only route → reviewer harus 403
  const putSettings = await apiRequest("/api/inventory/settings", {
    method: "PUT",
    token: reviewerCreds.token,
    body: { lowStockDefaultThreshold: 999 },
  });
  assert(
    putSettings.status === 403,
    `PUT /api/inventory/settings → ${putSettings.status} (expect 403)`,
    JSON.stringify(putSettings.data)
  );

  // 3g. POST /api/marketplace/tiktok/promotions/create — admin-only route → reviewer harus 403
  const postPromo = await apiRequest("/api/marketplace/tiktok/promotions/create", {
    method: "POST",
    token: reviewerCreds.token,
    body: { accountId: "acc-1", mappingIds: ["m-1"] },
  });
  assert(
    postPromo.status === 403,
    `POST /api/marketplace/tiktok/promotions/create → ${postPromo.status} (expect 403)`,
    JSON.stringify(postPromo.data)
  );

  // 3h. POST /api/auth/shopee/refresh — admin-only route → reviewer harus 403
  const postShopeeRefresh = await apiRequest("/api/auth/shopee/refresh", {
    method: "POST",
    token: reviewerCreds.token,
    body: { accountId: "acc-1" },
  });
  assert(
    postShopeeRefresh.status === 403,
    `POST /api/auth/shopee/refresh → ${postShopeeRefresh.status} (expect 403)`,
    JSON.stringify(postShopeeRefresh.data)
  );

  // ── 3i. Token palsu / invalid ─────────────────────────────────────────
  console.log("\n── 3i. Token palsu / invalid ──");
  const fakeToken = jwt.sign(
    { sub: "nonexistent", username: "hacker", businessId: "business-default", tokenVersion: 0 },
    JWT_SECRET,
    { expiresIn: "1h", algorithm: "HS256" }
  );
  const fakeGet = await apiRequest("/api/products", { token: fakeToken });
  assert(
    fakeGet.status === 401,
    `GET /api/products (fake token) → ${fakeGet.status} (expect 401)`,
    JSON.stringify(fakeGet.data)
  );

  // ── 3j. Token tanpa businessId ────────────────────────────────────────
  const noBizToken = jwt.sign(
    { sub: reviewerUserId, username: REVIEWER_USERNAME, tokenVersion: 0 },
    JWT_SECRET,
    { expiresIn: "1h", algorithm: "HS256" }
  );
  const noBizGet = await apiRequest("/api/products", { token: noBizToken });
  assert(
    noBizGet.status === 401,
    `GET /api/products (no businessId) → ${noBizGet.status} (expect 401)`,
    JSON.stringify(noBizGet.data)
  );

  // ── 3k. Token dgn businessId yang bukan milik reviewer ────────────────
  const wrongBizToken = jwt.sign(
    { sub: reviewerUserId, username: REVIEWER_USERNAME, businessId: "business-raxen", tokenVersion: 0, canViewFullPii: false },
    JWT_SECRET,
    { expiresIn: "1h", algorithm: "HS256" }
  );
  const wrongBizGet = await apiRequest("/api/products", { token: wrongBizToken });
  assert(
    wrongBizGet.status === 403,
    `GET /api/products (wrong business) → ${wrongBizGet.status} (expect 403)`,
    JSON.stringify(wrongBizGet.data)
  );

  // ── 4. Login admin & verifikasi data tidak berubah ────────────────────
  console.log("\n── 4. Login admin & verifikasi data tidak berubah ──");
  const adminPasswords = [process.env.MAXIUS_TEST_PASS, process.env.TEST_ADMIN_PASSWORD, "admin123"].filter(Boolean) as string[];
  let adminLoggedIn = false;
  for (const pw of adminPasswords) {
    try {
      const adminCreds = await loginUser("admin", pw);
      assert(true, "Login admin berhasil");
      adminLoggedIn = true;

      const adminProducts = await apiRequest("/api/products", { token: adminCreds.token });
      assert(adminProducts.status === 200, `GET /api/products (admin) → ${adminProducts.status}`);

      const adminMe = await apiRequest("/api/auth/me", { token: adminCreds.token });
      assert(adminMe.status === 200, `GET /api/auth/me (admin) → ${adminMe.status}`);
      if (adminMe.status === 200) {
        const meData = adminMe.data as { user?: { role?: string } };
        assert(meData?.user?.role === "owner", `Admin role = "${meData?.user?.role}" (expect "owner")`);
      }
      break;
    } catch {
      // try next candidate
    }
  }
  if (!adminLoggedIn) {
    assert(false, "Login admin gagal dengan kandidat password");
  }

  // Verifikasi DB snapshot tidak berubah
  const after = await snapshotCounts();
  // Exclude the reviewer user we just created
  const afterAdjusted = { ...after, users: after.users - 1 };
  assert(
    afterAdjusted.products === before.products,
    `Products unchanged: ${before.products} → ${afterAdjusted.products}`
  );
  assert(
    afterAdjusted.users === before.users,
    `Users unchanged (adjusted): ${before.users} → ${afterAdjusted.users}`
  );
  assert(
    afterAdjusted.businesses === before.businesses,
    `Businesses unchanged: ${before.businesses} → ${afterAdjusted.businesses}`
  );
  assert(
    afterAdjusted.variants === before.variants,
    `Variants unchanged: ${before.variants} → ${afterAdjusted.variants}`
  );

  // ── 5. Cleanup ────────────────────────────────────────────────────────
  await cleanup();

  // ── Hasil ─────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  ✅ Passed: ${passCount}  |  ❌ Failed: ${failCount}`);
  console.log(`${"═".repeat(50)}\n`);

  if (failCount > 0) process.exit(1);
}

async function cleanup() {
  console.log("\n── Cleanup ──");
  if (reviewerUserId) {
    await prisma.userBusiness.deleteMany({ where: { userId: reviewerUserId } });
    await prisma.user.delete({ where: { id: reviewerUserId } }).catch(() => {});
    console.log(`   Removed: ${REVIEWER_USERNAME}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Fatal:", e);
  await cleanup();
  process.exit(1);
});
