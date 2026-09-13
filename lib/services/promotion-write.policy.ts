/**
 * POLICY murni untuk fitur promotion WRITE (buat DIRECT_DISCOUNT dari Maxius).
 *
 * Sengaja TANPA import prisma/next/env — semua fungsi pure & deterministik agar
 * unit-testable (tests/promotion-write.policy.test.mts) dan dapat dipakai ulang
 * oleh endpoint /preview (read-only) DAN /create (server-side re-check —
 * defense in depth: jangan pernah percaya hitungan dari client).
 *
 * Sumber keputusan: docs/plan-promotion-write.md §2 (G1/G2/G3) + keputusan review:
 * - G1: produk tanpa harga sumber TIDAK BOLEH ikut (tidak bisa dipreview).
 * - G2: diskon kebijakan Maxius 1–95; 0 atau >=96 hanya dengan konfirmasi dua
 *       tahap yang MENYEBUT DAMPAK NYATA ("dijual hampir gratis"), bukan
 *       warning generik.
 * - G3: overlap dibedakan tegas AKTIF (ONGOING/NOT_START + jendela waktu
 *       tumpang tindih) vs BERAKHIR (tidak memblock, hanya riwayat).
 */

/** Batas kebijakan diskon Maxius (BUKAN klaim aturan resmi TikTok). */
export const DISCOUNT_MIN = 1;
export const DISCOUNT_MAX = 95;
/** >= DISCOUNT_EXTREME_MIN dianggap "hampir gratis" → butuh konfirmasi khusus. */
export const DISCOUNT_EXTREME_MIN = 96;

export type PriceSource = {
  /** Harga tayang saat ini (override mapping, fallback harga default varian). */
  price: number | null;
  /** -1 = harga override mapping; null = varian juga belum punya harga. */
  priceSource: "MAPPING_OVERRIDE" | "VARIANT_DEFAULT" | null;
  /** Nama tampilan: platformTitle listing, fallback nama master product. */
  displayName: string | null;
  channelSku: string;
  platformProductId: string | null;
};

export type DiscountIssue =
  | { kind: "NOT_INTEGER"; value: number }
  | { kind: "OUT_OF_RANGE"; value: number; min: number; max: number }
  | { kind: "EXTREME_DISCOUNT"; value: number; needsDoubleConfirm: true };

/**
 * Validasi satu angka diskon (G2). Besar 1–95 langsung OK.
 * 0 / >=96 → EXTREME_DISCOUNT (boleh jalan HANYA dengan explicitConfirm=true).
 * Angka non-integer / negatif / >100 → selalu error (tidak bisa dikonfirmasi).
 */
export function validateDiscount(value: number, explicitConfirm = false): DiscountIssue | null {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { kind: "NOT_INTEGER", value };
  }
  if (value >= DISCOUNT_MIN && value <= DISCOUNT_MAX) return null;
  if (value >= 0 && value <= 100) {
    if (explicitConfirm) return null;
    return { kind: "EXTREME_DISCOUNT", value, needsDoubleConfirm: true };
  }
  return { kind: "OUT_OF_RANGE", value, min: DISCOUNT_MIN, max: DISCOUNT_MAX };
}

/**
 * Pesan konfirmasi EXTREME dengan DAMPAK NYATA (keputusan review 14 Sep):
 * sebutkan produk akan dijual hampir gratis / gratis, lengkap harga final Rp.
 */
export function extremeDiscountConfirmMessage(displayName: string, value: number, finalPrice: number): string {
  const priceText =
    finalPrice <= 0 ? "Rp 0 (GRATIS)" : `Rp ${Math.round(finalPrice).toLocaleString("id-ID")}`;
  const effect =
    value <= 0
      ? "akan dijual GRATIS"
      : `akan dijual HAMPIR GRATIS (hanya ${100 - value}% dari harga normal)`;
  return (
    `PERINGATAN: "${displayName}" ${effect} selama promo berjalan — ` +
    `harga jual menjadi ${priceText}. TikTok buyer membeli di harga ini sesungguhnya. ` +
    `Centang konfirmasi jika Anda yakin.`
  );
}

