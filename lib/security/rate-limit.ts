import { createHash } from "node:crypto";

type Bucket = { count: number; expires: number };
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private capacity = 10_000) {}
  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const current = this.buckets.get(key);
    if (current && current.expires > now) {
      if (current.count >= limit) return false;
      current.count++;
      return true;
    }
    for (const [id, bucket] of this.buckets) if (bucket.expires <= now) this.buckets.delete(id);
    // Fail closed under memory pressure; never evict active protection.
    if (!current && this.buckets.size >= this.capacity) return false;
    this.buckets.set(key, { count: 1, expires: now + windowMs });
    return true;
  }
}
const globalRate = globalThis as unknown as { maxiusRate?: RateLimiter };
export const limiter = globalRate.maxiusRate ??= new RateLimiter();
export function rateKey(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function rateLimitedResponse() {
  return Response.json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, { status: 429, headers: { "Retry-After": "60" } });
}
