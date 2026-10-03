import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { appOrigin } from "@/lib/utils/request-origin";

// Mulai alur Google OAuth (invite-only): redirect ke halaman login Google
// dengan state acak → diverifikasi di callback. Tanpa GOOGLE_CLIENT_ID/SECRET
// tombol Google tidak berfungsi (redirect ?error=google_disabled).
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/login?error=google_disabled", appOrigin(req)));
  }

  const redirectUri = new URL("/api/auth/google/callback", appOrigin(req)).toString();
  const state = crypto.randomBytes(16).toString("hex");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
