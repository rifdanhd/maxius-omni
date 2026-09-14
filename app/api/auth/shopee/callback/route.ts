import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAccessTokenByCode, getShopInfo } from "@/lib/integrations/shopee";

const PLATFORM = "SHOPEE";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const shopId = searchParams.get("shop_id") ?? searchParams.get("shop_id_list") ?? undefined;

  if (!code) {
    return NextResponse.redirect(new URL("/settings/accounts?error=missing_code", req.url));
  }

  let token;
  try {
    token = await getAccessTokenByCode(code, shopId ?? undefined);
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
        let label = `Shopee (${sid})`;
        try {
          const info = await getShopInfo(token.accessToken, sid);
          if (info.shopName) label = info.shopName;
        } catch (e) {
          console.warn(`[Shopee OAuth] get_shop_info gagal utk ${sid}:`, e instanceof Error ? e.message : e);
        }
        await prisma.platformAccount.upsert({
          where: { platform_externalShopId: { platform: PLATFORM, externalShopId: sid } },
          create: {
            platform: PLATFORM,
            label,
            externalShopId: sid,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            tokenExpiresAt: new Date(Date.now() + token.expireIn * 1000),
          },
          update: {
            label,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            tokenExpiresAt: new Date(Date.now() + token.expireIn * 1000),
          },
        });
      }
    } else {
      await prisma.platformAccount.create({
        data: {
          platform: PLATFORM,
          label: `Pending Shopee - ${new Date().toISOString()}`,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          tokenExpiresAt: new Date(Date.now() + token.expireIn * 1000),
        },
      });
    }
  } catch (e) {
    console.error("[Shopee OAuth] Gagal simpan kredensial:", e);
    return NextResponse.redirect(new URL("/settings/accounts?error=save_failed", req.url));
  }

  return NextResponse.redirect(new URL("/settings/accounts?success=true", req.url));
}
