import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/lib/integrations/shopee";

export async function GET(req: NextRequest) {
  try {
    const state = req.nextUrl.searchParams.get("state") ?? undefined;
    return NextResponse.redirect(buildAuthorizeUrl(state));
  } catch (e) {
    console.error("[Shopee OAuth] authorize gagal:", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/settings/accounts?error=shopee_missing_env", req.url));
  }
}
