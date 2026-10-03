import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  issueSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
} from "@/lib/services/auth.service";
import { appOrigin } from "@/lib/utils/request-origin";

type GoogleTokenResponse = { id_token?: string; error?: string };
type GoogleIdClaims = { email?: string; email_verified?: boolean };

// Callback Google OAuth: tukar kode → id_token → cocokkan email user
// TERDAFTAR (invite-only; tanpa auto-create) → terbitkan sesi yang sama
// dgn login password, lalu redirect ke /login?google_handoff=1 agar halaman
// login memindahkan token ke localStorage (token tidak pernah lewat URL).
export async function GET(req: NextRequest) {
  const loginUrl = (param: string) => new URL(`/login?${param}`, appOrigin(req));

  const state = req.cookies.get("google_oauth_state")?.value;
  const { searchParams } = new URL(req.url);
  if (!state || searchParams.get("state") !== state) {
    return NextResponse.redirect(loginUrl("error=google_state"));
  }
  const error = searchParams.get("error");
  if (error || !searchParams.get("code")) {
    return NextResponse.redirect(loginUrl("error=google_denied"));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(loginUrl("error=google_disabled"));
  }

  let tokenJson: GoogleTokenResponse | null = null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: searchParams.get("code")!,
        grant_type: "authorization_code",
        redirect_uri: new URL("/api/auth/google/callback", appOrigin(req)).toString(),
      }),
    });
    tokenJson = (await res.json().catch(() => null)) as GoogleTokenResponse | null;
  } catch (e) {
    console.error("[Google OAuth] Token request failed:", e);
  }
  if (!tokenJson?.id_token) {
    console.error("[Google OAuth] Token exchange gagal:", tokenJson?.error ?? "tanpa id_token");
    return NextResponse.redirect(loginUrl("error=google_token_exchange"));
  }

  // id_token diambil langsung dari endpoint token Google (HTTPS + client_secret)
  // → keaslian sudah terjamin di transport; decode payload tanpa verifikasi
  // signature (bukan token yang diterima dari pihak ketiga).
  let claims: GoogleIdClaims = {};
  try {
    const payload = tokenJson.id_token.split(".")[1];
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GoogleIdClaims;
  } catch {
    return NextResponse.redirect(loginUrl("error=google_token_exchange"));
  }

  const email = claims.email?.trim().toLowerCase();
  if (!email || claims.email_verified === false) {
    return NextResponse.redirect(loginUrl("error=google_unverified"));
  }

  // Gate domain opsional (mis. @maxius.id) — selain itu: undangan by email.
  const allowedDomain = process.env.GOOGLE_ALLOWED_DOMAIN?.trim().toLowerCase().replace(/^@/, "");
  if (allowedDomain && !email.endsWith(`@${allowedDomain}`)) {
    return NextResponse.redirect(loginUrl("error=google_not_invited"));
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.redirect(loginUrl("error=google_not_invited"));
  }

  const token = issueSessionToken(user);
  const res = NextResponse.redirect(loginUrl("google_handoff=1"));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
