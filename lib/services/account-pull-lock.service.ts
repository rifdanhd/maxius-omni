/**
 * A3 (M8b) — anti double-pull per akun, in-process.
 *
 * Sinkronisasi order = tarikan API berat (list + detail, rate-limited). Klik
 * sync dobel / retry paralel tidak boleh menjalankan dua tarikan untuk akun
 * yang sama pada saat bersamaan. Set akun dalam-flight → pemanggil kedua
 * langsung ditolak dengan pesan jelas (bukan antri, bukan jalan dua kali).
 */
const inflight = new Set<string>();

export class PullInProgressError extends Error {
  constructor() {
    super("Sinkronisasi akun ini sedang berjalan — tunggu beberapa detik lalu coba lagi.");
    this.name = "PullInProgressError";
  }
}

export async function withAccountPullLock<T>(
  accountId: string,
  fn: () => Promise<T>
): Promise<T> {
  if (inflight.has(accountId)) throw new PullInProgressError();
  inflight.add(accountId);
  try {
    return await fn();
  } finally {
    inflight.delete(accountId);
  }
}
