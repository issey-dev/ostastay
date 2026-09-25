"use client"

import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { GridData } from "@/components/reservations/look-to-book-grid"

// The phone version of the Look-to-Book grid (.agents/docs/MOBILE_PLAN.md §2.2): one card
// per room type, its rate plans listed underneath as full-width tappable rows. Same data,
// same selection handler as the grid — only the shape changes, because a rate × room-type
// matrix shows about one and a half room types on a phone. `md:hidden`: desktop keeps the grid.
export function LookToBookCards({
  gridData,
  visibleRatePlans,
  selectedRoomTypeId,
  selectedRatePlanId,
  onSelect,
}: {
  gridData: GridData
  visibleRatePlans: GridData["ratePlans"]
  selectedRoomTypeId?: string
  selectedRatePlanId?: string
  onSelect: (roomTypeId: string, ratePlanId: string) => void
}) {
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {gridData.roomTypes.map((rt) => {
        const soldOut = rt.minAvailable !== null && rt.minAvailable <= 0
        return (
          <div
            key={rt.id}
            className={cn(
              "overflow-hidden rounded-xl border bg-card",
              selectedRoomTypeId === rt.id && "border-info/60"
            )}
          >
            <div className="flex items-start justify-between gap-3 border-b bg-muted/40 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{rt.name}</p>
                <p className="text-xs text-muted-foreground">
                  {rt.code} · Occ. {rt.baseOccupancy}–{rt.maxOccupancy}
                </p>
              </div>
              <span className="shrink-0 text-xs font-medium">
                {rt.minAvailable === null ? (
                  <span className="text-muted-foreground">unlimited</span>
                ) : soldOut ? (
                  <span className="text-destructive">
                    Sold out{rt.soldOutNights[0] ? ` ${format(new Date(rt.soldOutNights[0]), "dd MMM")}` : ""}
                  </span>
                ) : (
                  <span className="text-info">{rt.minAvailable} left</span>
                )}
              </span>
            </div>
            {visibleRatePlans.length === 0 ? (
              <p className="px-3 py-3 text-xs italic text-muted-foreground">No rate plans to show.</p>
            ) : (
              <ul className="divide-y">
                {visibleRatePlans.map((rp) => {
                  const cell = gridData.grid[rp.id]?.[rt.id]
                  const selected = selectedRoomTypeId === rt.id && selectedRatePlanId === rp.id
                  return (
                    <li key={rp.id}>
                      <button
                        type="button"
                        disabled={soldOut}
                        onClick={() => onSelect(rt.id, rp.id)}
                        aria-pressed={selected}
                        className={cn(
                          "flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors",
                          soldOut
                            ? "cursor-not-allowed text-muted-foreground/50 line-through"
                            : selected
                              ? "bg-info-muted text-info"
                              : "active:bg-muted"
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{rp.name}</span>
                          <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                            {rp.code}
                            {rp.isNegotiated && (
                              <Badge variant="outline" className="border-warning/30 bg-warning-muted font-sans text-[10px] text-warning">
                                Negotiated
                              </Badge>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          {cell ? (
                            <>
                              <span className="block text-sm font-semibold tabular-nums">
                                ${cell.avgNightly.toFixed(2)}
                                {cell.unpricedNights > 0 && (
                                  <span className="text-warning" title={`${cell.unpricedNights} night(s) have no rate configured`}>*</span>
                                )}
                              </span>
                              <span className="block text-[11px] text-muted-foreground">avg / night</span>
                            </>
                          ) : (
                            <span className="text-xs italic text-muted-foreground">No rate</span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
