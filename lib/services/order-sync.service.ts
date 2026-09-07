import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { getOrders } from "@/lib/integrations/tiktokShop";
import { encryptPii } from "@/lib/services/crypto.service";

type PrismaLike = typeof defaultPrisma;

type LineItemRaw = {
  id?: string;
  product_id?: string;
  seller_sku?: string;
  sku_id?: string;
  sku_image?: string;
  sale_price?: string | number;
  original_price?: string | number;
  sku_name?: string;
  product_name?: string;
  package_id?: string;
  display_status?: string;
};

type RecipientAddressRaw = {
  name?: string;
  phone_number?: string;
  full_address?: string;
};

type OrderRaw = {
  id?: string;
  status?: string;
  buyer_nickname?: string;
  buyer_email?: string;
  buyer_message?: string;
  payment_method_name?: string;
  is_cod?: boolean;
  create_time?: number;
  paid_time?: number;
  update_time?: number;
  shipping_due_time?: number;
  rts_sla_time?: number;
  tts_sla_time?: number;
  recommended_shipping_time?: number;
  recipient_address?: RecipientAddressRaw | null;
  line_items?: LineItemRaw[];
  packages?: Array<Record<string, unknown>>;
  payment?: Record<string, string | number> | null;
};

function toNumber(v: string | number | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate(epochSec: number | undefined): Date | null {
  if (!epochSec) return null;
  const ms = epochSec * 1000;
  // Sandbox TikTok mengirim sentinel "tanpa nilai" (max uint64 → tahun ~58657).
  // Jangan simpan politan invalid; capaian tahun antara 2000–2100 saja yang sah.
  if (ms <= 0 || ms > new Date("2100-01-01T00:00:00Z").getTime()) return null;
  try {
    return new Date(ms);
  } catch {
    return null;
  }
}

/**
 * resolveVariantId — hubungkan channelSku (sku_id produk TikTok) ke varian
 * via ProductMapping akun ini. Null bila belum di-mapping (SKU boleh kosong;
 * line item tetap disimpan dengan identifier eksternal product_id/sku_id).
 */
async function resolveVariantId(
  prisma: PrismaLike,
  accountId: string,
  channelSku: string
): Promise<string | null> {
  if (!channelSku) return null;
  const mapping = await prisma.productMapping.findUnique({
    where: { accountId_channelSku: { accountId, channelSku } },
    select: { variantId: true },
  });
  return mapping?.variantId ?? null;
}

/** Persiapkan field PII dari recipient_address: nama polos, HP & alamat terenkripsi. */
function parseRecipient(recipient?: RecipientAddressRaw | null) {
  const name = recipient?.name?.trim() || null;
  const phone = encryptPii(recipient?.phone_number?.trim() || null);
  const address = encryptPii(recipient?.full_address?.trim() || null);
  return { recipientName: name, recipientPhone: phone, recipientAddress: address };
}

/** Sinkronkan paket pengiriman (carrier/resi/status) — idempotent per externalId. */
async function syncShipments(
  db: { shipment: typeof defaultPrisma.shipment },
  orderId: string,
  accountId: string,
  packagesRaw: Array<Record<string, unknown>> | undefined
) {
  for (const pkg of packagesRaw ?? []) {
    const externalId = pkg.id !== undefined ? String(pkg.id) : "";
    if (!externalId) continue;
    const carrier =
      (pkg.shipping_provider_name as string) ||
      (pkg.shipping_provider as string) ||
      null;
    const trackingNo = (pkg.tracking_number as string) ?? null;
    const status = (pkg.package_status as string) ?? "PACKAGED";
    const shippedAt = toDate(pkg.create_time as number | undefined);
    await db.shipment.upsert({
      where: {
        accountId_orderId_externalId: { accountId, orderId, externalId },
      },
      create: {
        externalId,
        orderId,
        accountId,
        carrier,
        trackingNo,
        status,
        shippedAt,
      },
      update: { carrier, trackingNo, status, shippedAt },
    });
  }
}

/**
 * syncOrdersTikTok — tarik order dari TikTok API lalu simpan idempotent.
 * Dedupe by (accountId, externalOrderId) via PlatformOrderMapping; order yang
 * sudah ada di-skip (tidak duplikat). Disimpan per-order + per-line-item,
 * line item memakai identifier eksternal (product_id / sku_id) langsung.
 */
export async function syncOrdersTikTok(
  accountId: string,
  prisma: PrismaLike = defaultPrisma
) {
  const account = await prisma.platformAccount.findUnique({
    where: { id: accountId },
  });
  if (!account) throw new Error("Akun tidak ditemukan.");
  if (!account.accessToken) throw new Error("Akun belum punya access token.");
  if (!account.shopCipher) throw new Error("Akun belum punya shop_cipher.");

  const { orders } = await getOrders(account.accessToken, account.shopCipher);

  const result = { fetched: orders.length, created: 0, skipped: 0, errors: [] as string[] };

  for (const raw of orders as OrderRaw[]) {
    const externalOrderId = raw.id;
    if (!externalOrderId) continue;

    const existing = await prisma.platformOrderMapping.findUnique({
      where: {
        accountId_externalOrderId: { accountId, externalOrderId },
      },
    });
    if (existing) {
      // Order sudah pernah disinkronkan: segarkan seluruh field ringan + SLA +
      // paket pengiriman supaya data tampilan selalu terbaru (SLA adalah yang
      // menentukan alert "Segera Kirim").
      try {
        const recipient = parseRecipient(raw.recipient_address);
        await prisma.order.update({
          where: { id: existing.orderId },
          data: {
            status: raw.status ?? existing.rawStatus,
            buyerName: raw.buyer_nickname || recipient.recipientName || raw.buyer_email || null,
            buyerEmail: raw.buyer_email ?? null,
            buyerNote: raw.buyer_message?.trim() || null,
            paymentMethodName: raw.payment_method_name ?? null,
            isCod: raw.is_cod ?? null,
            paymentJson: raw.payment ? JSON.stringify(raw.payment) : null,
            ...recipient,
            shippingDueTime: toDate(raw.shipping_due_time),
            rtsSlaTime: toDate(raw.rts_sla_time),
            ttsSlaTime: toDate(raw.tts_sla_time),
            recommendedShippingTime: toDate(raw.recommended_shipping_time),
          },
        });
        await syncShipments(prisma, existing.orderId, accountId, raw.packages);
        // Backfill nama produk/variasi di item yang sudah ada.
        for (const li of raw.line_items ?? []) {
          if (!li.sku_id && !li.seller_sku && !li.product_id) continue;
          const channelSku = li.sku_id || li.seller_sku || li.product_id || "";
          const item = await prisma.orderItem.findFirst({
            where: { orderId: existing.orderId, channelSku },
            select: { id: true },
          });
          if (!item) continue;
          await prisma.orderItem.update({
            where: { id: item.id },
            data: {
              productName: li.product_name ?? null,
              skuName: li.sku_name ?? null,
              price: toNumber(li.sale_price),
            },
          });
        }
      } catch (e) {
        result.errors.push(`${externalOrderId}: refresh gagal (${e instanceof Error ? e.message : String(e)})`);
      }
      result.skipped += 1;
      continue;
    }

    const payment = raw.payment ?? null;
    const recipient = parseRecipient(raw.recipient_address);
    const lineItems = (raw.line_items ?? []).map((li) => ({
      channelSku: li.sku_id || li.seller_sku || li.product_id || "",
      productId: li.product_id ?? null,
      imageUrl: li.sku_image ?? null,
      productName: li.product_name ?? null,
      skuName: li.sku_name ?? null,
      qty: 1,
      price: toNumber(li.sale_price),
      variantId: null as string | null,
    }));

    // Resolusi variantId per line item (idempotent lookup).
    for (const item of lineItems) {
      if (!item.channelSku) continue;
      item.variantId = await resolveVariantId(prisma, accountId, item.channelSku);
    }

    try {
      await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            orderNo: externalOrderId,
            status: raw.status ?? "UNKNOWN",
            buyerName: raw.buyer_nickname || recipient.recipientName || raw.buyer_email || null,
            buyerEmail: raw.buyer_email ?? null,
            buyerNote: raw.buyer_message?.trim() || null,
            paymentMethodName: raw.payment_method_name ?? null,
            isCod: raw.is_cod ?? null,
            paymentJson: payment ? JSON.stringify(payment) : null,
            ...recipient,
            amount: toNumber(payment?.total_amount),
            currency: payment?.currency as string | undefined ?? null,
            createTime: toDate(raw.create_time),
            paidTime: toDate(raw.paid_time),
            shippingDueTime: toDate(raw.shipping_due_time),
            rtsSlaTime: toDate(raw.rts_sla_time),
            ttsSlaTime: toDate(raw.tts_sla_time),
            recommendedShippingTime: toDate(raw.recommended_shipping_time),
            accountId,
            items: {
              create: lineItems.map((item) => ({
                channelSku: item.channelSku,
                productId: item.productId,
                imageUrl: item.imageUrl,
                productName: item.productName,
                skuName: item.skuName,
                qty: item.qty,
                price: item.price,
                variantId: item.variantId,
              })),
            },
          },
        });
        await tx.platformOrderMapping.create({
          data: {
            externalOrderId,
            rawStatus: raw.status ?? "UNKNOWN",
            orderId: order.id,
            accountId,
          },
        });
        await syncShipments(tx, order.id, accountId, raw.packages);
      });
      result.created += 1;
    } catch (e) {
      result.errors.push(`${externalOrderId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}