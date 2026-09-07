import crypto from "crypto";

const ALGO = "aes-256-gcm";
const KEY_HEX = process.env.PII_ENC_KEY;

if (!KEY_HEX) {
  throw new Error(
    "PII_ENC_KEY belum diisi di .env (32 byte hex). " +
      'Generate: node -e \'console.log(require("crypto").randomBytes(32).toString("hex"))\''
  );
}

const KEY = Buffer.from(KEY_HEX, "hex");

if (KEY.length !== 32) {
  throw new Error("PII_ENC_KEY harus 32 byte (64 karakter hex) untuk AES-256.");
}

/**
 * encryptPii — enkripsi AES-256-GCM. Format simpanan: iv.tag.ciphertext (base64).
 * Random IV per nilai → nilai yang sama menghasilkan ciphertext berbeda.
 */
export function encryptPii(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

/**
 * decryptPii — kebalikan encryptPii. Value non-ciphertext (mis. data lama)
 * di-return apa adanya agar tidak crash; ciphertext invalid → null.
 */
export function decryptPii(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return value as string | null;
  const [ivB64, tagB64, encB64] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}