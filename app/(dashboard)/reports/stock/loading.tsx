import { CardsPageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return (
    <CardsPageSkeleton
      container="space-y-6 p-4 md:p-8"
      cards={4}
      cardClassName="h-28 rounded-xl border border-border bg-card"
      gridClassName="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      chartClassName="h-64"
    />
  );
}
