"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

export interface DataCardProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
}

export function DataCard({
  title,
  description,
  action,
  children,
  footer,
  className,
  headerClassName,
  contentClassName,
  footerClassName,
}: DataCardProps) {
  const hasHeader = Boolean(title || description || action);
  return (
    <Card className={cn("shadow-sm", className)}>
      {hasHeader && (
        <CardHeader className={cn("border-b border-gray-100", headerClassName)}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full">
            <div>
              {title && <CardTitle className="text-lg">{title}</CardTitle>}
              {description && <CardDescription>{description}</CardDescription>}
            </div>
            {action && <CardAction>{action}</CardAction>}
          </div>
        </CardHeader>
      )}
      <CardContent className={cn(hasHeader ? "pt-0" : "", contentClassName)}>{children}</CardContent>
      {footer && (
        <CardFooter className={cn("border-t border-gray-100", footerClassName)}>
          {footer}
        </CardFooter>
      )}
    </Card>
  );
}