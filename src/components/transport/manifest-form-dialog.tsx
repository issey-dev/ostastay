"use client"

import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { OptionSelect } from "@/components/ui/option-select"
import { DatePicker } from "@/components/ui/date-picker"
import { SubmitButton } from "@/components/ui/submit-button"
import { toast } from "@/lib/toast"
import { HHMM } from "@/lib/transport/constants"
import { cn } from "@/lib/utils"
import { api, type ManifestView, type TransportConfig } from "@/components/transport/shared"

// Create or edit a departure (manifest). Created empty, from the board's selected bookings
// ("New departure from selected"), or by the route's default times (the board's own action).

const schema = z.object({
  routeId: z.string().min(1, "Choose the route"),
  direction: z.enum(["PICKUP", "DROP_OFF"]),
  serviceDate: z.string().min(1, "Choose the date"),
  departureTime: z.string().refine((v) => HHMM.test(v), "HH:MM"),
  transportTypeId: z.string(),
  providerId: z.string(),
  vesselId: z.string(),
  driverName: z.string().max(80),
  driverContact: z.string().max(40),
  notes: z.string().max(1000),
})
type Values = z.infer<typeof schema>

export function ManifestFormDialog({
  open,
  onOpenChange,
  propertyId,
  config,
  editing,
  defaults,
  bookingIds = [],
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  propertyId: string
  config: TransportConfig | null
  editing: ManifestView | null
  defaults?: { serviceDate: string; direction?: "PICKUP" | "DROP_OFF"; routeId?: string | null; departureTime?: string | null }
  bookingIds?: string[]
  onSaved: (m: ManifestView) => void
}) {
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onChange" })
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!open) return
    setError(null)
    form.reset(
      editing
        ? {
            routeId: editing.route.id,
            direction: editing.direction as Values["direction"],
            serviceDate: editing.serviceDate,
            departureTime: editing.departureLocal.time,
            transportTypeId: editing.transportType?.id ?? "",
            providerId: editing.provider?.id ?? "",
            vesselId: editing.vessel?.id ?? "",
            driverName: editing.driverName ?? "",
            driverContact: editing.driverContact ?? "",
            notes: editing.notes ?? "",
          }
        : {
            routeId: defaults?.routeId ?? "",
            direction: defaults?.direction ?? "PICKUP",
            serviceDate: defaults?.serviceDate ?? "",
            departureTime: defaults?.departureTime ?? "",
            transportTypeId: "",
            providerId: "",
            vesselId: "",
            driverName: "",
            driverContact: "",
            notes: "",
          }
    )
    // Only when the dialog opens: the caller rebuilds `defaults` on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  const v = form.watch()
  const route = config?.routes.find((r) => r.id === v.routeId)
  const vessels = (config?.providers ?? []).flatMap((p) => p.vessels.filter((x) => (x.isActive || x.id === v.vesselId) && (!v.providerId || x.providerId === v.providerId)))

  const submit = async (values: Values) => {
    setPending(true)
    setError(null)
    const payload = {
      ...values,
      transportTypeId: values.transportTypeId || null,
      providerId: values.providerId || null,
      vesselId: values.vesselId || null,
      driverName: values.driverName || null,
      driverContact: values.driverContact || null,
      notes: values.notes || null,
    }
    try {
      const saved = editing
        ? (await api<{ manifest: ManifestView }>(`/api/transport/manifests/${editing.id}?propertyId=${propertyId}`, {
            method: "PATCH",
            json: { serviceDate: payload.serviceDate, departureTime: payload.departureTime, transportTypeId: payload.transportTypeId, providerId: payload.providerId, vesselId: payload.vesselId, driverName: payload.driverName, driverContact: payload.driverContact, notes: payload.notes },
          })).manifest
        : await api<ManifestView>(`/api/transport/manifests?propertyId=${propertyId}`, { method: "POST", json: { ...payload, bookingIds } })
      toast.success(editing ? "Departure saved" : bookingIds.length ? `Departure created with ${bookingIds.length} booking(s)` : "Departure created")
      onOpenChange(false)
      onSaved(saved)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)}>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit departure" : "New departure"}</DialogTitle>
              <DialogDescription>
                {bookingIds.length ? `${bookingIds.length} selected booking(s) will ride on it.` : "One boat, seaplane or car leaving at a time — guests from any reservation ride on it together."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="routeId"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Route *</FormLabel>
                    <FormControl>
                      <OptionSelect
                        value={field.value}
                        onChange={field.onChange}
                        disabled={!!editing}
                        placeholder="Select route…"
                        options={(config?.routes ?? []).filter((r) => r.isActive || r.id === field.value).map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="direction"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Direction *</FormLabel>
                    <FormControl>
                      <OptionSelect
                        value={field.value}
                        onChange={field.onChange}
                        disabled={!!editing || bookingIds.length > 0}
                        options={[
                          { value: "PICKUP", label: "Pickup" },
                          { value: "DROP_OFF", label: "Drop-off" },
                        ]}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="serviceDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date *</FormLabel>
                    <FormControl>
                      <DatePicker value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="departureTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Departs *</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    {route && route.departureSlots.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {route.departureSlots.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => form.setValue("departureTime", s, { shouldValidate: true })}
                            className={cn("border px-2 py-0.5 font-mono text-xs", field.value === s ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="providerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider</FormLabel>
                    <FormControl>
                      <OptionSelect
                        value={field.value}
                        onChange={(id) => {
                          field.onChange(id)
                          form.setValue("vesselId", "")
                        }}
                        options={[{ value: "", label: "Not assigned" }, ...(config?.providers ?? []).filter((p) => p.isActive || p.id === field.value).map((p) => ({ value: p.id, label: p.name }))]}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vesselId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vessel / vehicle</FormLabel>
                    <FormControl>
                      <OptionSelect value={field.value} onChange={field.onChange} options={[{ value: "", label: "Not assigned" }, ...vessels.map((x) => ({ value: x.id, label: `${x.name} (${x.capacity} seats)` }))]} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="driverName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Driver / captain / pilot</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="driverContact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Their contact</FormLabel>
                    <FormControl>
                      <Input type="tel" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea rows={2} {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              {error && <p className="text-sm text-destructive md:col-span-2">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>{editing ? "Save" : "Create departure"}</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
