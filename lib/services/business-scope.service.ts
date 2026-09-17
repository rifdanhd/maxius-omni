import { prisma } from "@/lib/db/prisma";

export const DEFAULT_BUSINESS_ID = "business-default";

export class BusinessScopeError extends Error {
  status = 403;
}

// Brand yg boleh diakses user (fase 1: many-to-many tanpa role).
export async function getUserBusinessIds(userId: string): Promise<string[]> {
  const rows = await prisma.userBusiness.findMany({
    where: { userId },
    select: { businessId: true },
    orderBy: { businessId: "asc" },
  });
  return rows.map((r) => r.businessId);
}

// Brand aktif utk request: ?businessId= bila milik user, else default.
// Melempar BusinessScopeError (→ 403) bila meminta brand yg bukan haknya.
export async function resolveRequestBusiness(
  req: Request,
  userId: string
): Promise<string> {
  const ids = await getUserBusinessIds(userId);
  if (ids.length === 0) {
    throw new BusinessScopeError("User tidak punya akses ke brand mana pun.");
  }
  const url = new URL(req.url);
  const requested =
    url.searchParams.get("businessId") ?? url.searchParams.get("business_id");
  if (requested) {
    if (!ids.includes(requested)) {
      throw new BusinessScopeError("Tidak punya akses ke brand tersebut.");
    }
    return requested;
  }
  if (ids.includes(DEFAULT_BUSINESS_ID)) return DEFAULT_BUSINESS_ID;
  return ids[0];
}

// Fragmen where Prisma per domain — satu-satunya pola scoping yg dipakai
// semua route/service (hindari varian bebas yg bisa bocor antar brand).
export const businessWhere = {
  product: (businessId: string) => ({ businessId }),
  variant: (businessId: string) => ({ masterProduct: { businessId } }),
  account: (businessId: string) => ({ businessId }),
  mapping: (businessId: string) => ({ account: { businessId } }),
  order: (businessId: string) => ({ account: { businessId } }),
  orderItem: (businessId: string) => ({ order: { account: { businessId } } }),
  salesLog: (businessId: string) => ({ account: { businessId } }),
  ledger: (businessId: string) => ({
    variant: { masterProduct: { businessId } },
  }),
  syncJob: (businessId: string) => ({ account: { businessId } }),
  syncLog: (businessId: string) => ({ account: { businessId } }),
  promotion: (businessId: string) => ({ account: { businessId } }),
  shipment: (businessId: string) => ({ account: { businessId } }),
  orderMapping: (businessId: string) => ({ account: { businessId } }),
  image: (businessId: string) => ({ masterProduct: { businessId } }),
  opname: (businessId: string) => ({
    items: { some: { variant: { masterProduct: { businessId } } } },
  }),
};

// Verifikasi objek milik brand aktif (detail/edit by id) — 404 bila bukan,
// agar tidak bocor via tebak ID. Pakai di route setelah fetch.
export function assertSameBrand(
  objectBusinessId: string | null | undefined,
  businessId: string
): void {
  if (!objectBusinessId || objectBusinessId !== businessId) {
    const e = new Error("Data tidak ditemukan.") as Error & { status?: number };
    e.status = 404;
    throw e;
  }
}

// Verifikasi akun + daftar mapping milik brand aktif (utk write sensitif
// seperti promo/edit). Melempar Error("...tidak ditemukan.") bila tidak cocok.
export async function assertAccountMappingsInBrand(
  accountId: string,
  mappingIds: string[],
  businessId: string
): Promise<void> {
  const notFound = () => {
    const e = new Error("Toko / mapping tidak ditemukan di brand ini.") as Error & {
      status?: number;
    };
    e.status = 404;
    throw e;
  };
  const account = await prisma.platformAccount.findUnique({
    where: { id: accountId },
    select: { businessId: true },
  });
  if (!account || account.businessId !== businessId) notFound();
  if (mappingIds.length === 0) return;
  const count = await prisma.productMapping.count({
    where: {
      id: { in: mappingIds },
      accountId,
      account: { businessId },
    },
  });
  if (count !== new Set(mappingIds).size) notFound();
}
