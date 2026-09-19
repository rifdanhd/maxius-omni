import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  deductStockForOrder,
  cancelReasonForStatus,
  CANCEL_STATUSES,
  restoreStockForCanceledOrder,
} from "@/lib/services/central-stock.service";
import { resolveTiktokCreds } from "@/lib/services/app-credential.service";
import { upsertTikTokReturn } from "@/lib/services/return-ingest.service";

async function listActiveTiktokSecrets(): Promise<Array<{ appKey: string; appSecret: string }>> {
  const rows = await prisma.appCredential.findMany({
    where: { platform: "TIKTOK_SHOP", isActive: true },
    select: { clientId: true, clientSecret: true },
  });
  const pairs = rows
    .filter((r) => r.clientId && r.clientSecret)
    .map((r) => ({ appKey: r.clientId as string, appSecret: r.clientSecret as string }));
  try {
    const env = resolveTiktokCreds(null);
    if (!pairs.some((p) => p.appKey === env.appKey && p.appSecret === env.appSecret)) {
      pairs.push({ appKey: env.appKey, appSecret: env.appSecret });
    }
  } catch {
    // env belum diisi — verifikasi mengandalkan kredensial DB saja.
  }
  return pairs;
}

/**
 * verifyTikTokShopSignature
 *
 * Tokopedia | Shop webhook signature (bukan TikTok API request signature):
 *   - Header   : Authorization (nilai mentah, TANPA prefix Bearer)
 *   - Base     : app_key + raw_request_body (persis seperti diterima, tanpa reformat)
 *   - Key      : app_secret
 *   - Algoritma: HMAC-SHA256, output lowercase hex
 * Verifikasi di body mentah SEBELUM JSON.parse. Tanpa timestamp di dalam
 * signature → tidak ada replay protection; dedupe ditangani saat processing.
 */
function verifyTikTokShopSignature(
  rawBody: string,
  authHeader: string | null,
  pairs: Array<{ appKey: string; appSecret: string }>
): boolean {
  if (!authHeader) return false;
  return pairs.some(({ appKey, appSecret }) => {
    const computedHex = crypto
      .createHmac("sha256", appSecret)
      .update(`${appKey}${rawBody}`)
      .digest("hex");

    const computed = Buffer.from(computedHex, "hex");
    let received: Buffer;
    try {
      received = Buffer.from(authHeader, "hex");
    } catch {
      return false;
    }

    // timingSafeEqual THROW bila panjang buffer beda — cek panjang dulu.
    if (computed.length !== received.length) return false;
    return crypto.timingSafeEqual(computed, received);
  });
}

