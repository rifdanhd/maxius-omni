type Entry = { expiresAt: number; value: unknown };

const store = new Map<string, Entry>();

/**
 * cached(key, ttlMs, loader) — cache in-memory sederhana dengan TTL.
 *
 * Dipakai untuk endpoint dashboard yang re-baca setiap request (summary,
 * analytics). Pada skala data saat ini cache 60 detik sudah cukup; saat data
 * tumbuh besar, ganti dengan pre-agregasi + scheduled job (bukan perluasan
 * cache ini).
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const value = await loader();
  store.set(key, { expiresAt: now + ttlMs, value });
  return value;
}