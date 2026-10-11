"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Request = { message: string; title: string; confirmText: string; destructive: boolean; resolve: (confirmed: boolean) => void; trigger: HTMLElement | null };
let current: Request | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => current;
const emit = () => listeners.forEach((listener) => listener());

export function confirmAction(message: string, options: { title?: string; confirmText?: string; destructive?: boolean } = {}): Promise<boolean> {
  if (current || typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const destructive = options.destructive ?? /hapus/i.test(message);
    current = { message, title: options.title ?? (destructive ? "Hapus data ini?" : "Lanjutkan tindakan ini?"), confirmText: options.confirmText ?? (destructive ? "Hapus" : "Lanjutkan"), destructive, resolve, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    emit();
  });
}

function finish(confirmed: boolean) {
  const request = current;
  current = null;
  emit();
  request?.resolve(confirmed);
  request?.trigger?.focus();
}

export function ConfirmationHost() {
  const request = useSyncExternalStore(subscribe, snapshot, () => null);
  useEffect(() => () => { if (current) finish(false); }, []);
  return <ConfirmDialog open={Boolean(request)} onOpenChange={(open) => { if (!open) finish(false); }} title={request?.title ?? "Konfirmasi"} desc={request?.message ?? ""} confirmText={request?.confirmText} destructive={request?.destructive} handleConfirm={() => finish(true)} />;
}
