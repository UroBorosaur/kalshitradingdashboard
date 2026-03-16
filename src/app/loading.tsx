import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-full" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-52" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-[360px]" />
          <Skeleton className="h-[360px]" />
        </div>
        <Skeleton className="h-[640px]" />
      </div>
      <Skeleton className="h-[280px]" />
    </div>
  );
}
