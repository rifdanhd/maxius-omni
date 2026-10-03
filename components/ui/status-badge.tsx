"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusVariant =
  | "success"
  | "failed"
  | "pending"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "returned"
  | "refunded"
  | "mismatch"
  | "active"
  | "inactive"
  | "draft"
  | "low"
  | "out"
  | "ok"
  | "warning"
  | "info";

const statusStyles: Record<StatusVariant, string> = {
  success: "bg-gray-100 text-gray-900 border-gray-200",
  failed: "bg-gray-100 text-gray-900 border-gray-200",
  pending: "bg-gray-100 text-gray-900 border-gray-200",
  processing: "bg-gray-100 text-gray-900 border-gray-200",
  shipped: "bg-gray-100 text-gray-900 border-gray-200",
  delivered: "bg-gray-100 text-gray-900 border-gray-200",
  cancelled: "bg-gray-100 text-gray-700 border-gray-200",
  returned: "bg-gray-100 text-gray-900 border-gray-200",
  refunded: "bg-gray-100 text-gray-900 border-gray-200",
  mismatch: "bg-gray-100 text-gray-900 border-gray-200",
  active: "bg-gray-100 text-gray-900 border-gray-200",
  inactive: "bg-gray-100 text-gray-700 border-gray-200",
  draft: "bg-gray-100 text-gray-900 border-gray-200",
  low: "bg-gray-100 text-gray-900 border-gray-200",
  out: "bg-gray-100 text-gray-900 border-gray-200",
  ok: "bg-gray-100 text-gray-900 border-gray-200",
  warning: "bg-gray-100 text-gray-900 border-gray-200",
  info: "bg-gray-100 text-gray-900 border-gray-200",
};

export interface StatusBadgeProps {
  status: StatusVariant | string;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const style = statusStyles[status as StatusVariant] ?? "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <Badge
      variant="outline"
      className={cn("px-2 py-0.5 text-xs font-semibold border", style, className)}
    >
      {label ?? status}
    </Badge>
  );
}

// Convenience: map common API status strings to our variants
export function normalizeStatus(status: string): StatusVariant {
  const s = status.toUpperCase();
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