"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  action,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6",
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-foreground break-words">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <div className="min-w-0 max-w-full flex-shrink-0 [&>div]:flex-wrap [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:h-auto [&_button]:min-h-9">{action}</div>
      )}
    </div>
  );
}
