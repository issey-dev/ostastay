"use client"

import { useEffect, useState } from "react"
import { z } from "zod"
import { useForm, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"

// Hub › Property › Reservations › Agent portal (Agent Portal plan A-25). One card: the
// switch, the option rules for tentative bookings, how much availability agents see, when
// guest details are due, and the overflow cap. Saved through PATCH /api/properties/[id]/settings.

const schema = z.object({
  agentPortalEnabled: z.boolean(),
  optionDaysBeforeArrival: z.coerce.number().int("Whole days").min(0, "0 or more").max(365, "At most 365"),
  shortOptionHours: z.coerce.number().int("Whole hours").min(1, "At least 1").max(336, "At most 336 (two weeks)"),
  guestDetailsDueDays: z.coerce.number().int("Whole days").min(0, "0 or more").max(90, "At most 90"),
  agentAvailabilityCap: z.coerce.number().int("Whole rooms").min(1, "At least 1").max(50, "At most 50"),
  maxOverflowPerNight: z.string().refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) <= 500), "A number up to 500, or empty for no cap"),
})
type Values = z.infer<typeof schema>

export function AgentPortalSettingsForm({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const form = useForm<Values>({ resolver: zodResolver(schema) as Resolver<Values>, mode: "onChange" })

  useEffect(() => {
    fetch(`/api/properties/${propertyId}/settings`)
      .then((r) => r.json())
      .then((s) => {
        form.reset({
          agentPortalEnabled: !!s.agentPortalEnabled,
          optionDaysBeforeArrival: s.optionDaysBeforeArrival ?? 30,
          shortOptionHours: s.shortOptionHours ?? 48,
          guestDetailsDueDays: s.guestDetailsDueDays ?? 7,
          agentAvailabilityCap: s.agentAvailabilityCap ?? 5,
          maxOverflowPerNight: s.maxOverflowPerNight == null ? "" : String(s.maxOverflowPerNight),
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [propertyId, form])

  const save = form.handleSubmit(async (v) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/properties/${propertyId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v, maxOverflowPerNight: v.maxOverflowPerNight === "" ? null : Number(v.maxOverflowPerNight) }),
      })
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't save the agent portal settings."))
        return
      }
      toast.success("Agent portal settings saved")
      form.reset(v)
    } finally {
      setSaving(false)
    }
  })

  if (loading) return <Skeleton className="h-40 w-full" />
  const err = form.formState.errors
  const field = (name: keyof Values, label: string, hint: string, suffix?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`ap-${name}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={`ap-${name}`} inputMode="numeric" className="w-28" disabled={!canEdit} {...form.register(name)} />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {err[name] && <p className="text-xs text-destructive">{err[name]?.message as string}</p>}
    </div>
  )

  return (
    <form onSubmit={save} className="space-y-5">
      <Controller
        control={form.control}
        name="agentPortalEnabled"
        render={({ field: f }) => (
          <label className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
            <span>
              <span className="text-sm font-medium">Agent portal for this property</span>
              <span className="block text-xs text-muted-foreground">
                Sources with portal logins can see availability, request slots and enter bookings here. Turning it off stops the portal the same minute; existing bookings stay.
              </span>
            </span>
            <Switch checked={f.value} onCheckedChange={(v) => f.onChange(!!v)} disabled={!canEdit} aria-label="Agent portal for this property" />
          </label>
        )}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        {field("optionDaysBeforeArrival", "Option runs until", "A tentative booking outside a slot is held until this many days before arrival (a slot's cutoff wins).", "days before arrival")}
        {field("shortOptionHours", "Late bookings get", "Option length for a tentative booking made after that point.", "hours")}
        {field("guestDetailsDueDays", "Guest details due", "Names, passports and flights are due this many days before arrival.", "days before arrival")}
        {field("agentAvailabilityCap", "Agents see free rooms up to", "Above this the portal shows “N+” instead of the exact number. Their own slots are always exact.", "rooms")}
        {field("maxOverflowPerNight", "Overflow bookings a night", "Most guests placed at partner hotels on one night. Empty: no cap.")}
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !form.formState.isDirty}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      )}
    </form>
  )
}
