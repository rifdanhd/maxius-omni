import { FormPageSkeleton } from "@/components/ui/page-skeleton";

export default function Loading() {
  return <FormPageSkeleton container="space-y-4 p-4 md:p-8" fields={5} />;
}
