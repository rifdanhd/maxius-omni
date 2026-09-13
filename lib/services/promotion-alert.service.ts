/**
 * ALERT service — memastikan status UNVERIFIED / PENDING menggantung BENAR-BENAR
 * terlihat (permintaan reviewer Tahap 3 #3): bukan cuma tersimpan di kolom DB
 * yang tidak pernah dibaca. Sumber alert:
 * - resultStatus = UNVERIFIED → create/attach sukses menurut sebagian sumber
 *   tapi state remote tidak terkonfirmasi → risiko "zombie activity".
 * - resultStatus = PENDING dan createdAt lewat STALE_AFTER_MS → intent tanpa
 *   penyelesaian = proses crash di tengah jalan.
 * Dipakai endpoint GET /api/marketplace/tiktok/promotions/alerts yang dipoll
 * banner halaman Promosi.
 */
import { prisma } from "@/lib/db/prisma";

/** PENDING lebih lama dari ini = proses kemungkinan crash sebelum update final. */
export const STALE_PENDING_MS = 30 * 60 * 1000; // 30 menit

export type PromotionAlert = {
  kind: "UNVERIFIED" | "STALE_PENDING";
  auditLogId: string;
  action: string;
  activityTitle: string | null;
  externalActivityId: string | null;
  username: string;
  createdAt: string;
  reason: string;
};

export async function getPromotionAlerts(): Promise<PromotionAlert[]> {
  const staleCutoff = new Date(Date.now() - STALE_PENDING_MS);
  const rows = await prisma.promotionAuditLog.findMany({
    where: { resultStatus: { in: ["UNVERIFIED", "PENDING"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const alerts: PromotionAlert[] = [];
  for (const row of rows) {
    if (row.resultStatus === "UNVERIFIED") {
      alerts.push({
        kind: "UNVERIFIED",
        auditLogId: row.id,
        action: row.action,
        activityTitle: row.activityTitle,
        externalActivityId: row.externalActivityId,
        username: row.username,
        createdAt: row.createdAt.toISOString(),
        reason:
          row.tiktokMessage ??
          "State activity di TikTok tidak terkonfirmasi — cek Seller Center, nonaktifkan bila activity zombie.",
      });
      continue;
    }
    // PENDING: hanya alert bila sudah stale (yang segar = sedang berjalan normal).
    if (row.createdAt < staleCutoff) {
      alerts.push({
        kind: "STALE_PENDING",
        auditLogId: row.id,
        action: row.action,
        activityTitle: row.activityTitle,
        externalActivityId: row.externalActivityId,
        username: row.username,
        createdAt: row.createdAt.toISOString(),
        reason: "Intent create tergantung >30 menit tanpa hasil — proses kemungkinan crash di tengah.",
      });
    }
  }
  return alerts;
}
