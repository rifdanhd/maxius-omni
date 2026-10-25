import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/utils/api";
import { stockQuantity } from "@/lib/security/input";
import { getMasterStock } from "@/lib/services/master-stock.service";
import { changeMasterStock, inheritStockAllocation, InventoryConflict, retryMasterStock, setStockAllocation } from "@/lib/services/master-stock-mutation.service";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { dispatchInventoryAfterResponse } from "@/lib/services/inventory-dispatch.service";

const id = z.string().trim().min(1).max(200);
const change = z.object({ variantId: id, expectedVersion: stockQuantity, warehouseId: id,
  kind: z.enum(["IN", "OUT", "COUNT", "CORRECTION"]), quantity: stockQuantity, safetyStock: stockQuantity.optional(),
  reason: z.string().trim().min(1).max(120), note: z.string().trim().max(1000).optional(), requestId: id.min(8) }).strict()
  .refine((input) => !["IN", "OUT"].includes(input.kind) || input.quantity > 0, "Jumlah harus lebih dari nol.");
const request = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change"), changes: z.array(change).min(1).max(200) }).strict(),
  z.object({ action: z.literal("retry"), variantIds: z.array(id).min(1).max(200), listingId: id.optional() }).strict(),
  z.object({ action: z.literal("allocation"), listingId: id.optional(), accountId: id.optional(), mode: z.enum(["FULL", "PERCENT", "FIXED", "EQUAL"]),
    value: stockQuantity, buffer: stockQuantity }).strict(),
  z.object({ action: z.literal("archive"), variantId: id, archived: z.boolean() }).strict(),
  z.object({ action: z.literal("allocation-inherit"), listingId: id }).strict(),
  z.object({ action: z.literal("warehouse"), name: z.string().trim().min(1).max(100) }).strict(),
]);

export const GET = withAuth(async (req) => NextResponse.json(await getMasterStock(req.businessId, new URL(req.url).searchParams)));

export const POST = withAuth(async (req) => {
  const input = request.parse(await req.json());
  try {
    if (input.action === "change") {
      const results = await changeMasterStock(req.businessId, req.user.id, input.changes);
      dispatchInventoryAfterResponse(req.businessId);
      return NextResponse.json({ success: true, results });
    }
    if (input.action === "retry") {
      const listings = await retryMasterStock(req.businessId, input.variantIds, input.listingId);
      dispatchInventoryAfterResponse(req.businessId);
      return NextResponse.json({ success: true, listings });
    }
    if (input.action === "allocation") {
      if (Boolean(input.listingId) === Boolean(input.accountId) || (input.mode === "PERCENT" && input.value > 100)) {
        return NextResponse.json({ error: "Pilih satu listing atau default toko; persentase maksimal 100%." }, { status: 400 });
      }
      const listings = await setStockAllocation(req.businessId, input);
      dispatchInventoryAfterResponse(req.businessId);
      return NextResponse.json({ success: true, listings });
    }
    if (input.action === "allocation-inherit") {
      await inheritStockAllocation(req.businessId, input.listingId);
      dispatchInventoryAfterResponse(req.businessId);
      return NextResponse.json({ success: true });
    }
    if (input.action === "archive") {
      const changed = await prisma.productVariant.updateMany({ where: { id: input.variantId, masterProduct: { businessId: req.businessId } }, data: { isArchived: input.archived } });
      return changed.count ? NextResponse.json({ success: true }) : NextResponse.json({ error: "SKU tidak ditemukan." }, { status: 404 });
    }
    const warehouse = await prisma.inventoryWarehouse.create({ data: { businessId: req.businessId, name: input.name } });
    return NextResponse.json({ success: true, warehouse: { id: warehouse.id, name: warehouse.name } });
  } catch (error) {
    if (error instanceof InventoryConflict) return NextResponse.json({ error: error.message }, { status: error.status });
    if (input.action === "warehouse" && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Nama gudang sudah dipakai. Pilih nama lain." }, { status: 409 });
    throw error;
  }
});
