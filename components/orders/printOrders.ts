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
  items: OrderCardItem[];
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

function buildLabel(o: PrintableOrder) {
  const items = o.items
    .map((i) => escapeHtml(`${i.qty}x ${i.name} (${i.variant})`))
    .join("<br/>");
  return `
    <div class="sheet">
      <div class="order-header">
        <div>
          <div class="store">${escapeHtml(o.storeName)}</div>
          <div class="meta">${escapeHtml(o.platform)}</div>
        </div>
        <div>
          <div class="title">Label Pengiriman</div>
          <div class="meta">No. Pesanan: ${escapeHtml(o.orderNo)}</div>
        </div>
      </div>
      <div class="label-row">
        <div class="label-key">Penerima</div>
        <div class="label-val">${escapeHtml(o.buyerName)} (${escapeHtml(o.buyerPhone)})</div>
      </div>
      <div class="label-row">
        <div class="label-key">Alamat</div>
        <div class="address">${escapeHtml(o.address)}</div>
      </div>
      <div class="label-row">
        <div class="label-key">Isi Paket</div>
        <div class="address">${items || "-"}</div>
      </div>
      <div class="barcode">${escapeHtml(o.orderNo)}</div>
      <div class="footer">Dicetak ${new Date().toLocaleString("id-ID")}</div>
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
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function openPrintWindow(title: string, bodyHtml: string) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Izin pop-up diblokir. Izinkan pop-up untuk mencetak, lalu ulangi.");
    return;
  }
  win.document.write(
    `<html><head><title>${title}</title><style>${PRINT_STYLES}</style></head><body>${bodyHtml}</body></html>`
  );
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
  }, 300);
}

export function printOrders(orders: PrintableOrder[], type: PrintType) {
  const builder = {
    Label: buildLabel,
    Invoice: buildInvoice,
    PackingList: buildPackingList,
  }[type];
  const body = orders.map((o) => builder(o)).join("");
  openPrintWindow(`Cetak ${type}`, body);
}