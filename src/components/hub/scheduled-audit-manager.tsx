"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { toast } from "@/lib/toast"
import { auditTimeSchema, isAuditBeforeMidnight } from "@/lib/night-audit/audit-window"

// The scheduled Night Audit — see src/lib/night-audit/scheduled.ts. On, the background
// jobs run this property's whole End-of-Day at the set time in its own time zone. The time
// must fall between 22:00 and 06:00 (owner, 2026-09-24) — the same rule the settings API
// enforces (src/lib/night-audit/audit-window.ts).

const schema = z.object({
  autoAuditEnabled: z.boolean(),
  autoAuditTime: auditTimeSchema,
})
type Values = z.infer<typeof schema>

export function ScheduledAuditManager({
  propertyId,
  timeZone,
  initial,
  lastAudit,
  noShowTiming,
  canEdit,
}: {
  propertyId: string
  timeZone: string
  initial: Values
  /** The last completed audit, for context. Null when there has been none yet. */
  lastAudit: string | null
  /** The property's No-Show timing (PropertySettings.noShowTiming) — for the warning below. */
  noShowTiming: string
  canEdit: boolean
}) {
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onChange", defaultValues: initial })
  const enabled = form.watch("autoAuditEnabled")
  const time = form.watch("autoAuditTime")
  // Not an error, just a warning: an audit before midnight that marks no-shows at the
  // arrival night's audit catches guests who are still on their way that night.
  const lateArrivalWarning = enabled && noShowTiming === "FIRST_AUDIT" && isAuditBeforeMidnight(time)

  const onSubmit = async (values: Values) => {
    const res = await fetch(`/api/properties/${propertyId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(typeof body.error === "string" ? body.error : "Couldn't save the schedule")
      return
    }
    form.reset(values)
    toast.success(values.autoAuditEnabled ? `Night Audit will run at ${values.autoAuditTime}` : "Scheduled Night Audit switched off")
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField control={form.control} name="autoAuditEnabled" render={({ field }) => (
          <FormItem className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
            <div className="min-w-0">
              <FormLabel>Run Night Audit automatically</FormLabel>
              <FormDescription>
                Runs every End-of-Day step with no one at the desk. It stops at the first step that needs a person — guests
                still due out, for example (settled ones can be checked out automatically, under Departures) — and the Hub
                Overview says so; finish it from the Night Audit screen.
              </FormDescription>
            </div>
            <FormControl>
              <Switch className="shrink-0" checked={field.value} disabled={!canEdit} onCheckedChange={(on) => field.onChange(!!on)} />
            </FormControl>
          </FormItem>
        )} />

        <FormField control={form.control} name="autoAuditTime" render={({ field }) => (
          <FormItem className="max-w-xs">
            <FormLabel>Time</FormLabel>
            <FormControl>
              <Input type="time" step={60} disabled={!canEdit || !enabled} {...field} />
            </FormControl>
            <FormDescription>
              In the property&apos;s time zone ({timeZone}), between 22:00 and 06:00. From 22:00 it runs on the business
              day itself; from midnight to 06:00 in the small hours after it (02:00 closes the day before).
            </FormDescription>
            <FormMessage />
            {lateArrivalWarning && (
              <p role="status" className="rounded-md border border-warning/40 bg-warning-muted p-2 text-xs text-warning">
                No-shows are marked at the arrival night&apos;s audit, so a guest arriving after {time} but before the night is
                over would be marked No-Show. Choose a time after midnight, or set No-Shows to &ldquo;Hold one night for late
                arrivals&rdquo;.
              </p>
            )}
          </FormItem>
        )} />

        <p className="text-xs text-muted-foreground">Last completed Night Audit: {lastAudit ?? "none yet"}.</p>

        {canEdit && (
          <Button type="submit" disabled={!form.formState.isDirty || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save schedule"}
          </Button>
        )}
      </form>
    </Form>
  )
}
