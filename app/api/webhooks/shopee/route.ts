import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { shopeePushUrlCandidates, verifyPushSignature } from "@/lib/integrations/shopee";
import { listActiveShopeeSecrets } from "@/lib/services/app-credential.service";
import {
  CANCEL_STATUSES,
  cancelReasonForStatus,
  deductStockForOrder,
  restoreStockForCanceledOrder,
} from "@/lib/services/central-stock.service";

type ShopeePush = {
  code?: number;
  shop_id?: number | string;
  timestamp?: number;
  data?: Record<string, unknown>;
};

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

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const authHeader = req.headers.get("authorization");

  // Shopee Console "Verify / Get Test Push" hanya mengecek status 2xx.
  // Signature gagal → JANGAN 401 (gagal verify); cukup jangan proses payload.
  let secrets: string[] = [];
  try {
    secrets = await listActiveShopeeSecrets();
  } catch (e) {
    console.error("[webhook/shopee] gagal ambil partner secrets:", e);
    return new Response(null, { status: 200 });
  }

  const urlCandidates = shopeePushUrlCandidates(req);
  const verified = secrets.some((key) =>
    verifyPushSignature(rawBody, authHeader, urlCandidates, {
      partnerId: "",
      partnerKey: key,
    })
  );
  if (!verified) {
    console.warn(
      `[webhook/shopee] signature invalid (skip process) auth=${authHeader ? "ada" : "kosong"} urls=${urlCandidates.join(" , ")} body=${rawBody.slice(0, 200)}`
    );
    return new Response(null, { status: 200 });
  }

  let payload: ShopeePush;
  try {
    payload = JSON.parse(rawBody) as ShopeePush;
  } catch {
    return new Response(null, { status: 200 });
  }

  const shopId = payload.shop_id !== undefined && payload.shop_id !== null
    ? String(payload.shop_id)
    : null;
  if (!shopId) return new Response(null, { status: 200 });

  const account = await prisma.platformAccount.findUnique({
    where: { platform_externalShopId: { platform: "SHOPEE", externalShopId: shopId } },
    select: { id: true, isFrozen: true, frozenReason: true },
  });
  if (!account) {
    console.warn(`[webhook/shopee] unknown shop_id: ${shopId}`);
    return new Response(null, { status: 200 });
  }
  if (account.isFrozen) {
    console.warn(
      `[webhook/shopee] push dari akun dibekukan ${shopId} diabaikan (${account.frozenReason ?? "tanpa alasan"}).`
    );
    return new Response(null, { status: 200 });
  }

  try {
    const code = Number(payload.code);
    if (code === 3) {
      await handleOrderUpdate(account.id, rawBody, payload.data ?? {});
    } else if (code === 1) {
      await logSync({
        accountId: account.id,
        kind: "shop_authorization",
        status: "success",
        message: "Otorisasi toko Shopee berubah.",
        payload: rawBody,
      });
    } else if (code === 2) {
      // shop_authorization_canceled_push — seller mencabut otorisasi.
      // Hapus token agar UI terbaca Terputus + API tidak dipanggil sia-sia.
      await prisma.platformAccount.update({
        where: { id: account.id },
        data: { accessToken: null, refreshToken: null, tokenExpiresAt: null },
      });
      await logSync({
        accountId: account.id,
        kind: "shop_deauthorization",
        status: "skipped",
        message: "Otorisasi Shopee dicabut seller — akun ditandai terputus, hubungkan ulang.",
        payload: rawBody,
      });
    } else if (code === 12) {
      // open_api_authorization_expiry — H-7 sebelum authorization expired.
      await logSync({
        accountId: account.id,
        kind: "authorization_expiry_warning",
        status: "skipped",
        message: "Otorisasi Shopee segera kedaluwarsa — minta seller authorize ulang.",
        payload: rawBody,
      });
    } else {
      await logSync({
        accountId: account.id,
        kind: `unknown_code_${Number.isFinite(code) ? code : "na"}`,
        status: "skipped",
        message: "Topik push Shopee tidak dikenali / tidak disubscribe.",
        payload: rawBody,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[webhook/shopee] process error utk akun ${account.id}:`, err);
    await logSync({
      accountId: account.id,
      kind: "webhook_process_error",
      status: "error",
      errorMessage: message,
      payload: rawBody,
    });
  }

  return new Response(null, { status: 200 });
}

async function handleOrderUpdate(
  accountId: string,
  rawBody: string,
  data: Record<string, unknown>
) {
  const externalOrderId =
    data.order_sn !== undefined && data.order_sn !== null ? String(data.order_sn) : null;
  const orderStatus =
    data.order_status !== undefined && data.order_status !== null
      ? String(data.order_status)
      : null;
  const updateTime = Number(data.update_time ?? NaN);

  if (!externalOrderId || !orderStatus) {
    await logSync({
      accountId,
      kind: "order_status_change",
      status: "error",
      errorMessage: "payload.data kurang field order_sn/order_status",
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
      errorMessage: "order belum di-sync, jalankan sinkronisasi order manual",
      payload: rawBody,
    });
    return;
  }

  const lastWebhook = mapping.lastWebhookUpdateTime;
  if (lastWebhook === null) {
    if (mapping.rawStatus === orderStatus) {
      await logSync({
        accountId,
        kind: "order_status_change",
        status: "skipped",
        message: `duplicate: status sama (${orderStatus})`,
        payload: rawBody,
      });
      return;
    }
  } else if (Number.isFinite(updateTime) && updateTime <= lastWebhook) {
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
    prisma.order.update({ where: { id: mapping.orderId }, data: { status: orderStatus } }),
    prisma.platformOrderMapping.update({
      where: { id: mapping.id },
      data: {
        rawStatus: orderStatus,
        ...(Number.isFinite(updateTime) ? { lastWebhookUpdateTime: updateTime } : {}),
      },
    }),
  ]);

  if (orderStatus === "READY_TO_SHIP") {
    try {
      const deducted = await deductStockForOrder(mapping.orderId);
      await logSync({
        accountId,
        kind: "central_stock_deduct",
        status: deducted.ok && !deducted.already ? "success" : "skipped",
        message: `order ${externalOrderId}: ${
          deducted.ok
            ? deducted.already
              ? "stok sudah dipotong sebelumnya (idempotent)"
              : `stok gudang berkurang di ${deducted.deductions?.length ?? 0} varian`
            : (deducted.reason ?? "?")
        }`,
        payload: rawBody,
      });
    } catch (e) {
      console.error("[central_stock] gagal memotong stok (Shopee):", e);
      await logSync({
        accountId,
        kind: "central_stock_deduct",
        status: "error",
        errorMessage: e instanceof Error ? e.message : String(e),
        payload: rawBody,
      });
    }
  }

  if (CANCEL_STATUSES.has(orderStatus)) {
    try {
      const reason = cancelReasonForStatus(orderStatus);
      if (!reason) throw new Error(`status batal tanpa reason mapping: ${orderStatus}`);
      const restored = await restoreStockForCanceledOrder(mapping.orderId, reason);
      await logSync({
        accountId,
        kind: "central_stock_restore",
        status: restored.ok && !restored.already ? "success" : "skipped",
        message: `order ${externalOrderId}: ${
          restored.ok
            ? restored.already
              ? "stok sudah direstore sebelumnya (idempotent)"
              : `stok gudang dikembalikan di ${restored.restores?.length ?? 0} varian`
            : (restored.reason ?? "?")
        }`,
        payload: rawBody,
      });
    } catch (e) {
      console.error("[central_stock] gagal me-restore stok (Shopee):", e);
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
