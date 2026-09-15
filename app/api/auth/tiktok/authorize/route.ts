import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

// Format resmi seller OAuth (ROW/ID): service_id — lihat
// partner.tiktokshop.com > Seller authorization guide.
// Format lama app_key+redirect_uri sudah tidak terdokumentasi untuk seller.
const TIKTOK_AUTHORIZE_URL = "https://services.tiktokshop.com/open/authorize";

export async function GET(req: NextRequest) {
  const serviceId = process.env.TIKTOK_SERVICE_ID;
  const appKey = process.env.TIKTOK_APP_KEY;
  const redirectUri =
    process.env.TIKTOK_REDIRECT_URI ?? process.env.TIKTOK_REDIRECT_URL;

  if (!redirectUri || (!serviceId && !appKey)) {
    return NextResponse.redirect(
      new URL("/settings/accounts?error=missing_env", req.url),
    );
  }

  const url = new URL(TIKTOK_AUTHORIZE_URL);
  if (serviceId) {
    url.searchParams.set("service_id", serviceId);
  } else {
    // Fallback legacy (tidak terdokumentasi) — isi TIKTOK_SERVICE_ID dari
    // Partner Center > App & Service > Basic Information > Service ID.
    url.searchParams.set("app_key", appKey!);
    url.searchParams.set("redirect_uri", redirectUri);
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
  return res;
}
