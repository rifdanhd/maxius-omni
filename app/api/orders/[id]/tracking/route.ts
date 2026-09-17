import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";

/**
 * GET /api/orders/[id]/tracking — timeline tracking tersimpan untuk modal Lacak.
 *
 * Read-only dari DB (ShipmentTrackingEvent): TIDAK memanggil API TikTok dan
 * TIDAK menulis tabel Shipment. Event diurutkan kronologis (eventTime asc).
 * trackingEvents kosong = order lama / ambiguous / belum di-ingest — client
 * fallback ke timeline simulasi lama.
 */
export const GET = withAuth(
  async (req, ctx?: { params: Promise<{ id?: string }> }) => {
    const { id } = (await ctx?.params) ?? {};
    if (!id) {
      return NextResponse.json({ error: "Order id wajib diisi." }, { status: 400 });
    }

    const orderBrand = await prisma.order.findUnique({
      where: { id },
      select: { account: { select: { businessId: true } } },
    });
    if (!orderBrand) {
      return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
    }
    try {
      assertSameBrand(orderBrand.account.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
    }

    const events = await prisma.shipmentTrackingEvent.findMany({
      where: { shipment: { orderId: id } },
      orderBy: { eventTime: "asc" },
      select: {
        actionCode: true,
        description: true,
        eventTime: true,
      },
    });

    return NextResponse.json({
      ok: true,
      trackingEvents: events.map((e) => ({
        actionCode: e.actionCode,
        description: e.description,
        eventTime: e.eventTime.toISOString(),
      })),
    });
  }
);
