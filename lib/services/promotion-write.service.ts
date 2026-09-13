/**
 * SERVICE /preview — fitur promotion WRITE, tahap hitung TANPA EFEK SAMPING.
 *
 * JAMINAN KETAT (permintaan reviewer):
 * - TIDAK ada write ke DB Maxius (hanya findMany/findUnique) — baris audit
 *   PENDING pun TIDAK ditulis di sini (audit hanya di endpoint /create).
 * - TIDAK ada panggilan ke TikTok API sama sekali (bukan sekadar tidak-write —
 *   tidak ada call apa pun; data overlap diambil dari tabel lokal hasil ingest).
 * - Murni: baca harga & activity tersimpan → hitung → kembalikan hasil.
 *
 * Prinsip G1: produk tanpa harga sumber tidak bisa dipreview → ditandai error
 * dan HARUS dikeluarkan dari submit (di-enforce ulang di /create).
 */
import { prisma } from "@/lib/db/prisma";
import {
  classifyOverlap,
  computePriceRow,
  type ExistingActivityLike,
  type PriceRow,
} from "@/lib/services/promotion-write.policy";

export type PreviewRequest = {
  accountId: string;
  /** ProductMapping.id yang dipilih user (listing ter-mapping di Maxius). */
  mappingIds: string[];
  /** Persen diskon per mapping (key = mappingId). Iterasi 1: per-baris, satu nilai. */
  discountByMappingId: Record<string, number>;
  beginAt: Date;
  endAt: Date;
};

export type PreviewResultItem = PriceRow & {
  mappingId: string;
  masterProductName: string | null;
  variantName: string | null;
  /** Ringkasan overlap AKTIF utk baris ini (kosong = aman). */
  activeOverlaps: Array<{
    externalActivityId: string;
    title: string;
    status: string;
    overlapKind: "FULL" | "PARTIAL";
  }>;
  /** Activity lama yang sudah berakhir — info riwayat, tidak memblock. */
  pastOverlaps: Array<{ externalActivityId: string; title: string; status: string }>;
};

export type PreviewResult = {
  items: PreviewResultItem[];
  /** Ada baris ditolak (tanpa harga) → submit tidak boleh lanjut. */
  hasBlockingError: boolean;
  /** Ada overlap AKTIF → warn + block-by-default (boleh di-override user). */
  hasActiveOverlap: boolean;
  activityCountScanned: number;
};

/**
 * Hitung preview per produk. Read-only total: 2 findMany (mapping + activity).
 * Overlap memakai DB lokal (PromotionActivity tersimpan dari ingest); catatan
 * jujur di UI: data bisa basi — penolakan final tetap dari TikTok saat attach.
 */
export async function previewPromotion(req: PreviewRequest): Promise<PreviewResult> {
  const mappings = await prisma.productMapping.findMany({
    where: { id: { in: req.mappingIds }, accountId: req.accountId },
    select: {
      id: true,
      channelSku: true,
      platformProductId: true,
      platformTitle: true,
      price: true,
      variant: {
        select: {
          name: true,
          price: true,
          masterProduct: { select: { name: true } },
        },
      },
    },
  });
  const mappingById = new Map(mappings.map((m) => [m.id, m]));

  // Kandidat overlap: activity AKTIF (ONGOING/NOT_START) milik account yang
  // sama yang waktunya belum lewat, beserta item produknya. Window filter
  // longgar di query; klasifikasi tegas (aktif vs berakhir, FULL/PARTIAL)
  // dilakukan policy murni — konsisten dengan unit test.
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

  const items: PreviewResultItem[] = [];
  let hasBlockingError = false;
  let hasActiveOverlap = false;

  for (const mappingId of req.mappingIds) {
    const mapping = mappingById.get(mappingId);
    if (!mapping) {
      hasBlockingError = true;
      items.push({
        mappingId,
        input: {
          price: null,
          priceSource: null,
          displayName: null,
          channelSku: "(mapping tidak ditemukan)",
          platformProductId: null,
        },
        finalPrice: null,
        error: "Mapping tidak ditemukan / bukan milik toko ini.",
        masterProductName: null,
        variantName: null,
        activeOverlaps: [],
        pastOverlaps: [],
      });
      continue;
    }

    const discount = req.discountByMappingId[mappingId];
    if (typeof discount !== "number" || !Number.isFinite(discount)) {
      hasBlockingError = true;
      items.push({
        mappingId,
        input: {
          price: mapping.price ?? mapping.variant.price ?? null,
          priceSource: mapping.price != null ? "MAPPING_OVERRIDE" : mapping.variant.price != null ? "VARIANT_DEFAULT" : null,
          displayName: mapping.platformTitle ?? mapping.variant.masterProduct.name,
          channelSku: mapping.channelSku,
          platformProductId: mapping.platformProductId,
        },
        finalPrice: null,
        error: "Diskon belum diisi untuk produk ini.",
        masterProductName: mapping.variant.masterProduct.name,
        variantName: mapping.variant.name,
        activeOverlaps: [],
        pastOverlaps: [],
      });
      continue;
    }

    const price =
      mapping.price != null ? mapping.price : mapping.variant.price != null ? mapping.variant.price : null;
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
    if (row.error) hasBlockingError = true;

    // G3: hanya AKTIF yang menghasilkan overlap warn. Activity BERAKHIR tidak
    // memblock produk — kumpulkan sebagai riwayat bila ada di data lokal.
    const pid = mapping.platformProductId;
    let activeOverlaps: PreviewResultItem["activeOverlaps"] = [];
    let pastOverlaps: PreviewResultItem["pastOverlaps"] = [];
    if (pid && row.finalPrice !== null) {
      const allForProduct = byProduct.get(pid) ?? [];
      const verdict = classifyOverlap(pid, req.beginAt, req.endAt, allForProduct);
      activeOverlaps = verdict.active;
      pastOverlaps = verdict.past;
      if (verdict.active.length > 0) hasActiveOverlap = true;
    }

    items.push({
      mappingId,
      input: row.input,
      finalPrice: row.finalPrice,
      error: row.error,
      masterProductName: mapping.variant.masterProduct.name,
      variantName: mapping.variant.name,
      activeOverlaps,
      pastOverlaps,
    });
  }

  return {
    items,
    hasBlockingError,
    hasActiveOverlap,
    activityCountScanned: candidates.length,
  };
}
