import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { getMasterStock } from "@/lib/services/master-stock.service";
import { InventoryConflict, type MasterStockChange } from "@/lib/services/master-stock-mutation.service";

const HEADERS = ["SKU Master", "Nama Produk", "Stok Gudang", "Disisihkan", "ID SKU Master", "Versi", "ID Gudang", "Gudang"];

export async function exportMasterStock(businessId: string, params: URLSearchParams) {
  const warehouse = await prisma.inventoryWarehouse.findFirst({ where: { businessId, ...(params.get("warehouse") ? { id: params.get("warehouse")! } : { isDefault: true }) } });
  if (!warehouse) throw new InventoryConflict("Gudang tidak ditemukan.", 404);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Stok SKU Master", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(HEADERS);
  sheet.columns = HEADERS.map((header, index) => ({ header, width: index === 1 ? 48 : 25 }));
  sheet.getColumn(1).numFmt = "@";
  const ids = new Set((params.get("ids") ?? "").split(",").filter(Boolean));
  const query = new URLSearchParams(params);
  query.set("limit", "200");
  for (let page = 1; ; page++) {
    query.set("page", String(page));
    const result = await getMasterStock(businessId, query);
    if (result.total > 20_000) throw new InventoryConflict("Gunakan filter agar ekspor tidak melebihi 20.000 SKU.", 400);
    for (const row of result.rows) {
      if (ids.size && !ids.has(row.id)) continue;
      const balance = row.warehouses.find((item) => item.id === warehouse.id);
      sheet.addRow([row.sku, row.name, balance?.stock ?? 0, balance?.safetyStock ?? 0, row.id, row.version, warehouse.id, warehouse.name]);
    }
    if (page * result.pageSize >= result.total) break;
  }
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: "A1", to: "H1" };
  return workbook.xlsx.writeBuffer();
}

function checkArchive(bytes: Buffer) {
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new InventoryConflict("File harus berupa Excel .xlsx yang valid.", 400);
  const entries = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  let expanded = 0;
  if (entries > 1000) throw new InventoryConflict("File Excel terlalu kompleks. Gunakan template ekspor stok.", 400);
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new InventoryConflict("Struktur file Excel tidak valid.", 400);
    expanded += bytes.readUInt32LE(offset + 24);
    if (expanded > 30 * 1024 * 1024) throw new InventoryConflict("Isi file Excel terlalu besar. Bagi menjadi beberapa file.", 400);
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
}

export async function previewMasterStockImport(businessId: string, warehouseId: string, bytes: Buffer) {
  if (bytes.length > 5 * 1024 * 1024) throw new InventoryConflict("Ukuran file maksimal 5 MB.", 400);
  checkArchive(bytes);
  const warehouse = await prisma.inventoryWarehouse.findFirst({ where: { id: warehouseId, businessId } });
  if (!warehouse) throw new InventoryConflict("Gudang tidak ditemukan.", 404);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(Uint8Array.from(bytes).buffer); } catch { throw new InventoryConflict("File Excel tidak dapat dibaca. Gunakan file .xlsx dari ekspor stok.", 400); }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2 || sheet.rowCount > 5001) throw new InventoryConflict("File harus berisi 1–5.000 baris SKU.", 400);
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, column) => headers.set(cell.text.trim().toLowerCase(), column));
  if (!headers.has("sku master") || !headers.has("stok gudang")) throw new InventoryConflict("Kolom SKU Master dan Stok Gudang wajib ada. Gunakan file ekspor sebagai template.", 400);
  const input: Array<{ line: number; sku: string; variantId: string; quantity: number; safetyStock?: number; version?: number }> = [];
  for (let line = 2; line <= sheet.rowCount; line++) {
    const row = sheet.getRow(line);
    const cell = (name: string) => headers.has(name) ? row.getCell(headers.get(name)!) : undefined;
    if (!cell("sku master")?.text.trim() && !cell("stok gudang")?.text.trim()) continue;
    if ([...headers.values()].some((column) => row.getCell(column).type === ExcelJS.ValueType.Formula)) throw new InventoryConflict(`Baris ${line}: gunakan angka akhir, bukan rumus Excel.`, 400);
    const quantity = Number(cell("stok gudang")?.value);
    const safety = cell("disisihkan")?.value;
    const version = cell("versi")?.value;
    if (!cell("stok gudang")?.text.trim() || !Number.isInteger(quantity) || quantity < 0 || quantity > 2147483647) throw new InventoryConflict(`Baris ${line}: stok gudang harus angka bulat minimal nol.`, 400);
    if (safety !== null && safety !== undefined && (!Number.isInteger(Number(safety)) || Number(safety) < 0 || Number(safety) > 2147483647)) throw new InventoryConflict(`Baris ${line}: Disisihkan tidak valid.`, 400);
    if (cell("id gudang")?.text && cell("id gudang")!.text !== warehouseId) throw new InventoryConflict(`Baris ${line}: gudang berbeda dari gudang yang dipilih.`, 400);
    input.push({ line, sku: cell("sku master")?.text.trim() ?? "", variantId: cell("id sku master")?.text.trim() ?? "", quantity,
      ...(safety !== null && safety !== undefined ? { safetyStock: Number(safety) } : {}),
      ...(version !== null && version !== undefined ? { version: Number(version) } : {}) });
  }
  if (!input.length) throw new InventoryConflict("File tidak berisi baris SKU yang dapat diimpor.", 400);
  const variants = await prisma.productVariant.findMany({ where: { masterProduct: { businessId }, OR: [
    { id: { in: input.flatMap((row) => row.variantId ? [row.variantId] : []) } },
    { sku: { in: input.map((row) => row.sku) } }, { skuKeys: { some: { businessId, sellerSku: { in: input.map((row) => row.sku) } } } },
  ] }, include: { masterProduct: { select: { name: true } }, skuKeys: { where: { businessId } },
    productMapping: { where: { account: { businessId } }, select: { accountId: true } },
    warehouseStock: { where: { warehouseId } } } });
  const used = new Set<string>();
  return input.map((row) => {
    const matches = variants.filter((variant) => row.variantId ? variant.id === row.variantId
      : variant.sku === row.sku || variant.skuKeys.some((key) => key.sellerSku === row.sku));
    if (matches.length !== 1) throw new InventoryConflict(`Baris ${row.line}: SKU tidak ditemukan atau ganda. Periksa Mapping Stok.`, 400);
    const variant = matches[0];
    if (row.variantId && variant.sku !== row.sku && !variant.skuKeys.some((key) => key.sellerSku === row.sku)) throw new InventoryConflict(`Baris ${row.line}: SKU dan ID tidak sesuai.`, 400);
    if (used.has(variant.id)) throw new InventoryConflict(`Baris ${row.line}: SKU muncul lebih dari sekali.`, 400);
    used.add(variant.id);
    if (row.version !== undefined && row.version !== variant.version) throw new InventoryConflict(`Baris ${row.line}: stok sudah berubah sejak file diekspor. Ekspor ulang sebelum mengimpor.`, 409);
    return { variantId: variant.id, sku: row.sku, name: variant.masterProduct.name, expectedVersion: variant.version,
      warehouseId, kind: "INITIAL" as const, quantity: row.quantity,
      ...(row.safetyStock !== undefined ? { safetyStock: row.safetyStock } : {}), before: variant.warehouseStock[0]?.stock ?? 0,
      listings: variant.productMapping.length, storeIds: variant.productMapping.map((mapping) => mapping.accountId) };
  });
}

export type StockImportPreview = Awaited<ReturnType<typeof previewMasterStockImport>>;
export type StockImportChange = MasterStockChange;
