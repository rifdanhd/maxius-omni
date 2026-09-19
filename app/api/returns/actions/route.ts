import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

/**
 * POST /api/returns/actions — aksi approve/reject/confirm retur ke platform.
 *
 * SENGAJA diblokir oleh RETURN_ACTIONS_ENABLED (default false) sampai scope
 * app terkonfirmasi (TikTok seller.return_refund.basic / module Returns
 * Shopee) — pola SHOPEE_AUTHORIZE_ENABLED. Struktur fungsi service & audit
 * log sudah siap; begitu flag=true, handler memanggil action service.
 */
export const POST = withAuth(async (req) => {
  if (process.env.RETURN_ACTIONS_ENABLED !== "true") {
    return NextResponse.json(
      {
        error:
          "Aksi retur ke platform belum diaktifkan (RETURN_ACTIONS_ENABLED=false). Approve/reject dilakukan manual di Seller Center masing-masing.",
      },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    returnId?: string;
    action?: "APPROVE" | "REJECT" | "CONFIRM";
    reason?: string;
  };
  if (!body.returnId || !body.action) {
    return NextResponse.json({ error: "returnId & action wajib diisi." }, { status: 400 });
  }

  const ret = await prisma.returnRequest.findUnique({
    where: { id: body.returnId },
    select: { id: true, accountId: true, externalReturnId: true, account: { select: { platform: true, businessId: true, isFrozen: true } } },
  });
  if (!ret || ret.account.businessId !== req.businessId) {
    return NextResponse.json({ error: "Retur tidak ditemukan." }, { status: 404 });
  }
  if (ret.account.isFrozen) {
    return NextResponse.json({ error: "Akun platform dibekukan." }, { status: 400 });
  }

  // TODO(scope): panggil action service per platform di sini begitu scope
  // dikonfirmasi — TikTok Approve/Reject Return 202309, Shopee returns.confirm.
  // Struktur ReturnAuditLog (PENDING → SUCCESS/PLATFORM_ERROR) sudah siap.
  return NextResponse.json(
    { error: `Aksi ${body.action} belum tersedia untuk platform ${ret.account.platform}.` },
    { status: 501 }
  );
});
