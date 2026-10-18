import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/services/auth.service";
import { appOrigin } from "@/lib/utils/request-origin";

const PUBLIC_PATHS = new Set(["/", "/privacy-policy", "/terms"]);

export function proxy(req: NextRequest) {
  if (PUBLIC_PATHS.has(req.nextUrl.pathname) || req.nextUrl.pathname === "/login" || req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (!token) throw new Error("missing session");
    verifyToken(token);
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", appOrigin(req)));
  }
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|Logo|.*\\.(?:png|jpg|jpeg|webp|svg)$).*)"] };
