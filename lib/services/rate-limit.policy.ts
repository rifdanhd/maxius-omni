import { TikTokApiError } from "@/lib/integrations/tiktokShop";

/**
 * Klasifikasi error platform utk kebijakan retry (TUGAS 3) — FUNGSI MURNI.
 *
 * Aturan client: retry backoff HANYA untuk error sementara (rate limit /
 * infrastruktur). Error validasi/permanen harus gagal JELAS, bukan diulang
 * percuma (retry payload invalid selalu invalid).
 */

/** Kode HTTP yang jelas-jelas sementara (rate limit / server error). */
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);

/**
 * isTransientPlatformError — true bila error layak di-retry dengan backoff.
 *
 * Sumber deteksi rate limit:
 *   - HTTP 429: callApi melempar TikTokApiError dgn code = res.status (429)
 *     bila body non-JSON / tanpa code — jadi HTTP 429 TERBACA di sini.
 *   - Body JSON TikTok: code diset platform; HTTP 429 dgn body code juga
 *     lolos via res.status fallback bila code bukan token error.
 */
export function isTransientPlatformError(err: unknown): boolean {
  if (err instanceof TikTokApiError) {
    return RETRYABLE_HTTP.has(err.code);
  }
  // Network fetch (TypeError: fetch failed dsb.) = sementara, layak retry.
  if (err instanceof TypeError) return true;
  return false;
}

/** Backoff eksponensial + jitter: base * 2^attempt, acak ±25%, cap 5 menit. */
export function backoffDelayMs(attempt: number, baseMs = 2_000, maxMs = 300_000): number {
  const exp = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = exp * (0.75 + Math.random() * 0.5);
  return Math.round(jitter);
}

/** Jumlah percobaan backoff utk error sementara (percobaan pertama bukan retry). */
export const MAX_TRANSIENT_RETRIES = 5;
