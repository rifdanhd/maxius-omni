/**
 * Klasifikasi tab untuk halaman Promosi (read-only monitoring TikTok Shop).
 *
 * Sengaja PURE (tanpa import prisma/react) supaya unit-testable dan dapat
 * dipakai di client component. Semua "now" diinject dari pemanggil agar
 * deterministik saat test.
 */

export type PromotionTabId = "aktif" | "upcoming" | "ended";

export type TabLike = {
  status: string;
  startsAt: string;
  endsAt: string;
};

/**
 * Mapping status TikTok yang sudah tervalidasi.
 * - ONGOING   → sedang berjalan
 * - NOT_START → dijadwalkan
 * - DEACTIVATED / ENDED / NOT_EFFECTIVE → berakhir/nonaktif
 *
 * Status lain (belum tervalidasi, termasuk DRAFT dari API) di-fallback
 * berdasarkan waktu — JANGAN sampai activity hilang dari semua tab.
 */
function classifyByStatus(status: string): PromotionTabId | null {
  switch (status) {
    case "ONGOING":
      return "aktif";
    case "NOT_START":
      return "upcoming";
    case "DEACTIVATED":
    case "ENDED":
    // NOT_EFFECTIVE = dihentikan platform → paling masuk akal di "berakhir".
    case "NOT_EFFECTIVE":
      return "ended";
    default:
      // Unknown status (mis. DRAFT, EXPIRED lama, atau nilai baru dari TikTok):
      // jatuhkan ke fallback waktu, jangan buang.
      return null;
  }
}

/**
 * Fallback berbasis waktu untuk status tak dikenal:
 * - now < startsAt          → upcoming
 * - now > endsAt            → ended
 * - else (starts..ends)     → aktif
 * Gagal parse waktu → "ended" (tab paling aman utk data aneh).
 */
function classifyByTime(startsAt: string, endsAt: string, now: Date): PromotionTabId {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "ended";
  if (now.getTime() < start) return "upcoming";
  if (now.getTime() > end) return "ended";
  return "aktif";
}

/** Tab untuk satu activity — status dulu, fallback waktu utk status unknown. */
export function classifyPromotionTab(activity: TabLike, now: Date = new Date()): PromotionTabId {
  const byStatus = classifyByStatus(activity.status);
  if (byStatus) return byStatus;
  return classifyByTime(activity.startsAt, activity.endsAt, now);
}

/** Hitung jumlah per tab. */
export function countPromotionTabs(activities: TabLike[], now: Date = new Date()) {
  const counts: Record<PromotionTabId, number> = { aktif: 0, upcoming: 0, ended: 0 };
  for (const a of activities) counts[classifyPromotionTab(a, now)] += 1;
  return counts;
}

/** Expose utk test fallback waktu. */
export { classifyByTime as classifyPromotionTabByTime };
