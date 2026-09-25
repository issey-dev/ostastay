"use client"

import { apiError } from "@/lib/api-error"
import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"

const intString = z.string().refine((v) => !isNaN(parseInt(v)) && parseInt(v) >= 0, "Must be a non-negative number")
const optionalNumString = z.string().refine((v) => v === "" || !isNaN(parseFloat(v)), "Must be a number")

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

// Not on this form (kept in SpaSettings, left untouched on save):
// - allowTentativeAppointments / tentativeHoldMinutes: the desk never creates a
//   TENTATIVE appointment — every desk booking is CONFIRMED. The only tentative spa
//   appointments are Booking API holds, whose length is the Online Booking setting
//   (SpaOnlineSettings.holdMinutes), so the switch had no effect.
// - requireRescheduleReason: there is no reschedule action yet (SPA_PLAN.md Phase 5);
//   add the switch back together with it.
const settingsSchema = z.object({
  defaultOpeningTime: z.string().regex(HHMM, "Enter a time"),
  defaultClosingTime: z.string().regex(HHMM, "Enter a time"),
  slotIntervalMinutes: intString.refine((v) => parseInt(v) >= 5, "At least 5 minutes"),
  defaultPreparationBufferMinutes: intString,
  defaultCleanupBufferMinutes: intString,
  requireTherapistAtBooking: z.boolean(),
  requireRoomAtBooking: z.boolean(),
  allowAutoAssignment: z.boolean(),
  chargeTiming: z.enum(["AT_BOOKING", "AT_COMPLETION"]),
  cancellationCutoffHours: intString,
  lateCancellationChargeType: z.enum(["NONE", "FULL", "PERCENTAGE", "FIXED"]),
  lateCancellationChargeValue: optionalNumString,
  noShowChargeType: z.enum(["NONE", "FULL", "PERCENTAGE", "FIXED"]),
  noShowChargeValue: optionalNumString,
  noShowGraceMinutes: intString,
  requireCancellationReason: z.boolean(),
})
  // "HH:MM" strings compare correctly as text (zero-padded 24h).
  .refine((v) => v.defaultOpeningTime < v.defaultClosingTime, { message: "Closing time must be after opening time", path: ["defaultClosingTime"] })
  .refine((v) => v.lateCancellationChargeType !== "PERCENTAGE" || (v.lateCancellationChargeValue !== "" && parseFloat(v.lateCancellationChargeValue) >= 0 && parseFloat(v.lateCancellationChargeValue) <= 100), {
    message: "Enter a percentage from 0 to 100",
    path: ["lateCancellationChargeValue"],
  })
  .refine((v) => v.noShowChargeType !== "PERCENTAGE" || (v.noShowChargeValue !== "" && parseFloat(v.noShowChargeValue) >= 0 && parseFloat(v.noShowChargeValue) <= 100), {
    message: "Enter a percentage from 0 to 100",
    path: ["noShowChargeValue"],
  })
  .refine((v) => v.lateCancellationChargeType !== "FIXED" || (v.lateCancellationChargeValue !== "" && parseFloat(v.lateCancellationChargeValue) >= 0), {
    message: "Enter the amount",
    path: ["lateCancellationChargeValue"],
  })
  .refine((v) => v.noShowChargeType !== "FIXED" || (v.noShowChargeValue !== "" && parseFloat(v.noShowChargeValue) >= 0), {
    message: "Enter the amount",
    path: ["noShowChargeValue"],
  })

type SettingsFormValues = z.infer<typeof settingsSchema>

const defaults: SettingsFormValues = {
  defaultOpeningTime: "09:00",
  defaultClosingTime: "18:00",
  slotIntervalMinutes: "15",
  defaultPreparationBufferMinutes: "0",
  defaultCleanupBufferMinutes: "15",
  requireTherapistAtBooking: true,
  requireRoomAtBooking: true,
  allowAutoAssignment: true,
  chargeTiming: "AT_BOOKING",
  cancellationCutoffHours: "4",
  lateCancellationChargeType: "NONE",
  lateCancellationChargeValue: "",
  noShowChargeType: "NONE",
  noShowChargeValue: "",
  noShowGraceMinutes: "15",
  requireCancellationReason: true,
}

const CHARGE_TYPE_LABELS: Record<string, string> = { NONE: "No charge", FULL: "Full charge", PERCENTAGE: "Percentage", FIXED: "Fixed amount" };

