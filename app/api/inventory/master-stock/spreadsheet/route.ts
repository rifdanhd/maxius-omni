import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { InventoryConflict } from "@/lib/services/master-stock-mutation.service";
import { exportMasterStock, previewMasterStockImport } from "@/lib/services/master-stock-spreadsheet.service";
import { readLimitedStream } from "@/lib/security/validate-upload";

export const GET = withAuth(async (req) => {
  try {
    const bytes = await exportMasterStock(req.businessId, new URL(req.url).searchParams);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="stok-sku-master.xlsx"',
    } });
  } catch (error) {
    if (error instanceof InventoryConflict) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});

export const POST = withAuth(async (req) => {
  const body = await readLimitedStream(req.body, 6 * 1024 * 1024);
  const form = await new Request(req.url, { method: "POST", headers: { "Content-Type": req.headers.get("Content-Type") ?? "" }, body: Uint8Array.from(body) }).formData();
  const file = form.get("file");
  const warehouseId = form.get("warehouseId");
  if (!(file instanceof File) || typeof warehouseId !== "string" || !warehouseId || !file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ error: "Pilih gudang dan file Excel .xlsx." }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Ukuran file maksimal 5 MB." }, { status: 400 });
  try {
    const rows = await previewMasterStockImport(req.businessId, warehouseId, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ rows });
  } catch (error) {
    if (error instanceof InventoryConflict) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});
