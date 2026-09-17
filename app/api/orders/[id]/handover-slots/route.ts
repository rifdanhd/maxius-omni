import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { getPackageHandoverTimeSlots } from "@/lib/integrations/tiktokShop";

/**
 * Opsi penjemputan paket utk modal "Atur Pengiriman".
 * GET /api/orders/:id/handover-slots
 *
 * Meneruskan hasil GET /fulfillment/202309/packages/{package_id}/handover_time_slots:
 * mode handover yang didukung (pickup/drop off/van collection) + slot waktu
 * penjemputan. Kalau TikTok belum punya paket / akun tanpa token → 400 supaya
 * UI bisa fallback ke mode Drop Off / fleksibel.
 */
export const GET = withAuth(
  async (req: AuthenticatedRequest, ctx?: { params: Promise<{ id?: string }> }) => {
    const { id } = (await ctx?.params) ?? {};

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        account: { select: { accessToken: true, shopCipher: true, businessId: true } },
        shipments: { select: { externalId: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
    }
    try {
      assertSameBrand(order.account.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
    }
    if (!order.account.accessToken) {
      return NextResponse.json({ error: "Akun belum punya access token." }, { status: 400 });
    }
    const packageId = order.shipments.find((s) => s.externalId)?.externalId ?? null;
    if (!packageId) {
      return NextResponse.json(
        { error: "Belum ada paket pengiriman untuk order ini. Sync order dari marketplace lalu coba lagi." },
        { status: 400 }
      );
    }

    try {
      const info = await getPackageHandoverTimeSlots(
        order.account.accessToken,
        order.account.shopCipher ?? undefined,
        packageId
      );
      return NextResponse.json({ ok: true, packageId, ...info });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg }, { status: 502 });
    }
  }
);