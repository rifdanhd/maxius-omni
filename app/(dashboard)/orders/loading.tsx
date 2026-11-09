import { CardsPageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return (
    <CardsPageSkeleton
      container="flex min-h-full min-w-0 flex-col gap-4 p-3 font-sans sm:p-6"
      cards={4}
      cardClassName="h-28 bg-muted/40"
      gridClassName="divide-y divide-border"
    />
  );
}
