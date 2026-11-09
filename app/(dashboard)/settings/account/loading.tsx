import { FormPageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return (
    <FormPageSkeleton container="mx-auto w-full max-w-2xl space-y-6" fields={2} />
  );
}
