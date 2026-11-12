import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";

export const GET = withAuth(async (_req: AuthenticatedRequest) => {
  const products = await prisma.masterProduct.findMany({
    where: { businessId: _req.businessId }, orderBy: { name: "asc" },
    include: { productVariant: { orderBy: { sku: "asc" } } },
  });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Katalog Pusat");
  sheet.columns = [
    { header: "Nama Produk", key: "name", width:  thirty(28) },
    { header: "SKU", key: "sku", width: 22 }, { header: "Nama Varian", key: "variantName", width: 22 },
    { header: "Kategori", key: "category", width: 18 }, { header: "Harga", key: "price", width: 15 },
    { header: "Stok Pusat", key: "stock", width: 14 }, { header: "Cadangan", key: "safetyStock", width: 14 },
    { header: "Ambang Stok", key: "threshold", width: 14 }, { header: "Status", key: "status", width: 12 },
  ];
  for (const product of products) for (const variant of product.productVariant) sheet.addRow({ name: product.name, sku: variant.sku, variantName: variant.name ?? "", category: product.category ?? "", price: variant.price ?? "", stock: variant.stock, safetyStock: variant.safetyStock, threshold: product.threshold, status: product.isActive ? product.status : "inactive" });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="katalog-pusat.xlsx"', "Cache-Control": "no-store" } });
});

function thirty(value: number): number { return value; }
