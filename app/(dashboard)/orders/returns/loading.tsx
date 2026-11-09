import { TablePageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return <TablePageSkeleton container="space-y-4 p-6" rows={5} />;
}
