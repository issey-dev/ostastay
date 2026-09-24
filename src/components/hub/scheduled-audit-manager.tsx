"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { toast } from "@/lib/toast"

// The scheduled Night Audit — see src/lib/night-audit/scheduled.ts. On, the background
// jobs run this property's whole End-of-Day at the set time in its own time zone.

const schema = z.object({
  autoAuditEnabled: z.boolean(),
  autoAuditTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time, e.g. 02:00"),
})
type Values = z.infer<typeof schema>

export function ScheduledAuditManager({
  propertyId,
  timeZone,
  initial,
  lastAudit,
  canEdit,
}: {
  propertyId: string
  timeZone: string
  initial: Values
  /** The last completed audit, for context. Null when there has been none yet. */
  lastAudit: string | null
  canEdit: boolean
}) {
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onChange", defaultValues: initial })
  const enabled = form.watch("autoAuditEnabled")

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
              In the property&apos;s time zone ({timeZone}). Before noon it runs in the small hours after the business day
              (02:00 closes the day before); from noon it runs on the day itself.
            </FormDescription>
            <FormMessage />
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
