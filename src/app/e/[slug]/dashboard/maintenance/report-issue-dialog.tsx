"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { OptionSelect } from "@/components/ui/option-select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { MAINTENANCE_ISSUE_TYPES, MAINTENANCE_PRIORITIES } from "@/lib/maintenance"

/**
 * "Report issue" from the Maintenance dashboard — the same ticket the Housekeeping board's
 * Report Issue dialog raises, for one room, through the same endpoint
 * (POST /api/housekeeping/maintenance) with the same field set.
 */

const ISSUE_TYPE_VALUES = MAINTENANCE_ISSUE_TYPES.map((t) => t.value) as [string, ...string[]]

const reportIssueSchema = z.object({
  roomId: z.string().min(1, "Pick a room"),
  issueType: z.enum(ISSUE_TYPE_VALUES, { message: "Pick an issue type" }),
  priority: z.enum(MAINTENANCE_PRIORITIES, { message: "Pick a priority" }),
  description: z.string().trim().min(1, "Describe the issue"),
  takeOutOfOrder: z.boolean(),
  expectedReturn: z.string(),
})

type ReportIssueValues = z.infer<typeof reportIssueSchema>

const defaultValues: ReportIssueValues = {
  roomId: "",
  issueType: "HVAC",
  priority: "MEDIUM",
  description: "",
  takeOutOfOrder: false,
  expectedReturn: "",
}

type RoomOption = {
  id: string
  roomNumber: string
  floorId: string | null
  roomType?: { name?: string; housekeepingEnabled?: boolean } | null
}

export function ReportIssueDialog({
  open,
  onOpenChange,
  propertyId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  propertyId: string | undefined
  onCreated: () => void
}) {
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [roomsError, setRoomsError] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<ReportIssueValues>({
    resolver: zodResolver(reportIssueSchema),
    mode: "onChange",
    defaultValues,
  })
  const takeOutOfOrder = form.watch("takeOutOfOrder")

  // Rooms load when the dialog opens (fresh list each time, no cost while closed).
  useEffect(() => {
    if (!open || !propertyId) return
    let cancelled = false
    setRoomsError(false)
    fetch(`/api/rooms?propertyId=${propertyId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data: RoomOption[]) => { if (!cancelled) setRooms(data) })
      .catch(() => { if (!cancelled) setRoomsError(true) })
    return () => { cancelled = true }
  }, [open, propertyId])

  // Same room set the Housekeeping board offers (and the endpoint accepts): real rooms
  // (on a floor) whose room type has housekeeping enabled.
  const roomOptions = useMemo(
    () =>
      rooms
        .filter((r) => r.floorId && r.roomType?.housekeepingEnabled !== false)
        .map((r) => ({ value: r.id, label: r.roomType?.name ? `Room ${r.roomNumber} · ${r.roomType.name}` : `Room ${r.roomNumber}` })),
    [rooms]
  )

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      form.reset(defaultValues)
      setSubmitError(null)
    }
  }

  const onSubmit = async (values: ReportIssueValues) => {
    setSubmitError(null)
    try {
      const res = await fetch(`/api/housekeeping/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomIds: [values.roomId],
          issueType: values.issueType,
          description: values.description.trim(),
          priority: values.priority,
          takeOutOfOrder: values.takeOutOfOrder,
          expectedReturn: values.takeOutOfOrder && values.expectedReturn ? values.expectedReturn : null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSubmitError(data.error || "Failed to create the ticket.")
        return
      }
      close(false)
      onCreated()
    } catch {
      setSubmitError("An error occurred creating the ticket.")
    }
  }

  const submitting = form.formState.isSubmitting

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report Maintenance Issue</DialogTitle>
          <DialogDescription>This will create a maintenance ticket for the selected room.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form id="report-issue-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="roomId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Room</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      value={field.value}
                      onChange={(v) => { field.onChange(v); field.onBlur() }}
                      placeholder={roomsError ? "Couldn't load rooms" : "Select room..."}
                      searchPlaceholder="Search rooms..."
                      emptyText="No rooms found."
                      options={roomOptions}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="issueType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Issue Type</FormLabel>
                  <FormControl>
                    <OptionSelect
                      aria-label="Issue type"
                      value={field.value}
                      onChange={field.onChange}
                      options={MAINTENANCE_ISSUE_TYPES.map((t) => ({ label: t.label, value: t.value }))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Priority</FormLabel>
                  <FormControl>
                    <OptionSelect
                      aria-label="Priority"
                      value={field.value}
                      onChange={field.onChange}
                      options={[
                        { label: "Low", value: "LOW" },
                        { label: "Medium", value: "MEDIUM" },
                        { label: "High", value: "HIGH" },
                      ]}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="E.g. AC unit is leaking water..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-3 rounded-md border border-border p-3">
              <FormField
                control={form.control}
                name="takeOutOfOrder"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer pointer-coarse:min-h-11">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                      />
                      Take room out of order
                    </label>
                  </FormItem>
                )}
              />
              <p className="text-xs text-muted-foreground">
                Removes the room from sale until this ticket is resolved (it returns as Dirty).
              </p>
              {takeOutOfOrder && (
                <FormField
                  control={form.control}
                  name="expectedReturn"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel className="text-xs">Expected return date (optional)</FormLabel>
                      <FormControl>
                        <DatePicker value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
            {submitError && <p className="text-sm font-medium text-destructive">{submitError}</p>}
          </form>
        </Form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button type="submit" form="report-issue-form" disabled={submitting}>
            {submitting ? "Saving..." : "Submit Ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
