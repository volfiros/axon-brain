import { Skeleton } from "@/components/ui/skeleton";

export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Skeleton className="bg-surface-hover h-12 w-64" />
        <Skeleton className="bg-surface-hover h-4 w-40" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="bg-surface-hover h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
