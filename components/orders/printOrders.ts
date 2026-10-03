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

// Label pengiriman gaya resi thermal: kertas 100mm x 150mm (4x6"/10x15cm).
const LABEL_STYLE = `
  @page { size: 100mm 150mm; margin: 0; }
  @media print {
    html, body { width: 100mm; margin: 0; padding: 0; background: #fff; }
    .sheet { page-break-after: always; break-after: page; }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .label-sheet {
    width: 100mm;
    box-sizing: border-box;
    padding: 3.5mm 4.5mm;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #111;
    background: #fff;
    font-size: 9.5px;
  }
  .l-box {
    border: 1.5px solid #000;
    border-radius: 3px;
    overflow: hidden;
  }
  .l-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 8px;
    border-bottom: 1.5px solid #000;
    background: #fafafa;
  }
  .l-brand {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 13px;
    font-weight: 800;
  }
  .l-courier {
    text-align: right;
  }
  .l-courier-name {
    font-size: 13px;
    font-weight: 900;
    letter-spacing: .02em;
    display: block;
  }
  .l-badge {
    display: inline-block;
    background: #000;
    color: #fff;
    font-size: 8px;
    font-weight: 800;
    padding: 1px 5px;
    border-radius: 2px;
    letter-spacing: .04em;
  }
  .l-barcode-area {
    padding: 6px 8px 5px;
    text-align: center;
    border-bottom: 1.5px solid #000;
  }
  .l-barcode-area svg {
    width: 96%;
    max-height: 46px;
    display: block;
    margin: 0 auto;
  }
  .l-resi-no {
    text-align: center;
    font-size: 13px;
    font-weight: 900;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    letter-spacing: .08em;
    margin-top: 2px;
  }
  .l-order-meta {
    display: flex;
    justify-content: space-between;
    font-size: 8.5px;
    color: #444;
    margin-top: 3px;
    padding: 0 4px;
  }
  .l-addresses {
    display: flex;
    border-bottom: 1.5px solid #000;
  }
  .l-recipient {
    flex: 1.4;
    padding: 5px 7px;
    border-right: 1.5px solid #000;
  }
  .l-sender {
    flex: 1;
    padding: 5px 7px;
    background: #fbfbfb;
  }
  .l-k {
    font-size: 8px;
    font-weight: 800;
    color: #555;
    text-transform: uppercase;
    letter-spacing: .05em;
    margin-bottom: 2px;
  }
  .l-name {
    font-size: 11px;
    font-weight: 800;
    line-height: 1.25;
  }
  .l-phone {
    font-size: 9.5px;
    font-weight: 700;
    color: #222;
    margin-bottom: 2px;
  }
  .l-addr {
    font-size: 9px;
    font-weight: 500;
    line-height: 1.35;
    color: #222;
    word-break: break-word;
  }
  .l-items-box {
    padding: 5px 7px;
    border-bottom: 1.5px solid #000;
  }
  .l-items-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 8.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: .04em;
    margin-bottom: 3px;
    padding-bottom: 2px;
    border-bottom: 1px dashed #bbb;
  }
  .l-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9px;
  }
  .l-table th {
    text-align: left;
    font-size: 8px;
    text-transform: uppercase;
    color: #555;
    padding: 2px 3px;
    border-bottom: 1px solid #eee;
  }
  .l-table td {
    padding: 3px 3px;
    vertical-align: top;
    border-bottom: 1px dashed #eee;
  }
  .l-table tr:last-child td {
    border-bottom: none;
  }
  .l-prod-name {
    font-weight: 700;
    color: #111;
    line-height: 1.25;
  }
  .l-prod-var {
    font-size: 8.5px;
    font-weight: 700;
    color: #000;
    background: #f0f0f0;
    display: inline-block;
    padding: 1px 4px;
    border-radius: 2px;
    margin-top: 2px;
  }
  .l-qty {
    text-align: center;
    font-weight: 800;
    font-size: 10px;
  }
  .l-note {
    margin-top: 3px;
    padding: 3px 5px;
    background: #fffbeb;
    border: 1px solid #fef3c7;
    border-radius: 2px;
    font-size: 8px;
    line-height: 1.3;
  }
  .l-foot {
    display: flex;
    justify-content: space-between;
    padding: 4px 7px;
    font-size: 8px;
    background: #fafafa;
  }
  .l-foot-item strong {
    font-weight: 800;
  }
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
  // order. Order ID panjang alfanumerik tidak bisa di-scan kurir.
  // Fallback ke orderNo hanya saat order belum punya resi (belum di-ship).
  const barcodeValue = (o.trackingNumber && o.trackingNumber !== "-" ? o.trackingNumber : o.orderNo) || o.orderNo;
  const courier = o.courier && o.courier !== "-" ? escapeHtml(o.courier) : "J&T Express";
  const note = o.sellerNote ? `<div class="l-note"><strong>Catatan:</strong> ${escapeHtml(o.sellerNote)}</div>` : "";

  let totalQty = 0;
  const rows = o.items
    .map((i, idx) => {
      totalQty += i.qty;
      const variantText =
        i.variant && i.variant !== "-"
          ? escapeHtml(i.variant)
          : i.category && i.category !== "-"
          ? escapeHtml(i.category)
          : "";
      return `
        <tr>
          <td style="width: 18px; color: #666; font-size: 8px; text-align: center;">${idx + 1}</td>
          <td>
            <div class="l-prod-name">${escapeHtml(i.name)}</div>
            ${variantText ? `<div class="l-prod-var">Varian: ${variantText}</div>` : ""}
          </td>
          <td class="l-qty">${i.qty}</td>
        </tr>`;
    })
    .join("");

  const TIKTOK_LABEL_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block;vertical-align:middle;margin-right:2px;"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`;

  const isTikTok = o.platform === "TikTok Shop" || o.platform === "TIKTOK_SHOP";
  const brand = isTikTok
    ? `${TIKTOK_LABEL_ICON} TikTok Shop`
    : `<span style="font-weight:900;text-transform:uppercase;">${escapeHtml(o.platform || "-")}</span>`;

  return `
    <div class="sheet label-sheet">
      <div class="l-box">
        <div class="l-head">
          <div class="l-brand">${brand}</div>
          <div class="l-courier">
            <span class="l-courier-name">${courier}</span>
            <span class="l-badge">CASHLESS</span>
          </div>
        </div>

        <div class="l-barcode-area">
          <div class="l-barcode">${renderBarcode(barcodeValue)}</div>
          <div class="l-resi-no">${escapeHtml(barcodeValue)}</div>
          <div class="l-order-meta">
            <span>No. Pesanan: <strong>${escapeHtml(o.orderNo)}</strong></span>
            <span>${escapeHtml(o.orderDate || "")}</span>
          </div>
        </div>

        <div class="l-addresses">
          <div class="l-recipient">
            <div class="l-k">Penerima:</div>
            <div class="l-name">${escapeHtml(o.buyerName)}</div>
            <div class="l-phone">${escapeHtml(o.buyerPhone || "-")}</div>
            <div class="l-addr">${escapeHtml(o.address || "-")}</div>
          </div>
          <div class="l-sender">
            <div class="l-k">Pengirim:</div>
            <div class="l-name">${escapeHtml(o.storeName)}</div>
            ${o.pickupLocation ? `<div class="l-addr" style="margin-top:2px;">${escapeHtml(o.pickupLocation)}</div>` : ""}
          </div>
        </div>

        <div class="l-items-box">
          <div class="l-items-title">
            <span>Daftar Barang & Varian</span>
            <span>Total: ${totalQty} Pcs</span>
          </div>
          <table class="l-table">
            <thead>
              <tr>
                <th style="width: 18px; text-align: center;">No</th>
                <th>Nama Produk & Varian</th>
                <th style="width: 32px; text-align: center;">Qty</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="3" style="text-align:center;color:#666;">-</td></tr>`}
            </tbody>
          </table>
          ${note}
        </div>

        <div class="l-foot">
          <div class="l-foot-item">Platform: <strong>${escapeHtml(o.platform || "TikTok Shop")}</strong></div>
          <div class="l-foot-item">Metode: <strong>${escapeHtml(o.paymentMethod || "COD/Non-COD")}</strong></div>
          <div class="l-foot-item">Kurir: <strong>${courier}</strong></div>
        </div>
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