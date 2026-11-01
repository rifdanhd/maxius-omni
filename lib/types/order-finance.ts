export type OrderFinance = {
  status: "ready" | "pending" | "unavailable" | "unsupported";
  message: string;
  currency?: string;
  fetchedAt?: string;
  transactionCount?: number;
  amounts?: {
    subtotal: string | null;
    refundSubtotal: string | null;
    sellerDiscount: string | null;
    sellerDiscountRefund: string | null;
    revenue: string | null;
    shippingCost: string | null;
    feesAndTaxes: string | null;
    transactionFee: string | null;
    affiliateCommission: string | null;
    affiliateAdsCommission: string | null;
    affiliatePartnerCommission: string | null;
    platformCommission: string | null;
    dynamicCommission: string | null;
    settlement: string | null;
  };
};
