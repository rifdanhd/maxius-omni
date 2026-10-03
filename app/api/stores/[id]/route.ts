import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";

export const DELETE = withAuth(async (req, ctx) => {
  try {
    const { id } = (await ctx?.params) as { id: string };

    const existing = await prisma.platformAccount.findUnique({
      where: { id },
      select: { id: true, businessId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Store tidak ditemukan." }, { status: 404 });
    }
    try {
      assertSameBrand(existing.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Store tidak ditemukan." }, { status: 404 });
    }

    // Hapus semua data terkait dalam satu transaksi.
    // Urutan penting: hapus tabel anak dulu sebelum tabel induk,
    // karena beberapa relasi menggunakan ON DELETE RESTRICT.
    await prisma.$transaction(async (tx) => {
      // 1. SyncLog (RESTRICT on accountId)
      await tx.syncLog.deleteMany({ where: { accountId: id } });

      // 2. SalesLog (RESTRICT on accountId)
      await tx.salesLog.deleteMany({ where: { accountId: id } });

      // 3. PromotionAuditLog (RESTRICT on accountId)
      await tx.promotionAuditLog.deleteMany({ where: { accountId: id } });

      // 4. ReturnAuditLog (RESTRICT on accountId)
      await tx.returnAuditLog.deleteMany({ where: { accountId: id } });

      // 5. Shipment (RESTRICT on accountId) — ShipmentTrackingEvent akan CASCADE
      await tx.shipment.deleteMany({ where: { accountId: id } });

      // 6. PlatformOrderMapping (RESTRICT on accountId)
      await tx.platformOrderMapping.deleteMany({ where: { accountId: id } });

      // 7. ReturnRequest (CASCADE on accountId, tapi Order masih jadi parent-nya)
      //    Hapus dulu agar constraint Order tidak terhalang.
      await tx.returnRequest.deleteMany({ where: { accountId: id } });

      // 8. Order (RESTRICT on accountId) — OrderItem akan CASCADE
      await tx.order.deleteMany({ where: { accountId: id } });

      // 9. Hapus PlatformAccount (relasi lain sudah CASCADE: ProductMapping,
      //    SyncJob, PromotionActivity, ReturnRequest, StockLedger nulled)
      await tx.platformAccount.delete({ where: { id } });
    });

    return NextResponse.json({ success: true, message: "Store deleted successfully" });
  } catch (error) {
    console.error("Error deleting store:", error);
    return NextResponse.json({ error: "Failed to delete store" }, { status: 500 });
  }
});
