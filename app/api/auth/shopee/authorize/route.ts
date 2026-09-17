import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { buildAuthorizeUrl } from "@/lib/integrations/shopee";
import {
  getAuthorizeCredential,
  isShopeeAuthorizeEnabled,
  resolveShopeeCreds,
} from "@/lib/services/app-credential.service";

export const SHOPEE_OAUTH_CRED_COOKIE = "shopee_oauth_cred";
export const OAUTH_BRAND_COOKIE = "maxius_oauth_brand";

export async function GET(req: NextRequest) {
  // Feature flag: authorize Shopee diblokir total sampai ISV approved
  // (SHOPEE_AUTHORIZE_ENABLED=true di env server).
  if (!isShopeeAuthorizeEnabled()) {
    return NextResponse.redirect(
      new URL("/settings/accounts?error=shopee_authorize_disabled", req.url)
    );
  }
  try {
    const { searchParams } = new URL(req.url);
    const credential = await getAuthorizeCredential(
      "SHOPEE",
      searchParams.get("credentialId") ?? undefined
    );
    const creds = resolveShopeeCreds(credential);
    // Anti-CSRF: state acak disimpan di cookie httpOnly, diverifikasi di callback.
    const state = crypto.randomBytes(16).toString("hex");
    const res = NextResponse.redirect(buildAuthorizeUrl(state, creds));
    res.cookies.set("shopee_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 1800,
    });
    // Bawa credential yg dipakai authorize ke callback (token exchange
    // WAJIB memakai partner key yg sama).
    if (credential) {
      res.cookies.set(SHOPEE_OAUTH_CRED_COOKIE, credential.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 1800,
      });
    }
    // Bawa brand aktif ke callback (akun baru dibuat di brand ini).
    const businessId = searchParams.get("businessId")?.trim();
    if (businessId) {
      res.cookies.set(OAUTH_BRAND_COOKIE, businessId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 1800,
      });
    }
    return res;
  } catch (e) {
    console.error("[Shopee OAuth] authorize gagal:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/settings/accounts?error=shopee_missing_env", req.url));
  }
}
