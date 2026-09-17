import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { mergeShippingDocuments } from "@/lib/services/label-merge.service";

/**
 * Cetak label gabungan (batch) untuk beberapa order sekaligus.
 *
 * TikTok TIDAK punya endpoint batch utk shipping document, jadi server mengambil
 * label tiap order (paralel) lalu menggabungkannya jadi 1 PDF multi-halaman.
 * Order tanpa label resmi (belum di-ship / tidak punya paket / docUrl kosong)
 * dilewati dan dilaporkan via `failed` — label yang berhasil tetap digabung.
 *
 * Response JSON: { ok, count, failed: [{orderNo, reason}], pdfBase64 }
 * pdfBase64 kosong bila tidak ada satu pun label yang berhasil.
 */
export const POST = withAuth(async (req) => {
  const body = await req.json().catch(() => null);
  const orderIds: unknown = body?.orderIds;

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "Pilih minimal satu pesanan." }, { status: 400 });
  }
  if (orderIds.length > 100) {
    return NextResponse.json({ error: "Maksimal 100 pesanan per cetakan." }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds.map(String) }, account: { businessId: req.businessId } },
    select: {
      id: true,
      orderNo: true,
      account: { select: { accessToken: true, shopCipher: true } },
      shipments: { select: { externalId: true } },
    },
  });

  const items: {
    orderNo: string;
    packageId: string | null;
    accessToken: string | null;
    shopCipher: string | null;
  }[] = [];
  const failed: Array<{ orderNo: string; reason: string }> = [];

  for (const order of orders) {
    const packageId = order.shipments.find((s) => s.externalId)?.externalId ?? null;
    if (!packageId) {
      failed.push({ orderNo: order.orderNo, reason: "belum ada paket pengiriman" });
      continue;
    }
    if (!order.account.accessToken) {
      failed.push({ orderNo: order.orderNo, reason: "akun belum punya access token" });
      continue;
    }
    items.push({
      orderNo: order.orderNo,
      packageId,
      accessToken: order.account.accessToken,
      shopCipher: order.account.shopCipher,
    });
  }

  if (items.length === 0) {
    return NextResponse.json({ ok: true, count: 0, failed, pdfBase64: "" });
  }

  const result = await mergeShippingDocuments(
    items.map((it) => ({
      orderNo: it.orderNo,
      packageId: it.packageId as string,
      accessToken: it.accessToken as string,
      shopCipher: it.shopCipher,
    }))
  );

  return NextResponse.json({
    ok: true,
    count: result.count,
    failed: [...failed, ...result.failed],
    pdfBase64: result.pdf ? Buffer.from(result.pdf).toString("base64") : "",
  });
});