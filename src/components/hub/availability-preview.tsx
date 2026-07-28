"use client"

import { Fragment, useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"

// Shows exactly what WOULD be published for a link, without publishing anything.
//
// This is the cheap moment to catch a mapping mistake. Once sharing is on, the next thing
// that notices a wrong number is an OTA — and by then it has either sold a room that does
// not exist or hidden one that does.

type Night = { date: string; available: number; closed: boolean; prices: Record<string, number> }
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

// Every channel rate id that appears on ANY night for this room type. Derived from the
// nights rather than assumed, so a rate priced on only some dates still gets a row —
// otherwise its partially-priced nights would be invisible.
function rateIdsFor(rt: RoomTypePlan): string[] {
  const ids = new Set<string>()
  for (const n of rt.nights) for (const id of Object.keys(n.prices)) ids.add(id)
  return [...ids].sort()
}

export function AvailabilityPreview({
  linkId,
  propertyName,
  canPush,
  open,
  onOpenChange,
}: {
  linkId: string
  propertyName: string
  canPush: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const confirm = useConfirm()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [pushing, setPushing] = useState(false)

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

  const handlePush = async () => {
    // Confirmed because this is the one control in the Hub whose effect is immediately
    // visible to the public — the numbers above go live on booking sites.
    const ok = await confirm({
      title: `Send this to the channel manager?`,
      description: `Availability for ${propertyName} will be published to the connected booking channels straight away.`,
      confirmLabel: "Send now",
    })
    if (!ok) return

    setPushing(true)
    try {
      const res = await fetch(`/api/hub/property-links/${linkId}/push`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not push")
        return
      }
      if (data.status === "PUSHED") {
        toast.success(`Sent ${data.roomTypeCount} room type(s), ${data.nightCount} nights`)
      } else {
        // SKIPPED and FAILED both arrive as 200 — the request succeeded, the push did not.
        toast.error(data.reason ?? `Not sent (${data.status})`)
      }
    } finally {
      setPushing(false)
    }
  }

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
                      <Fragment key={rt.roomTypeId}>
                        <tr className="border-b border-border">
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
                        {/* One row per rate actually being sent for this room type. An
                            unpriced night shows "—" because nothing is sent for it — the
                            channel keeps whatever price it already has. */}
                        {rateIdsFor(rt).map((rateId) => (
                          <tr key={`${rt.roomTypeId}-${rateId}`} className="border-b border-border last:border-0">
                            <td className="py-1 pl-6 pr-2">
                              <span className="font-mono text-xs text-muted-foreground">{rateId}</span>
                            </td>
                            {rt.nights.map((n) => (
                              <td
                                key={n.date}
                                className="py-1 px-2 text-center text-xs tabular-nums text-muted-foreground"
                              >
                                {n.prices[rateId] != null ? n.prices[rateId] : "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-destructive">×</span> = stop-sale, closed at the channel (distinct
              from 0, which means sold out but still listed). Indented rows are prices per channel rate;{" "}
              <span className="font-mono">—</span> means no price is sent for that night, so the channel keeps
              whatever it already has.
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

        {!loading && !failed && plan && (
          <DialogFooter>
            {/* Sending is only offered when the operator has already turned sharing on —
                the push itself refuses otherwise, so offering it would just produce a
                confusing failure. */}
            {canPush && plan.syncEnabled && plan.roomTypes.length > 0 && (
              <Button onClick={() => void handlePush()} disabled={pushing}>
                {pushing ? "Sending..." : "Send now"}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
