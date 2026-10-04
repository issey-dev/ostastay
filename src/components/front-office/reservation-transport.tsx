"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { format, parseISO } from "date-fns"
import { Compass, Pencil, ArrowRightCircle, ArrowLeftRight } from "@/components/icons"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { SubmitButton } from "@/components/ui/submit-button"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  simpleTransportSchema,
  type SimpleDirection,
  type SimpleTransport,
  type SimpleTransportInput,
  type SimpleTransportLeg,
} from "@/lib/transport/simple-schema"

// The reservation's simple Transport section: flight no., transport no. and flight time for
// the pickup and the drop-off — nothing else, no charges. Where Transportation is active at
// the property it is read-only, filled from the module's bookings (src/lib/transport/simple.ts).

const DIRECTIONS: { key: SimpleDirection; form: "pickup" | "dropoff"; label: string; timeLabel: string; icon: typeof ArrowRightCircle }[] = [
  { key: "PICKUP", form: "pickup", label: "Pickup (arrival)", timeLabel: "Flight lands", icon: ArrowRightCircle },
  { key: "DROPOFF", form: "dropoff", label: "Drop-off (departure)", timeLabel: "Flight departs", icon: ArrowLeftRight },
]

const toForm = (leg: SimpleTransportLeg | null) => ({
  flightNo: leg?.flightNo ?? "",
  transportNo: leg?.transportNo ?? "",
  time: leg?.flightTime ?? "",
})
const dayLabel = (dateKey: string | null) => (dateKey ? format(parseISO(dateKey), "dd MMM") : null)

export function ReservationTransport({
  reservationId,
  checkInDate,
  checkOutDate,
  refreshKey = 0,
  onChanged,
  openSignal = 0,
  transportationHref,
  className,
}: {
  reservationId: string
  checkInDate: string
  checkOutDate: string
  /** Bump to re-read the section (e.g. after a transfer changed in the Transportation card). */
  refreshKey?: number
  onChanged: () => void
  /** Bump to open the editor from outside (the reservation page's "+ Add transport"). */
  openSignal?: number
  /** Where "Managed in Transportation" links to. */
  transportationHref?: string
  className?: string
}) {
  const [data, setData] = useState<SimpleTransport | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const form = useForm<SimpleTransportInput>({
    resolver: zodResolver(simpleTransportSchema),
    mode: "onChange",
    defaultValues: { pickup: toForm(null), dropoff: toForm(null) },
  })

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reservations/${reservationId}/transport`)
      if (res.ok) setData(await res.json())
    } catch {
      /* the section stays empty; the rest of the page is unaffected */
    }
  }, [reservationId])
  useEffect(() => {
    load()
  }, [load, refreshKey])

  const readOnly = !!data?.managedByModule
  const openEditor = () => {
    if (readOnly) return
    form.reset({ pickup: toForm(data?.legs.PICKUP ?? null), dropoff: toForm(data?.legs.DROPOFF ?? null) })
    setIsEditing(true)
  }
  // Open when the parent bumps openSignal (skip the initial 0).
  useEffect(() => {
    if (openSignal > 0) openEditor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal])

  // stopPropagation: React submit events bubble through the dialog's portal to any form the
  // card happens to sit in.
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const res = await fetch(`/api/reservations/${reservationId}/transport`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      if (res.ok) {
        setData(await res.json())
        setIsEditing(false)
        toast.success("Transport saved")
        onChanged()
      } else {
        toast.error(await apiError(res, "Couldn't save the transport. Try again."))
        if (res.status === 409) {
          setIsEditing(false)
          load()
        }
      }
    } catch {
      toast.error("Couldn't save the transport. Try again.")
    }
  })

  const legs = data?.legs
  const hasAny = !!legs && (!!legs.PICKUP || !!legs.DROPOFF)
  const detail = (label: string, value?: string | null) =>
    value ? (
      <p className="text-xs">
        <span className="text-muted-foreground">{label}: </span>
        {value}
      </p>
    ) : null

  return (
    <Card className={cn("shadow-elevation-1 lg:col-span-2", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Compass className="w-5 h-5 text-muted-foreground" /> Transport
        </CardTitle>
        <CardAction>
          {readOnly ? (
            transportationHref ? (
              <Link href={transportationHref} className="text-xs text-primary hover:underline">
                Managed in Transportation
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">Managed in Transportation</span>
            )
          ) : (
            data && (
              <Button variant="outline" size="sm" onClick={openEditor}>
                <Pencil className="w-4 h-4 mr-2" /> {hasAny ? "Edit" : "Add"}
              </Button>
            )
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm">
        {!hasAny ? (
          <EmptyState size="inline" title={readOnly ? "No transfer booked yet" : "No pickup or drop-off arranged"} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {DIRECTIONS.map(({ key, label, timeLabel, icon: Icon }) => {
              const leg = legs![key]
              return (
                <div key={key} className="rounded-md border border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </p>
                  {!leg || (!leg.flightNo && !leg.transportNo && !leg.flightTime && !leg.legacyCharge) ? (
                    <p className="text-muted-foreground">Not set</p>
                  ) : (
                    <div className="space-y-1">
                      {detail("Flight no.", leg.flightNo)}
                      {detail("Transport no.", leg.transportNo)}
                      {detail(timeLabel, leg.flightTime ? [leg.flightTime, dayLabel(leg.flightDate)].filter(Boolean).join(" · ") : null)}
                      {leg.legacyCharge && (
                        <div className="pt-1">
                          <StatusBadge
                            label={
                              leg.legacyCharge.posted
                                ? `Charged ${leg.legacyCharge.amount.toFixed(2)}`
                                : `${leg.legacyCharge.amount.toFixed(2)} — posts at Night Audit`
                            }
                            tone={leg.legacyCharge.posted ? "success" : "neutral"}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent size="lg">
          <Form {...form}>
            <form
              onSubmit={(e) => {
                e.stopPropagation()
                onSubmit(e)
              }}
              className="contents"
            >
              <DialogHeader>
                <DialogTitle>Transport</DialogTitle>
                <DialogDescription>
                  Flight and transport for the pickup and the drop-off. Leave a side blank to remove it.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-6 sm:grid-cols-2">
                {DIRECTIONS.map(({ key, form: name, label, timeLabel, icon: Icon }) => (
                  <div key={key} className="space-y-3 rounded-lg border border-border p-4">
                    <p className="font-semibold flex items-center gap-2 text-sm">
                      <Icon className="w-4 h-4 text-muted-foreground" /> {label}
                    </p>
                    <FormField
                      control={form.control}
                      name={`${name}.flightNo`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Flight no.</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="e.g. EK652" autoCapitalize="characters" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`${name}.transportNo`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Transport no.</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Boat, vehicle or ticket no." />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`${name}.time`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">
                            {timeLabel} ({dayLabel((key === "PICKUP" ? checkInDate : checkOutDate).slice(0, 10))})
                          </FormLabel>
                          <FormControl>
                            <Input type="time" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <SubmitButton pending={form.formState.isSubmitting}>Save transport</SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
