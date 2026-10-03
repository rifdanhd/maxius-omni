import { prisma } from "@/lib/db/prisma";
import { DEFAULT_BUSINESS_ID } from "@/lib/services/business-scope.service";

/**
 * Pengaturan Inventori (FITUR Pengaturan Inventori).
 *
 * Satu baris PER BRAND (unique businessId; legacy id "inventory-default"
 * = baris brand default era singleton). Auto-dibuat saat pertama dibaca —
 * baris brand baru menyalin nilai baris default (pola get-or-create; tanpa
 * seed terpisah). Kolom eksplisit di schema agar type-safe. Nilai per
 * setting & pemakaiannya:
 *
 * - lowStockDefaultThreshold → ambang AWAL MasterProduct.threshold utk produk
 *   BARU (dua lokasi create: /api/inventory/mappings & product-copy.service).
 *   Produk existing tetap pakai threshold per-produk (dapat diubah di halaman
 *   Produk Master) — setting brand TIDAK menimpa nilai per-produk.
 * - notifyLowStock → gate in-app NotificationBell via /api/stock-alerts.
 *   notifyLowStockEmail disimpan tapi BELUM aktif: repo tidak punya provider
 *   email (tidak ada nodemailer/resend/smtp) — tidak bikin sistem baru.
 * - syncPush{Tokopedia,Shopee,Tiktok} → gate auto-push stok di sync.service
 *   (satu-satunya titik push; logic push tidak diduplikasi). Shopee &
 *   Tokopedia belum punya integrasi push — toggle disimpan utk saat siap.
 * - opnameReminderFrequency → preferensi pengingat opname rutin (off/daily/
 *   weekly/monthly). Belum ada infra cron di project — job-nya task terpisah.
 */

export const OPNAME_FREQUENCIES = ["off", "daily", "weekly", "monthly"] as const;
export type OpnameFrequency = (typeof OPNAME_FREQUENCIES)[number];

export const SETTING_ID = "inventory-default";

export type InventorySettings = {
  lowStockDefaultThreshold: number;
  notifyLowStock: boolean;
  notifyLowStockEmail: boolean;
  syncPushTokopedia: boolean;
  syncPushShopee: boolean;
  syncPushTiktok: boolean;
  opnameReminderFrequency: OpnameFrequency;
};

type SettingsRow = {
  lowStockDefaultThreshold: number;
  notifyLowStock: boolean;
  notifyLowStockEmail: boolean;
  syncPushTokopedia: boolean;
  syncPushShopee: boolean;
  syncPushTiktok: boolean;
  opnameReminderFrequency: string;
};

function toSettings(row: SettingsRow): InventorySettings {
  return {
    lowStockDefaultThreshold: row.lowStockDefaultThreshold,
    notifyLowStock: row.notifyLowStock,
    notifyLowStockEmail: row.notifyLowStockEmail,
    syncPushTokopedia: row.syncPushTokopedia,
    syncPushShopee: row.syncPushShopee,
    syncPushTiktok: row.syncPushTiktok,
    // Nilai tak dikenal (mis. diubah manual di DB) → fallback "monthly".
    opnameReminderFrequency: (OPNAME_FREQUENCIES as readonly string[]).includes(
      row.opnameReminderFrequency
    )
      ? (row.opnameReminderFrequency as OpnameFrequency)
      : "monthly",
  };
}

/** getInventorySettings — baca baris PER BRAND; auto-create bila kosong.
 *  Baris baru disalin dari baris default brand (periode singleton global)
 *  supaya perilaku tiap brand identik dengan sebelum pemisahan. */
export async function getInventorySettings(
  businessId: string = DEFAULT_BUSINESS_ID
): Promise<InventorySettings> {
  const existing = await prisma.inventorySetting.findUnique({ where: { businessId } });
  if (existing) return toSettings(existing);
  const template = await prisma.inventorySetting.findUnique({
    where: { businessId: DEFAULT_BUSINESS_ID },
  });
  try {
    const created = await prisma.inventorySetting.create({
      data: {
        // PK per brand; baris legacy tetap memakai id "inventory-default".
        id: businessId,
        businessId,
        ...(template
          ? {
              lowStockDefaultThreshold: template.lowStockDefaultThreshold,
              notifyLowStock: template.notifyLowStock,
              notifyLowStockEmail: template.notifyLowStockEmail,
              syncPushTokopedia: template.syncPushTokopedia,
              syncPushShopee: template.syncPushShopee,
              syncPushTiktok: template.syncPushTiktok,
              opnameReminderFrequency: template.opnameReminderFrequency,
            }
          : {}),
      },
    });
    return toSettings(created);
  } catch (e) {
    // Balapan pembacaan paralel → unique(businessId) menang; baca ulang.
    const again = await prisma.inventorySetting.findUnique({ where: { businessId } });
    if (again) return toSettings(again);
    throw e;
  }
}

/**
 * getCachedInventorySettings — alias getInventorySettings.
 *
 * Sengaja TANPA cache TTL: baca setting = lookup single-row by PK (mikrodetik
 * di SQLite), sementara risiko cache tanpa invalidasi = toggle yang baru
 * dimatikan masih diabaikan sampai TTL habis (push bisa jalan setelah
 * dimatikan). Kejujuran perilaku > penghematan mikro.
 */
export async function getCachedInventorySettings(
  businessId: string = DEFAULT_BUSINESS_ID
): Promise<InventorySettings> {
  return getInventorySettings(businessId);
}

/**
 * validateInventorySettingsUpdate — validasi payload PUT secara ketat:
 * field tak dikenal diabaikan, field salah tipe/nilai → ditolak dengan alasan
 * yang jelas (Bukan parse diam-diam).
 */
export function validateInventorySettingsUpdate(
  body: unknown
): { ok: true; data: Partial<InventorySettings> } | { ok: false; reason: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "Body harus objek JSON." };
  }
  const b = body as Record<string, unknown>;
  const out: Partial<InventorySettings> = {};

  if ("lowStockDefaultThreshold" in b) {
    const n = Number(b.lowStockDefaultThreshold);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      return {
        ok: false,
        reason: "Ambang stok rendah harus bilangan bulat antara 0 dan 1.000.000.",
      };
    }
    out.lowStockDefaultThreshold = n;
  }

  const booleanKeys = [
    "notifyLowStock",
    "notifyLowStockEmail",
    "syncPushTokopedia",
    "syncPushShopee",
    "syncPushTiktok",
  ] as const;
  for (const key of booleanKeys) {
    if (key in b) {
      if (typeof b[key] !== "boolean") {
        return { ok: false, reason: `${key} harus boolean (true/false).` };
      }
      out[key] = b[key];
    }
  }

  if ("opnameReminderFrequency" in b) {
    const v = b.opnameReminderFrequency;
    if (typeof v !== "string" || !(OPNAME_FREQUENCIES as readonly string[]).includes(v)) {
      return {
        ok: false,
        reason: `Frekuensi pengingat opname harus salah satu dari: ${OPNAME_FREQUENCIES.join(", ")}.`,
      };
    }
    out.opnameReminderFrequency = v as OpnameFrequency;
  }

  return { ok: true, data: out };
}

/** updateInventorySettings — patch parsial per brand; pastikan baris ada dulu. */
export async function updateInventorySettings(
  businessId: string,
  patch: Partial<InventorySettings>
): Promise<InventorySettings> {
  await getInventorySettings(businessId);
  const row = await prisma.inventorySetting.update({ where: { businessId }, data: patch });
  return toSettings(row);
}
