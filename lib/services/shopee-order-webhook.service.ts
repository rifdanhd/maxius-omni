import { prisma } from "@/lib/db/prisma";
import { applyShopeeStockEffectsForStatus, canonicalShopeeStatus } from "@/lib/services/shopee-order-status.service";
import { ingestShopeeOrderBySn, refreshShopeeOrderShipment } from "@/lib/services/shopee-order-sync.service";

/** Jejak push/efek ke SyncLog (arahan "in"). Bentuk baris sama seperti sebelumnya. */
export async function logShopeeSync(params: {
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

async function logEffect(
  accountId: string,
  kind: "central_stock_deduct" | "central_stock_restore",
  orderSn: string,
  eff: { ok?: boolean; already?: boolean; note?: string; count?: number },
  payload: string
): Promise<void> {
  const verb = kind === "central_stock_deduct" ? "dipotong" : "dikembalikan";
  await logShopeeSync({
    accountId,
    kind,
    status: eff.ok && !eff.already ? "success" : eff.ok ? "skipped" : "error",
    message: eff.ok
      ? `order ${orderSn}: ${
          eff.already
            ? `stok sudah ${verb} sebelumnya (idempotent)`
            : `stok gudang ${verb} di ${eff.count ?? 0} varian`
        }`
      : undefined,
    errorMessage: eff.ok ? undefined : (eff.note ?? "?"),
    payload,
  });
}

/**
 * handleShopeeOrderUpdate — topik push "order update" (code 3).
 *
 * A1: status kanonik via SHOPEE_STATUS_MAP + applyShopeeStockEffectsForStatus
 *     — aturan deduct/restore SAMA dengan ingest manual (satu peta, satu jalur).
 * A2: mapping belum ada (order belum pernah di-sync) → auto-ingest 1 order dari
 *     API detail, lalu proses push; gagal → SyncLog + hint sinkronisasi manual.
 * Dedupe: duplikat/stale didorong berdasar rawStatus (bahasa Shopee) +
 *     lastWebhookUpdateTime — ATURAN YANG SAMA seperti sebelumnya; push
 *     pemecah auto-ingest (autoIngested) melewati guard (efek stok belum pernah
 *     diterapkan untuk order itu).
 */
export async function handleShopeeOrderUpdate(
  accountId: string,
  rawBody: string,
  data: Record<string, unknown>
): Promise<void> {
  const externalOrderId =
    data.order_sn != null || data.ordersn != null ? String(data.order_sn ?? data.ordersn) : null;
  const orderStatus =
    data.order_status != null || data.status != null
      ? String(data.order_status ?? data.status)
      : null;
  const updateTime = Number(data.update_time ?? NaN);

  if (!externalOrderId || !orderStatus) {
    await logShopeeSync({
      accountId,
      kind: "order_status_change",
      status: "error",
      errorMessage: "payload.data kurang field order_sn/order_status",
      payload: rawBody,
    });
    return;
  }

  let mapping = await prisma.platformOrderMapping.findUnique({
    where: { accountId_externalOrderId: { accountId, externalOrderId } },
    select: { id: true, orderId: true, rawStatus: true, lastWebhookUpdateTime: true },
  });
  let autoIngested = false;

  if (!mapping) {
    // A2 — auto-ingest: order masuk sebelum sync manual.
    let orderId: string | null = null;
    let ingestError: string | null = null;
    try {
      orderId = await ingestShopeeOrderBySn(accountId, externalOrderId);
    } catch (e) {
      ingestError = e instanceof Error ? e.message : String(e);
    }
    if (!orderId) {
      await logShopeeSync({
        accountId,
        kind: "order_auto_ingest",
        status: "error",
        errorMessage: `${ingestError ?? "gagal mengambil detail order"} — jalankan sinkronisasi order manual`,
        payload: rawBody,
      });
      return;
    }
    mapping = await prisma.platformOrderMapping.findUnique({
      where: { accountId_externalOrderId: { accountId, externalOrderId } },
      select: { id: true, orderId: true, rawStatus: true, lastWebhookUpdateTime: true },
    });
    if (!mapping) {
      await logShopeeSync({
        accountId,
        kind: "order_auto_ingest",
        status: "error",
        errorMessage: "mapping tidak terbuat oleh auto-ingest — jalankan sinkronisasi order manual",
        payload: rawBody,
      });
      return;
    }
    autoIngested = true;
    await logShopeeSync({
      accountId,
      kind: "order_auto_ingest",
      status: "success",
      message: `order ${externalOrderId}: auto-ingest dari push (belum pernah di-sync)`,
      payload: rawBody,
    });
  }

  if (!autoIngested) {
    const lastWebhook = mapping.lastWebhookUpdateTime;
    if (lastWebhook === null) {
      if (mapping.rawStatus === orderStatus) {
        try {
          if (["ON_HOLD", "AWAITING_SHIPMENT", "AWAITING_COLLECTION", "PARTIALLY_SHIPPING", "IN_TRANSIT"].includes(canonicalShopeeStatus(orderStatus))) {
            await refreshShopeeOrderShipment(accountId, externalOrderId);
          }
        } catch (e) {
          await logShopeeSync({ accountId, kind: "shipment_sync", status: "error", errorMessage: e instanceof Error ? e.message : String(e), payload: rawBody });
        }
        await logShopeeSync({
          accountId,
          kind: "order_status_change",
          status: "skipped",
          message: `duplicate: status sama (${orderStatus})`,
          payload: rawBody,
        });
        return;
      }
    } else if (Number.isFinite(updateTime) && updateTime <= lastWebhook) {
      await logShopeeSync({
        accountId,
        kind: "order_status_change",
        status: "skipped",
        message: `skipped: stale/duplicate update_time (${updateTime} <= ${lastWebhook})`,
        payload: rawBody,
      });
      return;
    }
  }

  const canonical = canonicalShopeeStatus(orderStatus);

  await prisma.$transaction([
    prisma.order.update({ where: { id: mapping.orderId }, data: { status: canonical } }),
    prisma.platformOrderMapping.update({
      where: { id: mapping.id },
      data: {
        rawStatus: orderStatus,
        ...(Number.isFinite(updateTime) ? { lastWebhookUpdateTime: updateTime } : {}),
      },
    }),
  ]);

  // A1 — satu aturan efek stok untuk semua status (idempoten; dobel-push aman).
  try {
    const eff = await applyShopeeStockEffectsForStatus(mapping.orderId, canonical);
    if (eff.effect === "deduct") {
      await logEffect(accountId, "central_stock_deduct", externalOrderId, eff, rawBody);
    } else if (eff.effect === "restore") {
      await logEffect(accountId, "central_stock_restore", externalOrderId, eff, rawBody);
    }
  } catch (e) {
    const kind =
      canonical === "CANCELLED" || canonical === "REFUNDED"
        ? "central_stock_restore"
        : "central_stock_deduct";
    console.error(`[central_stock] gagal ${kind} (Shopee):`, e);
    await logShopeeSync({
      accountId,
      kind,
      status: "error",
      errorMessage: e instanceof Error ? e.message : String(e),
      payload: rawBody,
    });
  }

  await logShopeeSync({
    accountId,
    kind: "order_status_change",
    status: "success",
    message: `${externalOrderId}: ${mapping.rawStatus} -> ${orderStatus} (${canonical})`,
    payload: rawBody,
  });
  if (["ON_HOLD", "AWAITING_SHIPMENT", "AWAITING_COLLECTION", "PARTIALLY_SHIPPING", "IN_TRANSIT"].includes(canonical)) {
    try {
      await refreshShopeeOrderShipment(accountId, externalOrderId);
    } catch (e) {
      await logShopeeSync({ accountId, kind: "shipment_sync", status: "error", errorMessage: e instanceof Error ? e.message : String(e), payload: rawBody });
    }
  }
}
