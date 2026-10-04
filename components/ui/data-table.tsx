"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  headerClassName?: string;
  render?: (row: T, index: number) => React.ReactNode;
  align?: "left" | "center" | "right";
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ReactNode;
  emptyAction?: React.ReactNode;
  rowClassName?: (row: T, index: number) => string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  loadMoreText?: string;
  caption?: string;
  className?: string;
}

function SkeletonRow<T>({ columns }: { columns: Column<T>[] }) {
  return (
    <TableRow>
      {columns.map((col) => (
        <TableCell key={col.key} className={cn("p-4", col.className)}>
          <Skeleton className="h-4 w-full" />
        </TableCell>
      ))}
    </TableRow>
  );
}

function LoadingSkeleton<T>({ columns, rows = 5 }: { columns: Column<T>[]; rows?: number }) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} columns={columns} />
      ))}
    </TableBody>
  );
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  loading = false,
  emptyTitle = "Tidak ada data",
  emptyDescription,
  emptyIcon,
  emptyAction,
  rowClassName,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  loadMoreText = "Muat Lebih Banyak",
  caption,
  className,
}: DataTableProps<T>) {
  const alignClass = (align?: "left" | "center" | "right") =>
    align === "right" ? "text-right" : align === "center" ? "text-center" : "";

  if (loading) {
    return (
      <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn("h-10 px-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground", col.headerClassName, alignClass(col.align))}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <LoadingSkeleton columns={columns} />
        </Table>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn("h-10 px-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground", col.headerClassName, alignClass(col.align))}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={columns.length} className="p-0">
                <EmptyState
                  title={emptyTitle}
                  description={emptyDescription}
                  icon={emptyIcon}
                  action={emptyAction}
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <Table className="min-w-full">
        <TableHeader>
          <TableRow className="bg-muted border-b border-border">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  "h-10 px-4 font-semibold text-xs uppercase tracking-wider text-muted-foreground",
                  col.headerClassName,
                  alignClass(col.align)
                )}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, index) => (
            <TableRow
              key={keyExtractor(row)}
              className={cn(
                "border-b border-border last:border-0 hover:bg-muted/50 transition-colors",
                rowClassName?.(row, index)
              )}
            >
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  className={cn("px-4 py-3 align-middle", col.className, alignClass(col.align))}
                >
                  {col.render ? col.render(row, index) : String((row as Record<string, unknown>)[col.key] ?? "—")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {caption && (
        <TableCaption className={cn("mt-2 text-[11px] text-muted-foreground px-2", caption)} />
      )}
      {hasMore && onLoadMore && (
        <div className="px-4 py-3 border-t border-border text-center bg-muted/50">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="w-full sm:w-auto"
          >
            {loadingMore ? "Memuat…" : loadMoreText}
          </Button>
        </div>
      )}
    </div>
  );
}