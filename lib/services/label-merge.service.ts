import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import { getShippingDocument } from "@/lib/integrations/tiktokShop";
import { NON_TIKTOK_LABEL_REASON } from "@/lib/utils/platform-guard";
import { downloadValidatedPdf } from "@/lib/security/validate-upload";

/** Penggabungan label pengiriman TikTok untuk cetak batch.

 * TikTok Shop Partner API TIDAK punya endpoint batch utk shipping documents
 * (GetPackageShippingDocument hanya menerima 1 package_id di path; yang ada
 * batch hanyalah /packages/batch_ship utk mengirim paket). Karena itu label tiap
 * order diambil SATU PER SATU (paralel utk kecepatan) lalu digabung jadi 1 PDF
 * di sini memakai pdf-lib.

 * Halaman label resmi digabung tanpa menambahkan rincian produk pada resi.
 * Picking List opsional ditambahkan sebagai halaman terpisah.
 */

const A6_PT = { width: 297.64, height: 419.53 }; // 105 x 148 mm @ 72dpi

const DARK = rgb(0.15, 0.15, 0.15);
const LIGHT = rgb(0.85, 0.85, 0.85);
const GRAY = rgb(0.5, 0.5, 0.5);
const NAVY = rgb(0.13, 0.13, 0.32);
const WHITE = rgb(1, 1, 1);
const PURPLE = rgb(0.46, 0.3, 0.9);
const INK = rgb(0, 0, 0);

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
  /** Platform akun order — non-TikTok tidak boleh menyentuh API TikTok. */
  platform?: string;
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

