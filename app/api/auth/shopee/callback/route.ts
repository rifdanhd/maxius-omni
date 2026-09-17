import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAccessTokenByCode, getShopInfo } from "@/lib/integrations/shopee";
import {
  getAuthorizeCredential,
  isShopeeAuthorizeEnabled,
  resolveShopeeCreds,
} from "@/lib/services/app-credential.service";
import { SHOPEE_OAUTH_CRED_COOKIE, OAUTH_BRAND_COOKIE } from "../authorize/route";

const PLATFORM = "SHOPEE";

export async function GET(req: NextRequest) {
  if (!isShopeeAuthorizeEnabled()) {
    return NextResponse.redirect(
      new URL("/settings/accounts?error=shopee_authorize_disabled", req.url)
    );
  }
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const shopId = searchParams.get("shop_id") ?? searchParams.get("shop_id_list") ?? undefined;

  if (error || !code) {
    return NextResponse.redirect(
      new URL(
        `/settings/accounts?error=${encodeURIComponent(error ?? "missing_code")}`,
        req.url,
      ),
    );
  }

  // Validasi state anti-CSRF (di-set oleh /api/auth/shopee/authorize).
  const expectedState = req.cookies.get("shopee_oauth_state")?.value;
  const gotState = searchParams.get("state");
  if (expectedState && gotState !== expectedState) {
    return NextResponse.redirect(
      new URL("/settings/accounts?error=invalid_state", req.url),
    );
  }

  // Kredensial yg dipakai saat authorize (cookie) — token exchange wajib
  // memakai partner key yg sama.
  let credential = null;
  try {
    credential = await getAuthorizeCredential(
      PLATFORM,
      req.cookies.get(SHOPEE_OAUTH_CRED_COOKIE)?.value ?? undefined
    );
  } catch (e) {
    console.error("[Shopee OAuth] credential tidak valid:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/settings/accounts?error=shopee_missing_env", req.url));
  }
  const creds = resolveShopeeCreds(credential);

  // Brand utk akun baru (cookie dari authorize; default Maxius).
  // Hanya id Business yg benar-benar ada yg dipakai.
  const cookieBrand = req.cookies.get(OAUTH_BRAND_COOKIE)?.value?.trim();
  let businessId = "business-default";
  if (cookieBrand) {
    const exists = await prisma.business.findUnique({
      where: { id: cookieBrand },
      select: { id: true },
    });
    if (exists) businessId = exists.id;
  }

  let token;
  try {
    token = await getAccessTokenByCode(code, shopId ?? undefined, creds);
  } catch (e) {
    console.error("[Shopee OAuth] Token exchange gagal:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/settings/accounts?error=shopee_token_exchange_failed", req.url));
  }

  const shopIds = token.shopIdList?.length
    ? token.shopIdList.map(String)
    : shopId
      ? [String(shopId)]
      : [];

  try {
    if (shopIds.length > 0) {
      for (const sid of shopIds) {
        // Proteksi: akun dibekukan tidak boleh di-authorize ulang.
        const existing = await prisma.platformAccount.findUnique({
          where: { platform_externalShopId: { platform: PLATFORM, externalShopId: sid } },
          select: { id: true, isFrozen: true, frozenReason: true },
        });
        if (existing?.isFrozen) {
          console.warn(
            `[Shopee OAuth] authorize ditolak utk shop ${sid}: akun dibekukan (${existing.frozenReason ?? "tanpa alasan"}).`
          );
          return NextResponse.redirect(new URL("/settings/accounts?error=account_frozen", req.url));
        }
        let label = `Shopee (${sid})`;
        try {
          const info = await getShopInfo(token.accessToken, sid, creds);
          if (info.shopName) label = info.shopName;
        } catch (e) {
          console.warn(`[Shopee OAuth] get_shop_info gagal utk ${sid}:`, e instanceof Error ? e.message : e);
        }
        await prisma.platformAccount.upsert({
          where: { platform_externalShopId: { platform: PLATFORM, externalShopId: sid } },
          create: {
            platform: PLATFORM,
            label,
            businessId,
            externalShopId: sid,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            tokenExpiresAt: new Date(Date.now() + token.expireIn * 1000),
            ...(credential ? { appCredentialId: credential.id } : {}),
          },
          update: {
            label,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            tokenExpiresAt: new Date(Date.now() + token.expireIn * 1000),
            ...(credential ? { appCredentialId: credential.id } : {}),
          },
        });
      }
    } else {
      await prisma.platformAccount.create({
        data: {
          platform: PLATFORM,
          label: `Pending Shopee - ${new Date().toISOString()}`,
          businessId,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          tokenExpiresAt: new Date(Date.now() + token.expireIn * 1000),
          ...(credential ? { appCredentialId: credential.id } : {}),
        },
      });
    }
  } catch (e) {
    console.error("[Shopee OAuth] Gagal simpan kredensial:", e);
    return NextResponse.redirect(new URL("/settings/accounts?error=save_failed", req.url));
  }

  return NextResponse.redirect(new URL("/settings/accounts?success=true", req.url));
}
