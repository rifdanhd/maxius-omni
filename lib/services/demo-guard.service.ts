import { prisma } from "@/lib/db/prisma";

/**
 * Cache in-memory untuk status isDemo per businessId dan accountId
 * untuk efisiensi throughput sync tanpa membebani query DB berulang.
 */
const demoBusinessCache = new Map<string, { isDemo: boolean; expires: number }>();
const demoAccountCache = new Map<string, { isDemo: boolean; expires: number }>();

const TTL_MS = 30_000;

export async function isBusinessDemo(businessId: string): Promise<boolean> {
  const cached = demoBusinessCache.get(businessId);
  if (cached && cached.expires > Date.now()) return cached.isDemo;

  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: { isDemo: true },
  });
  const isDemo = Boolean(b?.isDemo);
  demoBusinessCache.set(businessId, { isDemo, expires: Date.now() + TTL_MS });
  return isDemo;
}

export async function isAccountDemo(accountId: string): Promise<boolean> {
  const cached = demoAccountCache.get(accountId);
  if (cached && cached.expires > Date.now()) return cached.isDemo;

  const acc = await prisma.platformAccount.findUnique({
    where: { id: accountId },
    select: { business: { select: { isDemo: true } } },
  });
  const isDemo = Boolean(acc?.business?.isDemo);
  demoAccountCache.set(accountId, { isDemo, expires: Date.now() + TTL_MS });
  return isDemo;
}

export async function isShopIdentifierDemo(identifier: {
  shopId?: string | number;
  shopCipher?: string;
  accessToken?: string;
}): Promise<boolean> {
  if (!identifier.shopId && !identifier.shopCipher && !identifier.accessToken) return false;

  const orConditions = [];
  if (identifier.shopId) {
    orConditions.push({ externalShopId: String(identifier.shopId) });
  }
  if (identifier.shopCipher) {
    orConditions.push({ shopCipher: String(identifier.shopCipher) });
  }
  if (identifier.accessToken) {
    orConditions.push({ accessToken: String(identifier.accessToken) });
  }

  const acc = await prisma.platformAccount.findFirst({
    where: { OR: orConditions },
    select: { business: { select: { isDemo: true } } },
  });
  return Boolean(acc?.business?.isDemo);
}

export function clearDemoCache() {
  demoBusinessCache.clear;
  demoAccountCache.clear();
}
