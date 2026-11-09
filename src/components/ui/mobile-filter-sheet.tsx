"use client"

import * as React from "react"
import { Filter } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerBody, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { cn } from "@/lib/utils"

// Phones: a list's secondary filters behind one "Filters" button that opens a bottom sheet,
// instead of a wrapping row of half-width selects above the list (MOBILE_PLAN.md; the owner
// wants nothing on a phone to sit cramped or scroll sideways). The page renders its own
// controls as children, stacked full width; the sheet adds Clear and a Done button that says
// how many results the filters leave.
//
//   <MobileFilterSheet activeCount={n} onClear={clear} resultLabel={`Show ${rows.length} transfers`}>
//     <OptionSelect …/>  <OptionSelect …/>
//   </MobileFilterSheet>
export function MobileFilterSheet({
  activeCount = 0,
  onClear,
  resultLabel = "Done",
  title = "Filters",
  children,
  className,
}: {
  activeCount?: number
  onClear?: () => void
  /** The Done button's text, e.g. "Show 12 transfers". */
  resultLabel?: string
  title?: string
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger
        render={
          <Button variant="outline" className={cn("relative shrink-0 gap-1.5", activeCount > 0 && "border-foreground", className)} aria-label={activeCount ? `${title}, ${activeCount} on` : title} />
        }
      >
        <Filter className="h-4 w-4" />
        {title}
        {activeCount > 0 && (
          <span className="ml-0.5 min-w-5 rounded-full bg-foreground px-1.5 text-center text-[11px] font-semibold leading-5 text-background tabular-nums">{activeCount}</span>
        )}
      </DrawerTrigger>
      <DrawerContent initialFocus={false}>
        <DrawerHeader className="flex items-center justify-between gap-3">
          <DrawerTitle>{title}</DrawerTitle>
          {onClear && (
            <Button variant="ghost" size="sm" disabled={activeCount === 0} onClick={onClear}>
              Clear all
            </Button>
          )}
        </DrawerHeader>
        <DrawerBody className="space-y-3 [&_[data-slot=select-trigger]]:w-full">{children}</DrawerBody>
        <div className="shrink-0 border-t border-border px-4 pt-3 pb-1">
          <Button className="h-11 w-full" onClick={() => setOpen(false)}>
            {resultLabel}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
