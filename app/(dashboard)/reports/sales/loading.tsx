import { CardsPageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return (
    <CardsPageSkeleton
      container="space-y-6 p-6"
      cards={3}
      gridClassName="grid grid-cols-1 gap-4 sm:grid-cols-3"
      chartClassName="h-[360px]"
    />
  );
}
