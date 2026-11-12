import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? n : fallback; };

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "File Excel wajib dipilih." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Format file harus .xlsx." }, { status: 400 });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await file.arrayBuffer()) as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) return NextResponse.json({ error: "Sheet Excel tidak ditemukan." }, { status: 400 });
  const headerRow = sheet.getRow(1);
  const headers = new Map<string, number>();
  headerRow.eachCell((cell, col) => headers.set(text(cell.value).toLowerCase().replace(/[\s_-]+/g, ""), col));
  const col = (...names: string[]) => names.map((name) => headers.get(name)).find(Boolean);
  const nameCol = col("namaproduk", "produk", "name"); const skuCol = col("sku", "mastersku");
  if (!nameCol || !skuCol) return NextResponse.json({ error: "Kolom wajib: Nama Produk dan SKU." }, { status: 400 });
  const categoryCol = col("kategori", "category"); const variantCol = col("namavarian", "varian", "variant"); const priceCol = col("harga", "price"); const stockCol = col("stokpusat", "stok", "stock"); const safetyCol = col("cadangan", "safetystock"); const thresholdCol = col("ambangstok", "threshold"); const imageCol = col("urlgambar", "imageurl", "gambar");
  const rows: Array<{ name: string; sku: string; variantName: string | null; category: string | null; price: number | null; stock: number; safetyStock: number; threshold: number | null; imageUrl: string | null }> = [];
  sheet.eachRow((row, rowNumber) => { if (rowNumber === 1) return; const name = text(row.getCell(nameCol).value); const sku = text(row.getCell(skuCol).value); if (name && sku) rows.push({ name, sku, variantName: variantCol ? text(row.getCell(variantCol).value) || null : null, category: categoryCol ? text(row.getCell(categoryCol).value) || null : null, price: priceCol && text(row.getCell(priceCol).value) !== "" ? number(row.getCell(priceCol).value) : null, stock: Math.max(0, Math.trunc(number(stockCol ? row.getCell(stockCol).value : 0))), safetyStock: Math.max(0, Math.trunc(number(safetyCol ? row.getCell(safetyCol).value : 0))), threshold: thresholdCol && text(row.getCell(thresholdCol).value) !== "" ? Math.max(0, Math.trunc(number(row.getCell(thresholdCol).value))) : null, imageUrl: imageCol ? text(row.getCell(imageCol).value) || null : null }); });
  if (!rows.length) return NextResponse.json({ error: "Tidak ada baris produk yang valid." }, { status: 400 });
  if (rows.length > 5000) return NextResponse.json({ error: "Maksimal 5.000 baris per unggahan." }, { status: 400 });
  const settings = await getCachedInventorySettings(req.businessId);
  let createdProducts = 0, createdVariants = 0, updatedVariants = 0, skippedStock = 0;
  await prisma.$transaction(async (tx) => {
    const productIds = new Map<string, string>();
    for (const row of rows) {
      const key = row.name.toLowerCase();
      let productId = productIds.get(key);
      if (!productId) { const existing = await tx.masterProduct.findFirst({ where: { businessId: req.businessId, name: { equals: row.name, mode: "insensitive" } }, select: { id: true } }); productId = existing?.id; if (!productId) { const created = await tx.masterProduct.create({ data: { name: row.name, businessId: req.businessId, category: row.category, imageUrl: row.imageUrl, threshold: row.threshold ?? settings.lowStockDefaultThreshold }, select: { id: true } }); productId = created.id; createdProducts++; } productIds.set(key, productId); }
      const existingVariant = await tx.productVariant.findFirst({ where: { masterProductId: productId, sku: row.sku }, select: { id: true } });
      if (existingVariant) { await tx.productVariant.update({ where: { id: existingVariant.id }, data: { name: row.variantName, ...(row.price !== null ? { price: row.price, priceUpdatedAt: new Date() } : {}), safetyStock: row.safetyStock } }); updatedVariants++; skippedStock++; continue; }
      const variant = await tx.productVariant.create({ data: { masterProductId: productId, sku: row.sku, name: row.variantName, stock: row.stock, safetyStock: row.safetyStock, ...(row.price !== null ? { price: row.price, priceUpdatedAt: new Date() } : {}) } });
      createdVariants++; if (row.stock > 0) await tx.stockLedger.create({ data: { id: crypto.randomUUID(), variantId: variant.id, changeQty: row.stock, stockAfter: row.stock, reason: "INIT", referenceId: `excel-import:${file.name}`, note: "Stok awal unggah katalog pusat" } });
    }
  });
  return NextResponse.json({ ok: true, createdProducts, createdVariants, updatedVariants, skippedStock, message: `Berhasil memproses ${rows.length} baris katalog.` });
});