export function SpaSettingsForm({ propertyId }: { propertyId: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const form = useForm<SettingsFormValues>({ resolver: zodResolver(settingsSchema), mode: "onChange", defaultValues: defaults })
  const lateType = form.watch("lateCancellationChargeType")
  const noShowType = form.watch("noShowChargeType")

  useEffect(() => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/spa/settings?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data) {
          form.reset({
            defaultOpeningTime: data.defaultOpeningTime,
            defaultClosingTime: data.defaultClosingTime,
            slotIntervalMinutes: String(data.slotIntervalMinutes),
            defaultPreparationBufferMinutes: String(data.defaultPreparationBufferMinutes),
            defaultCleanupBufferMinutes: String(data.defaultCleanupBufferMinutes),
            requireTherapistAtBooking: data.requireTherapistAtBooking,
            requireRoomAtBooking: data.requireRoomAtBooking,
            allowAutoAssignment: data.allowAutoAssignment,
            chargeTiming: data.chargeTiming,
            cancellationCutoffHours: String(data.cancellationCutoffHours),
            lateCancellationChargeType: data.lateCancellationChargeType,
            lateCancellationChargeValue: data.lateCancellationChargeValue != null ? String(data.lateCancellationChargeValue) : "",
            noShowChargeType: data.noShowChargeType,
            noShowChargeValue: data.noShowChargeValue != null ? String(data.noShowChargeValue) : "",
            noShowGraceMinutes: String(data.noShowGraceMinutes),
            requireCancellationReason: data.requireCancellationReason,
          })
        } else {
          form.reset(defaults)
        }
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const onSubmit = async (values: SettingsFormValues) => {
    setSaving(true)
    setServerError(null)
    setSaved(false)
    try {
      const payload = {
        ...values,
        propertyId,
        slotIntervalMinutes: parseInt(values.slotIntervalMinutes),
        defaultPreparationBufferMinutes: parseInt(values.defaultPreparationBufferMinutes),
        defaultCleanupBufferMinutes: parseInt(values.defaultCleanupBufferMinutes),
        cancellationCutoffHours: parseInt(values.cancellationCutoffHours),
        lateCancellationChargeValue: values.lateCancellationChargeValue !== "" ? parseFloat(values.lateCancellationChargeValue) : null,
        noShowChargeValue: values.noShowChargeValue !== "" ? parseFloat(values.noShowChargeValue) : null,
        noShowGraceMinutes: parseInt(values.noShowGraceMinutes),
      }
      const res = await fetch("/api/spa/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setSaved(true)
      } else {
        setServerError(await apiError(res, "Couldn't save the spa settings. Try again."))
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <FormField control={form.control} name="defaultOpeningTime" render={({ field }) => (
            <FormItem><FormLabel>Opening time</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="defaultClosingTime" render={({ field }) => (
            <FormItem><FormLabel>Closing time</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="slotIntervalMinutes" render={({ field }) => (
            <FormItem><FormLabel>Slot interval (min)</FormLabel><FormControl><Input type="number" min="5" step="5" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="defaultPreparationBufferMinutes" render={({ field }) => (
            <FormItem><FormLabel>Default prep buffer (min)</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="defaultCleanupBufferMinutes" render={({ field }) => (
            <FormItem><FormLabel>Default cleanup buffer (min)</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <FormField control={form.control} name="requireTherapistAtBooking" render={({ field }) => (
            <FormItem className="flex items-center gap-3"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="!mt-0 font-normal cursor-pointer">Require therapist at booking</FormLabel></FormItem>
          )} />
          <FormField control={form.control} name="requireRoomAtBooking" render={({ field }) => (
            <FormItem className="flex items-center gap-3"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="!mt-0 font-normal cursor-pointer">Require room at booking</FormLabel></FormItem>
          )} />
          <FormField control={form.control} name="allowAutoAssignment" render={({ field }) => (
            <FormItem className="flex items-center gap-3"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="!mt-0 font-normal cursor-pointer">Allow auto-assignment</FormLabel></FormItem>
          )} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField control={form.control} name="chargeTiming" render={({ field }) => (
            <FormItem>
              <FormLabel>Charge timing</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="AT_BOOKING">At booking</SelectItem>
                  <SelectItem value="AT_COMPLETION">At treatment completion</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="cancellationCutoffHours" render={({ field }) => (
            <FormItem><FormLabel>Cancellation cutoff (hours)</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="grid grid-cols-2 gap-2">
            <FormField control={form.control} name="lateCancellationChargeType" render={({ field }) => (
              <FormItem>
                <FormLabel>Late cancellation charge</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {Object.entries(CHARGE_TYPE_LABELS).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="lateCancellationChargeValue" render={({ field }) => (
              <FormItem><FormLabel>&nbsp;</FormLabel><FormControl><Input type="number" step="0.01" placeholder="Value" disabled={lateType === "NONE" || lateType === "FULL"} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FormField control={form.control} name="noShowChargeType" render={({ field }) => (
              <FormItem>
                <FormLabel>No-show charge</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {Object.entries(CHARGE_TYPE_LABELS).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="noShowChargeValue" render={({ field }) => (
              <FormItem><FormLabel>&nbsp;</FormLabel><FormControl><Input type="number" step="0.01" placeholder="Value" disabled={noShowType === "NONE" || noShowType === "FULL"} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
          </div>
        </div>

        <FormField control={form.control} name="noShowGraceMinutes" render={({ field }) => (
          <FormItem className="max-w-[240px]"><FormLabel>No-show grace period (min)</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormMessage /></FormItem>
        )} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField control={form.control} name="requireCancellationReason" render={({ field }) => (
            <FormItem className="flex items-center gap-3"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="!mt-0 font-normal cursor-pointer">Require cancellation reason</FormLabel></FormItem>
          )} />
        </div>

        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
        {saved && !serverError && <p className="text-sm text-success">Settings saved.</p>}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Form>
  )
}
