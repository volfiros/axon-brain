import { PageShell } from "@/components/page-shell";
import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return (
    <PageShell account="loading">
      <PageSkeleton />
    </PageShell>
  );
}
