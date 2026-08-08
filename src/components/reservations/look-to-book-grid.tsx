"use client"

import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"

export type GridData = {
  nights: number
  roomTypes: {
    id: string
    code: string
    name: string
    isPseudo: boolean
    baseOccupancy: number
    maxOccupancy: number
    minAvailable: number | null
    soldOutNights: string[]
  }[]
  ratePlans: {
    id: string
    code: string
    name: string
    isNegotiated: boolean
    negotiatedForProfileIds: string[]
    parentRatePlanId: string | null
  }[]
  grid: Record<
    string,
    Record<string, { total: number; avgNightly: number; pricedNights: number; unpricedNights: number; extraOccupancyTotal: number } | null>
  >
}

type LookToBookGridProps = {
  gridData: GridData
  visibleRatePlans: GridData["ratePlans"]
  selectedRoomTypeId?: string
  selectedRatePlanId?: string
  onSelect: (roomTypeId: string, ratePlanId: string) => void
}

// The rate × room-type availability matrix ("Look-to-Book") — a pure display
// component: what's on offer, what's sold out, what's selected. Selection state
// and segment bookkeeping live in the parent form.
export function LookToBookGrid({ gridData, visibleRatePlans, selectedRoomTypeId, selectedRatePlanId, onSelect }: LookToBookGridProps) {
  return (
    <div className="overflow-x-auto border rounded-md bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="sticky left-0 z-10 text-left font-medium text-muted-foreground px-3 py-2 w-36 md:w-44 bg-muted">Rate Plan</th>
            {gridData.roomTypes.map(rt => (
              <th key={rt.id} className="px-3 py-2 text-center font-medium">
                <div>{rt.name}</div>
                <div className="text-[10px] font-normal text-muted-foreground">
                  Occ. {rt.baseOccupancy}–{rt.maxOccupancy}
                </div>
                <div className="text-[11px] font-normal">
                  {rt.minAvailable === null ? (
                    <span className="text-muted-foreground">unlimited</span>
                  ) : rt.minAvailable <= 0 ? (
                    <span className="text-destructive">
                      Sold out{rt.soldOutNights[0] ? ` ${format(new Date(rt.soldOutNights[0]), "dd MMM")}` : ""}
                    </span>
                  ) : (
                    <span className="text-info">{rt.minAvailable} left</span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRatePlans.map(rp => (
            <tr key={rp.id} className="border-b last:border-b-0">
              <td className="sticky left-0 z-10 bg-card px-3 py-2 text-muted-foreground">
                <span className="font-mono text-xs">{rp.code}</span>
                <span className="block text-xs">
                  {rp.name}
                  {rp.isNegotiated && (
                    <Badge variant="outline" className="ml-1.5 bg-warning-muted text-warning border-warning/30 text-[10px]">
                      Negotiated
                    </Badge>
                  )}
                </span>
              </td>
              {gridData.roomTypes.map(rt => {
                const cell = gridData.grid[rp.id]?.[rt.id]
                const soldOut = rt.minAvailable !== null && rt.minAvailable <= 0
                const selected = selectedRoomTypeId === rt.id && selectedRatePlanId === rp.id
                return (
                  <td key={rt.id} className="px-1.5 py-1.5 text-center">
                    <button
                      type="button"
                      disabled={soldOut}
                      onClick={() => onSelect(rt.id, rp.id)}
                      className={`w-full rounded-md border px-2 py-2 font-medium transition-colors ${
                        soldOut
                          ? "border-border text-muted-foreground/50 line-through cursor-not-allowed"
                          : selected
                          ? "border-info bg-info-muted text-info"
                          : "border-border hover:border-foreground/40"
                      }`}
                    >
                      {cell ? (
                        <>
                          ${cell.avgNightly.toFixed(2)}
                          {cell.unpricedNights > 0 && (
                            <span className="text-warning" title={`${cell.unpricedNights} night(s) have no rate configured`}>*</span>
                          )}
                        </>
                      ) : (
                        <span className="font-normal italic text-muted-foreground">No rate</span>
                      )}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
