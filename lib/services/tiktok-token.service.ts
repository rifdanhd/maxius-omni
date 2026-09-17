import { prisma } from "@/lib/db/prisma";
import { TikTokApiError, refreshAccessToken, type TiktokCreds } from "@/lib/integrations/tiktokShop";
import {
  assertAccountActive,
  resolveTiktokCreds,
} from "@/lib/services/app-credential.service";

type TiktokAccount = {
  id: string;
  label: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
};

// Cerminan withRefreshedToken Shopee: refresh proaktif bila token kedaluwarsa,
// + 1x retry setelah refresh bila kena AUTH error (105001–105004).
// SCOPE error (105005) TIDAK di-refresh — butuh re-authorize seller.
// Akun dibekukan DITOLAK di sini (proteksi level kode, bukan sekadar UI).
export async function withRefreshedTiktokToken<T>(
  account: TiktokAccount,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const fresh = await prisma.platformAccount.findUnique({
    where: { id: account.id },
    include: { appCredential: true },
  });
  if (!fresh || fresh.platform !== "TIKTOK_SHOP") {
    throw new Error(`Akun TikTok "${account.label}" tidak ditemukan.`);
  }
  assertAccountActive(fresh);
  const creds: TiktokCreds = resolveTiktokCreds(fresh.appCredential);
  if (!account.accessToken) {
    throw new Error(
      `"${account.label}" belum punya access token — hubungkan ulang via OAuth TikTok.`,
    );
  }
  let token = account.accessToken;
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now()) {
    if (!account.refreshToken) {
      throw new Error(
        `"${account.label}" token kedaluwarsa tanpa refresh token — hubungkan ulang via OAuth TikTok.`,
      );
    }
    token = await doRefresh(account.id, account.refreshToken, creds);
  }
  try {
    return await fn(token);
  } catch (e) {
    const isAuth =
      e instanceof TikTokApiError
        ? e.kind === "AUTH"
        : /auth|token|expired|invalid/i.test(e instanceof Error ? e.message : String(e));
    if (!isAuth || !account.refreshToken) throw e;
    token = await doRefresh(account.id, account.refreshToken, creds);
    return fn(token);
  }
}

async function doRefresh(accountId: string, refreshToken: string, creds: TiktokCreds): Promise<string> {
  const r = await refreshAccessToken(refreshToken, creds);
  await prisma.platformAccount.update({
    where: { id: accountId },
    data: {
      accessToken: r.accessToken,
      refreshToken: r.refreshToken,
      tokenExpiresAt: r.expiresAt,
    },
  });
  return r.accessToken;
}
