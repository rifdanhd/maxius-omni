import { NextRequest, NextResponse } from "next/server";

const TIKTOK_AUTHORIZE_URL = "https://services.tiktokshop.com/open/authorize";

export async function GET(req: NextRequest) {
  const appKey = process.env.TIKTOK_APP_KEY;
  const redirectUri =
    process.env.TIKTOK_REDIRECT_URI ?? process.env.TIKTOK_REDIRECT_URL;

  if (!appKey || !redirectUri) {
    return NextResponse.redirect(
      new URL("/settings/accounts?error=missing_env", req.url),
    );
  }

  const url = new URL(TIKTOK_AUTHORIZE_URL);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("redirect_uri", redirectUri);

  return NextResponse.redirect(url.toString());
}