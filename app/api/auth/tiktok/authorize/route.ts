import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  getAuthorizeCredential,
  resolveTiktokCreds,
} from "@/lib/services/app-credential.service";
import { verifySessionCookie } from "@/lib/services/auth.service";
import { getUserBusinessIds } from "@/lib/services/business-scope.service";
import { appOrigin } from "@/lib/utils/request-origin";
import { TIKTOK_OAUTH_CRED_COOKIE } from "@/lib/utils/oauth-cookies";

// Region ID (pasca-merger TikTok Shop–Tokopedia) memakai domain seller
// Tokopedia — isi TIKTOK_AUTHORIZE_URL dengan "Copy authorization link"
// dari Partner Center (path-nya memuat id khusus, BUKAN Service ID).
// Default: format resmi service_id (services.tiktokshop.com/open/authorize).
// Fallback lama app_key+redirect_uri sudah tidak terdokumentasi → tidak dipakai.
const TIKTOK_AUTHORIZE_DEFAULT = "https://services.tiktokshop.com/open/authorize";

export async function GET(req: NextRequest) {
  // Sesi login wajib: brand yg diikatkan ke akun baru harus milik user yang
  // login (cookie brand bisa dipalsukan sendiri → wajib divalidasi keanggotaan).
  const session = verifySessionCookie(req);
  if (!session) {
    return NextResponse.redirect(new URL("/login?reason=session_expired", appOrigin(req)));
  }
  const { searchParams } = new URL(req.url);
  let credential = null;
  try {
    credential = await getAuthorizeCredential(
      "TIKTOK_SHOP",
      searchParams.get("credentialId") ?? undefined
    );
  } catch {
    return NextResponse.redirect(
      new URL("/settings/accounts?error=missing_env", appOrigin(req)),
    );
  }
  let creds;
  try {
    creds = resolveTiktokCreds(credential);
  } catch {
    return NextResponse.redirect(
      new URL("/settings/accounts?error=missing_env", appOrigin(req)),
    );
  }
  const authorizeUrl = process.env.TIKTOK_AUTHORIZE_URL?.trim();
  if (!authorizeUrl && !creds.serviceId) {
    console.error(
      "[TikTok OAuth] TIKTOK_AUTHORIZE_URL / TIKTOK_SERVICE_ID kosong — " +
        "isi dari Partner Center (Copy authorization link) di .env lalu restart."
    );
    return NextResponse.redirect(
      new URL("/settings/accounts?error=missing_auth_url", appOrigin(req)),
    );
  }

  let url: URL;
  try {
    url = authorizeUrl
      ? new URL(authorizeUrl)
      : new URL(
          `${TIKTOK_AUTHORIZE_DEFAULT}?service_id=${encodeURIComponent(creds.serviceId ?? "")}`
        );
  } catch {
    console.error("[TikTok OAuth] TIKTOK_AUTHORIZE_URL bukan URL valid.");
    return NextResponse.redirect(
      new URL("/settings/accounts?error=missing_auth_url", appOrigin(req)),
    );
  }

  // Anti-CSRF: state acak disimpan di cookie httpOnly, diverifikasi di callback.
  const state = crypto.randomBytes(16).toString("hex");
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url.toString());
  res.cookies.set("tiktok_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 1800,
  });
  if (credential) {
    res.cookies.set(TIKTOK_OAUTH_CRED_COOKIE, credential.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 1800,
    });
  }
  const businessId = searchParams.get("businessId")?.trim();
  if (businessId) {
    const owned = await getUserBusinessIds(String(session.sub));
    if (!owned.includes(businessId)) {
      return NextResponse.redirect(
        new URL("/settings/accounts?error=brand_forbidden", appOrigin(req)),
      );
    }
    res.cookies.set("maxius_oauth_brand", businessId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 1800,
    });
  }
  return res;
}
