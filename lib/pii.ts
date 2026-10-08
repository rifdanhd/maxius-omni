/**
 * Utility masking data pribadi (PII) — reusable, dipakai server-side.
 * Prinsip: nilai asli tidak pernah bocor ke response untuk yang tidak berhak;
 * masking di sini untuk response "default" (semua role/flag).
 */

import { maskEmail, maskPii } from "@/lib/utils/pii";
export { maskEmail, maskPii } from "@/lib/utils/pii";

function maskGeneric(value: string): string {
  const t = value.trim();
  if (t.length <= 2) return "*".repeat(t.length);
  return `${t.slice(0, 1)}${"*".repeat(Math.min(6, t.length - 2))}`;
}

/** Nama: huruf awal + asterisk (sesuai referensi "a***"). Bila berbentuk email → mask local part. */
export function maskName(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim();
  if (!t) return null;
  if (t.includes("@")) return maskEmail(t);
  return maskGeneric(t);
}

/** HP: 4 digit awal + asterisk + 4 digit akhir (contoh 0812••••4212). */
export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim().replace(/[^0-9+]/g, "");
  if (t.length <= 8) return "***";
  return `${t.slice(0, 2)}****${t.slice(-2)}`;
}

/**
 * Alamat: sembunyikan detail jalan/nomor dengan `***`, pertahankan kota/kabupaten
 * & provinsi (2 segmen terakhir dipisah koma). Contoh:
 * "Jl. Mawar No.12, RT.03, Jakarta Selatan, DKI Jakarta"
 *   → "***, ***, Jakarta Selatan, DKI Jakarta"
 */
export function maskAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 3) return maskPii(value);
  const kept = parts.slice(-2).join(", ");
  const maskedHead = parts.slice(0, -2).map(() => "***").join(", ");
  return maskedHead ? `${maskedHead}, ${kept}` : kept;
}
