import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import {
  processBulkPrice,
  BulkPriceRow,
} from "@/lib/services/pricing.service";

// POST /api/products/pricing/bulk-upload
// Body: { csv: string } — isi file CSV sebagai teks.
//
// Format CSV (baris pertama = header):
//   sku,price,store,channel_sku
//   - sku        (wajib)  SKU induk/varian.
//   - price      (angka)  Harga baru (default bila `store` kosong,
//                         override bila `store` diisi). Kosongkan utk
//                         menghapus override (dengan store + header harga kosong).
//   - store      (opsional) Label toko utk override per marketplace.
//   - channel_sku (opsional) SKU marketplace utk verifikasi mapping.
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = (await req.json().catch(() => ({}))) as { csv?: string };
  if (!body.csv || typeof body.csv !== "string" || !body.csv.trim()) {
    return NextResponse.json(
      { error: "Field csv (teks konten file) wajib diisi." },
      { status: 400 }
    );
  }

  const parsed = parseCsv(body.csv);
  if (parsed.length < 2) {
    return NextResponse.json(
      { error: "CSV tidak memiliki baris data (header + minimal 1 baris)." },
      { status: 400 }
    );
  }

  const header = parsed[0].map((h) => normalizeHeader(h));
  const idx = {
    sku: header.indexOf("sku"),
    price: header.indexOf("price"),
    store: header.indexOf("store"),
    channelSku: header.indexOf("channel_sku"),
  };
  if (idx.sku === -1) {
    return NextResponse.json(
      { error: 'Kolom "sku" tidak ditemukan di header CSV.' },
      { status: 400 }
    );
  }

  const rows: BulkPriceRow[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const cells = parsed[i];
    const get = (k: keyof typeof idx) =>
      idx[k] === -1 || idx[k] >= cells.length ? "" : cells[idx[k]].trim();

    const sku = get("sku");
    if (!sku) continue;

    const priceRaw = get("price").replace(/[Rp\s.]/g, "").replace(",", ".");
    const price = priceRaw === "" ? null : Number(priceRaw);

    rows.push({
      row: i + 1,
      sku,
      price: price !== null && Number.isFinite(price) && price >= 0 ? price : null,
      store: get("store") || null,
      channelSku: get("channelSku") || null,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada baris valid untuk diproses." },
      { status: 400 }
    );
  }

  const result = await processBulkPrice(rows, req.businessId);
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
});

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]/g, "_");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else if (ch !== "\r") {
        field += ch;
      }
    }
  }
  row.push(field);
  rows.push(row);

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}