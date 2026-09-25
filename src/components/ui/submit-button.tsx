"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Loader2 } from "@/components/icons"

/**
 * A form's submit button that can't be double-clicked: disabled and showing a spinner +
 * `pendingLabel` while `pending` (DESKTOP_PLAN D11 — 12 confirm buttons had no guard and
 * loading labels came in two spellings). Label wording: "Save" in edit forms, "Create" in
 * create forms, the verb for actions ("Post charge"). Pending labels end in "…".
 */
export function SubmitButton({
  pending,
  pendingLabel = "Saving…",
  children,
  disabled,
  type = "submit",
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean; pendingLabel?: string }) {
  return (
    <Button type={type} disabled={pending || disabled} aria-busy={pending || undefined} {...props}>
      {pending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  )
}
