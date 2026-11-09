import { FormPageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return (
    <FormPageSkeleton
      container="mx-auto max-w-4xl space-y-6 p-4 md:p-8"
      stepper
      fields={3}
    />
  );
}
