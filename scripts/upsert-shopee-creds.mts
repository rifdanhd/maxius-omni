/**
 * upsert-shopee-creds.mts — simpan partner Test/Live ke tabel AppCredential.
 *
 * Secrets DIAMBIL dari env (bukan hardcode) — aman dari Git.
 *
 * USAGE lokal (Test → DB lokal):
 *   SHOPEE_TEST_PARTNER_ID=... SHOPEE_TEST_PARTNER_KEY=... \
 *   npx tsx scripts/upsert-shopee-creds.mts test
 *
 * USAGE VPS (Live → DB production; POSTGRES_URL dari env server):
 *   SHOPEE_LIVE_PARTNER_ID=... SHOPEE_LIVE_PARTNER_KEY=... \
 *   npx tsx scripts/upsert-shopee-creds.mts live
 *
 * Label unik (platform+label): "Shopee Test (Sandbox)" / "Shopee Live".
 * Authorize pilih credential: /api/auth/shopee/authorize?credentialId=<id>
 * (default resolve: Legacy ENV > active[0] — pastikan nonaktifkan baris
 *  lama bila ingin eksklusif pakai baris ini).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Mode = "test" | "live";

const LABELS: Record<Mode, string> = {
  test: "Shopee Test (Sandbox)",
  live: "Shopee Live",
};

async function main() {
  const mode = (process.argv[2] ?? "") as Mode;
  if (mode !== "test" && mode !== "live") {
    console.error("Pakai: npx tsx scripts/upsert-shopee-creds.mts <test|live>");
    process.exit(1);
  }

  const idEnv = mode === "test" ? "SHOPEE_TEST_PARTNER_ID" : "SHOPEE_LIVE_PARTNER_ID";
  const keyEnv = mode === "test" ? "SHOPEE_TEST_PARTNER_KEY" : "SHOPEE_LIVE_PARTNER_KEY";
  const partnerId = process.env[idEnv];
  const partnerKey = process.env[keyEnv];
  if (!partnerId || !partnerKey) {
    console.error(`Env ${idEnv} dan ${keyEnv} wajib diisi.`);
    process.exit(1);
  }

  const label = LABELS[mode];
  const row = await prisma.appCredential.upsert({
    where: { platform_label: { platform: "SHOPEE", label } },
    update: { clientId: partnerId, clientSecret: partnerKey, isActive: true },
    create: {
      id: mode === "test" ? "app-cred-shopee-test" : "app-cred-shopee-live",
      platform: "SHOPEE",
      label,
      clientId: partnerId,
      clientSecret: partnerKey,
      isActive: true,
    },
  });
  console.log(`✅ AppCredential [${mode}] id=${row.id} label="${row.label}" clientId=${row.clientId}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
