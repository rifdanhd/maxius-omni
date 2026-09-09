import JsBarcode from "jsbarcode";
import type { OrderCardItem, PrintType } from "./OrderCard";

export type PrintableOrder = {
  id: string;
  orderNo: string;
  storeName: string;
  platform: string;
  buyerName: string;
  buyerPhone: string;
  address: string;
  totalPrice: string;
  paymentMethod: string;
  orderDate: string;
  courier?: string;
  trackingNumber?: string;
  sellerNote?: string | null;
  pickupLocation?: string | null;
  items: (OrderCardItem & { category?: string })[];
};

const PRINT_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; background: #fff; }
  .sheet { padding: 24px; page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  .order-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .store { font-size: 18px; font-weight: 800; }
  .meta { font-size: 12px; color: #444; margin-top: 2px; }
  .title { font-size: 20px; font-weight: 800; margin-bottom: 4px; }
  .label-row { margin-bottom: 10px; }
  .label-key { font-size: 11px; font-weight: 700; color: #666; text-transform: uppercase; }
  .label-val { font-size: 14px; font-weight: 600; }
  .address { font-size: 14px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
  th { text-align: left; border-bottom: 2px solid #111; padding: 6px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  td { border-bottom: 1px solid #ddd; padding: 8px; }
  .num { text-align: right; }
  .totals { margin-top: 12px; font-size: 14px; }
  .totals .grand { display: flex; justify-content: space-between; font-weight: 800; border-top: 2px solid #111; padding-top: 8px; }
  .barcode { margin-top: 24px; font-size: 32px; font-family: monospace; letter-spacing: .15em; }
  .footer { margin-top: 32px; font-size: 11px; color: #666; }
`;

// Label pengiriman gaya resi TikTok: kertas 100mm x 150mm (4x6"/10x15cm).
const LABEL_STYLE = `
  @page { size: 100mm 150mm; margin: 0; }
  .sheet { padding: 6mm 7mm; }
  .label-sheet { font-size: 10px; }
  .l-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5mm; }
  .l-brand { display: flex; align-items: center; gap: 2mm; font-size: 15px; font-weight: 800; }
  .l-brand .tmark { width: 7mm; height: 7mm; border-radius: 50%; background: #111; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 900; }
  .l-title { font-size: 10px; font-weight: 800; border: 1.2px solid #111; border-radius: 3mm; padding: 1.5mm 3.5mm; letter-spacing: .04em; }
  .l-barcode svg { width: 100%; height: auto; display: block; }
  .l-resi-no { text-align: center; font-size: 12px; font-weight: 800; font-family: ui-monospace, monospace; letter-spacing: .06em; margin-top: 1mm; }
  .l-sep { border-top: 1.5px dashed #999; margin: 4mm 0; }
  .l-k { font-size: 8.5px; font-weight: 800; color: #666; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 1mm; }
  .l-v { font-size: 12px; font-weight: 700; line-height: 1.45; }
  .l-addr { font-size: 10.5px; font-weight: 600; line-height: 1.5; color: #222; }
  .l-items li { list-style: none; font-size: 10.5px; line-height: 1.5; }
  .l-items .qty { font-weight: 800; }
  .l-foot { display: flex; justify-content: space-between; gap: 3mm; margin-top: 5mm; border-top: 1.5px solid #111; padding-top: 3mm; }
  .l-foot .box { flex: 1; }
  .l-pickup { margin-top: 3mm; font-size: 9px; color: #444; }
`;

function renderBarcode(value: string): string {
  if (typeof document === "undefined") return "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    JsBarcode(svg, value, {
      format: "CODE128",
      width: 1.6,
      height: 46,
      margin: 0,
      displayValue: false,
    });
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return "";
  }
}

function buildLabel(o: PrintableOrder) {
  // Barcode & "No. Resi" wajib mengikuti nomor resi/tracking resmi, bukan ID
  // order. Order ID panjang alfanumerik tidak bisa di-scan kurir, dan beda
  // dengan label TikTok (barcode = resi). Fallback ke orderNo hanya saat
  // order belum punya resi (belum di-ship).
  const barcodeValue = (o.trackingNumber && o.trackingNumber !== "-" ? o.trackingNumber : o.orderNo) || o.orderNo;
  const items = o.items
    .map(
      (i) =>
        `<li><span class="qty">${i.qty}x</span> ${escapeHtml(i.name)} ${
          i.category
            ? `— ${escapeHtml(i.category)}`
            : i.variant
            ? `— ${escapeHtml(i.variant)}`
            : ""
        }</li>`
    )
    .join("");
  const courier = o.courier && o.courier !== "-" ? escapeHtml(o.courier) : "-";
  const tracking = o.trackingNumber && o.trackingNumber !== "-" ? escapeHtml(o.trackingNumber) : "-";
  const note = o.sellerNote ? `<div class="l-pickup">Catatan: ${escapeHtml(o.sellerNote)}</div>` : "";

const TIKTOK_LABEL_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block;vertical-align:middle;margin-right:2px;"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`;

  return `
    <div class="sheet label-sheet">
      <div class="l-head">
        <div class="l-brand">${TIKTOK_LABEL_ICON} TikTok Shop</div>
        <div class="l-title">Label Pengiriman</div>
      </div>
      <div class="l-barcode">${renderBarcode(barcodeValue)}</div>
      <div class="l-resi-no">${escapeHtml(barcodeValue)}</div>
      <div class="l-sep"></div>
      <div>
        <div class="l-k">Penerima</div>
        <div class="l-v">${escapeHtml(o.buyerName)}</div>
        <div class="l-v">${escapeHtml(o.buyerPhone)}</div>
        <div class="l-addr">${escapeHtml(o.address)}</div>
        ${note}
      </div>
      <div class="l-sep"></div>
      <div>
        <div class="l-k">Isi Paket</div>
        <ul class="l-items">${items || "<li>-</li>"}</ul>
      </div>
      <div class="l-foot">
        <div class="box"><div class="l-k">Toko</div><div class="l-v">${escapeHtml(o.storeName)}</div></div>
        <div class="box"><div class="l-k">Kurir</div><div class="l-v">${courier}</div></div>
        <div class="box"><div class="l-k">No. Resi</div><div class="l-v">${tracking}</div></div>
      </div>
    </div>`;
}

function buildInvoice(o: PrintableOrder) {
  const rows = o.items
    .map(
      (i) => `<tr><td>${escapeHtml(i.name)}<br/><span style="color:#666;font-size:11px">${escapeHtml(i.variant)}</span></td><td class="num">${i.qty}</td><td class="num">${i.price}</td><td class="num">${(i.qty * (Number(i.price.replace(/[^0-9]/g, "")) || 0)).toLocaleString("id-ID")}</td></tr>`
    )
    .join("");
  return `
    <div class="sheet">
      <div class="order-header">
        <div>
          <div class="store">${escapeHtml(o.storeName)}</div>
          <div class="meta">Invoice ${escapeHtml(o.platform)}</div>
        </div>
        <div>
          <div class="title">Kuitansi / Invoice</div>
          <div class="meta">No. Pesanan: ${escapeHtml(o.orderNo)}</div>
        </div>
      </div>
      <div class="label-row">
        <div class="label-key">Pembeli</div>
        <div class="label-val">${escapeHtml(o.buyerName)} (${escapeHtml(o.buyerPhone)})</div>
      </div>
      <table>
        <thead><tr><th>Produk</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">
        <div class="grand"><span>Total (${escapeHtml(o.paymentMethod)})</span><span>${escapeHtml(o.totalPrice)}</span></div>
      </div>
      <div class="footer">Dicetak ${new Date().toLocaleString("id-ID")}</div>
    </div>`;
}

function buildPackingList(o: PrintableOrder) {
  const rows = o.items
    .map(
      (i) => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.variant)}</td><td class="num">${i.qty}</td></tr>`
    )
    .join("");
  return `
    <div class="sheet">
      <div class="order-header">
        <div>
          <div class="store">${escapeHtml(o.storeName)}</div>
          <div class="meta">Packing List</div>
        </div>
        <div>
          <div class="title">Packing List</div>
          <div class="meta">No. Pesanan: ${escapeHtml(o.orderNo)}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>Produk</th><th>Varian</th><th class="num">Qty</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals">
        <div class="grand"><span>Total Item</span><span>${o.items.reduce((acc, i) => acc + i.qty, 0)}</span></div>
      </div>
      <div class="barcode">${escapeHtml(o.orderNo)}</div>
      <div class="footer">Dicetak ${new Date().toLocaleString("id-ID")}</div>
    </div>`;
}

function escapeHtml(text: string) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function openPrintWindow(title: string, bodyHtml: string, extraStyle = "") {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Izin pop-up diblokir. Izinkan pop-up untuk mencetak, lalu ulangi.");
    return;
  }
  win.document.write(
    `<html><head><title>${title}</title><style>${PRINT_STYLES}${extraStyle}</style></head><body>${bodyHtml}</body></html>`
  );
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
  }, 300);
}

export function printOrders(orders: PrintableOrder[], type: PrintType) {
  const builders: Record<PrintType, { build: (o: PrintableOrder) => string; style?: string }> = {
    Label: { build: buildLabel, style: LABEL_STYLE },
    Invoice: { build: buildInvoice },
    PackingList: { build: buildPackingList },
  };
  const { build, style = "" } = builders[type];
  const body = orders.map((o) => build(o)).join("");
  openPrintWindow(`Cetak ${type}`, body, style);
}

/**
 * printShippingDocument — cetak label RESMI TikTok (hasil endpoint
 * GetPackageShippingDocument). docUrl bisa PDF atau PNG; dirender di jendela
 * cetak sendiri agar browser memakai dialog print untuk ukuran label.
 */
export function printShippingDocument(docUrl: string, title = "Label Pengiriman TikTok") {
  const isPdf = /\.pdf($|\?)/i.test(docUrl) || !/\.(png|jpe?g|webp)($|\?)/i.test(docUrl);
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Izin pop-up diblokir. Izinkan pop-up untuk mencetak, lalu ulangi.");
    return;
  }
  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #eee; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; padding: 16px; font-family: ui-sans-serif, system-ui, sans-serif; }
          .frame { background: #fff; box-shadow: 0 4px 24px rgba(0,0,0,.15); }
          img { display: block; max-height: 100vh; }
          iframe { border: 0; width: 100vw; height: 100vh; }
        </style>
      </head>
      <body>
        ${isPdf ? `<iframe src="${escapeHtml(docUrl)}"></iframe>` : `<div class="frame"><img src="${escapeHtml(docUrl)}" /></div>`}
      </body>
    </html>`);
  win.document.close();
  win.focus();
}

/**
 * pdfBlobFromBase64 — ubah PDF base64 (hasil endpoint bulk-label) jadi Blob.
 */
export function pdfBlobFromBase64(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

/**
 * printPdfWindow — tampilkan PDF (URL lokal blob/remote) utk dicetak. PDF multi
 * halaman dirender dalam iframe; win.print() mencetak seluruh halaman sekaligus.
 */
export function printPdfWindow(url: string, title: string) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Izin pop-up diblokir. Izinkan pop-up untuk mencetak, lalu ulangi.");
    return;
  }
  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #eee; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; padding: 16px; font-family: ui-sans-serif, system-ui, sans-serif; }
          iframe { border: 0; width: 100vw; height: 100vh; }
        </style>
      </head>
      <body><iframe id="pdf" src="${escapeHtml(url)}"></iframe></body>
    </html>`);
  win.document.close();
  win.focus();
  // Tunggu PDF termuat (reader bawaan browser) sebelum memicu dialog print.
  const frame = win.document.getElementById("pdf") as HTMLIFrameElement | null;
  let printed = false;
  const trigger = () => {
    if (printed) return;
    printed = true;
    try {
      win.print();
    } catch {
      /* abaikan */
    }
  };
  frame?.addEventListener("load", trigger);
  setTimeout(trigger, 800);
}