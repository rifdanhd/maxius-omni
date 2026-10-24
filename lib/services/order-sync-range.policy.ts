export const DEFAULT_INITIAL_ORDER_SYNC_DAYS = 30;

export function initialOrderSyncDays(
  shopId: string | null,
  configuration = process.env.ORDER_SYNC_INITIAL_DAYS_BY_SHOP
): number {
  if (!shopId || !configuration) return DEFAULT_INITIAL_ORDER_SYNC_DAYS;
  try {
    const settings: unknown = JSON.parse(configuration);
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return DEFAULT_INITIAL_ORDER_SYNC_DAYS;
    const days = Object.prototype.hasOwnProperty.call(settings, shopId)
      ? (settings as Record<string, unknown>)[shopId]
      : undefined;
    return typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 90
      ? days
      : DEFAULT_INITIAL_ORDER_SYNC_DAYS;
  } catch {
    return DEFAULT_INITIAL_ORDER_SYNC_DAYS;
  }
}