function toEpochSeconds(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function logSync(params: {
  accountId: string;
  kind: string;
  status: string;
  message?: string;
  errorMessage?: string;
  payload: string;
}) {
  return prisma.syncLog.create({
    data: {
      direction: "in",
      kind: params.kind,
      status: params.status,
      message: params.message,
      errorMessage: params.errorMessage,
      payload: params.payload,
      accountId: params.accountId,
    },
  });
}

type WebhookPayload = {
  type?: number;
  event?: string;
  event_type?: string;
  tts_notification_id?: string;
  shop_id?: string;
  timestamp?: number;
  data?: Record<string, unknown>;
};

function parsePayload(rawBody: string): WebhookPayload {
  try {
    return JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return { data: {} };
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const authHeader = req.headers.get("authorization");

  // Multi-credential: coba tiap app key/secret aktif (DB + env) sampai cocok.
  if (!verifyTikTokShopSignature(rawBody, authHeader, await listActiveTiktokSecrets())) {
    return new Response(null, { status: 401 });
  }

  // Signature valid → parse & proses. Error tak terduga tetap balikin 200
  // (hindari retry-storm TikTok) TAPI dicatat untuk investigasi manual.
  try {
    const payload = parsePayload(rawBody);

    const shopId = payload.shop_id ? String(payload.shop_id) : null;
    if (!shopId) return new Response(null, { status: 200 });

    const account = await prisma.platformAccount.findUnique({
      where: { platform_externalShopId: { platform: "TIKTOK_SHOP", externalShopId: shopId } },
      select: { id: true, isFrozen: true, frozenReason: true },
    });

    // shop_id tidak dikenal → bukan salah TikTok, jangan trigger retry.
    // SyncLog.accountId wajib FK ke PlatformAccount, jadi tak bisa kita tandai
    // tanpa akun — cukup catat ke log server.
    if (!account) {
      console.warn(`[webhook] unknown shop_id dari TikTok: ${shopId}`);
      return new Response(null, { status: 200 });
    }
    if (account.isFrozen) {
      console.warn(
        `[webhook] push dari akun dibekukan ${shopId} diabaikan (${account.frozenReason ?? "tanpa alasan"}).`
      );
      return new Response(null, { status: 200 });
    }

    try {
      const eventName = payload.event ?? payload.event_type;
      if (eventName === "SELLER_DEAUTHORIZATION") {
        // Seller mencabut otorisasi — hapus token agar UI terbaca Terputus.
        await prisma.platformAccount.update({
          where: { id: account.id },
          data: { accessToken: null, refreshToken: null, tokenExpiresAt: null },
        });
        await logSync({
          accountId: account.id,
          kind: "seller_deauthorization",
          status: "skipped",
          message: "Otorisasi TikTok dicabut seller — akun ditandai terputus, hubungkan ulang.",
          payload: rawBody,
        });
      } else if (eventName === "UPCOMING_AUTHORIZATION_EXPIRATION") {
        await logSync({
          accountId: account.id,
          kind: "authorization_expiry_warning",
          status: "skipped",
          message: "Otorisasi TikTok segera kedaluwarsa — minta seller authorize ulang.",
          payload: rawBody,
        });
      } else switch (payload.type) {
        case 1:
          await handleOrderStatusChange(account.id, rawBody, payload);
          break;
        case 5:
          await handleProductStatusChange(account.id, rawBody, payload);
          break;
        // Return & Refund: 12 = return status change, 64 = aftersales request
        // status, 65 = RMA status, 67 = refund success. Semua → funnel ingest
        // retur yang sama (idempoten per return_id).
        case 12:
        case 64:
        case 65:
        case 67:
          await handleReturnStatusChange(account.id, rawBody, payload);
          break;
        default:
          await logSync({
            accountId: account.id,
            kind: `unknown_type_${String(payload.type)}`,
            status: "skipped",
            message: "Topik webhook tidak dikenali / tidak disubscribe.",
            payload: rawBody,
          });
      }
    } catch (err) {
      const message = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error(`[webhook] process error untuk akun ${account.id}:`, err);
      await logSync({
        accountId: account.id,
        kind: "webhook_process_error",
        status: "error",
        errorMessage: message,
        payload: rawBody,
      });
    }

    return new Response(null, { status: 200 });
  } catch (err) {
    // Gagal di level verifikasi/parse/akun-resolve (mis. DB down sementara).
    // Kirim 500 agar TikTok menunda & mengretry (jangan hilangkan event).
    console.error("[webhook] fatal error:", err);
    return new Response(null, { status: 500 });
  }
}

async function handleOrderStatusChange(
  accountId: string,
  rawBody: string,
  payload: WebhookPayload
) {
  const data = payload.data ?? {};
  const externalOrderId = data.order_id ? String(data.order_id) : null;
  const orderStatus = data.order_status ? String(data.order_status) : null;
  const updateTime = toEpochSeconds(data.update_time);

  if (!externalOrderId || !orderStatus) {
    await logSync({
      accountId,
      kind: "order_status_change",
      status: "error",
      errorMessage: "payload.data kurang field order_id/order_status",
      payload: rawBody,
    });
    return;
  }

  const mapping = await prisma.platformOrderMapping.findUnique({
    where: { accountId_externalOrderId: { accountId, externalOrderId } },
    select: { id: true, orderId: true, rawStatus: true, lastWebhookUpdateTime: true },
  });

  if (!mapping) {
    await logSync({
      accountId,
      kind: "order_status_change",
      status: "error",
      errorMessage: "order belum di-sync, jalankan /api/orders/sync manual",
      payload: rawBody,
    });
    return;
  }

  // IDEMPOTENCY:
  // lastWebhookUpdateTime === null  → webhook PERTAMA untuk order ini, tidak ada
  // referensi waktu sebelumnya → selalu proses update valid (tanpa perbandingan,
  // karena null <= number menghasilkan true via coercion palsu kalau dibandingkan).
  // Non-null → hanya proses bila update_time lebih baru dari yang terakhir diproses.
  const lastWebhook = mapping.lastWebhookUpdateTime;

  if (lastWebhook === null) {
    // Webhook pertama. Skip hanya bila status juga sudah sama (duplikat retry).
    if (mapping.rawStatus === orderStatus) {
      await logSync({
        accountId,
        kind: "order_status_change",
        status: "skipped",
        message: `duplicate: status sama (${orderStatus}), belum pernah diproses webhook`,
        payload: rawBody,
      });
      return;
    }
  } else if (updateTime !== null && updateTime <= lastWebhook) {
    // Bukan webhook pertama & event tidak lebih baru → retry lama/out-of-order.
    await logSync({
      accountId,
      kind: "order_status_change",
      status: "skipped",
      message: `skipped: stale/duplicate update_time (${updateTime} <= ${lastWebhook})`,
      payload: rawBody,
    });
    return;
  }

  await prisma.$transaction([
    prisma.order.update({
      where: { id: mapping.orderId },
      data: { status: orderStatus },
    }),
    prisma.platformOrderMapping.update({
      where: { id: mapping.id },
      data: {
        rawStatus: orderStatus,
        ...(updateTime !== null ? { lastWebhookUpdateTime: updateTime } : {}),
      },
    }),
  ]);

  // STOK GUDANG BERSAMA: order yang dibayar & menunggu dikirim memotong stok
  // pusat. Inner try/catch supaya kegagalan pemotongan tidak menggagalkan update
  // status yang sudah berhasil & tidak memicu retry-storm.
  if (orderStatus === "AWAITING_SHIPMENT") {
    try {
      const deducted = await deductStockForOrder(mapping.orderId);
      if (!deducted.ok) {
        await logSync({
          accountId,
          kind: "central_stock_deduct",
          status: "skipped",
          message: `order ${externalOrderId}: ${deducted.reason ?? "?"}`,
          payload: rawBody,
        });
      } else if (deducted.already) {
        await logSync({
          accountId,
          kind: "central_stock_deduct",
          status: "skipped",
          message: `order ${externalOrderId}: stok sudah dipotong sebelumnya (idempotent)`,
          payload: rawBody,
        });
      } else {
        const n = deducted.deductions?.length ?? 0;
        await logSync({
          accountId,
          kind: "central_stock_deduct",
          status: "success",
          message: `order ${externalOrderId}: stok gudang berkurang di ${n} varian`,
          payload: rawBody,
        });
      }
    } catch (e) {
      console.error("[central_stock] gagal memotong stok:", e);
      await logSync({
        accountId,
        kind: "central_stock_deduct",
        status: "error",
        errorMessage: e instanceof Error ? e.message : String(e),
        payload: rawBody,
      });
    }
  }

  // STOK GUDANG BERSAMA: order yang batal me-restore stok yang tadi dipotong.
  // Idempoten (via StockLedger reason ORDER_CANCELLED/ORDER_REFUNDED) dan aman
  // bila ternyata order itu tidak pernah memotong stok sama sekali.
  if (CANCEL_STATUSES.has(orderStatus)) {
    try {
      const reason = cancelReasonForStatus(orderStatus);
      if (!reason) throw new Error(`status batal tanpa reason mapping: ${orderStatus}`);
      const restored = await restoreStockForCanceledOrder(mapping.orderId, reason);
      if (!restored.ok) {
        await logSync({
          accountId,
          kind: "central_stock_restore",
          status: "skipped",
          message: `order ${externalOrderId}: ${restored.reason ?? "?"}`,
          payload: rawBody,
        });
      } else if (restored.already) {
        await logSync({
          accountId,
          kind: "central_stock_restore",
          status: "skipped",
          message: `order ${externalOrderId}: ${restored.reason === "no deduction" ? "tidak ada stok yang dipotong" : "stok sudah direstore sebelumnya (idempotent)"}`,
          payload: rawBody,
        });
      } else {
        const n = restored.restores?.length ?? 0;
        await logSync({
          accountId,
          kind: "central_stock_restore",
          status: "success",
          message: `order ${externalOrderId}: stok gudang dikembalikan di ${n} varian`,
          payload: rawBody,
        });
      }
    } catch (e) {
      console.error("[central_stock] gagal me-restore stok:", e);
      await logSync({
        accountId,
        kind: "central_stock_restore",
        status: "error",
        errorMessage: e instanceof Error ? e.message : String(e),
        payload: rawBody,
      });
    }
  }

  await logSync({
    accountId,
    kind: "order_status_change",
    status: "success",
    message: `${externalOrderId}: ${mapping.rawStatus} -> ${orderStatus}`,
    payload: rawBody,
  });
}

/**
 * handleReturnStatusChange — webhook Return & Refund TikTok (type 12/64/65/67).
 * Payload.data membawa return_id + return_status (type 12) atau id/status
 * aftersales (64/65/67). Ingest idempoten; kegagalan ingest tidak menggagalkan
 * webhook (SyncLog error, TikTok tetap menerima 200).
 */
async function handleReturnStatusChange(
  accountId: string,
  rawBody: string,
  payload: WebhookPayload
) {
  const data = payload.data ?? {};
  const returnId = data.return_id ? String(data.return_id) : null;
  const aftersaleId = data.aftersale_id ? String(data.aftersale_id) : null;
  const id = returnId ?? aftersaleId;

  if (!id) {
    await logSync({
      accountId,
      kind: "return_status_change",
      status: "error",
      errorMessage: "payload.data kurang return_id/aftersale_id",
      payload: rawBody,
    });
    return;
  }

  // Payload mentah disimpan apa adanya di ReturnRequest.rawPayload — mapper
  // di return-ingest.service menangani variasi antar type (12 vs 64/65/67).
  const returnIdResult = await upsertTikTokReturn(accountId, {
    return_id: id,
    order_id: data.order_id,
    return_status: data.return_status ?? data.status,
    ...data,
  });

  await logSync({
    accountId,
    kind: "return_status_change",
    status: returnIdResult ? "success" : "skipped",
    message: returnIdResult
      ? `retur ${id} di-ingest (type ${payload.type})`
      : `retur ${id} tanpa return_id valid`,
    payload: rawBody,
  });
}

async function handleProductStatusChange(
  accountId: string,
  rawBody: string,
  payload: WebhookPayload
) {
  const data = payload.data ?? {};
  const productId = data.product_id ? String(data.product_id) : null;
  const status = data.status ? String(data.status) : null;

  if (!productId) {
    await logSync({
      accountId,
      kind: "product_status_change",
      status: "error",
      errorMessage: "payload.data kurang field product_id",
      payload: rawBody,
    });
    return;
  }

  // Status produk TIDAK ditulis ke field yang tidak ada di schema.
  // Mapping di-resolve hanya untuk konteks penggunaan; per rancangan,
  // perubahan status cukup tercatat di SyncLog.
  await prisma.productMapping.findUnique({
    where: { accountId_channelSku: { accountId, channelSku: productId } },
    select: { id: true },
  });

  await logSync({
    accountId,
    kind: "product_status_change",
    status: "success",
    message: `product ${productId}: ${status ?? "?"}`,
    payload: rawBody,
  });
}