import crypto from "crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";

const APP_KEY = process.env.TIKTOK_APP_KEY!;
const APP_SECRET = process.env.TIKTOK_APP_SECRET!;

if (!APP_KEY || !APP_SECRET) {
  throw new Error("TIKTOK_APP_KEY / TIKTOK_APP_SECRET belum diisi di file .env");
}

/**
 * verifyTikTokShopSignature
 *
 * TikTok Shop webhook signature (bukan TikTok API request signature):
 *   - Header   : Authorization (nilai mentah, TANPA prefix Bearer)
 *   - Base     : app_key + raw_request_body (persis seperti diterima, tanpa reformat)
 *   - Key      : app_secret
 *   - Algoritma: HMAC-SHA256, output lowercase hex
 * Verifikasi di body mentah SEBELUM JSON.parse. Tanpa timestamp di dalam
 * signature → tidak ada replay protection; dedupe ditangani saat processing.
 */
function verifyTikTokShopSignature(rawBody: string, authHeader: string | null): boolean {
  if (!authHeader) return false;

  const computedHex = crypto
    .createHmac("sha256", APP_SECRET)
    .update(`${APP_KEY}${rawBody}`)
    .digest("hex");

  const computed = Buffer.from(computedHex, "hex");
  const received = Buffer.from(authHeader, "hex");

  // timingSafeEqual THROW bila panjang buffer beda — cek panjang dulu.
  if (computed.length !== received.length) return false;
  return crypto.timingSafeEqual(computed, received);
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

  if (!verifyTikTokShopSignature(rawBody, authHeader)) {
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
      select: { id: true },
    });

    // shop_id tidak dikenal → bukan salah TikTok, jangan trigger retry.
    // SyncLog.accountId wajib FK ke PlatformAccount, jadi tak bisa kita tandai
    // tanpa akun — cukup catat ke log server.
    if (!account) {
      console.warn(`[webhook] unknown shop_id dari TikTok: ${shopId}`);
      return new Response(null, { status: 200 });
    }

    try {
      switch (payload.type) {
        case 1:
          await handleOrderStatusChange(account.id, rawBody, payload);
          break;
        case 5:
          await handleProductStatusChange(account.id, rawBody, payload);
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
      // Error tak terduga saat proses (DB error dll) → catat, tetap 200 supaya
      // TikTok tidak retry-storm. Return 500 hanya bila sengaja mau TikTok retry.
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

  await logSync({
    accountId,
    kind: "order_status_change",
    status: "success",
    message: `${externalOrderId}: ${mapping.rawStatus} -> ${orderStatus}`,
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