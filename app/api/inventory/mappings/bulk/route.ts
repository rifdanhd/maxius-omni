import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";
import { STOCK_REASONS } from "@/lib/services/central-stock.service";

interface BulkSkuItem {
  skuId: string;
  sellerSku?: string | null;
  skuName?: string | null;
  stock?: number;
  price?: number | null;
  imageUrl?: string | null;
}

interface BulkProductItem {
  platformProductId: string;
  title: string;
  imageUrl?: string | null;
  skus: BulkSkuItem[];
}

interface BulkMappingPayload {
  accountId: string;
  mode?: "create-master" | "map-existing";
  products?: BulkProductItem[];
  mappings?: Array<{
    channelSku: string;
    sellerSku?: string | null;
    variantId: string;
  }>;
}

/**
 * POST /api/inventory/mappings/bulk
 * Mapping massal langsung per produk / banyak produk sekaligus:
 * 1. mode "create-master" (default): Buat MasterProduct baru + seluruh variannya
 *    di stok pusat, lalu langsung petakan channelSku TikTok ke varian masing-masing.
 * 2. mode "map-existing": Petakan banyak channelSku sekaligus ke variantId yang ditentukan.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  try {
    const body = (await req.json().catch(() => ({}))) as BulkMappingPayload;
    const accountId = body.accountId?.trim();

    if (!accountId) {
      return NextResponse.json({ error: "Toko (accountId) wajib dipilih." }, { status: 400 });
    }

    const account = await prisma.platformAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return NextResponse.json({ error: "Toko tidak ditemukan." }, { status: 404 });
    }

    try {
      assertSameBrand(account.businessId, req.businessId);
    } catch {
      return NextResponse.json({ error: "Toko tidak ditemukan." }, { status: 404 });
    }

    const settings = await getCachedInventorySettings(req.businessId);

    // -------------------------------------------------------------
    // Mode 1: Buat Produk Master Baru dari Produk TikTok (Semua Varian)
    // -------------------------------------------------------------
    if (body.products && body.products.length > 0) {
      let createdMastersCount = 0;
      let createdVariantsCount = 0;
      let mappedSkusCount = 0;

      await prisma.$transaction(async (tx) => {
        for (const prod of body.products!) {
          const title = prod.title?.trim() || `Produk TikTok ${prod.platformProductId}`;
          const mainImage = prod.imageUrl?.trim() || null;

          // 1. Buat Master Product baru
          const master = await tx.masterProduct.create({
            data: {
              name: title,
              businessId: req.businessId,
              threshold: settings.lowStockDefaultThreshold,
              ...(mainImage ? { imageUrl: mainImage } : {}),
            },
          });
          createdMastersCount++;

          if (mainImage) {
            await tx.productImage.create({
              data: {
                id: crypto.randomUUID(),
                updatedAt: new Date(),
                masterProductId: master.id,
                url: mainImage,
                isCover: true,
                order: 0,
              },
            });
          }

          // 2. Buat seluruh varian di bawah master & hubungkan mapping
          const usedSkus = new Set<string>();
          for (const s of prod.skus) {
            const channelSku = s.skuId?.trim() || s.sellerSku?.trim();
            if (!channelSku) continue;

            // Buat SKU lokal yang unik & rapi
            let localSku =
              s.sellerSku?.trim() ||
              (s.skuName?.trim()
                ? `${title.slice(0, 15).trim()}-${s.skuName.trim()}`
                : `${channelSku}`);

            if (usedSkus.has(localSku)) {
              localSku = `${localSku}-${s.skuId.slice(-4)}`;
            }
            usedSkus.add(localSku);

            const stockNum = Math.max(0, Math.floor(Number(s.stock) || 0));
            const priceNum = Number.isFinite(Number(s.price)) && Number(s.price) >= 0 ? Number(s.price) : null;

            const variant = await tx.productVariant.create({
              data: {
                sku: localSku,
                stock: stockNum,
                safetyStock: 0,
                ...(priceNum !== null ? { price: priceNum, priceUpdatedAt: new Date() } : {}),
                masterProductId: master.id,
              },
            });
            createdVariantsCount++;

            // Catat saldo awal stok
            await tx.stockLedger.create({
              data: {
                id: crypto.randomUUID(),
                variantId: variant.id,
                changeQty: stockNum,
                reason: STOCK_REASONS.INIT,
                note: `Stok awal impor katalog TikTok (${title})`,
                stockAfter: stockNum,
              },
            });

            // Petakan channelSku ke varian baru ini
            await tx.productMapping.upsert({
              where: { accountId_channelSku: { accountId, channelSku } },
              create: {
                id: crypto.randomUUID(),
                accountId,
                channelSku,
                sellerSku: s.sellerSku?.trim() || null,
                variantId: variant.id,
                platformSkuId: s.skuId || null,
                platformProductId: prod.platformProductId,
                platformTitle: title,
                platformStock: stockNum,
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
              },
              update: {
                variantId: variant.id,
                sellerSku: s.sellerSku?.trim() || null,
                platformSkuId: s.skuId || null,
                platformProductId: prod.platformProductId,
                platformTitle: title,
                platformStock: stockNum,
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
              },
            });
            mappedSkusCount++;

            // Buat event stockOutbox
            await tx.stockOutbox.create({
              data: {
                id: crypto.randomUUID(),
                businessId: req.businessId,
                variantId: variant.id,
                eventKey: `bulk-map:${variant.id}:${crypto.randomUUID()}`,
              },
            });
          }
        }
      });

      return NextResponse.json({
        ok: true,
        message: `Berhasil membuat ${createdMastersCount} produk master dengan ${createdVariantsCount} varian dan menghubungkan ${mappedSkusCount} SKU.`,
        createdMastersCount,
        createdVariantsCount,
        mappedSkusCount,
      });
    }

    // -------------------------------------------------------------
    // Mode 2: Petakan Banyak Varian Sekaligus ke Varian Yang Ditentukan
    // -------------------------------------------------------------
    if (body.mappings && body.mappings.length > 0) {
      let mappedCount = 0;
      await prisma.$transaction(async (tx) => {
        for (const m of body.mappings!) {
          const channelSku = m.channelSku?.trim();
          const variantId = m.variantId?.trim();
          if (!channelSku || !variantId) continue;

          await tx.productMapping.upsert({
            where: { accountId_channelSku: { accountId, channelSku } },
            create: {
              id: crypto.randomUUID(),
              accountId,
              channelSku,
              sellerSku: m.sellerSku?.trim() || null,
              variantId,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
            update: {
              variantId,
              sellerSku: m.sellerSku?.trim() || null,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          });
          mappedCount++;

          await tx.stockOutbox.create({
            data: {
              id: crypto.randomUUID(),
              businessId: req.businessId,
              variantId,
              eventKey: `bulk-map-single:${variantId}:${crypto.randomUUID()}`,
            },
          });
        }
      });

      return NextResponse.json({
        ok: true,
        message: `Berhasil menghubungkan ${mappedCount} SKU ke stok pusat.`,
        mappedCount,
      });
    }

    return NextResponse.json({ error: "Pilih produk atau varian untuk di-mapping." }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Terjadi kesalahan saat memproses mapping massal.";
    console.error("[bulkMapping error]", error);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
});
