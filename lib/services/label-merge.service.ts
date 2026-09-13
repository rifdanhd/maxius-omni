import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getShippingDocument } from "@/lib/integrations/tiktokShop";

/**
 * Penggabungan label pengiriman TikTok untuk cetak batch.
 *
 * TikTok Shop Partner API TIDAK punya endpoint batch utk shipping documents
 * (GetPackageShippingDocument hanya menerima 1 package_id di path; yang ada
 * batch hanyalah /packages/batch_ship utk mengirim paket). Karena itu label tiap
 * order diambil SATU PER SATU (paralel utk kecepatan) lalu digabung jadi 1 PDF
 * di sini memakai pdf-lib.
 *
 * Per order: halaman label RESMI TikTok ditanam, lalu satu halaman A6 "Ringkasan
 * Produk" yang DIBUAT SENDIRI dari OrderItem/ProductVariant lokal (tabel: Produk,
 * Varian/SKU, Seller SKU, Qty). Opsional "Picking List" ikut ditambahkan.
 */

const A6_PT = { width: 297.64, height: 419.53 }; // 105 x 148 mm @ 72dpi

const DARK = rgb(0.15, 0.15, 0.15);
const LIGHT = rgb(0.85, 0.85, 0.85);
const GRAY = rgb(0.5, 0.5, 0.5);
const NAVY = rgb(0.13, 0.13, 0.32);
const WHITE = rgb(1, 1, 1);
const PURPLE = rgb(0.46, 0.3, 0.9);

export type LabelMergeProductRow = {
  productName: string;
  variant: string;
  sellerSku: string;
  qty: number;
};

export type LabelMergeItem = {
  orderNo: string;
  packageId: string;
  accessToken: string;
  shopCipher?: string | null;
  rows?: LabelMergeProductRow[];
  includePickingList?: boolean;
};

export type LabelMergeResult = {
  pdf: Uint8Array | null;
  count: number;
  failed: Array<{ orderNo: string; reason: string }>;
};

