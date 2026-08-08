"use client"

import { useEffect, useState } from "react"
import { Mail, Loader2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { validateCommunicationValue } from "@/lib/profile-communications"

type EmailOption = { id: string; value: string; isPrimary: boolean }

// Shared "Email this document" dialog for every stationery type (Invoice, Payment
// Receipt, Exchange Receipt, Registration Card, Confirmation Letter, Debtor Statement).
// If the profile has one or more emails on file, offers them as a pick-list; always
// offers a manual-entry fallback with an option to save it back to the profile — the
// previous per-page implementations just hard-failed with "no email on file" and gave
// staff no way to proceed.
export function EmailDocumentDialog({
  open,
  onOpenChange,
  profileUpid,
  documentLabel,
  onSend,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whose ProfileCommunication rows to offer as choices. Omit for accounts (e.g. a
   *  Debtor Statement's company/travel-agent profile) the same way — the dialog doesn't
   *  care what kind of profile it is, only that it has EMAIL communications. */
  profileUpid?: string | null
  /** e.g. "Tax Invoice", "Payment Receipt" — used in the confirm copy. */
  documentLabel: string
  onSend: (email: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [options, setOptions] = useState<EmailOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [selected, setSelected] = useState<string>("") // an option id, or "manual"
  const [manualEmail, setManualEmail] = useState("")
  const [saveToProfile, setSaveToProfile] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!open) return
    // Reset per-open so a previous send's state doesn't linger.
    setError(null)
    setSent(false)
    setManualEmail("")
    setSaveToProfile(true)

    if (!profileUpid) {
      setOptions([])
      setSelected("manual")
      return
    }
    setLoadingOptions(true)
    fetch(`/api/profiles/${profileUpid}/communications`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { id: string; type: string; value: string; isPrimary: boolean }[]) => {
        const emails = rows.filter((r) => r.type === "EMAIL")
        setOptions(emails)
        setSelected(emails.find((e) => e.isPrimary)?.id ?? emails[0]?.id ?? "manual")
      })
      .catch(() => setOptions([]))
      .finally(() => setLoadingOptions(false))
  }, [open, profileUpid])

  const resolvedEmail = selected === "manual" ? manualEmail.trim() : options.find((o) => o.id === selected)?.value ?? ""
  const manualIsNew = selected === "manual" && manualEmail.trim() && !options.some((o) => o.value.toLowerCase() === manualEmail.trim().toLowerCase())

  const handleSend = async () => {
    setError(null)
    if (selected === "manual") {
      const validationError = validateCommunicationValue("EMAIL", manualEmail)
      if (validationError) {
        setError(validationError)
        return
      }
    }
    setSending(true)
    try {
      if (manualIsNew && saveToProfile && profileUpid) {
        // Best-effort: a failed save shouldn't block the send the user actually asked for.
        await fetch(`/api/profiles/${profileUpid}/communications`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "EMAIL", value: resolvedEmail, isPrimary: options.length === 0 }),
        }).catch(() => null)
      }
      const result = await onSend(resolvedEmail)
      if (result.ok) {
        setSent(true)
        setTimeout(() => onOpenChange(false), 1400)
      } else {
        setError(result.error || "Failed to send.")
      }
    } catch {
      setError("An unexpected error occurred.")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email {documentLabel}
          </DialogTitle>
          <DialogDescription>Choose an email address, or enter a new one.</DialogDescription>
        </DialogHeader>

        {sent ? (
          <p className="py-4 text-sm font-medium text-success">Sent to {resolvedEmail}.</p>
        ) : (
          <div className="space-y-4">
            {loadingOptions ? (
              <p className="text-sm text-muted-foreground">Loading saved emails...</p>
            ) : (
              <div className="space-y-2" role="radiogroup" aria-label="Email address">
                {options.map((opt) => (
                  <label key={opt.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="radio"
                      className="accent-primary"
                      checked={selected === opt.id}
                      onChange={() => setSelected(opt.id)}
                    />
                    <span>{opt.value}</span>
                    {opt.isPrimary && <span className="text-xs text-muted-foreground">(primary)</span>}
                  </label>
                ))}
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    className="accent-primary"
                    checked={selected === "manual"}
                    onChange={() => setSelected("manual")}
                  />
                  <span>{options.length > 0 ? "Enter a different email" : "Enter an email address"}</span>
                </label>
              </div>
            )}

            {selected === "manual" && (
              <div className="space-y-3 pl-6">
                <div className="space-y-1.5">
                  <Label htmlFor="manual-email" className="sr-only">Email address</Label>
                  <Input
                    id="manual-email"
                    type="email"
                    placeholder="guest@example.com"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    autoFocus
                  />
                </div>
                {profileUpid && manualEmail.trim() && (
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground">
                    <Checkbox checked={saveToProfile} onCheckedChange={(c) => setSaveToProfile(!!c)} />
                    Save this as their email on file
                  </label>
                )}
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        {!sent && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={sending || !resolvedEmail}>
              {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
              {sending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
