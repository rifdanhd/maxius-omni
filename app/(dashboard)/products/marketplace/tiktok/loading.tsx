import { TablePageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return (
    <TablePageSkeleton container="space-y-4 p-4 md:p-8" filters rows={8} />
  );
}
