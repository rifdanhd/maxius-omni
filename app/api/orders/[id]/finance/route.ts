import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getOrderStatementTransactions, TikTokApiError } from "@/lib/integrations/tiktokShop";
import { parseTikTokOrderFinance } from "@/lib/services/order-finance.service";
import { withRefreshedTiktokToken } from "@/lib/services/tiktok-token.service";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import type { OrderFinance } from "@/lib/types/order-finance";

export const GET = withAuth(async (req: AuthenticatedRequest, ctx?: { params: Promise<{ id?: string }> }) => {
  const { id } = await ctx?.params ?? {};
  if (!id) return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  const order = await prisma.order.findFirst({
    where: { id, account: { businessId: req.businessId } },
    include: { account: true, orderMappings: { select: { accountId: true, externalOrderId: true } } },
  });
  if (!order) return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  const unavailable = (message: string) => NextResponse.json({ status: "unavailable", message } satisfies OrderFinance);
  if (order.account.platform !== "TIKTOK_SHOP") {
    return NextResponse.json({ status: "unsupported", message: "Rincian Finance ini tersedia untuk pesanan TikTok Shop." } satisfies OrderFinance);
  }
  if (!order.account.accessToken || !order.account.shopCipher) {
    return unavailable("Koneksi toko belum lengkap. Hubungkan ulang toko melalui Pengaturan Toko.");
  }
  const externalIds = [...new Set(order.orderMappings.filter(mapping => mapping.accountId === order.accountId).map(mapping => mapping.externalOrderId).filter(Boolean))];
  if (externalIds.length !== 1) return unavailable("Identitas pesanan TikTok belum lengkap. Sinkronkan pesanan, lalu coba lagi.");
  try {
    const raw = await withRefreshedTiktokToken(order.account, (token, creds) =>
      getOrderStatementTransactions(token, order.account.shopCipher!, externalIds[0], creds));
    return NextResponse.json(parseTikTokOrderFinance(raw, externalIds[0]));
  } catch (error) {
    if (error instanceof TikTokApiError) {
      console.warn("[order-finance] TikTok rejected request", { orderId: id, code: error.code, requestId: error.requestId });
      if (error.kind === "SCOPE") return unavailable("Akses Finance TikTok ditolak (105005). Pastikan Finance Information aktif dan hubungkan ulang toko agar izin terbaru diterapkan.");
      if (error.kind === "AUTH") return unavailable("Koneksi TikTok perlu diperbarui. Hubungkan ulang toko melalui Pengaturan Toko.");
      return unavailable(`TikTok belum berhasil mengirim rincian Finance (kode ${error.code}). Coba lagi nanti. Referensi: ${error.requestId}.`);
    }
    console.warn("[order-finance] Finance unavailable", { orderId: id, reason: error instanceof Error ? error.name : "unknown" });
    return unavailable("Rincian Finance belum berhasil dimuat atau respons TikTok belum lengkap. Coba perbarui lagi.");
  }
});
