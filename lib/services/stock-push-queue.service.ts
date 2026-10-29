import { prisma } from "@/lib/db/prisma";
import { updateStockBatch, TikTokApiError, type StockBatchItem } from "@/lib/integrations/tiktokShop";
import { withRefreshedTiktokToken } from "@/lib/services/tiktok-token.service";
import { logStockPush } from "@/lib/services/sync-log.util";
import { backoffDelayMs, isTransientPlatformError, MAX_TRANSIENT_RETRIES } from "@/lib/services/rate-limit.policy";
import { getCachedInventorySettings } from "@/lib/services/inventory-settings.service";
import { stockPushDisabledReason } from "@/lib/services/stock-push.policy";
import { allocationQuantity, resolveAllocation } from "@/lib/services/stock-allocation.policy";
import { safeStockPushMessage } from "@/lib/services/stock-push-error";

export const DEBOUNCE_WINDOW_MS = 8_000;
const BATCH_CHUNK = 50;
type Delivery = { success: boolean; skipped: boolean; outcome: "success" | "failed" | "disabled"; error?: string };
type Entry = StockBatchItem & { revision: number; fresh: boolean; logged: Promise<void>; waiters: Array<(result: Delivery) => void> };
type AccountQueue = { pending: Map<string, Entry>; revisions: Map<string, number>; attempts: Map<string, number>; timer: ReturnType<typeof setTimeout> | null; retries: Set<ReturnType<typeof setTimeout>>; flushing: boolean };
const queues = new Map<string, AccountQueue>();
function getQueue(id: string): AccountQueue {
  let queue = queues.get(id);
  if (!queue) { queue = { pending: new Map(), revisions: new Map(), attempts: new Map(), timer: null, retries: new Set(), flushing: false }; queues.set(id, queue); }
  return queue;
}
function timer(queue: AccountQueue, accountId: string) {
  if (queue.timer !== null || queue.flushing) return;
  queue.timer = setTimeout(() => { queue.timer = null; void flushAccount(accountId); }, DEBOUNCE_WINDOW_MS);
  queue.timer.unref?.();
}
function enqueue(accountId: string, channelSku: string, quantity: number, fresh: boolean, waiter?: (result: Delivery) => void) {
  const queue = getQueue(accountId);
  const old = queue.pending.get(channelSku);
  const revision = (queue.revisions.get(channelSku) ?? 0) + 1;
  queue.revisions.set(channelSku, revision);
  queue.attempts.delete(channelSku);
  const entry: Entry = { channelSku, quantity, revision, fresh, waiters: [...(old?.waiters ?? []), ...(waiter ? [waiter] : [])],
    logged: old?.logged ?? logStockPush(accountId, channelSku, quantity, "deferred", "Stok masuk antrean; belum diterima marketplace.") };
  queue.pending.set(channelSku, entry);
  return queue;
}
export function scheduleStockPush(accountId: string, channelSku: string, quantity: number, fresh = false): void {
  timer(enqueue(accountId, channelSku, quantity, fresh), accountId);
}
export function pushStockAndWait(accountId: string, channelSku: string, quantity: number): Promise<Delivery> {
  return new Promise((resolve) => { enqueue(accountId, channelSku, quantity, true, resolve); void flushAccount(accountId); });
}
async function flushAccount(accountId: string) {
  const queue = getQueue(accountId);
  if (queue.flushing) return;
  queue.flushing = true;
  if (queue.timer !== null) { clearTimeout(queue.timer); queue.timer = null; }
  try {
    while (queue.pending.size) {
      const snapshot = [...queue.pending.values()]; queue.pending.clear();
      await Promise.all(snapshot.map((item) => item.logged));
      for (let offset = 0; offset < snapshot.length; offset += BATCH_CHUNK) {
        const chunk = snapshot.slice(offset, offset + BATCH_CHUNK);
        try { await flushChunk(accountId, chunk, queue); }
        catch (error) { for (const item of chunk) await itemError(accountId, item, error, queue); }
      }
    }
  } finally { queue.flushing = false; if (queue.pending.size) timer(queue, accountId); }
}
function current(queue: AccountQueue, item: Entry) { return queue.revisions.get(item.channelSku) === item.revision; }
function settle(item: Entry, result: Delivery) { item.waiters.forEach((resolve) => resolve(result)); }
async function flushChunk(accountId: string, chunk: Entry[], queue: AccountQueue) {
  const account = await prisma.platformAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Akun marketplace tidak ditemukan.");
  const settings = await getCachedInventorySettings(account.businessId);
  const disabled = stockPushDisabledReason(account, settings);
  if (disabled) {
    for (const item of chunk) { await logStockPush(accountId, item.channelSku, item.quantity, "skipped_disabled", disabled); settle(item, { success: true, skipped: true, outcome: "disabled", error: disabled }); }
    return;
  }
  if (!account.accessToken || !account.shopCipher || account.platform !== "TIKTOK_SHOP") throw new Error("Koneksi toko TikTok belum lengkap.");
  const ready: Entry[] = [];
  for (const item of chunk) {
    if (!current(queue, item)) { settle(item, { success: false, skipped: true, outcome: "failed", error: "Antrean digantikan stok lebih baru." }); continue; }
    const mapping = await prisma.productMapping.findUnique({ where: { accountId_channelSku: { accountId, channelSku: item.channelSku } }, include: { variant: { include: { masterProduct: { select: { businessId: true } } } } } });
    if (!mapping?.variant || mapping.variant.masterProduct.businessId !== account.businessId) { await itemError(accountId, item, new Error("Mapping SKU master tidak tersedia atau berbeda customer."), queue); continue; }
    let quantity = item.quantity;
    if (item.fresh) {
      const count = await prisma.productMapping.count({ where: { variantId: mapping.variantId, account: { businessId: account.businessId } } });
      quantity = allocationQuantity(Math.max(0, mapping.variant.stock - mapping.variant.safetyStock), resolveAllocation(mapping, account), count);
    }
    ready.push({ ...item, quantity, productId: mapping.platformProductId ?? undefined, skuId: mapping.platformSkuId ?? undefined, sellerSku: mapping.sellerSku ?? undefined });
  }
  if (!ready.length) return;
  const result = await withRefreshedTiktokToken(account, async (token, creds) => {
    const response = await updateStockBatch(token, ready, account.shopCipher!, creds);
    const auth = response.failed.find((failure) => failure.error instanceof TikTokApiError && failure.error.kind === "AUTH");
    if (auth) throw auth.error;
    return response;
  });
  for (const item of result.ok) {
    const entry = ready.find((entry) => entry.channelSku === item.channelSku)!;
    if (current(queue, entry)) { queue.attempts.delete(item.channelSku); await logStockPush(accountId, item.channelSku, item.quantity, "success", `Stok ${item.quantity} diterima TikTok Shop.`); }
    settle(entry, { success: true, skipped: false, outcome: "success" });
  }
  for (const failed of result.failed) await itemError(accountId, ready.find((entry) => entry.channelSku === failed.item.channelSku)!, failed.error, queue);
}
async function itemError(accountId: string, item: Entry, error: unknown, queue: AccountQueue) {
  const message = safeStockPushMessage(error);
  if (!current(queue, item)) { settle(item, { success: false, skipped: true, outcome: "failed", error: "Antrean digantikan stok lebih baru." }); return; }
  const transient = isTransientPlatformError(error);
  const attempt = (queue.attempts.get(item.channelSku) ?? 0) + 1;
  await logStockPush(accountId, item.channelSku, item.quantity, "error", transient
    ? `Push stok gagal sementara; retry backoff ke-${attempt} dikelola antrean atau job durable.`
    : "Push stok ditolak (permanen/validasi); TIDAK di-retry otomatis oleh antrean.", message);
  // Job durable memiliki backoff sendiri; jangan jadwalkan retry kedua untuk waiter.
  if (!item.waiters.length && isTransientPlatformError(error)) {
    queue.attempts.set(item.channelSku, attempt);
    if (attempt <= MAX_TRANSIENT_RETRIES) {
      const retry = setTimeout(() => {
        queue.retries.delete(retry);
        if (queues.get(accountId) !== queue || !current(queue, item)) return;
        if (!queue.pending.has(item.channelSku)) queue.pending.set(item.channelSku, item);
        timer(queue, accountId);
      }, backoffDelayMs(attempt - 1));
      retry.unref?.(); queue.retries.add(retry);
    }
  }
  settle(item, { success: false, skipped: false, outcome: "failed", error: message });
}
export function _resetStockPushQueueForTests(): void {
  for (const queue of queues.values()) { if (queue.timer !== null) clearTimeout(queue.timer); for (const retry of queue.retries) clearTimeout(retry); }
  queues.clear();
}
