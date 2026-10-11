"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { PackageOpen } from "lucide-react";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 md:py-16 px-4 text-center",
        className
      )}
    >
      {(
        <div className="mb-4 rounded-full border border-border bg-muted p-3 text-muted-foreground" aria-hidden="true">
          {icon ?? <PackageOpen className="size-6" />}
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground max-w-md">{description}</p>
      )}
      {action && (
        <div className="mt-4">{action}</div>
      )}
    </div>
  );
}
