"use client"

import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { SubmitButton } from "@/components/ui/submit-button"
import { CHECK_NO_PATTERN } from "@/lib/folio-presentation"
import { toast } from "@/lib/toast"

// Same rule as PATCH /api/folios/{id}/line-items/check-no — the API re-checks.
const schema = z.object({
  checkNo: z
    .string()
    .trim()
    .min(1, "Enter a check number")
    .max(20, "20 characters at most")
    .regex(CHECK_NO_PATTERN, "Letters, digits and hyphens only"),
})
type FormValues = z.infer<typeof schema>

export type CheckNoTarget = {
  lineItemIds: string[]
  /** The current number (shared by every line in the target), or null. */
  checkNo: string | null
  /** What is being renumbered, e.g. the line's description or "3 lines". */
  label: string
}

// Edit the check number of one line, or of every line in a rolled-up check. Lines that
// end up sharing a number roll together on the folio; a line given its own number splits
// out of its group.
export function FolioCheckNoDialog({
  folioId,
  target,
  onOpenChange,
  onSaved,
}: {
  folioId: string
  target: CheckNoTarget | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        {target && (
          <CheckNoForm
            key={target.lineItemIds.join(",")}
            folioId={folioId}
            target={target}
            onCancel={() => onOpenChange(false)}
            onSaved={() => { onOpenChange(false); onSaved() }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CheckNoForm({
  folioId,
  target,
  onCancel,
  onSaved,
}: {
  folioId: string
  target: CheckNoTarget
  onCancel: () => void
  onSaved: () => void
}) {
  const [saving, setSaving] = useState(false)
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { checkNo: target.checkNo ?? "" },
  })

  const onSubmit = async (values: FormValues) => {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/folios/${folioId}/line-items/check-no`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItemIds: target.lineItemIds, checkNo: values.checkNo }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success("Check number updated")
        onSaved()
      } else {
        toast.error(data.error || "Couldn't update the check number. Try again.")
      }
    } catch {
      toast.error("Couldn't update the check number. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Form {...form}>
      {/* stopPropagation: this opens over the folio dialog, and submit events bubble
          through portals. */}
      <form
        onSubmit={(e) => { e.stopPropagation(); form.handleSubmit(onSubmit)(e) }}
        className="contents"
      >
        <DialogHeader>
          <DialogTitle>Edit check number</DialogTitle>
          <DialogDescription>
            {target.label}. Lines with the same number show as one line on this folio.
          </DialogDescription>
        </DialogHeader>
        <FormField
          control={form.control}
          name="checkNo"
          render={({ field }) => (
            <FormItem className="py-2">
              <FormLabel>Check number</FormLabel>
              <FormControl>
                <Input {...field} autoFocus autoComplete="off" maxLength={20} placeholder="e.g. 10452" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <SubmitButton pending={saving} pendingLabel="Saving…" disabled={!form.formState.isValid}>
            Save
          </SubmitButton>
        </DialogFooter>
      </form>
    </Form>
  )
}
