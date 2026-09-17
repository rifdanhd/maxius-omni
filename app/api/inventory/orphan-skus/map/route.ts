import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import {
  mapOrphanToVariant,
  mapOrphanToNewMaster,
} from "@/lib/services/orphan-sku.service";

/**
 * POST /api/inventory/orphan-skus/map — aksi manual dari panel
 * "SKU Order Belum Ter-mapping" (halaman Mapping).
 *
 * Body:
 *  - mode "existing": { accountId, channelSku, variantId }
 *      → mapping ke varian existing (upsert; kalau mapping sudah ada,
 *        ini efeknya "repoint" + backfill historis).
 *  - mode "new": { accountId, channelSku, newProductName?, sku?, category?, stock?, safetyStock? }
 *      → buat MasterProduct + varian + mapping (+ StockLedger INIT) + backfill.
 *
 * Selalu butuh konfirmasi manusia: endpoint ini HANYA dipanggil dari tombol UI,
 * tidak pernah dipanggil otomatis oleh sync/cron (keputusan owner: sistem cuma
 * mendeteksi & menandai).
 */
export const POST = withAuth(async (req) => {
  const body = (await req.json().catch(() => ({}))) as {
    accountId?: string;
    channelSku?: string;
    mode?: "existing" | "new";
    variantId?: string;
    newProductName?: string;
    sku?: string;
    category?: string;
    stock?: number;
    safetyStock?: number;
    platformTitle?: string;
  };

  const accountId = body.accountId?.trim();
  const channelSku = body.channelSku?.trim();
  if (!accountId || !channelSku) {
    return NextResponse.json({ error: "accountId & channelSku wajib diisi." }, { status: 400 });
  }

  const account = await prisma.platformAccount.findUnique({
    where: { id: accountId },
    select: { id: true, businessId: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Toko tidak ditemukan." }, { status: 400 });
  }
  try {
    assertSameBrand(account.businessId, req.businessId);
  } catch {
    return NextResponse.json({ error: "Toko tidak ditemukan." }, { status: 400 });
  }

  try {
    if (body.mode === "new") {
      const result = await mapOrphanToNewMaster({
        businessId: req.businessId,
        accountId,
        channelSku,
        newProductName: body.newProductName,
        sku: body.sku,
        category: body.category,
        stock: body.stock,
        safetyStock: body.safetyStock,
        platformTitle: body.platformTitle,
      });
      return NextResponse.json({ ok: true, mode: "new", ...result });
    }

    const variantId = body.variantId?.trim();
    if (!variantId) {
      return NextResponse.json({ error: "variantId wajib untuk mode existing." }, { status: 400 });
    }
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, masterProduct: { select: { businessId: true } } },
    });
    if (!variant) {
      return NextResponse.json({ error: "Varian target tidak ditemukan." }, { status: 404 });
    }
    try {
      assertSameBrand(variant.masterProduct.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Varian target tidak ditemukan." }, { status: 404 });
    }

    const result = await mapOrphanToVariant({ accountId, channelSku, variantId });
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 409 });
    }
    return NextResponse.json({ mode: "existing", ...result });
  } catch (error) {
    console.error("Error mapping orphan SKU:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal mapping orphan SKU." },
      { status: 500 }
    );
  }
});
