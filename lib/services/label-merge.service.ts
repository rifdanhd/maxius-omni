import { PDFDocument } from "pdf-lib";
import { getShippingDocument } from "@/lib/integrations/tiktokShop";

/**
 * Penggabungan label pengiriman TikTok untuk cetak batch.
 *
 * TikTok Shop Partner API TIDAK punya endpoint batch utk shipping documents
 * (GetPackageShippingDocument hanya menerima 1 package_id di path; yang ada
 * batch hanyalah /packages/batch_ship utk mengirim paket). Karena itu label tiap
 * order diambil SATU PER SATU (paralel utk kecepatan) lalu digabung jadi 1 PDF
 * di sini memakai pdf-lib.
 */

const A6_PT = { width: 297.64, height: 419.53 }; // 105 x 148 mm @ 72dpi

export type LabelMergeItem = {
  orderNo: string;
  packageId: string;
  accessToken: string;
  shopCipher?: string | null;
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