import { CardsPageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return (
    <CardsPageSkeleton
      container="mx-auto max-w-[1500px] space-y-5 p-4 pb-28 md:p-8"
      cards={3}
      cardClassName="h-28 w-full rounded-xl border border-border bg-card"
      gridClassName="space-y-3"
    />
  );
}
