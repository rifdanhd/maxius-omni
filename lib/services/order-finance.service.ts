import { Prisma } from "@prisma/client";
import type { OrderFinance } from "@/lib/types/order-finance";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function money(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("Nominal Finance TikTok tidak valid.");
  }
  return new Prisma.Decimal(value).toFixed();
}

function sum(rows: Record<string, unknown>[], path: string[]): string | null {
  if (!rows.length) return null;
  let total = new Prisma.Decimal(0);
  for (const row of rows) {
    let value: unknown = row;
    for (const key of path) value = record(value)?.[key];
    const amount = money(value);
    if (amount === null) return null;
    total = total.plus(amount);
  }
  return total.toFixed();
}

export function parseTikTokOrderFinance(raw: unknown, orderId: string): OrderFinance {
  const data = record(raw);
  if (!data || (data.order_id !== undefined && data.order_id !== orderId)) {
    throw new Error("Identitas respons Finance TikTok tidak sesuai pesanan.");
  }
  if (data.total_count !== undefined && (!Number.isSafeInteger(data.total_count) || Number(data.total_count) < 0)) {
    throw new Error("Jumlah transaksi Finance TikTok tidak valid.");
  }
  const transactions = data.sku_transactions ?? (data.total_count === 0 ? [] : null);
  if (!Array.isArray(transactions) || transactions.some(row => !record(row)) ||
      (typeof data.total_count === "number" && data.total_count !== transactions.length)) {
    throw new Error("Rincian transaksi Finance TikTok belum lengkap.");
  }
  const rows = transactions as Record<string, unknown>[];
  const revenue = money(data.revenue_amount);
  const settlement = money(data.settlement_amount);
  const shippingCost = money(data.shipping_cost_amount);
  const feesAndTaxes = money(data.fee_and_tax_amount);
  const hasAmounts = [revenue, settlement, shippingCost, feesAndTaxes].some(value => value !== null && value !== "0");
  const fetchedAt = new Date().toISOString();
  if (!rows.length && !hasAmounts) {
    return {
      status: "pending",
      message: "TikTok belum menyediakan transaksi settlement untuk pesanan ini. Coba perbarui setelah transaksi tersedia di keuangan Seller Center.",
      fetchedAt,
      transactionCount: 0,
    };
  }
  if ([revenue, settlement, shippingCost, feesAndTaxes].every(value => value === null)) {
    throw new Error("Nominal transaksi Finance TikTok belum lengkap.");
  }
  if (data.order_id !== orderId || typeof data.currency !== "string" || !/^[A-Z]{3}$/.test(data.currency)) {
    throw new Error("Identitas atau mata uang Finance TikTok belum lengkap.");
  }
  return {
    status: "ready",
    message: "Nilai mengikuti transaksi settlement TikTok yang tersedia. Settlement bukan konfirmasi dana sudah masuk rekening. Rincian biaya di bawah sudah termasuk dalam total biaya dan pajak; jangan dijumlahkan ulang. Tanda − berarti potongan, tanda - berarti nilai belum diberikan TikTok.",
    currency: data.currency,
    fetchedAt,
    transactionCount: rows.length,
    amounts: {
      subtotal: sum(rows, ["revenue_breakdown", "subtotal_before_discount_amount"]),
      refundSubtotal: sum(rows, ["revenue_breakdown", "refund_subtotal_before_discount_amount"]),
      sellerDiscount: sum(rows, ["revenue_breakdown", "seller_discount_amount"]),
      sellerDiscountRefund: sum(rows, ["revenue_breakdown", "seller_discount_refund_amount"]),
      revenue,
      shippingCost,
      feesAndTaxes,
      transactionFee: sum(rows, ["fee_tax_breakdown", "fee", "transaction_fee_amount"]),
      affiliateCommission: sum(rows, ["fee_tax_breakdown", "fee", "affiliate_commission_amount"]),
      affiliateAdsCommission: sum(rows, ["fee_tax_breakdown", "fee", "affiliate_ads_commission_amount"]),
      affiliatePartnerCommission: sum(rows, ["fee_tax_breakdown", "fee", "affiliate_partner_commission_amount"]),
      platformCommission: sum(rows, ["fee_tax_breakdown", "fee", "platform_commission_amount"]),
      dynamicCommission: sum(rows, ["fee_tax_breakdown", "fee", "dynamic_commission_amount"]),
      settlement,
    },
  };
}
