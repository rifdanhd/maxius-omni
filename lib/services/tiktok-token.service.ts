import { prisma } from "@/lib/db/prisma";
import { TikTokApiError, refreshAccessToken } from "@/lib/integrations/tiktokShop";

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
export async function withRefreshedTiktokToken<T>(
  account: TiktokAccount,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
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
    token = await doRefresh(account.id, account.refreshToken);
  }
  try {
    return await fn(token);
  } catch (e) {
    const isAuth =
      e instanceof TikTokApiError
        ? e.kind === "AUTH"
        : /auth|token|expired|invalid/i.test(e instanceof Error ? e.message : String(e));
    if (!isAuth || !account.refreshToken) throw e;
    token = await doRefresh(account.id, account.refreshToken);
    return fn(token);
  }
}

async function doRefresh(accountId: string, refreshToken: string): Promise<string> {
  const r = await refreshAccessToken(refreshToken);
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
