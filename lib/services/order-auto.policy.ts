export function orderAutoStatus() {
  const enabled = process.env.AUTO_ORDERS_DISABLED !== "true"
    && (process.env.AUTO_SYNC_DISABLED !== "true" || process.env.AUTO_ORDERS_ENABLED === "true")
    && (process.env.NODE_ENV === "production" || process.env.AUTO_SYNC_DEV === "true");
  return { enabled, intervalMs: Math.max(60_000, Number(process.env.AUTO_ORDERS_INTERVAL_MS) || 60_000) };
}
