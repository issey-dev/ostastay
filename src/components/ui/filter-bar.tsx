"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Search, X } from "@/components/icons"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

// The one filter row above a list (DESKTOP_PLAN §3.5 — there were five layouts): search on
// the left, the page's selects/date range after it, and "Clear (n)" once anything is set.
// Presentational — the page owns the values; keep them in the URL with useUrlState so Back
// and refresh keep the filters.
//
//   <FilterBar search={{ value: q, onChange: setQ, placeholder: "Name, email, phone…" }}
//              activeCount={active} onClear={clearAll}>
//     <Select …/>
//   </FilterBar>
export function FilterBar({
  search,
  activeCount = 0,
  onClear,
  children,
  className,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }
  activeCount?: number
  onClear?: () => void
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {search && (
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? "Search"}
            autoFocus={search.autoFocus}
            className="pl-8"
            aria-label={search.placeholder ?? "Search"}
          />
        </div>
      )}
      {children}
      {onClear && activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onClear} className="gap-1 text-muted-foreground">
          <X className="h-3.5 w-3.5" /> Clear ({activeCount})
        </Button>
      )}
    </div>
  )
}
