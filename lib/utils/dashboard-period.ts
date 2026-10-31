export const DASHBOARD_TIME_ZONE = "Asia/Jakarta";
export const DAY_MS = 86_400_000;

export function jakartaDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DASHBOARD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function dashboardPreset(days: number, date = new Date()) {
  const end = jakartaDateKey(date);
  const midnight = new Date(`${end}T00:00:00+07:00`).getTime();
  return { start: jakartaDateKey(new Date(midnight - (days - 1) * DAY_MS)), end };
}

export function dashboardPeriod(start: string, end: string, now = new Date()) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Tanggal tidak valid.");
    const ms = new Date(`${value}T00:00:00+07:00`).getTime();
    if (!Number.isFinite(ms) || jakartaDateKey(new Date(ms)) !== value) throw new Error("Tanggal tidak valid.");
    return ms;
  };
  const currentStart = parse(start);
  const endStart = parse(end);
  const days = (endStart - currentStart) / DAY_MS + 1;
  if (days < 1) throw new Error("Tanggal akhir harus sama atau setelah tanggal awal.");
  if (days > 90) throw new Error("Pilih rentang maksimal 90 hari.");
  if (end > jakartaDateKey(now)) throw new Error("Tanggal tidak boleh melewati hari ini (WIB).");
  return { currentStart, previousStart: currentStart - days * DAY_MS, rangeEnd: endStart + DAY_MS, days };
}
