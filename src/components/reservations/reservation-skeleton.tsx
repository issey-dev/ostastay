import { Skeleton } from "@/components/ui/skeleton"

// The reservation page's loading state, drawn in the shape of the real page (header, guest
// card, detail card, room table, and the stay-summary rail on desktop) so the content
// settles into the places the skeleton held instead of the layout jumping.

function SkeletonCard({ lines, className }: { lines: number; className?: string }) {
  return (
    <div className={`space-y-4 border border-border bg-card p-5 shadow-elevation-1 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${88 - ((i * 17) % 40)}%` }} />
        ))}
      </div>
    </div>
  )
}

export function ReservationSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading reservation">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-4 w-36" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-6 w-20" />
          </div>
        </div>
        <div className="flex gap-2 max-md:hidden">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6 lg:space-y-0">
        <div className="min-w-0 space-y-6">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={5} />
          <SkeletonCard lines={3} />
        </div>
        <div className="space-y-0 border border-border bg-card shadow-elevation-1 max-lg:hidden">
          <div className="space-y-3 p-4">
            <div className="flex justify-between">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-4 w-14" />
            </div>
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="space-y-3 border-t border-border p-4">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
