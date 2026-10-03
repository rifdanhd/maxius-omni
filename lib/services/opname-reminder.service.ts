/**
 * opname-reminder — pengingat opname stok OTOMATIS (read-side).
 *
 * Preferensi `InventorySetting.opnameReminderFrequency` (off/daily/weekly/
 * monthly) sebelumnya hanya tersimpan tanpa scheduler; pengingat kini
 * dihitung SAAT DIBACA di /api/stock-alerts → muncul sebagai baris amber di
 * lonceng notifikasi. Tanpa cron: biaya 1 query kecil per request bell.
 *
 * Due = opname COMPLETED terakhir (lintas brand via item → variant → master)
 * berjarak >= ambang frekuensi, atau belum pernah ada sama sekali.
 */
import { prisma } from "@/lib/db/prisma";
import {
  getCachedInventorySettings,
  type OpnameFrequency,
} from "@/lib/services/inventory-settings.service";

const DAY_MS = 86_400_000;
const THRESHOLD_DAYS: Record<OpnameFrequency, number> = {
  off: 0,
  daily: 1,
  weekly: 7,
  monthly: 30,
};

export type OpnameReminder = {
  due: boolean;
  frequency: OpnameFrequency;
  lastOpnameAt: string | null;
  /** Hari lewat ambang (0 bila belum waktunya); -1 bila belum pernah opname. */
  overdueDays: number;
};

export async function getOpnameReminder(businessId: string): Promise<OpnameReminder | null> {
  const settings = await getCachedInventorySettings(businessId);
  const frequency = settings.opnameReminderFrequency;
  if (frequency === "off") return null;

  const last = await prisma.stockOpname.findFirst({
    where: {
      status: "COMPLETED",
      items: { some: { variant: { masterProduct: { businessId } } } },
    },
    orderBy: { finalizedAt: "desc" },
    select: { finalizedAt: true },
  });

  const lastAt = last?.finalizedAt ?? null;
  const threshold = THRESHOLD_DAYS[frequency];
  if (!lastAt) {
    return { due: true, frequency, lastOpnameAt: null, overdueDays: -1 };
  }
  const days = Math.floor((Date.now() - lastAt.getTime()) / DAY_MS);
  return {
    due: days >= threshold,
    frequency,
    lastOpnameAt: lastAt.toISOString(),
    overdueDays: Math.max(0, days - threshold),
  };
}
