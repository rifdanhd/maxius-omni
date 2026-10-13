"use client";

import { useEffect, useRef, useState } from "react";
import type { StockAlertsResponse } from "@/app/api/stock-alerts/route";
import { authFetch, getActiveBusinessId } from "@/lib/utils/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { APPLICATION_NOTIFICATION_EVENT, localNotificationStorageKey, notificationStorageKey, readLocalNotifications, readNotificationMemory, reconcileNotifications, writeLocalNotifications, type ApplicationNotificationDetail, type NotificationItem, type NotificationMemory } from "@/lib/ui/notifications";

type SyncResponse = { rows: Array<{ id: string; status: string; retryCount: number; updatedAt: string; account: { label: string }; variant: { productName: string } }>; nextCursor?: string | null };
type Store = { id: string; name: string; status: string; isFrozen?: boolean; tokenExpiresAt?: string };
type View = { scope: string; rows: NotificationItem[]; loading: boolean; failed: string[]; more: boolean };
const initial: View = { scope: "", rows: [], loading: true, failed: [], more: false };

export function useNotifications() {
  const username = useAuthStore((state) => state.auth.user?.accountNo ?? "");
  const [view, setView] = useState<View>(initial);
  const viewRef = useRef(view);
  const memory = useRef<{ scope: string; value: NotificationMemory }>({ scope: "", value: {} });
  const refresh = useRef<() => void>(() => {});

  function save(scope: string, value: NotificationMemory) {
    memory.current = { scope, value };
    try { localStorage.setItem(scope, JSON.stringify(value)); } catch { /* Tetap berfungsi selama sesi ini. */ }
  }
  function update(next: View) { viewRef.current = next; setView(next); }

  useEffect(() => {
    let cancelled = false;
    let running = false;
    const controller = new AbortController();
    const scopeNow = () => notificationStorageKey(username, getActiveBusinessId());
    const read = async <T,>(url: string): Promise<T> => {
      const response = await authFetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("Notifikasi belum dapat dimuat.");
      return response.json() as Promise<T>;
    };
    async function load() {
      if (!username || running) return;
      running = true;
      const scope = scopeNow();
      if (viewRef.current.scope !== scope) update({ ...initial, scope });
      const [stock, sync, stores] = await Promise.allSettled([
        read<StockAlertsResponse>("/api/stock-alerts"),
        read<SyncResponse>("/api/sync-jobs?status=mismatch&limit=100"),
        read<Store[]>("/api/stores"),
      ]);
      running = false;
      if (cancelled) return;
      if (scope !== scopeNow()) { void load(); return; }
      const items: NotificationItem[] = [];
      const failed: string[] = [];
      const failedSources = new Set<NotificationItem["source"]>();
      if (stock.status === "fulfilled") {
        for (const item of stock.value.alerts ?? []) items.push({ id: `stock:${item.variantId}`, source: "stock", fingerprint: item.severity, severity: item.severity === "out" ? "error" : "warning", title: item.severity === "out" ? "Stok habis" : "Stok menipis", description: `${item.productName} · ${item.variantSku} · ${item.effectiveStock.toLocaleString("id-ID")} tersedia`, href: "/inventory" });
        if (stock.value.reminder?.due) items.push({ id: "opname", source: "opname", fingerprint: `${stock.value.reminder.frequency}:${stock.value.reminder.lastOpnameAt}`, severity: "warning", title: "Waktunya opname stok", description: "Periksa stok fisik agar catatan inventori tetap sesuai.", href: "/inventory/opname" });
      } else { failed.push("peringatan stok"); failedSources.add("stock"); failedSources.add("opname"); }
      if (sync.status === "fulfilled") {
        for (const job of sync.value.rows ?? []) items.push({ id: `sync:${job.id}`, source: "sync", fingerprint: `${job.status}:${job.retryCount}`, severity: "error", occurredAt: job.updatedAt, title: "Gagal sinkron stok", description: `${job.account.label} · ${job.variant.productName}`, href: "/inventory/mismatch" });
      } else { failed.push("sinkronisasi"); failedSources.add("sync"); }
      if (stores.status === "fulfilled") {
        for (const store of stores.value) {
          if (store.status !== "expired" && !store.isFrozen) continue;
          items.push({ id: `store:${store.id}`, source: "store", fingerprint: `${store.status}:${store.isFrozen}:${store.tokenExpiresAt}`, severity: "error", title: store.isFrozen ? "Koneksi toko dibekukan" : "Koneksi toko kedaluwarsa", description: `${store.name} · Periksa koneksi melalui Pengaturan Toko.`, href: "/settings/accounts" });
        }
      } else { failed.push("koneksi toko"); failedSources.add("store"); }
      items.push(...readLocalNotifications(scope));
      const oldRows = viewRef.current.scope === scope ? viewRef.current.rows : [];
      items.push(...oldRows.filter((item) => failedSources.has(item.source)));
      const stored = { ...(memory.current.scope === scope ? memory.current.value : {}), ...readNotificationMemory(scope) };
      const result = reconcileNotifications(items, stored, new Date().toISOString());
      save(scope, result.memory);
      update({ scope, rows: result.rows, loading: false, failed, more: sync.status === "fulfilled" && Boolean(sync.value.nextCursor) });
    }
    const refreshNow = () => { void load(); };
    refresh.current = refreshNow;
    void load();
    const timer = window.setInterval(refreshNow, 60_000);
    window.addEventListener("focus", refreshNow);
    const onStorage = (event: StorageEvent) => {
      if (event.key === "activeBusinessId") { refreshNow(); return; }
      const scope = scopeNow();
      if (event.key === localNotificationStorageKey(scope)) { refreshNow(); return; }
      if (event.key !== scope) return;
      const stored = readNotificationMemory(scope);
      memory.current = { scope, value: stored };
      update({ ...viewRef.current, rows: viewRef.current.rows.map((item) => ({ ...item, read: stored[item.id]?.fingerprint === item.fingerprint && stored[item.id]?.read })) });
    };
    const onApplicationNotification = (event: Event) => {
      const detail = (event as CustomEvent<ApplicationNotificationDetail>).detail;
      if (!detail?.notification || detail.notification.source !== "local") return;
      const scope = scopeNow();
      const nextLocal = [detail.notification, ...readLocalNotifications(scope).filter((item) => item.id !== detail.notification.id)];
      const important = nextLocal.filter((item) => !item.fingerprint.startsWith("success:")).slice(0, 27);
      const routine = nextLocal.filter((item) => item.fingerprint.startsWith("success:")).slice(0, 3);
      const local = [...important, ...routine].sort((a, b) => Date.parse(b.occurredAt ?? "") - Date.parse(a.occurredAt ?? ""));
      writeLocalNotifications(scope, local);
      const items = [
        ...viewRef.current.rows.filter((item) => item.source !== "local"),
        ...local,
      ];
      const stored = { ...(memory.current.scope === scope ? memory.current.value : {}), ...readNotificationMemory(scope) };
      const result = reconcileNotifications(items, stored, new Date().toISOString());
      if (detail.variant === "success") {
        result.memory[detail.notification.id].read = true;
        const row = result.rows.find((item) => item.id === detail.notification.id);
        if (row) row.read = true;
      }
      save(scope, result.memory);
      update({ ...viewRef.current, scope, rows: result.rows, loading: false });
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(APPLICATION_NOTIFICATION_EVENT, onApplicationNotification);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); window.removeEventListener("focus", refreshNow); window.removeEventListener("storage", onStorage); window.removeEventListener(APPLICATION_NOTIFICATION_EVENT, onApplicationNotification); };
  }, [username]);

  function markRead(id?: string) {
    const stored = { ...readNotificationMemory(view.scope), ...(memory.current.scope === view.scope ? memory.current.value : {}) };
    const rows = view.rows.map((item) => {
      if (id && item.id !== id) return item;
      stored[item.id] = { fingerprint: item.fingerprint, detectedAt: item.detectedAt!, read: true };
      return { ...item, read: true };
    });
    save(view.scope, stored);
    update({ ...view, rows });
  }
  return { ...view, markRead, refresh: () => refresh.current() };
}
