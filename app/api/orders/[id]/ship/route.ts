import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import {
  shipPackage,
  waitForPackageTracking,
  getShippingDocument,
} from "@/lib/integrations/tiktokShop";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ship Package — kirim paket TikTok Shipping otomatis dari aplikasi.
 * POST /api/orders/:id/ship
 *
 * Alur:
 *  1. Validasi order + ambil package_id dari shipment lokal.
 *  2. Panggil TikTok POST /fulfillment/202309/packages/{id}/ship.
 *  3. TikTok Shipping → poll GetPackageDetail sampai resi & kurir ter-assign
 *     (async di sisi TikTok), lalu update data lokal (Shipment + Order).
 *  4. Setelah resi siap → delay+retry GetPackageShippingDocument supaya label
 *     resmi langsung bisa dicetak. Seller Shipping tidak punya label TikTok.
 *
 * Body opsional (cocok dengan spec TikTok):
 *  { handover_method, pickup_slot: {start_time,end_time} }  → TikTok Shipping
 *  { self_shipment: { shipping_provider_id, tracking_number } } → Seller Shipping
 */
export const POST = withAuth(
  async (req: AuthenticatedRequest, ctx?: { params: Promise<{ id?: string }> }) => {
    const { id } = (await ctx?.params) ?? {};

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        account: { select: { accessToken: true, shopCipher: true, businessId: true } },
        shipments: { select: { id: true, externalId: true } },
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

    const body = (await req.json().catch(() => ({}))) as {
      handover_method?: "PICKUP" | "DROP_OFF";
      pickup_slot?: { start_time?: number; end_time?: number };
      self_shipment?: { shipping_provider_id?: string; tracking_number?: string };
      seller_note?: string | null;
    };

    // Seller Shipping: resi disuplai merchant, label resmi TikTok tidak berlaku.
    const isSellerShipping = Boolean(body.self_shipment);

    try {
      await shipPackage(order.account.accessToken, order.account.shopCipher ?? undefined, packageId, {
        handoverMethod: body.handover_method,
        pickupSlot: body.pickup_slot
          ? {
              startTime: body.pickup_slot.start_time,
              endTime: body.pickup_slot.end_time,
            }
          : undefined,
        selfShipment: body.self_shipment
          ? {
              shippingProviderId: body.self_shipment.shipping_provider_id,
              trackingNumber: body.self_shipment.tracking_number,
            }
          : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg }, { status: 502 });
    }

    let trackingNumber: string | null = body.self_shipment?.tracking_number ?? null;
    let providerName: string | null = null;
    let providerId: string | null = null;

    if (!isSellerShipping) {
      // TikTok Shipping: resi & kurir di-assign async → poll paket.
      const detail = await waitForPackageTracking(
        order.account.accessToken,
        order.account.shopCipher ?? undefined,
        packageId
      );
      trackingNumber = trackingNumber ?? detail.trackingNumber;
      providerId = detail.providerId;
      providerName = detail.providerName;
    } else {
      providerId = body.self_shipment?.shipping_provider_id ?? null;
    }

    // Update data lokal: shipment + status order + catatan penjual.
    await prisma.$transaction([
      prisma.shipment.updateMany({
        where: { accountId: order.accountId, orderId: order.id, externalId: packageId },
        data: {
          trackingNo: trackingNumber,
          carrier: providerName,
          status: isSellerShipping ? "SHIPPED" : "AWAITING_COLLECTION",
          shippedAt: new Date(),
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: {
          status:
            order.status === "AWAITING_SHIPMENT" || order.status === "ON_HOLD"
              ? "AWAITING_COLLECTION"
              : order.status,
          ...(typeof body.seller_note === "string" && body.seller_note.trim()
            ? { sellerNote: body.seller_note.trim() }
            : {}),
        },
      }),
    ]);

    // Delay + retry label resmi (TikTok butuh waktu proses sebelum dokumen siap).
    let docUrl: string | null = null;
    let labelReady = false;
    if (!isSellerShipping) {
      for (let attempt = 0; attempt < 2 && !docUrl; attempt++) {
        if (attempt > 0) await sleep(3000);
        const doc = await getShippingDocument(
          order.account.accessToken,
          order.account.shopCipher ?? undefined,
          packageId
        );
        if (doc.docUrl) {
          docUrl = doc.docUrl;
          trackingNumber = trackingNumber ?? doc.trackingNumber;
        }
      }
      labelReady = Boolean(docUrl);
    }

    return NextResponse.json({
      ok: true,
      shipped: true,
      packageId,
      trackingNumber,
      providerName,
      providerId,
      labelReady,
      docUrl,
    });
  }
);