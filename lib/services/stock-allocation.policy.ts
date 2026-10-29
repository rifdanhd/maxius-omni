export const ALLOCATION_MODES = ["FULL", "PERCENT", "FIXED", "EQUAL"] as const;
export type AllocationMode = typeof ALLOCATION_MODES[number];
export type AllocationPolicy = { mode: AllocationMode; value: number; buffer: number };

export function allocationQuantity(available: number, policy: AllocationPolicy, listings: number): number {
  if (![available, policy.value, policy.buffer, listings].every(Number.isFinite)) throw new Error("Konfigurasi alokasi stok harus berupa angka terbatas.");
  if (policy.buffer < 0 || policy.value < 0 || (policy.mode === "PERCENT" && policy.value > 100)) throw new Error("Buffer dan alokasi stok tidak valid.");
  const base = Math.max(0, available - policy.buffer);
  const quantity = policy.mode === "PERCENT" ? Math.floor(base * policy.value / 100)
    : policy.mode === "FIXED" ? Math.min(base, policy.value)
      : policy.mode === "EQUAL" ? Math.floor(base / Math.max(1, listings)) : base;
  return Math.max(0, Math.min(2_147_483_647, Math.floor(quantity)));
}

export function resolveAllocation(
  listing: { stockAllocationMode?: string | null; stockAllocationValue?: number | null; stockBuffer?: number | null },
  account: { stockAllocationMode?: string; stockAllocationValue?: number; stockBuffer?: number }
): AllocationPolicy {
  const mode = listing.stockAllocationMode ?? account.stockAllocationMode ?? "FULL";
  return {
    mode: ALLOCATION_MODES.includes(mode as AllocationMode) ? mode as AllocationMode : "FULL",
    value: listing.stockAllocationValue ?? account.stockAllocationValue ?? 100,
    buffer: listing.stockBuffer ?? account.stockBuffer ?? 0,
  };
}
