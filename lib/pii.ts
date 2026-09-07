/**
 * Utility masking data pribadi (PII) — reusable, dipakai server-side.
 * Prinsip: nilai asli tidak pernah bocor ke response untuk yang tidak berhak;
 * masking di sini untuk response "default" (semua role/flag).
 */

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return maskGeneric(email);
  const localMasked = local.length > 0 ? `${local.slice(0, 1)}***` : "***";
  return `${localMasked}@${domain}`;
}

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
  if (t.length <= 4) return t;
  return `${t.slice(0, 4)}${"*".repeat(4)}${t.slice(-4)}`;
}

/**
 * Alamat: sembunyikan detail jalan, pertahankan kota/kabupaten & provinsi.
 * Ambil 2 segmen terakhir yang dipisah koma (umumnya city & province/region).
 */
export function maskAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return `… ${parts[0] ?? ""}`.trim();
  const kept = parts.slice(-2).join(", ");
  return `… ${kept}`;
}