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
  success: "bg-emerald-100 text-emerald-700 border-emerald-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  processing: "bg-blue-100 text-blue-700 border-blue-200",
  shipped: "bg-indigo-100 text-indigo-700 border-indigo-200",
  delivered: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled: "bg-gray-100 text-gray-700 border-gray-200",
  returned: "bg-orange-100 text-orange-700 border-orange-200",
  refunded: "bg-violet-100 text-violet-700 border-violet-200",
  mismatch: "bg-red-100 text-red-700 border-red-200",
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  inactive: "bg-gray-100 text-gray-700 border-gray-200",
  draft: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-amber-100 text-amber-700 border-amber-200",
  out: "bg-red-100 text-red-700 border-red-200",
  ok: "bg-emerald-100 text-emerald-700 border-emerald-200",
  warning: "bg-amber-100 text-amber-700 border-amber-200",
  info: "bg-blue-100 text-blue-700 border-blue-200",
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