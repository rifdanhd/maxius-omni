import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { buildAuthorizeUrl } from "@/lib/integrations/shopee";

export async function GET(req: NextRequest) {
  try {
    // Anti-CSRF: state acak disimpan di cookie httpOnly, diverifikasi di callback.
    const state = crypto.randomBytes(16).toString("hex");
    const res = NextResponse.redirect(buildAuthorizeUrl(state));
    res.cookies.set("shopee_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 1800,
    });
    return res;
  } catch (e) {
    console.error("[Shopee OAuth] authorize gagal:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/settings/accounts?error=shopee_missing_env", req.url));
  }
}
