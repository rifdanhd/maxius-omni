import { prisma } from "@/lib/db/prisma";

// Sumber kredensial per-App (fase multi-brand). Secret plaintext di DB —
// konsisten dgn accessToken/refreshToken existing. Baris "Legacy ENV"
// (secret null) = baca dari env seperti perilaku sekarang.

export type CredentialRef =
  | { clientId: string | null; clientSecret: string | null; serviceId?: string | null }
  | null
  | undefined;

export function isShopeeAuthorizeEnabled(): boolean {
  return process.env.SHOPEE_AUTHORIZE_ENABLED === "true";
}

export function resolveShopeeCreds(cred?: CredentialRef): {
  partnerId: string;
  partnerKey: string;
} {
  const partnerId = cred?.clientId ?? process.env.SHOPEE_PARTNER_ID ?? "";
  const partnerKey = cred?.clientSecret ?? process.env.SHOPEE_PARTNER_KEY ?? "";
  if (!partnerId || !partnerKey) {
    throw new Error(
      "[Shopee] SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY belum diisi di .env."
    );
  }
  return { partnerId, partnerKey };
}

export function resolveTiktokCreds(cred?: CredentialRef): {
  appKey: string;
  appSecret: string;
  serviceId?: string;
} {
  const appKey = cred?.clientId ?? process.env.TIKTOK_APP_KEY ?? "";
  const appSecret = cred?.clientSecret ?? process.env.TIKTOK_APP_SECRET ?? "";
  if (!appKey || !appSecret) {
    throw new Error("[TikTok] TIKTOK_APP_KEY/SECRET belum diisi.");
  }
  const serviceId = cred?.serviceId ?? process.env.TIKTOK_SERVICE_ID ?? undefined;
  return { appKey, appSecret, serviceId };
}

// Guard akun dibekukan (mis. sengketa Shopee Support) — dipakai di
// refresh, push, sync, dan re-authorize. Dilempar sebagai error biasa
// agar goose ke pesan UI / skip SyncJob yg konsisten.
export function assertAccountActive(account: {
  label: string;
  isFrozen: boolean;
  frozenReason: string | null;
}): void {
  if (account.isFrozen) {
    throw new Error(
      `Akun "${account.label}" dibekukan${account.frozenReason ? `: ${account.frozenReason}` : "."}`
    );
  }
}

// Kredensial utk authorize BARU: param eksplisit > satu-satunya yg aktif >
// baris "Legacy ENV" > null (fallback env di resolver).
export async function getAuthorizeCredential(platform: string, requestedId?: string) {
  if (requestedId) {
    const c = await prisma.appCredential.findFirst({
      where: { id: requestedId, platform, isActive: true },
    });
    if (!c) throw new Error("App credential tidak ditemukan / nonaktif.");
    return c;
  }
  const active = await prisma.appCredential.findMany({
    where: { platform, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (active.length === 1) return active[0];
  return active.find((c) => c.label.startsWith("Legacy ENV")) ?? active[0] ?? null;
}

// Semua partner key Shopee aktif (DB + env) — utk verifikasi webhook
// multi-credential: coba satu per satu sampai cocok.
export async function listActiveShopeeSecrets(): Promise<string[]> {
  const rows = await prisma.appCredential.findMany({
    where: { platform: "SHOPEE", isActive: true },
    select: { clientSecret: true },
  });
  const secrets = rows
    .map((r) => r.clientSecret)
    .filter((s): s is string => !!s);
  const env = process.env.SHOPEE_PARTNER_KEY;
  if (env && !secrets.includes(env)) secrets.push(env);
  return secrets;
}
