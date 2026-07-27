"use client"

import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"

// Shows exactly what WOULD be published for a link, without publishing anything.
//
// This is the cheap moment to catch a mapping mistake. Once sharing is on, the next thing
// that notices a wrong number is an OTA — and by then it has either sold a room that does
// not exist or hidden one that does.

type Night = { date: string; available: number; closed: boolean }
type RoomTypePlan = {
  roomTypeId: string
  roomTypeName: string
  roomTypeCode: string
  externalRoomId: string
  nights: Night[]
}
type Plan = {
  propertyName: string
  externalPropertyId: string
  syncEnabled: boolean
  from: string
  to: string
  roomTypes: RoomTypePlan[]
  excluded: { roomTypeId: string; roomTypeName: string; reason: string }[]
}

function shortDate(iso: string) {
  const [, m, d] = iso.split("-")
  return `${d}/${m}`
}

export function AvailabilityPreview({
  linkId,
  propertyName,
  open,
  onOpenChange,
}: {
  linkId: string
  propertyName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/hub/property-links/${linkId}/preview?days=14`)
      if (!res.ok) throw new Error("failed")
      setPlan(await res.json())
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [linkId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>What would be sent — {propertyName}</DialogTitle>
          <DialogDescription>
            The next 14 nights, computed from live inventory. Nothing is sent by opening this.
          </DialogDescription>
        </DialogHeader>

        {loading && <Skeleton className="h-48 w-full" />}
        {failed && <ErrorState onRetry={() => void load()} />}

        {!loading && !failed && plan && (
          <div className="space-y-4">
            {!plan.syncEnabled && (
              <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
                Sharing is currently off for this property — this is what would be sent once it is on.
              </p>
            )}

            {plan.roomTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No room types would be published.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="p-2 text-left font-medium">Room type</th>
                      {plan.roomTypes[0].nights.map((n) => (
                        <th key={n.date} className="p-2 text-center font-medium tabular-nums">
                          {shortDate(n.date)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.roomTypes.map((rt) => (
                      <tr key={rt.roomTypeId} className="border-b border-border last:border-0">
                        <td className="p-2">
                          <span className="font-medium">{rt.roomTypeName}</span>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            → {rt.externalRoomId}
                          </span>
                        </td>
                        {rt.nights.map((n) => (
                          <td
                            key={n.date}
                            className={`p-2 text-center tabular-nums ${
                              n.closed
                                ? "bg-destructive-muted font-semibold text-destructive"
                                : n.available === 0
                                  ? "text-muted-foreground"
                                  : ""
                            }`}
                            // Closed and zero look different on purpose — they mean
                            // different things at the channel.
                            title={n.closed ? "Stop-sale — room type closed at the channel" : undefined}
                          >
                            {n.closed ? "×" : n.available}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-destructive">×</span> = stop-sale, closed at the channel (distinct
              from 0, which means sold out but still listed).
            </p>

            {plan.excluded.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">Not published</h4>
                <ul className="space-y-1">
                  {plan.excluded.map((e) => (
                    <li key={e.roomTypeId} className="flex items-center gap-2 text-sm">
                      <Badge variant="secondary">{e.roomTypeName}</Badge>
                      <span className="text-muted-foreground">{e.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
