import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getAuthorizedShops } from "@/lib/integrations/tiktokShop";

const TIKTOK_TOKEN_URL = "https://auth.tiktok-shops.com/api/v2/token/get";
const PLATFORM = "TIKTOK_SHOP";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings/accounts?error=missing_code", req.url),
    );
  }

  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;

  if (!appKey || !appSecret) {
    return NextResponse.redirect(
      new URL("/settings/accounts?error=missing_env", req.url),
    );
  }

  const tokenUrl = new URL(TIKTOK_TOKEN_URL);
  tokenUrl.searchParams.set("app_key", appKey);
  tokenUrl.searchParams.set("app_secret", appSecret);
  tokenUrl.searchParams.set("auth_code", code);
  tokenUrl.searchParams.set("grant_type", "authorized_code");

  let tokenRes: Response;
  try {
    tokenRes = await fetch(tokenUrl.toString());
  } catch (e) {
    console.error("[TikTok OAuth] Token request failed:", e);
    return NextResponse.redirect(
      new URL("/settings/accounts?error=token_request_failed", req.url),
    );
  }

  if (!tokenRes.ok) {
    console.error(`[TikTok OAuth] Token endpoint HTTP ${tokenRes.status}`);
    return NextResponse.redirect(
      new URL("/settings/accounts?error=token_exchange_failed", req.url),
    );
  }

  const tokenJson = (await tokenRes.json().catch(() => null)) as {
    code?: number;
    message?: string;
    data?: {
      access_token?: string;
      access_token_expire_in?: number;
      refresh_token?: string;
      open_id?: string;
      seller_name?: string;
      user_type?: number;
      granted_scopes?: string[];
    };
  } | null;

  if (!tokenJson || tokenJson.code !== 0) {
    console.error("[TikTok OAuth] Token exchange failed:", tokenJson?.message);
    return NextResponse.redirect(
      new URL(
        `/settings/accounts?error=${encodeURIComponent(tokenJson?.message ?? "token_exchange_failed")}`,
        req.url,
      ),
    );
  }

  const data = tokenJson.data ?? {};
  if (!data.access_token || !data.refresh_token) {
    return NextResponse.redirect(
      new URL("/settings/accounts?error=token_missing", req.url),
    );
  }

  console.log(
    "[TikTok OAuth] open_id:",
    data.open_id,
    "| seller_name:",
    data.seller_name,
    "| user_type:",
    data.user_type,
    "| granted_scopes:",
    data.granted_scopes
  );
  if (
    data.granted_scopes &&
    !data.granted_scopes.includes("seller.authorization.info")
  ) {
    console.warn(
      "[TikTok OAuth] PERINGATAN: granted_scopes tidak mengandung seller.authorization.info — 105005 akan terus terjadi sampai seller reauthorize / remove-all-access & authorize ulang. Cek lagi kolom scope di PlatformAccount setelah reauthorize."
    );
  }

  const rawExpiresIn = data.access_token_expire_in;
  console.log(
    "[TikTok OAuth] Raw access_token_expire_in (Unix epoch detik, absolute):",
    rawExpiresIn
  );
  let expiresAt: Date;
  if (rawExpiresIn) {
    // Bukan durasi relatif — sudah absolute Unix epoch detik (default validitas 7 hari).
    expiresAt = new Date(rawExpiresIn * 1000);
  } else {
    console.warn(
      "[TikTok OAuth] access_token_expire_in tidak ada — fallback 7 hari (default resmi)."
    );
    expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
  const tokenPayload = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenExpiresAt: expiresAt,
    scope: data.granted_scopes?.join(","),
  };

  // Dapatkan shop id resmi setelah token exchange (open_id dari token sering null).
  let shops: Array<Record<string, string>> = [];
  try {
    shops = await getAuthorizedShops(data.access_token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[TikTok OAuth] GetAuthorizedShops gagal (lanjut ke mode pending): ${msg}`,
    );
    if (msg.includes("105005")) {
      console.warn(
        "[TikTok OAuth] Hint 105005: scope belum digrant. Aktifkan scope 'seller.authorization.info' (dan scope bisnis terkait) di partner.tiktokshop.com > App & Service > Manage API, revoke akses lama, lalu authorize ulang token baru.",
      );
    }
  }
  const shop = shops[0];

  try {
    if (shop?.id) {
      await prisma.platformAccount.upsert({
        where: {
          platform_externalShopId: {
            platform: PLATFORM,
            externalShopId: shop.id,
          },
        },
        create: {
          platform: PLATFORM,
          label: shop.name ?? shop.code ?? `TikTok Shop (${shop.id})`,
          externalShopId: shop.id,
          shopCipher: shop.cipher ?? null,
          appKey,
          ...tokenPayload,
        },
        update: {
          label: shop.name ?? shop.code ?? undefined,
          shopCipher: shop.cipher ?? undefined,
          ...tokenPayload,
        },
      });
    } else {
      // Tanpa shop id: buat baris PENDING baru per percobaan (label ber-timestamp).
      // Token akun berbeda TIDAK boleh saling menimpa — re-authorize selalu baris baru
      // sampai akar masalah endpoint shop-id diperbaiki permanen.
      await prisma.platformAccount.create({
        data: {
          platform: PLATFORM,
          label: `Pending TikTok Shop - ${new Date().toISOString()}`,
          appKey,
          ...tokenPayload,
        },
      });
    }
  } catch (e) {
    console.error("[TikTok OAuth] Failed to save credential:", e);
    return NextResponse.redirect(
      new URL("/settings/accounts?error=save_failed", req.url),
    );
  }

  return NextResponse.redirect(
    new URL("/settings/accounts?success=true", req.url),
  );
}