/**
 * SERVICE /create — fitur promotion WRITE: orkestrasi create DIRECT_DISCOUNT.
 *
 * URUTAN WAJIB (permintaan reviewer Tahap 3):
 * 1. Re-validasi server-side G1–G4 (jangan percaya input client walau sudah
 *    lewat /preview — payload bisa dipanggil langsung via curl).
 * 2. Tulis audit PENDING ke DB Maxius SEBELUM panggilan TikTok pertama —
 *    bila proses crash di tengah, tetap ada jejak "sedang mencoba create X".
 * 3. Call TikTok: create activity (tanpa produk) → attach per batch ≤300.
 * 4. G5: konfirmasi Get by ID → cocokkan → audit di-update final.
 *
 * Status akhir audit: SUCCESS | TIKTOK_ERROR | UNVERIFIED | PARTIAL.
 * UNVERIFIED = remote state tidak bisa dipastikan (attach gagal / Get by ID
 * gagal / tidak cocok) → WAJIB memicu alert admin (lihat lib/services/
 * promotion-alert.service.ts), bukan SUCCESS palsu.
 */
import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import {
  MAX_PRODUCTS_PER_BATCH,
  computePriceRow,
  classifyOverlap,
  extremeDiscountConfirmMessage,
  generateActivityTitle,
  validateConfirmation,
  validateCreateInput,
  validateDiscount,
  validateSchedule,
  type ExistingActivityLike,
} from "@/lib/services/promotion-write.policy";
import {
  createPromotionActivity,
  getPromotionActivity,
  updatePromotionActivityProducts,
} from "@/lib/integrations/tiktokShop";

/** Bentuk client TikTok yang dipakai service — supaya integration test bisa
 *  meng-inject fake TANPA mock module (DB tetap asli). */
export type PromotionTikTokClient = {
  create: typeof createPromotionActivity;
  attach: typeof updatePromotionActivityProducts;
  getById: typeof getPromotionActivity;
};

/** Default: integrasi asli. Integration test meng-inject fake via opsi client. */
const defaultClient: PromotionTikTokClient = {
  create: createPromotionActivity,
  attach: updatePromotionActivityProducts,
  getById: getPromotionActivity,
};

export type CreatePromotionRequest = {
  accountId: string;
  userId: string;
  username: string;
  mappingIds: string[];
  discountByMappingId: Record<string, number>;
  /** ISO string dari UI. */
  beginAt: string;
  endAt: string;
  /** G4: kata konfirmasi yang diketik user — divalidasi DI SERVER. */
  confirmationWord: string;
  /** Kosong = digenerate otomatis (unik, ≤50 char). */
  title?: string;
  /** G2: wajib true bila ada diskon 0% / >=96% (checkbox konfirmasi dampak). */
  confirmExtreme?: boolean;
  /** G3: wajib true bila ada overlap AKTIF (checkbox "tetap lanjutkan"). */
  acknowledgeActiveOverlap?: boolean;
};

export type CreatePromotionResult =
  | {
      ok: false;
      /** Ditolak sebelum audit PENDING dibuat / sebelum call TikTok. */
      rejected: true;
      error: string;
      /** Detail per-baris bila ditolak oleh G1 (harga) — utk feedback UI. */
      itemErrors?: Array<{ mappingId: string; error: string }>;
    }
  | {
      ok: true;
      auditLogId: string;
      externalActivityId: string | null;
      title: string;
      resultStatus: "SUCCESS" | "TIKTOK_ERROR" | "UNVERIFIED" | "PARTIAL";
      /** Verifikasi G5 gagal / tidak cocok → WAJIB cek manual + alert sudah dibuat. */
      unverifiedReason?: string;
      attachedCount: number;
      failedBatches: Array<{ batchIndex: number; error: string }>;
      tiktokCode: number | null;
      tiktokMessage: string | null;
      requestId: string | null;
      /** Ringkasan harga final per produk (G1) — konfirmasi UI pasca-create. */
      items: Array<{ mappingId: string; displayName: string; discount: number; priceBefore: number; priceAfter: number }>;
      /** Muncul bila ada produk konflik overlap AKTIF yang di-override user. */
      overlapWarningAcknowledged: boolean;
    };

