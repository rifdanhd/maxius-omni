import crypto from "node:crypto";
import jwt from "jsonwebtoken";

export class StockPreviewConflict extends Error {}
type Scope = { businessId: string; userId: string; accountId: string };
function secret() {
  const key = process.env.JWT_SECRET;
  if (!key || key.length < 32) throw new Error("Konfigurasi penandatanganan preview belum tersedia.");
  return key;
}
export function stockPlanDigest(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function signStockPreview(scope: Scope, digest: string) {
  return jwt.sign({ purpose: "tiktok-stock-preview", ...scope, digest }, secret(), { algorithm: "HS256", expiresIn: "10m", jwtid: crypto.randomUUID() });
}
export function verifyStockPreview(token: string | undefined, scope: Scope): { digest: string; jti: string } {
  try {
    if (!token || token.length > 4000) throw new Error();
    const value = jwt.verify(token, secret(), { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (value.purpose !== "tiktok-stock-preview" || value.businessId !== scope.businessId
      || value.userId !== scope.userId || value.accountId !== scope.accountId
      || typeof value.digest !== "string" || typeof value.jti !== "string") throw new Error();
    return { digest: value.digest, jti: value.jti };
  } catch { throw new StockPreviewConflict("Preview tidak valid atau sudah kedaluwarsa. Ambil preview baru sebelum mengganti stok pusat."); }
}
