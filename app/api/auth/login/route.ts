import { NextRequest, NextResponse } from "next/server";
import { login, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/services/auth.service";
import { isSameOriginRequest } from "@/lib/security/session";
import { z } from "zod";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Origin tidak valid." }, { status: 403 });
  try {
    const body = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(128) }).parse(await req.json());
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username dan password wajib diisi." },
        { status: 400 }
      );
    }

    const result = await login(username, password);
    const res = NextResponse.json({ user: result.user });
    // Cookie sesi httpOnly — dipakai proteksi OAuth authorize/callback yang
    // dijangkau lewat navigasi browser (tidak bisa bawa header Bearer).
    res.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_S,
    });
    return res;
  } catch (err) {
    console.error("[Login] failed", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Username atau password salah." }, { status: 401 });
  }
}
