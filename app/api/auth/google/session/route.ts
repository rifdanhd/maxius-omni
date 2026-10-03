import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie, SESSION_COOKIE } from "@/lib/services/auth.service";

// Handoff Google login: halaman login memanggil route INI (hanya saat
// ?google_handoff=1) untuk memindahkan token dari cookie httpOnly ke
// localStorage — bentuk respons sama dgn POST /api/auth/login.
export async function GET(req: NextRequest) {
  const payload = verifySessionCookie(req);
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!payload?.sub || !token) {
    return NextResponse.json({ error: "Sesi Google tidak valid — coba lagi." }, { status: 401 });
  }
  return NextResponse.json({
    token,
    user: {
      id: payload.sub,
      username: payload.username,
      canViewFullPii: payload.canViewFullPii !== false,
    },
  });
}
