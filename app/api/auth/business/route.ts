import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/utils/api";
import { prisma } from "@/lib/db/prisma";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/services/auth.service";
export const POST = withAuth(async req => {
  const { businessId } = z.object({ businessId: z.string().min(1).max(200) }).parse(await req.json());
  const membership = await prisma.userBusiness.findUnique({ where: { userId_businessId: { userId: req.user.id, businessId } } });
  if (!membership) return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
  const res = NextResponse.json({ businessId });
  res.cookies.set(SESSION_COOKIE, createSessionToken(user, businessId), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE_S });
  return res;
});
