import { Skeleton } from "@/components/ui/skeleton"

// What a dashboard/Hub page looks like while its segment loads (loading.tsx) — a title row and
// a content block, so navigation shows the page's shape at once instead of a blank area.
export function PageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-9 w-32 max-sm:hidden" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