function isPdf(bytes: Uint8Array): boolean {
  // Magic number "%PDF" di awal berkas.
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

/** Gabungkan semua halaman beberapa PDF jadi satu dokumen. */
async function mergePdfs(merged: PDFDocument, srcBytes: Uint8Array): Promise<void> {
  const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const pages = await merged.copyPages(src, src.getPageIndices());
  pages.forEach((p) => merged.addPage(p));
}

/** Label PNG/JPEG → halaman PDF berukuran A6 dengan gambar dimuat ukuran penuh. */
async function embedLabelImage(
  merged: PDFDocument,
  bytes: Uint8Array
): Promise<void> {
  const image = isPng(bytes)
    ? await merged.embedPng(bytes)
    : await merged.embedJpg(bytes);
  const page = merged.addPage([A6_PT.width, A6_PT.height]);
  // Fit dalam area A6 tanpa distorsi (gambar label A6 = rasio ~0.71).
  const scale = Math.min(A6_PT.width / image.width, A6_PT.height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, {
    x: (A6_PT.width - w) / 2,
    y: (A6_PT.height - h) / 2,
    width: w,
    height: h,
  });
}

const MAX_ROWS_PER_PAGE = 18;

function clip(text: string, max = 28): string {
  const t = String(text ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || "-";
}

function addTableHeader(page: import("pdf-lib").PDFPage, bold: import("pdf-lib").PDFFont, y: number) {
  const margin = 14;
  const cols = [
    { label: "Produk", w: 118 },
    { label: "Varian / SKU", w: 72 },
    { label: "Seller SKU", w: 55 },
    { label: "Qty", w: 24 },
  ];
  const tableW = cols.reduce((a, c) => a + c.w, 0);
  page.drawRectangle({ x: margin - 2, y: y - 3, width: tableW + 4, height: 13, color: NAVY });
  let x = margin;
  for (const c of cols) {
    page.drawText(c.label, { x, y, size: 6.5, font: bold, color: WHITE });
    x += c.w;
  }
  return { cols, tableW };
}

/** Ringkasan produk per order — halaman A6 tabel buatan lokal (bukan label TikTok). */
export function addProductSummaryPage(
  merged: PDFDocument,
  orderNo: string,
  rows: LabelMergeProductRow[],
  kind: "PRODUK" | "PICKING LIST"
): void {
  const page = merged.addPage([A6_PT.width, A6_PT.height]);
  const font = merged.embedStandardFont(StandardFonts.Helvetica);
  const bold = merged.embedStandardFont(StandardFonts.HelveticaBold);

  const title = kind === "PRODUK" ? "Ringkasan Produk" : "Picking List";
  const badge = "MAXIUS · " + (kind === "PRODUK" ? "LABEL" : "GUDANG");

  page.drawText(badge, { x: 14, y: A6_PT.height - 22, size: 7, font: bold, color: PURPLE });
  page.drawText(title, { x: 14, y: A6_PT.height - 36, size: 13, font: bold });
  page.drawText(`No. Pesanan: ${clip(orderNo, 40)}`, { x: 14, y: A6_PT.height - 50, size: 8, font });

  const headerY = A6_PT.height - 68;
  const { cols, tableW } = addTableHeader(page, bold, headerY);

  const margin = 14;
  const y = headerY - 18;
  const rowH = 11;
  let rowIndex = 0;
  for (const r of rows.slice(0, MAX_ROWS_PER_PAGE)) {
    const cy = y - rowIndex * rowH;
    if (cy < 24) break;
    page.drawLine({ start: { x: margin, y: cy - 3 }, end: { x: margin + tableW, y: cy - 3 }, thickness: 0.4, color: LIGHT });
    let x = margin;
    const vals = [clip(r.productName, 30), clip(r.variant, 18), clip(r.sellerSku, 14), String(r.qty)];
    for (let i = 0; i < cols.length; i++) {
      page.drawText(vals[i], {
        x,
        y: cy,
        size: 6.8,
        font,
        color: DARK,
        maxWidth: cols[i].w - 4,
      });
      x += cols[i].w;
    }
    rowIndex += 1;
  }

  // Baris ringkasan di bawah tabel.
  const totalQty = rows.reduce((a, r) => a + Number(r.qty || 0), 0);
  page.drawLine({ start: { x: margin, y: 34 }, end: { x: margin + tableW, y: 34 }, thickness: 0.8, color: DARK });
  page.drawText("Total Item", { x: margin, y: 24, size: 7.5, font: bold });
  page.drawText(String(rows.length), { x: margin + 60, y: 24, size: 7.5, font: bold });
  page.drawText("Total Qty", { x: margin + 110, y: 24, size: 7.5, font: bold });
  page.drawText(String(totalQty), { x: margin + 160, y: 24, size: 7.5, font: bold });
  page.drawText(`Dicetak ${formatDate()}`, { x: margin, y: 12, size: 6, font, color: GRAY });
}

function formatDate(): string {
  return new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

async function fetchDocumentBytes(docUrl: string): Promise<Uint8Array> {
  const res = await fetch(docUrl, { headers: { "User-Agent": "maxius-platform/1.0.0" } });
  if (!res.ok) throw new Error(`unduh label gagal (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * mergeShippingDocuments — ambil label resmi untuk N paket (paralel), unduh
 * isi PDF/PNG tiap docUrl, lalu gabung jadi satu PDF multi-halaman.
 *
 * Gagal pada satu order (belum di-ship / 404 / unduh error) TIDAK menggagalkan
 * yang lain: order itu dicatat di `failed` agar UI bisa memberi tahu user,
 * label yang berhasil tetap digabung.
 */
export async function mergeShippingDocuments(
  items: LabelMergeItem[]
): Promise<LabelMergeResult> {
  const merged = await PDFDocument.create();
  let count = 0;
  const failed: LabelMergeResult["failed"] = [];

  const results = await Promise.allSettled(
    items.map(async (item) => {
      // Dipaksa PDF (document_format=PDF) supaya label konsisten utk digabung;
      // docUrl tetap bisa PNG bila TikTok mengabaikannya → ditangani di bawah.
      const { docUrl } = await getShippingDocument(
        item.accessToken,
        item.shopCipher ?? undefined,
        item.packageId,
        "SHIPPING_LABEL",
        "PDF"
      );
      if (!docUrl) throw new Error("label resmi belum tersedia");
      const bytes = await fetchDocumentBytes(docUrl);
      return { orderNo: item.orderNo, bytes };
    })
  );

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const item = items[i];
    if (r.status === "rejected") {
      failed.push({
        orderNo: item.orderNo,
        reason:
          r.reason instanceof Error
            ? r.reason.message
            : String(r.reason ?? "gagal ambil label"),
      });
      continue;
    }
    try {
      const { bytes } = r.value;
      if (isPdf(bytes)) {
        await mergePdfs(merged, bytes);
      } else if (isPng(bytes) || isJpeg(bytes)) {
        await embedLabelImage(merged, bytes);
      } else {
        throw new Error("format dokumen tidak didukung");
      }
      // Bagian bawah: tabel ringkasan produk dari OrderItem/ProductVariant lokal.
      if (item.rows && item.rows.length > 0) {
        addProductSummaryPage(merged, item.orderNo, item.rows, "PRODUK");
      }
      // Opsional: halaman Picking List untuk gudang.
      if (item.includePickingList) {
        addProductSummaryPage(merged, item.orderNo, item.rows ?? [], "PICKING LIST");
      }
      count += 1;
    } catch (e) {
      failed.push({
        orderNo: r.value.orderNo,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (count === 0) return { pdf: null, count: 0, failed };
  return { pdf: await merged.save(), count, failed };
}