type RevalidatedProduct = {
  mappingId: string;
  platformProductId: string;
  displayName: string;
  discount: number;
  priceBefore: number;
  priceAfter: number;
};

function extractError(error: unknown): { code: number; message: string; requestId: string } {
  if (error && typeof error === "object" && "code" in error && "requestId" in error) {
    const e = error as { code: unknown; requestId: unknown; message?: unknown };
    if (typeof e.code === "number") {
      return {
        code: e.code,
        message: typeof e.message === "string" ? e.message : String(error),
        requestId: typeof e.requestId === "string" ? e.requestId : "-",
      };
    }
  }
  return { code: 0, message: error instanceof Error ? error.message : String(error), requestId: "-" };
}

/**
 * G4 server-side: null = lolos; non-null = pesan 400. Wrapper tipis di atas
 * policy validateConfirmation agar /create & unit test memakai logika sama.
 */
export function checkG4Confirmation(confirmationWord: unknown): string | null {
  return validateConfirmation(confirmationWord);
}

/**
 * Re-validasi server-side G1–G3 terhadap DB (jangan percaya client):
 * - G1: harga sumber wajib ada & final bisa dihitung; diskon wajib terisi valid.
 * - G2: angka 1–95 OK; 0/>=96 TANPA confirmExtreme=true → ditolak di sini
 *   (preview hanya menampilkan warning; keputusan final di /create).
 * - G3: overlap AKTIF (ONGOING/NOT_START + jendela tumpang tindih) harus
 *   disertai acknowledgeActiveOverlap=true dari user.
 * Mengembalikan peta produk siap-attach bila SEMUA lolos; null + alasan bila tidak.
 */
export async function revalidateForCreate(req: CreatePromotionRequest): Promise<
  | { ok: true; beginAt: Date; endAt: Date; products: RevalidatedProduct[]; overlapCount: number }
  | { ok: false; error: string; itemErrors?: Array<{ mappingId: string; error: string }> }
