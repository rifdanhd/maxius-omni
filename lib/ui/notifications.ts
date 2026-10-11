export type NotificationItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  severity: "error" | "warning" | "info";
  source: "stock" | "sync" | "store" | "opname";
  fingerprint: string;
  occurredAt?: string;
  detectedAt?: string;
  read?: boolean;
};
export type NotificationRecord = { fingerprint: string; detectedAt: string; read: boolean };
export type NotificationMemory = Record<string, NotificationRecord>;

export function reconcileNotifications(items: NotificationItem[], memory: NotificationMemory, now: string) {
  const next: NotificationMemory = {};
  const rows = items.map((item) => {
    const old = memory[item.id];
    const record = old?.fingerprint === item.fingerprint ? old : { fingerprint: item.fingerprint, detectedAt: now, read: false };
    next[item.id] = record;
    return { ...item, ...record };
  });
  return { rows, memory: next };
}

const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export function notificationGroup(iso: string, now = new Date()) {
  const value = day(new Date(iso));
  if (value === day(now)) return "Hari ini";
  if (value === day(new Date(now.getTime() - 86400000))) return "Kemarin";
  return "Sebelumnya";
}

export function relativeNotificationTime(iso: string, now = Date.now()) {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "Baru saja";
  const format = new Intl.RelativeTimeFormat("id", { numeric: "auto" });
  if (seconds < 3600) return format.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return format.format(-Math.floor(seconds / 3600), "hour");
  return format.format(-Math.floor(seconds / 86400), "day");
}

export function notificationStorageKey(user: string, business: string) {
  return `maxius.notifications.v1:${encodeURIComponent(user)}:${encodeURIComponent(business)}`;
}

export function readNotificationMemory(key: string): NotificationMemory {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, record]) => record && typeof record === "object" && typeof record.fingerprint === "string" && typeof record.read === "boolean" && typeof record.detectedAt === "string" && Number.isFinite(Date.parse(record.detectedAt))));
  } catch { return {}; }
}
