import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/services/auth.service";

export async function POST() {
  // Auth utama berbasis JWT stateless di localStorage (client-side); token
  // dihapus oleh tombol logout di Sidebar. Cookie sesi httpOnly (utk proteksi
  // OAuth) ikut dihapus di sini.
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