> {
  if (!req.accountId || !Array.isArray(req.mappingIds) || req.mappingIds.length === 0) {
    return { ok: false, error: "accountId dan mappingIds wajib diisi." };
  }
  if (req.mappingIds.length > 1000) {
    return { ok: false, error: "Maksimum 1.000 produk per activity (batas kebijakan Maxius)." };
  }

  const beginAt = new Date(req.beginAt);
  const endAt = new Date(req.endAt);
  if (Number.isNaN(beginAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { ok: false, error: "beginAt/endAt wajib tanggal valid." };
  }
  const scheduleIssue = validateSchedule(beginAt, endAt);
  if (scheduleIssue) {
    return { ok: false, error: `Jadwal tidak valid: ${scheduleIssue.kind}.` };
  }

  const structureIssue = validateCreateInput({
    title: req.title,
    productCount: req.mappingIds.length,
  });
  if (structureIssue) {
    return { ok: false, error: `Input create tidak valid: ${structureIssue.kind}.` };
  }

  const mappings = await prisma.productMapping.findMany({
    where: { id: { in: req.mappingIds }, accountId: req.accountId },
    select: {
      id: true,
      channelSku: true,
      platformProductId: true,
      platformTitle: true,
      price: true,
      variant: { select: { name: true, price: true, masterProduct: { select: { name: true } } } },
    },
  });
  const mappingById = new Map(mappings.map((m) => [m.id, m]));

  // G3: kandidat overlap AKTIF milik account yang sama (window belum lewat).
  const candidates = await prisma.promotionActivity.findMany({
    where: {
      accountId: req.accountId,
      status: { in: ["ONGOING", "NOT_START"] },
      endsAt: { gt: new Date() },
    },
    select: {
      externalActivityId: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      items: { select: { platformProductId: true } },
    },
  });
  const byProduct = new Map<string, ExistingActivityLike[]>();
  for (const act of candidates) {
    const productIds = new Set(act.items.map((i) => i.platformProductId));
    for (const pid of productIds) {
      const list = byProduct.get(pid) ?? [];
      list.push({
        externalActivityId: act.externalActivityId,
        title: act.title,
        status: act.status,
        startsAt: act.startsAt,
        endsAt: act.endsAt,
        productIds,
      });
      byProduct.set(pid, list);
    }
  }

  const products: RevalidatedProduct[] = [];
  const itemErrors: Array<{ mappingId: string; error: string }> = [];
  const conflictingProducts: string[] = [];

  for (const mappingId of req.mappingIds) {
    const mapping = mappingById.get(mappingId);
    if (!mapping) {
      itemErrors.push({ mappingId, error: "Mapping tidak ditemukan / bukan milik toko ini." });
      continue;
    }
    const discount = req.discountByMappingId[mappingId];
    if (typeof discount !== "number" || !Number.isFinite(discount) || !Number.isInteger(discount)) {
      itemErrors.push({ mappingId, error: "Diskon belum diisi / bukan bilangan bulat." });
      continue;
    }
    // G2 ketat di /create: EXTREME hanya lolos bila req.confirmExtreme=true
    // (preview hanya memunculkan warning; keputusan final di sini).
    const discountIssue = validateDiscount(discount, req.confirmExtreme === true);
    if (discountIssue) {
      if (discountIssue.kind === "EXTREME_DISCOUNT") {
        itemErrors.push({
          mappingId,
          error: `Diskon ${discount}% butuh konfirmasi dampak eksplisit: ${extremeDiscountConfirmMessage(
            mapping.platformTitle ?? mapping.variant.masterProduct.name,
            discount,
            Math.round(((mapping.price ?? mapping.variant.price ?? 0) * (100 - discount)) / 100)
          )}`,
        });
      } else {
        itemErrors.push({ mappingId, error: `Diskon ${discount}% tidak valid (harus bilangan bulat 1–100, tanpa konfirmasi di luar kebijakan).` });
      }
      continue;
    }
    const price = mapping.price != null ? mapping.price : mapping.variant.price != null ? mapping.variant.price : null;
    const row = computePriceRow(
      {
        price,
        priceSource:
          mapping.price != null
            ? "MAPPING_OVERRIDE"
            : mapping.variant.price != null
              ? "VARIANT_DEFAULT"
              : null,
        displayName: mapping.platformTitle ?? mapping.variant.masterProduct.name,
        channelSku: mapping.channelSku,
        platformProductId: mapping.platformProductId,
      },
      discount
    );
    if (row.error || row.finalPrice === null || !mapping.platformProductId) {
      itemErrors.push({ mappingId, error: row.error ?? "Produk tidak punya platformProductId (belum ter-sync ke TikTok)." });
      continue;
    }
    const verdict = classifyOverlap(mapping.platformProductId, beginAt, endAt, byProduct.get(mapping.platformProductId) ?? []);
    if (verdict.active.length > 0) {
      conflictingProducts.push(mapping.platformProductId);
    }
    products.push({
      mappingId,
      platformProductId: mapping.platformProductId,
      displayName: row.input.displayName ?? row.input.channelSku,
      discount,
      priceBefore: row.input.price ?? 0,
      priceAfter: row.finalPrice,
    });
  }

  if (conflictingProducts.length > 0 && !req.acknowledgeActiveOverlap) {
    return {
      ok: false,
      error: `${conflictingProducts.length} produk masih ikut activity AKTIF lain (G3). Hapus produk konflik atau centang konfirmasi lanjut.`,
      itemErrors,
    };
  }

  if (itemErrors.length > 0) {
    return { ok: false, error: "Ada produk yang ditolak guardrail.", itemErrors };
  }
  return { ok: true, beginAt, endAt, products, overlapCount: conflictingProducts.length };
}

/**
 * Orkestrasi create (SATU transaksi logika, BUKAN DB transaction):
 * validasi ulang → audit PENDING → create → attach batch → G5 → audit final.
 */
export async function createPromotion(
  req: CreatePromotionRequest,
  opts: { client?: PromotionTikTokClient } = {}
): Promise<CreatePromotionResult> {
  const client = opts.client ?? defaultClient;

  // ── G4: kata konfirmasi dicek paling awal (curl tanpa "BUAT" berhenti di sini).
  const g4Error = checkG4Confirmation(req.confirmationWord);
  if (g4Error) return { ok: false, rejected: true, error: g4Error };

  // ── Re-validasi G1–G3 server-side (DB asli, bukan input client).
  const revalidated = await revalidateForCreate(req);
  if (!revalidated.ok) {
    return { ok: false, rejected: true, error: revalidated.error, itemErrors: revalidated.itemErrors };
  }
  const { beginAt, endAt, products, overlapCount } = revalidated;

  // ── Judul: user-provided (divalidasi struktur) atau generate + cek unik lokal.
  let title = req.title?.trim() || generateActivityTitleLocal(products[0]?.displayName ?? "Promo");
  const titleTaken = await prisma.promotionActivity.findFirst({
    where: { accountId: req.accountId, title },
    select: { id: true },
  });
  if (titleTaken) title = generateUniqueTitle(title);

  const beginEpoch = Math.floor(beginAt.getTime() / 1000);
  const endEpoch = Math.floor(endAt.getTime() / 1000);
  const payloadSent = JSON.stringify({
    activity_type: "DIRECT_DISCOUNT",
    title,
    product_level: "PRODUCT",
    begin_time: beginEpoch,
    end_time: endEpoch,
    products: products.map((p) => ({ id: p.platformProductId, discount: String(p.discount) })),
  });

  // ── AUDIT PENDING — SEBELUM panggilan TikTok pertama (permintaan reviewer):
  // crash di tengah tetap meninggalkan jejak intent yang bisa dilihat admin.
  const audit = await prisma.promotionAuditLog.create({
    data: {
      id: crypto.randomUUID(),
      accountId: req.accountId,
      userId: req.userId,
      username: req.username,
      action: "CREATE_ACTIVITY",
      activityTitle: title,
      payloadSent,
      resultStatus: "PENDING",
      itemsBefore: JSON.stringify(products.map((p) => ({ productId: p.platformProductId, discount: p.discount, priceBefore: p.priceBefore }))),
      updatedAt: new Date(),
    },
  });

  // ── Call TikTok: create activity (tanpa produk).
  const account = await prisma.platformAccount.findUnique({
    where: { id: req.accountId },
    select: { accessToken: true, shopCipher: true },
  });
  if (!account?.accessToken || !account.shopCipher) {
    const error = "Akun belum terhubung ke TikTok Shop (token/shop_cipher kosong).";
    await prisma.promotionAuditLog.update({
      where: { id: audit.id },
      data: { resultStatus: "TIKTOK_ERROR", tiktokCode: 0, tiktokMessage: error, requestId: "-" },
    });
    return { ok: false, rejected: true, error };
  }

  let externalActivityId: string | null = null;
  let finalStatus: "SUCCESS" | "TIKTOK_ERROR" | "UNVERIFIED" | "PARTIAL" = "SUCCESS";
  let unverifiedReason: string | undefined;
  const failedBatches: Array<{ batchIndex: number; error: string }> = [];

  try {
    const created = await client.create(account.accessToken, account.shopCipher, {
      activityType: "DIRECT_DISCOUNT",
      title,
      productLevel: "PRODUCT",
      beginTime: beginEpoch,
      endTime: endEpoch,
    });
    externalActivityId = created.activityId;
    if (!externalActivityId) {
      finalStatus = "UNVERIFIED";
      unverifiedReason = "Create sukses menurut response tapi activity_id kosong.";
    }

    await prisma.promotionAuditLog.update({
      where: { id: audit.id },
      data: { externalActivityId },
    });

    // ── Attach per batch ≤300 (angka diskon hidup di attach, plan §1.1/§1.2).
    let attachedCount = 0;
    const batchCount = Math.ceil(products.length / MAX_PRODUCTS_PER_BATCH);
    if (externalActivityId) {
      for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
        const batch = products.slice(batchIndex * MAX_PRODUCTS_PER_BATCH, (batchIndex + 1) * MAX_PRODUCTS_PER_BATCH);
        try {
          await client.attach(
            account.accessToken,
            account.shopCipher,
            externalActivityId,
            batch.map((p) => ({ id: p.platformProductId, discount: String(p.discount) }))
          );
          attachedCount += batch.length;
          await prisma.promotionAuditLog.update({
            where: { id: audit.id },
            data: { batchIndex: batchIndex + 1, batchTotal: batchCount },
          });
        } catch (error) {
          const info = extractError(error);
          failedBatches.push({ batchIndex: batchIndex + 1, error: info.message });
          if (batchIndex === 0) {
            // Attach pertama gagal = activity kosong tersisa di TikTok (plan §1.1) —
            // tidak bisa dipastikan state remote → UNVERIFIED (bukan SUCCESS palsu).
            finalStatus = "UNVERIFIED";
            unverifiedReason = `Attach batch pertama gagal: ${info.message} — activity kosong mungkin sudah terbentuk.`;
          } else {
            finalStatus = "PARTIAL";
            unverifiedReason = `Batch ${batchIndex + 1}/${batchCount} gagal: ${info.message}`;
          }
        }
      }
    } else {
      finalStatus = "UNVERIFIED";
      unverifiedReason = unverifiedReason ?? "activity_id tidak tersedia — attach tidak bisa dijalankan.";
    }

    // ── G5: konfirmasi Get by ID — WAJIB sebelum boleh dianggap sukses.
    if (externalActivityId && finalStatus === "SUCCESS") {
      try {
        const remote = await client.getById(account.accessToken, account.shopCipher, externalActivityId);
        const data = (remote.data ?? {}) as Record<string, unknown>;
        const remoteStatus = typeof data.status === "string" ? data.status : null;
        const remoteBegin = typeof data.begin_time === "number" ? data.begin_time : null;
        const remoteEnd = typeof data.end_time === "number" ? data.end_time : null;
        const matches =
          remoteStatus !== null &&
          remoteBegin === beginEpoch &&
          remoteEnd === endEpoch;
        if (!matches) {
          finalStatus = "UNVERIFIED";
          unverifiedReason = `Get by ID tidak cocok (status=${remoteStatus ?? "?"}, begin=${remoteBegin ?? "?"}, end=${remoteEnd ?? "?"}).`;
        }
      } catch (error) {
        const info = extractError(error);
        finalStatus = "UNVERIFIED";
        unverifiedReason = `Get by ID gagal: ${info.message}`;
      }
    }

    // ── Audit final — update baris PENDING yang sama (bukan create baru).
    await prisma.promotionAuditLog.update({
      where: { id: audit.id },
      data: {
        resultStatus: finalStatus,
        tiktokMessage: unverifiedReason ?? null,
        itemsAfter: JSON.stringify(
          products.map((p) => ({ productId: p.platformProductId, discount: p.discount, priceAfter: p.priceAfter }))
        ),
        batchIndex: batchCount,
        batchTotal: batchCount,
      },
    });

    return {
      ok: true,
      auditLogId: audit.id,
      externalActivityId,
      title,
      resultStatus: finalStatus,
      unverifiedReason,
      attachedCount,
      failedBatches,
      tiktokCode: null,
      tiktokMessage: unverifiedReason ?? null,
      requestId: null,
      items: products.map((p) => ({
        mappingId: p.mappingId,
        displayName: p.displayName,
        discount: p.discount,
        priceBefore: p.priceBefore,
        priceAfter: p.priceAfter,
      })),
      overlapWarningAcknowledged: overlapCount > 0,
    };
  } catch (error) {
    // Create call itu sendiri melempar → status remote TIDAK DIKETAHUI
    // (activity bisa saja terbentuk) → UNVERIFIED, bukan sekadar TIKTOK_ERROR.
    const info = extractError(error);
    await prisma.promotionAuditLog.update({
      where: { id: audit.id },
      data: {
        resultStatus: "UNVERIFIED",
        tiktokCode: info.code,
        tiktokMessage: info.message,
        requestId: info.requestId,
      },
    });
    return {
      ok: true,
      auditLogId: audit.id,
      externalActivityId: null,
      title,
      resultStatus: "UNVERIFIED",
      unverifiedReason: `Create call gagal: ${info.message} — status remote tidak diketahui, cek TikTok Seller Center.`,
      attachedCount: 0,
      failedBatches: [],
      tiktokCode: info.code,
      tiktokMessage: info.message,
      requestId: info.requestId,
      items: [],
      overlapWarningAcknowledged: false,
    };
  }
}

function generateActivityTitleLocal(seed: string): string {
  return generateActivityTitle(seed);
}

function generateUniqueTitle(base: string): string {
  return `${base.slice(0, 44)} ${Math.random().toString(36).slice(2, 7)}`;
}
