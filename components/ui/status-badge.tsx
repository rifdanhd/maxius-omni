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
  success: "bg-muted text-foreground border-border",
  failed: "bg-muted text-foreground border-border",
  pending: "bg-muted text-foreground border-border",
  processing: "bg-muted text-foreground border-border",
  shipped: "bg-muted text-foreground border-border",
  delivered: "bg-muted text-foreground border-border",
  cancelled: "bg-muted text-foreground border-border",
  returned: "bg-muted text-foreground border-border",
  refunded: "bg-muted text-foreground border-border",
  mismatch: "bg-muted text-foreground border-border",
  active: "bg-muted text-foreground border-border",
  inactive: "bg-muted text-foreground border-border",
  draft: "bg-muted text-foreground border-border",
  low: "bg-muted text-foreground border-border",
  out: "bg-muted text-foreground border-border",
  ok: "bg-muted text-foreground border-border",
  warning: "bg-muted text-foreground border-border",
  info: "bg-muted text-foreground border-border",
};

export interface StatusBadgeProps {
  status: StatusVariant | string;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const style = statusStyles[status as StatusVariant] ?? "bg-muted text-foreground border-border";
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