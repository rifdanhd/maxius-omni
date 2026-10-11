"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { feedbackStyles, type FeedbackVariant } from "@/lib/ui/feedback";
import { feedbackIcons } from "@/components/ui/feedback";

const statuses = {
  success: ["success", "Berhasil"], connected: ["success", "Terhubung"],
  failed: ["error", "Gagal sinkron"], error: ["error", "Gagal"], expired: ["error", "Koneksi kedaluwarsa"],
  pending: ["info", "Menunggu"], processing: ["info", "Diproses"], shipped: ["info", "Dikirim"],
  delivered: ["success", "Diterima"], cancelled: ["neutral", "Dibatalkan"],
  returned: ["warning", "Dikembalikan"], refunded: ["neutral", "Dana dikembalikan"],
  mismatch: ["warning", "Perlu diperiksa"], active: ["success", "Aktif"],
  inactive: ["neutral", "Nonaktif"], unlinked: ["neutral", "Belum terhubung"],
  draft: ["neutral", "Draf"], low: ["warning", "Menipis"], out: ["error", "Habis"],
  ok: ["success", "Aman"], warning: ["warning", "Perlu perhatian"], info: ["info", "Informasi"],
} satisfies Record<string, [FeedbackVariant, string]>;
export type StatusVariant = keyof typeof statuses;

export interface StatusBadgeProps {
  status: StatusVariant | string;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const normalized = Object.hasOwn(statuses, status.toLowerCase()) ? status.toLowerCase() as StatusVariant : normalizeStatus(status);
  const [variant, defaultLabel] = statuses[normalized];
  const Icon = feedbackIcons[variant];
  return <Badge variant="outline" data-status={normalized} className={cn("gap-1 px-2 py-0.5 text-xs font-medium", feedbackStyles[variant], className)}>
    <Icon aria-hidden="true" className="size-3" />{label ?? defaultLabel}
  </Badge>;
}

// Convenience: map common API status strings to our variants
export function normalizeStatus(status: string): StatusVariant {
  const s = status.toUpperCase();
  if (["NORMAL", "ACTIVATE", "APPROVED", "ONGOING"].includes(s)) return "active";
  if (["UNLIST", "DELETED", "SELLER_DEACTIVATED", "DISCONNECTED", "DEACTIVATED", "ENDED", "NOT_EFFECTIVE"].includes(s)) return "inactive";
  if (["BANNED", "REJECTED", "DISPUTED"].includes(s)) return "failed";
  if (["PARTIAL", "UNVERIFIED"].includes(s)) return "warning";
  if (s === "CONNECTED") return "connected";
  if (s === "UNLINKED") return "unlinked";
  if (s === "EXPIRED") return "expired";
  if (s === "COMPLETED" || s === "DONE") return "success";
  if (s === "IN_PROGRESS" || s === "IN_TRANSIT") return "processing";
  if (s.includes("SUCCESS") || s === "OK") return "success";
  if (s.includes("FAIL") || s.includes("ERROR")) return "failed";
  if (s.includes("PENDING") || s.includes("WAIT")) return "pending";
  if (s.includes("PROCESS") || s.includes("SHIP")) return "processing";
  if (s.includes("DELIVER") || s.includes("RECEIVE")) return "delivered";
  if (s.includes("CANCEL")) return "cancelled";
  if (s.includes("RETURN")) return "returned";
  if (s.includes("REFUND")) return "refunded";
  if (s.includes("MISMATCH")) return "mismatch";
  if (s.includes("ACTIVE") && !s.includes("INACTIVE")) return "active";
  if (s.includes("INACTIVE")) return "inactive";
  if (s.includes("DRAFT")) return "draft";
  return "info";
}
