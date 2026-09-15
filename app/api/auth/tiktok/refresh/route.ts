import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { refreshAccessToken } from "@/lib/integrations/tiktokShop";

export const POST = withAuth(async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { accountId?: string };
  if (!body.accountId) {
    return NextResponse.json({ error: "accountId wajib diisi." }, { status: 400 });
  }
  const account = await prisma.platformAccount.findUnique({ where: { id: body.accountId } });
  if (!account || account.platform !== "TIKTOK_SHOP") {
    return NextResponse.json({ error: "Akun TikTok Shop tidak ditemukan." }, { status: 404 });
  }
  if (!account.refreshToken) {
    return NextResponse.json(
      { error: "Akun belum punya refresh token — hubungkan ulang via OAuth." },
      { status: 400 }
    );
  }
  try {
    const r = await refreshAccessToken(account.refreshToken);
    await prisma.platformAccount.update({
      where: { id: account.id },
      data: {
        accessToken: r.accessToken,
        refreshToken: r.refreshToken,
        tokenExpiresAt: r.expiresAt,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[TikTok OAuth] refresh gagal:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});