function clip(text: string, max = 48): string {
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
    const vals = [clip(r.productName, 48), clip(r.variant, 36), clip(r.sellerSku, 14), String(r.qty)];
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

function safeText(str: string): string {
  return String(str ?? "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Memecah teks panjang menjadi beberapa baris (word-wrap) untuk PDF. */
function wrapText(text: string, maxCharsPerLine = 32, maxLines = 2): string[] {
  const words = String(text ?? "").trim().replace(/\s+/g, " ").split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) {
      current = w;
    } else if ((current + " " + w).length <= maxCharsPerLine) {
      current += " " + w;
    } else {
      lines.push(current);
      current = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : ["-"];
}

/** Potong teks dengan "…" sesuai lebar sebenarnya. */
function fitText(text: string, font: PDFFont, size: number, maxW: number): string {
  let t = text;
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxW) t = t.slice(0, -1);
  return t + "…";
}

/** Word-wrap berdasarkan lebar sebenarnya. */
function wrapByWidth(text: string, font: PDFFont, size: number, maxW: number, maxLines: number): string[] {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["-"];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  let out = lines;
  if (lines.length > maxLines) {
    out = lines.slice(0, maxLines);
    out[maxLines - 1] += "…";
  }
  return out.map((l) => fitText(l, font, size, maxW));
}

/** Tabel rincian produk di bawah label resmi TikTok, meniru tata letak aslinya. */
export async function stampProductVariantOnLabel(
  pdfBytes: Uint8Array,
  rows: LabelMergeProductRow[],
  orderNo?: string
): Promise<Uint8Array> {
  if (!rows || rows.length === 0) return pdfBytes;

  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  if (pages.length === 0) return pdfBytes;

  const page = pages[0];
  const { width, height } = page.getSize();
  if (height < 300) return pdfBytes;

  const font = await pdfDoc.embedStandardFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedStandardFont(StandardFonts.HelveticaBold);

  const L = 5.8;
  const R = width - 4.4;
  const LABEL_BOTTOM = 130;
  const colX = { prod: L, sku: 145, sellerSku: 190, qtyHead: 275, qtyMid: 281 };
  const LEAD = 8.5;
  const TAIL = 38.5;

  page.drawRectangle({ x: 0, y: 0, width, height: LABEL_BOTTOM, color: WHITE });

  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  page.drawText(`In transit by: ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} 23:59`, {
    x: L, y: 121, size: 7, font, color: INK,
  });

  const headerY = 109;
  page.drawText("Product Name", { x: colX.prod, y: headerY, size: 7, font: bold, color: INK });
  page.drawText("SKU", { x: colX.sku, y: headerY, size: 7, font: bold, color: INK });
  page.drawText("Seller SKU", { x: colX.sellerSku, y: headerY, size: 7, font: bold, color: INK });
  page.drawText("Qty", { x: colX.qtyHead, y: headerY, size: 7, font: bold, color: INK });
  let cursor = 105;
  page.drawLine({ start: { x: L, y: cursor }, end: { x: R, y: cursor }, thickness: 0.6, color: INK });

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const prodLines = wrapByWidth(safeText(r.productName), font, 6.5, colX.sku - colX.prod - 6, 4);
    const varName = safeText(r.variant && r.variant !== "-" ? r.variant : r.sellerSku);
    const skuLines = wrapByWidth(varName, font, 6.5, colX.sellerSku - colX.sku - 4, 2);
    const nLines = Math.max(prodLines.length, skuLines.length);
    const itemH = 9 + (nLines - 1) * LEAD + 4;
    const isLast = i === rows.length - 1;

    if (cursor - itemH - TAIL < 5 + (isLast ? 0 : 9)) {
      page.drawText(`+ ${rows.length - i} item lainnya`, { x: L, y: cursor - 7, size: 6, font: bold, color: INK });
      cursor -= 9;
      break;
    }

    const base = cursor - 9;
    prodLines.forEach((t, li) => page.drawText(t, { x: colX.prod, y: base - li * LEAD, size: 6.5, font, color: INK }));
    skuLines.forEach((t, li) => page.drawText(t, { x: colX.sku, y: base - li * LEAD, size: 6, font, color: INK }));

    const seller = fitText(safeText(r.sellerSku && r.sellerSku !== "-" ? r.sellerSku : "-"), font, 6.5, 262 - colX.sellerSku);
    page.drawText(seller, { x: colX.sellerSku, y: base, size: 6.5, font, color: INK });

    const q = String(r.qty);
    page.drawText(q, { x: colX.qtyMid - font.widthOfTextAtSize(q, 7) / 2, y: base, size: 7, font, color: INK });

    cursor -= itemH;
    if (!isLast) {
      page.drawLine({ start: { x: L, y: cursor }, end: { x: R, y: cursor }, thickness: 0.3, color: LIGHT });
    }
  }

  page.drawLine({ start: { x: L, y: cursor }, end: { x: R, y: cursor }, thickness: 0.6, color: INK });
  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const totalNum = ` ${totalQty}`;
  const numW = font.widthOfTextAtSize(totalNum, 7);
  const labW = bold.widthOfTextAtSize("Qty Total:", 7);
  page.drawText("Qty Total:", { x: R - numW - labW, y: cursor - 9, size: 7, font: bold, color: INK });
  page.drawText(totalNum, { x: R - numW, y: cursor - 9, size: 7, font, color: INK });

  const line2 = cursor - 13;
  page.drawLine({ start: { x: L, y: line2 }, end: { x: R, y: line2 }, thickness: 0.6, color: INK });

  const logoY = line2 - 19.3;
  page.drawText("tokopedia", { x: L, y: logoY, size: 13, font: bold, color: INK });
  page.drawLine({ start: { x: 87, y: line2 - 1 }, end: { x: 87, y: line2 - 20.5 }, thickness: 0.5, color: GRAY });

  page.drawRectangle({ x: 102, y: logoY - 1, width: 11, height: 9.5, color: INK });
  page.drawSvgPath("M 0 0 V -2 C 0 -6.5 6.5 -6.5 6.5 -2 V 0", {
    x: 104.2, y: logoY + 12.5, borderWidth: 0.9, borderColor: INK,
  });
  page.drawCircle({ x: 107.5, y: logoY + 3.7, size: 1.9, color: WHITE });

  page.drawText("Shop", { x: 119, y: logoY, size: 13, font: bold, color: INK });

  const oid = `Order ID: ${orderNo ? safeText(orderNo) : "-"}`;
  page.drawText(oid, { x: R - font.widthOfTextAtSize(oid, 5.8), y: logoY + 9.5, size: 5.8, font, color: INK });

  const bottomY = line2 - 25.5;
  page.drawLine({ start: { x: L, y: bottomY }, end: { x: R, y: bottomY }, thickness: 0.6, color: INK });

  return await pdfDoc.save();
}

async function fetchDocumentBytes(docUrl: string): Promise<Uint8Array> {
  return new Uint8Array(await downloadValidatedPdf(docUrl));
}

/** Ambil label resmi untuk N paket (paralel), unduh isi PDF/PNG tiap docUrl, lalu gabung jadi satu PDF multi-halaman.

 * Gagal pada satu order (belum di-ship / 404 / unduh error) TIDAK menggagalkan
 * yang lain: order itu dicatat di `failed` agar UI bisa memberi tahu user,
 * label yang berhasil tetap digabung.
 *
 * PENTING: Jika Shopee mengembalikan format bukan PDF (misal PNG), maka error
 * dilempar agar label tidak "lopak" tanpa branding resmi. User perlu memastikan
 * paket sudah di-ship sebelum mencetak.
 */
export async function mergeShippingDocuments(
  items: LabelMergeItem[]
): Promise<LabelMergeResult> {
  const merged = await PDFDocument.create();
  let count = 0;
  const failed: LabelMergeResult["failed"] = [];

  // Guard platform: item non-TikTok TIDAK PERNAH memanggil getShippingDocument
  // (TikTok API) — dicatat ke `failed` agar UI bisa melaporkan.
  const allowed = items.filter((item) => {
    if (item.platform && item.platform !== "TIKTOK_SHOP") {
      failed.push({ orderNo: item.orderNo, reason: NON_TIKTOK_LABEL_REASON });
      return false;
    }
    return true;
  });

  const results = await Promise.allSettled(
    allowed.map(async (item) => {
      // Dipaksa PDF (document_format=PDF) supaya label konsisten utk digabung;
      // catatan: Shopee kadang mengembalikan image (PNG) daripada PDF,
      // jadi kita cek bytes setelah download, bukan hanya rely pada parameter.
      const { docUrl } = await getShippingDocument(
        item.accessToken,
        item.shopCipher ?? undefined,
        item.packageId,
        "SHIPPING_LABEL",
        "PDF"
      );
      if (!docUrl) throw new Error("label resmi belum tersedia");

      const bytes = await fetchDocumentBytes(docUrl);

      // VALIDASI: pastikan bytes memang berformat PDF.
      // Jika bukan PDF, lempar error agar UI bisa menampilkan pesan yang jelas
      // dan tidak menghasilkan PDF "lopak" tanpa branding resmi Shopee.
      if (!isPdf(bytes)) {
        throw new Error(
          "Shopee mengembalikan format bukan PDF. Pastikan paket sudah di-ship dan coba lagi. " +
            "Error: non-PDF document received."
        );
      }

      return { orderNo: item.orderNo, bytes };
    })
  );

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const item = allowed[i];
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
      let { bytes } = r.value;
      // Stamp rincian produk & varian langsung ke label resmi (sama dengan cetak 1)
      if (isPdf(bytes) && item.rows && item.rows.length > 0) {
        try {
          bytes = await stampProductVariantOnLabel(bytes, item.rows, item.orderNo);
        } catch (stampErr) {
          console.warn(`[LabelMerge] Gagal stamp rincian produk untuk ${item.orderNo}:`, stampErr);
        }
      }
      if (isPdf(bytes)) {
        await mergePdfs(merged, bytes);
      } else if (isPng(bytes) || isJpeg(bytes)) {
        // Jika somehow masih gagal validasi di atas, embed gambar tapi tandai
        await embedLabelImage(merged, bytes);
      } else {
        throw new Error("format dokumen tidak didukung");
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