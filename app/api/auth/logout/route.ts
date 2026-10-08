import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/services/auth.service";
import { withAuth } from "@/lib/utils/api";
import { prisma } from "@/lib/db/prisma";

export const POST = withAuth(async req => {
  await prisma.user.update({ where: { id: req.user.id }, data: { tokenVersion: { increment: 1 } } });
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
});
