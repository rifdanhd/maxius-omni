import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { getShippingParameter } from "@/lib/integrations/shopee";
import {
  loadShopeeAccount,
  withRefreshedToken,
} from "@/lib/services/marketplace-shopee.service";

/**
 * Opsi "Atur Pengiriman" untuk order Shopee.
 * GET /api/orders/:id/shipping-parameter
 *
 * Meneruskan hasil GET /api/v2/logistics/get_shipping_parameter — mode yang
 * didukung (pickup/dropoff/non_integrated), alamat penjemputan + slot waktu,
 * dan cabang drop-off. Dipakai ShopeeShipModal untuk membangun form.
 */
export const GET = withAuth(
  async (req: AuthenticatedRequest, ctx?: { params: Promise<{ id?: string }> }) => {
    const { id } = (await ctx?.params) ?? {};

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, orderNo: true, status: true, accountId: true, account: { select: { businessId: true, platform: true } } },
    });

    if (!order) {
      return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
    }
    try {
      assertSameBrand(order.account.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
    }
    if (order.account.platform !== "SHOPEE") {
      return NextResponse.json(
        {
          error: "Atur Pengiriman API hanya untuk order Shopee (platform lain punya alur sendiri).",
          code: "unsupported_platform",
        },
        { status: 400 }
      );
    }

    try {
      const account = await loadShopeeAccount(order.accountId);
      if (!account) {
        return NextResponse.json({ error: "Akun Shopee tidak ditemukan." }, { status: 404 });
      }
      const param = await withRefreshedToken(account, (token, shopId, creds) =>
        getShippingParameter(token, shopId, order.orderNo, creds)
      );
      return NextResponse.json({ ok: true, orderNo: order.orderNo, ...param });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg }, { status: 502 });
    }
  }
);
