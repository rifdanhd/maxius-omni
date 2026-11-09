import { TablePageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return (
    <TablePageSkeleton
      container="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 md:p-8"
      stats={4}
      filters
      rows={6}
    />
  );
}
