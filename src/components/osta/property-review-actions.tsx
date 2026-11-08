"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useReasonPrompt } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"

// Approve / Reject for a PENDING property, on the Osta property page header. Same API
// and wording as the row actions in the workspace Properties tab.
export function PropertyReviewActions({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const askReason = useReasonPrompt()
  const [busy, setBusy] = useState(false)

  async function post(action: "approve" | "reject") {
    let body: string | undefined
    if (action === "reject") {
      const reason = await askReason({
        title: `Reject ${name}?`,
        description: "The enterprise's admin sees this reason.",
        reasonLabel: "Reason",
        confirmLabel: "Reject",
        destructive: true,
      })
      if (reason === null) return
      body = JSON.stringify({ rejectionReason: reason })
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/osta/properties/${id}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(data.error ?? "That didn't work. Try again.")
      toast.success(action === "approve" ? `Approved ${name}` : `Rejected ${name}`)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" disabled={busy} onClick={() => post("reject")}>Reject…</Button>
      <Button disabled={busy} onClick={() => post("approve")}>Approve</Button>
    </>
  )
}