export type PriceRow = {
  input: PriceSource;
  /** Harga final = round(price * (100 - discount) / 100). null bila tak bisa dihitung. */
  finalPrice: number | null;
  /** Non-null = produk DITOLAK ikut activity (G1). */
  error: string | null;
};

/**
 * Hitung harga final satu produk (G1). Pembulatan ke rupiah terdekat.
 * Tanpa harga sumber → finalPrice null + error (endpoint menolak submit).
 */
export function computePriceRow(input: PriceSource, discount: number): PriceRow {
  if (input.price === null || !Number.isFinite(input.price) || input.price <= 0) {
    return { input, finalPrice: null, error: "Produk belum punya harga sumber (mapping & varian)." };
  }
  return {
    input,
    finalPrice: Math.round((input.price * (100 - discount)) / 100),
    error: null,
  };
}

/* ------------------------------ G3: Overlap ------------------------------ */

export type ExistingActivityLike = {
  externalActivityId: string;
  title: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  /** platformProductId yang tergabung di activity tersebut. */
  productIds: Set<string>;
};

export type OverlapVerdict = {
  /** Activity AKTIF (harus diwarn/block-by-default). */
  active: Array<{ externalActivityId: string; title: string; status: string; overlapKind: "FULL" | "PARTIAL" }>;
  /** Activity yang sudah berakhir — hanya riwayat, TIDAK memblock. */
  past: Array<{ externalActivityId: string; title: string; status: string }>;
};

/** Status activity yang masih membatasi produk. */
export function isActivePromotionStatus(status: string): boolean {
  return status === "ONGOING" || status === "NOT_START";
}

/**
 * Klasifikasi overlap per produk (G3):
 * - AKTIF: activity ONGOING/NOT_START DAN jendela waktunya tumpang tindih
 *   dengan [newStart,newEnd] — FULL bila activity lama berada penuh di dalam
 *   jendela baru, PARTIAL bila hanya sebagian.
 * - BERAKHIR: status selain ONGOING/NOT_START ATAU window sudah lewat →
 *   masuk `past`, produk TETAP boleh dipakai (tidak diblok).
 *
 * `now` di-inject (default jam sistem) supaya klasifikasi deterministik di
 * test — pola yang sama dengan validateSchedule & classifyPromotionTab.
 */
export function classifyOverlap(
  productId: string,
  newStart: Date,
  newEnd: Date,
  existing: ExistingActivityLike[],
  now: Date = new Date()
): OverlapVerdict {
  const active: OverlapVerdict["active"] = [];
  const past: OverlapVerdict["past"] = [];
  for (const act of existing) {
    // Keanggotaan produk adalah tanggung jawab fungsi ini sendiri (defensif):
    // activity yang tidak memuat productId diabaikan apa pun status/waktunya.
    if (!act.productIds.has(productId)) continue;
    const statusActive = isActivePromotionStatus(act.status);
    const timeActive = act.endsAt.getTime() > now.getTime();
    if (!statusActive || !timeActive) {
      // Sudah berakhir (DEACTIVATED/ENDED/NOT_EFFECTIVE/EXPIRED) atau
      // status aktif tapi jadwalnya ternyata sudah lewat → riwayat saja.
      past.push({
        externalActivityId: act.externalActivityId,
        title: act.title,
        status: act.status,
      });
      continue;
    }
    const overlaps = act.startsAt < newEnd && act.endsAt > newStart;
    if (!overlaps) continue;
    const full = act.startsAt >= newStart && act.endsAt <= newEnd;
    active.push({
      externalActivityId: act.externalActivityId,
      title: act.title,
      status: act.status,
      overlapKind: full ? "FULL" : "PARTIAL",
    });
  }
  return { active, past };
}

/* ------------------------------ Waktu (dipakai /preview & /create) ------------------------------ */

/** Minimal lead time begin_time dari sekarang (kebijakan Maxius, review #5). */
export const MIN_LEAD_TIME_MS = 2 * 60 * 60 * 1000; // 2 jam
export const MAX_ACTIVITY_DAYS = 90;

/* ------------------------------ G4: konfirmasi eksplisit ------------------------------ */

