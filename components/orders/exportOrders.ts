export type ExportOrderRow = {
  orderNo: string;
  status: string;
  store: string;
  platform: string;
  buyerName: string;
  buyerEmail: string;
  amount: string;
  currency: string;
  createTime: string;
  qty: number;
  products: string;
};

function escapeCsvCell(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ordersToCsv(rows: ExportOrderRow[]): string {
  if (rows.length === 0) return "";
  const header = [
    "No. Pesanan",
    "Status",
    "Toko",
    "Platform",
    "Pembeli",
    "Email",
    "Total",
    "Kurasi",
    "Tanggal",
    "Qty",
    "Produk",
  ];
  const lines = rows.map((r) =>
    [
      r.orderNo,
      r.status,
      r.store,
      r.platform,
      r.buyerName,
      r.buyerEmail,
      r.amount,
      r.currency,
      r.createTime,
      r.qty,
      r.products,
    ]
      .map(escapeCsvCell)
      .join(",")
  );
  return [header.map(escapeCsvCell).join(","), ...lines].join("\n");
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}