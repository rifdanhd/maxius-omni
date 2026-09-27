import { NextRequest, NextResponse } from "next/server";
import { login, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/services/auth.service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username dan password wajib diisi." },
        { status: 400 }
      );
    }

    const result = await login(username, password);
    const res = NextResponse.json(result);
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
    const message = err instanceof Error ? err.message : "Login gagal.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