/**
 * G4 type-to-confirm — kata WAJIB diketik user. Di-enforce DI ENDPOINT /create
 * (bukan cuma UI): panggilan langsung via curl tanpa confirmationWord yang
 * persis akan ditolak 400 sebelum menyentuh TikTok.
 */
export const CONFIRMATION_WORD = "BUAT";

/**
 * Cek G4 murni. null = lolos; non-null = pesan penolakan (400).
 * Ditaruh di policy agar /create & unit test memakai logika yang sama.
 */
export function validateConfirmation(word: unknown): string | null {
  if (typeof word !== "string" || word.trim() !== CONFIRMATION_WORD) {
    return `Konfirmasi wajib: ketik "${CONFIRMATION_WORD}" untuk membuat activity (G4).`;
  }
  return null;
}

/* ------------------------------ Kapasitas & judul ------------------------------ */

/** Batas API TikTok yang di-enforce (plan §1.2) — re-check server-side /create. */
export const MAX_PRODUCTS_PER_BATCH = 300;
/** Cap kebijakan Maxius per activity (plan §1.2) — sama dengan /preview. */
export const MAX_PRODUCTS_PER_ACTIVITY = 1000;
/** Batas panjang judul activity (plan §1.1). */
export const MAX_TITLE_LENGTH = 50;

export type CreateIssue =
  | { kind: "TITLE_REQUIRED" }
  | { kind: "TITLE_TOO_LONG"; maxLength: number }
  | { kind: "TOO_MANY_PRODUCTS"; max: number }
  | { kind: "BATCH_SIZE_EXCEEDED"; max: number };

/**
 * Validasi struktur create (judul bila diisi manual, jumlah produk).
 * title undefined = akan digenerate otomatis di service → tidak divalidasi di sini.
 * Murni — bagian dari re-check server-side di /create.
 */
export function validateCreateInput(input: {
  title?: unknown;
  productCount: number;
}): CreateIssue | null {
  if (input.title !== undefined) {
    if (typeof input.title !== "string" || input.title.trim().length === 0) {
      return { kind: "TITLE_REQUIRED" };
    }
    if (input.title.length > MAX_TITLE_LENGTH) {
      return { kind: "TITLE_TOO_LONG", maxLength: MAX_TITLE_LENGTH };
    }
  }
  if (
    !Number.isInteger(input.productCount) ||
    input.productCount < 1 ||
    input.productCount > MAX_PRODUCTS_PER_ACTIVITY
  ) {
    return { kind: "TOO_MANY_PRODUCTS", max: MAX_PRODUCTS_PER_ACTIVITY };
  }
  return null;
}

/**
 * Judul HARUS unik antar semua activity (aturan praktis TikTok, plan §1.1).
 * Fmt: [seed bersih] yyyymmdd-hhmmss — collision < 1 detik dipecahkan suffix acak.
 * Uniqueness final tetap dicek terhadap DB lokal di service (judul activity di
 * TikTok bisa lebih banyak dari yang ter-ingest di Maxius).
 */
export function generateActivityTitle(seed: string, now: Date = new Date()): string {
  const safe = seed.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 24) || "Promo";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const base = `${safe} ${stamp}`.slice(0, 50);
  return base.length + 5 > MAX_TITLE_LENGTH ? base.slice(0, MAX_TITLE_LENGTH - 6) : base;
}

export type ScheduleIssue =
  | { kind: "LEAD_TIME_TOO_SHORT"; minHours: number }
  | { kind: "END_BEFORE_START" }
  | { kind: "TOO_LONG"; maxDays: number };

/** Validasi jadwal; begin di masa depan >= +2 jam, end > begin, maks 90 hari. */
export function validateSchedule(begin: Date, end: Date, now: Date = new Date()): ScheduleIssue | null {
  if (begin.getTime() - now.getTime() < MIN_LEAD_TIME_MS) {
    return { kind: "LEAD_TIME_TOO_SHORT", minHours: MIN_LEAD_TIME_MS / 3600000 };
  }
  if (end.getTime() <= begin.getTime()) return { kind: "END_BEFORE_START" };
  if (end.getTime() - begin.getTime() > MAX_ACTIVITY_DAYS * 86400000) {
    return { kind: "TOO_LONG", maxDays: MAX_ACTIVITY_DAYS };
  }
  return null;
}
