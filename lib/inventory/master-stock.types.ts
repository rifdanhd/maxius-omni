import type { AllocationPolicy } from "@/lib/services/stock-allocation.policy";

export type MasterStockTab = "all" | "empty" | "low" | "failed" | "unmapped" | "oversells";
export type ListingStock = {
  id: string; accountId: string; store: string; platform: string; channelSku: string;
  sellerSku: string | null; platformSkuId: string | null; platformStock: number | null;
  status: "SUCCESS" | "FAILED" | "PENDING" | "DISABLED"; error: string | null; lastSyncedAt: string | null;
  blockedReason?: string | null;
  allocation: AllocationPolicy; quantity: number;
  inheritsAllocation: boolean; defaultAllocation: AllocationPolicy;
};
export type MasterStockRow = {
  id: string; version: number; sku: string; name: string; variantName: string | null;
  imageUrl: string | null; category: string | null; stock: number; safetyStock: number;
  available: number; pending: number; minimum: number; archived: boolean; promoActive: number;
  ownArchived: boolean;
  stockReview?: { reasons: string[]; initialStock: number | null; initialReason: string | null };
  status: "SUCCESS" | "FAILED" | "PENDING" | "DISABLED"; allocationWarning: boolean;
  listings: ListingStock[];
  warehouses: Array<{ id: string; name: string; stock: number; safetyStock: number }>;
};
export type MasterStockResult = {
  rows: MasterStockRow[]; total: number; page: number; pageSize: number;
  counts: Record<MasterStockTab, number>; archivedCounts: { all: number; empty: number };
  filters: { categories: string[]; stores: Array<{ id: string; label: string; platform: string }>;
    warehouses: Array<{ id: string; name: string; isDefault?: boolean }> };
};
