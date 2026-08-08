"use client"

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
import { useProperty } from "@/components/providers/property-provider"

const intString = z.string().refine((v) => !isNaN(parseInt(v)) && parseInt(v) >= 0, "Must be a non-negative number")
const optionalNumString = z.string().refine((v) => v === "" || !isNaN(parseFloat(v)), "Must be a number")

const settingsSchema = z.object({
  defaultOpeningTime: z.string().min(1),
  defaultClosingTime: z.string().min(1),
  slotIntervalMinutes: intString,
  defaultPreparationBufferMinutes: intString,
  defaultCleanupBufferMinutes: intString,
  allowTentativeAppointments: z.boolean(),
  tentativeHoldMinutes: intString,
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
  requireRescheduleReason: z.boolean(),
})

type SettingsFormValues = z.infer<typeof settingsSchema>

const defaults: SettingsFormValues = {
  defaultOpeningTime: "09:00",
  defaultClosingTime: "18:00",
  slotIntervalMinutes: "15",
  defaultPreparationBufferMinutes: "0",
  defaultCleanupBufferMinutes: "15",
  allowTentativeAppointments: true,
  tentativeHoldMinutes: "20",
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
  requireRescheduleReason: false,
}

const CHARGE_TYPE_LABELS: Record<string, string> = { NONE: "No charge", FULL: "Full charge", PERCENTAGE: "Percentage", FIXED: "Fixed amount" };

export function SpaSettingsForm() {
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""
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
            allowTentativeAppointments: data.allowTentativeAppointments,
            tentativeHoldMinutes: String(data.tentativeHoldMinutes),
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
            requireRescheduleReason: data.requireRescheduleReason,
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
        tentativeHoldMinutes: parseInt(values.tentativeHoldMinutes),
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
        const body = await res.json().catch(() => null)
        setServerError(body?.error || "Failed to save settings")
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
            <FormItem><FormLabel>Opening Time</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="defaultClosingTime" render={({ field }) => (
            <FormItem><FormLabel>Closing Time</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="slotIntervalMinutes" render={({ field }) => (
            <FormItem><FormLabel>Slot Interval (min)</FormLabel><FormControl><Input type="number" min="5" step="5" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="defaultPreparationBufferMinutes" render={({ field }) => (
            <FormItem><FormLabel>Default Prep Buffer (min)</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="defaultCleanupBufferMinutes" render={({ field }) => (
            <FormItem><FormLabel>Default Cleanup Buffer (min)</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="tentativeHoldMinutes" render={({ field }) => (
            <FormItem><FormLabel>Tentative Hold (min)</FormLabel><FormControl><Input type="number" min="0" {...field} disabled={!form.watch("allowTentativeAppointments")} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          <FormField control={form.control} name="allowTentativeAppointments" render={({ field }) => (
            <FormItem className="flex items-center gap-3"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="!mt-0 font-normal cursor-pointer">Allow tentative holds</FormLabel></FormItem>
          )} />
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
              <FormLabel>Charge Timing</FormLabel>
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
            <FormItem><FormLabel>Cancellation Cutoff (hours)</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="grid grid-cols-2 gap-2">
            <FormField control={form.control} name="lateCancellationChargeType" render={({ field }) => (
              <FormItem>
                <FormLabel>Late Cancellation Charge</FormLabel>
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
                <FormLabel>No-Show Charge</FormLabel>
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
          <FormItem className="max-w-[240px]"><FormLabel>No-Show Grace Period (min)</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl><FormMessage /></FormItem>
        )} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField control={form.control} name="requireCancellationReason" render={({ field }) => (
            <FormItem className="flex items-center gap-3"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="!mt-0 font-normal cursor-pointer">Require cancellation reason</FormLabel></FormItem>
          )} />
          <FormField control={form.control} name="requireRescheduleReason" render={({ field }) => (
            <FormItem className="flex items-center gap-3"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="!mt-0 font-normal cursor-pointer">Require reschedule reason</FormLabel></FormItem>
          )} />
        </div>

        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
        {saved && !serverError && <p className="text-sm text-success">Settings saved.</p>}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
        </div>
      </form>
    </Form>
  )
}
