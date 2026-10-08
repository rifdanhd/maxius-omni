import { timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

export function validOAuthState(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function clearOAuthCookies(response: NextResponse, platform: "shopee" | "tiktok") {
  for (const name of [`${platform}_oauth_state`, `${platform}_oauth_cred`, "maxius_oauth_brand"]) {
    response.cookies.set(name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  }
  return response;
}
