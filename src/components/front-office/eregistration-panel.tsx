"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { format } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Send, FileStack, Mail, Ban, Loader2, Unlock } from "@/components/icons"
import { toast } from "@/lib/toast"
import { StatusBadge } from "@/components/ui/status-badge"
import { InlineLoading } from "@/components/ui/inline-loading"
import { SubmitButton } from "@/components/ui/submit-button"
import { useConfirm } from "@/components/providers/confirm-provider"
import type { StatusTone } from "@/lib/status-tone"

type Slot = { id: string; slotIndex: number; isPrimary: boolean; existingProfileId: string | null; status: string; firstName: string | null; lastName: string | null }
type LinkStatus = { id: string; status: string; expiresAt: string } | null

const noopSubscribe = () => () => {}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active", EXPIRED: "Expired", REVOKED: "Revoked", COMPLETED: "Completed",
}
const STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: "success", EXPIRED: "danger", REVOKED: "neutral", COMPLETED: "info",
}

// Link generation/monitoring for one reservation, on the reservation detail page — a
// staff-facing companion to /eregistration/[token]. Copy Link and Send Email only work
// in the same browser session as the most recent Generate/Regenerate: the server never
// stores the plaintext token (only its hash), so once this component unmounts or a page
// reload happens, the only way to get a sendable link again is to regenerate.
// embedded: rendered inside a host that already provides its own chrome/title (e.g. the
// Front Office row dialog) — skips the Card wrapper and header.
export function ERegistrationPanel({ reservationId, embedded = false }: { reservationId: string; embedded?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [link, setLink] = useState<LinkStatus>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [sessionUrl, setSessionUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const confirm = useConfirm()
  const [reopenConfirmOpen, setReopenConfirmOpen] = useState(false)
  const [reopenSelection, setReopenSelection] = useState<Set<string>>(new Set())
  // Web Share (phones): hand the link straight to WhatsApp / SMS / mail. False on the
  // server so SSR and hydration agree; the button itself is md:hidden.
  const canShare = useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator.share === "function",
    () => false
  )

  const refetch = useCallback(() => {
    setLoading(true)
    fetch(`/api/reservations/${reservationId}/eregistration-link`)
      .then((r) => r.json())
      .then((d) => { setLink(d.link ?? null); setSlots(Array.isArray(d.slots) ? d.slots : []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [reservationId])

  useEffect(() => { refetch() }, [refetch])

  const generate = async () => {
    setBusy("generate")
    try {
      const res = await fetch(`/api/reservations/${reservationId}/eregistration-link`, { method: "POST" })
      const body = await res.json()
      if (!res.ok) { toast.error(body.error || "Couldn't generate the link. Try again."); return }
      setSessionToken(body.token)
      setSessionUrl(body.url)
      if (Array.isArray(body.warnings) && body.warnings.length > 0) {
        body.warnings.forEach((w: string) => toast.warning(w))
      }
      toast.success("eRegistration link generated")
      refetch()
    } finally {
      setBusy(null)
    }
  }

  const reopenSlot = async (slotId: string) => {
    const res = await fetch(`/api/reservations/${reservationId}/eregistration-link/slots/${slotId}/reopen`, { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body.error || "Couldn't reopen that guest's details. Try again.")
      return false
    }
    return true
  }

  const reopenOne = async (slotId: string) => {
    setBusy(`reopen-${slotId}`)
    try {
      if (await reopenSlot(slotId)) {
        toast.success("Reopened for correction")
        refetch()
      }
    } finally {
      setBusy(null)
    }
  }

  // A submitted/applied slot stays locked even after the link is regenerated (relinking
  // never silently reopens someone's already-completed submission) — this is the deliberate
  // staff-in-the-loop step that lets a regenerate optionally double as "let them fill it in
  // again," without it being an accidental side effect of every regenerate.
  const submittedOrApplied = slots.filter((s) => s.status === "SUBMITTED" || s.status === "APPLIED")

  const onRegenerateClick = () => {
    if (link && submittedOrApplied.length > 0) {
      setReopenSelection(new Set(submittedOrApplied.map((s) => s.id)))
      setReopenConfirmOpen(true)
      return
    }
    generate()
  }

  const toggleReopenSelection = (slotId: string) =>
    setReopenSelection((prev) => {
      const next = new Set(prev)
      if (next.has(slotId)) next.delete(slotId)
      else next.add(slotId)
      return next
    })

  const confirmRegenerate = async () => {
    setReopenConfirmOpen(false)
    await generate()
    if (reopenSelection.size > 0) {
      setBusy("reopen-batch")
      try {
        await Promise.all(Array.from(reopenSelection).map((id) => reopenSlot(id)))
        toast.success(`Reopened ${reopenSelection.size} guest slot(s) for correction`)
        refetch()
      } finally {
        setBusy(null)
      }
    }
  }

  const revoke = async () => {
    const ok = await confirm({
      title: "Revoke this link?",
      description: "The guest's link stops working. Details already submitted are kept.",
      confirmLabel: "Revoke",
      destructive: true,
    })
    if (!ok) return
    setBusy("revoke")
    try {
      const res = await fetch(`/api/reservations/${reservationId}/eregistration-link/revoke`, { method: "POST" })
      const body = await res.json()
      if (!res.ok) { toast.error(body.error || "Couldn't revoke the link. Try again."); return }
      setSessionToken(null); setSessionUrl(null)
      toast.success("Link revoked")
      refetch()
    } finally {
      setBusy(null)
    }
  }

  const copyLink = async () => {
    if (!sessionUrl) return
    await navigator.clipboard.writeText(sessionUrl)
    toast.success("Link copied")
  }

  const shareLink = async () => {
    if (!sessionUrl) return
    try {
      await navigator.share({
        title: "Online registration",
        text: "Please complete your registration details before arrival:",
        url: sessionUrl,
      })
    } catch (e) {
      // The guest-picker sheet was dismissed — nothing to do. Anything else: copy instead.
      if ((e as Error)?.name !== "AbortError") await copyLink()
    }
  }

  const sendEmail = async () => {
    if (!sessionToken) return
    setBusy("email")
    try {
      const res = await fetch(`/api/reservations/${reservationId}/eregistration-link/send-email`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: sessionToken }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(body.error || "Couldn't send the email. Try again."); return }
      toast.success(`Sent to ${body.sentTo}`)
    } finally {
      setBusy(null)
    }
  }

  const activeAndUsable = link?.status === "ACTIVE" && sessionToken

  const body = (
    <>
        {loading ? (
          <InlineLoading lines={2} label="Loading eRegistration" />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                {link ? (
                  <>
                    <StatusBadge label={STATUS_LABEL[link.status] ?? link.status} tone={STATUS_TONE[link.status] ?? "neutral"} />
                    {link.status === "ACTIVE" && <span className="text-muted-foreground">expires {format(new Date(link.expiresAt), "dd MMM yyyy, h:mm a")}</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground">Not sent yet</span>
                )}
              </div>
              <div className="flex gap-2">
                {link?.status === "ACTIVE" && (
                  <Button size="sm" variant="outline" onClick={revoke} disabled={!!busy}>
                    {busy === "revoke" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5 mr-1.5" />} Revoke
                  </Button>
                )}
                <Button size="sm" onClick={onRegenerateClick} disabled={!!busy}>
                  {busy === "generate" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  {link ? "Regenerate" : "Generate link"}
                </Button>
              </div>
            </div>

            {activeAndUsable && (
              <div className="space-y-2.5 rounded-lg border bg-muted/40 p-3">
                <code className="block break-all text-xs leading-relaxed text-muted-foreground">{sessionUrl}</code>
                <div className="flex flex-wrap gap-2">
                  {canShare && (
                    <Button size="sm" className="md:hidden max-sm:w-full" onClick={shareLink}>
                      <Send className="h-3.5 w-3.5 mr-1.5" /> Share link
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={copyLink}><FileStack className="h-3.5 w-3.5 mr-1.5" /> Copy link</Button>
                  <Button size="sm" variant="outline" onClick={sendEmail} disabled={busy === "email"}>
                    {busy === "email" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Mail className="h-3.5 w-3.5 mr-1.5" />} Send via email
                  </Button>
                </div>
              </div>
            )}
            {link?.status === "ACTIVE" && !sessionToken && (
              <p className="text-xs text-muted-foreground">
                The link itself isn&apos;t stored — Copy/Send only work right after Generate/Regenerate. Click Regenerate to get a fresh sendable link.
              </p>
            )}

            {slots.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                {slots.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm max-sm:flex-wrap max-sm:gap-1.5">
                    <span>{[s.firstName, s.lastName].filter(Boolean).join(" ") || `Guest ${s.slotIndex + 1}`}{s.isPrimary && <Badge variant="outline" className="ml-2 text-[10px] uppercase">Lead</Badge>}</span>
                    <div className="flex items-center gap-2">
                      {s.status === "APPLIED" ? (
                        <StatusBadge label="Applied" tone="success" />
                      ) : s.status === "SUBMITTED" ? (
                        <StatusBadge label="Submitted — review in check-in" tone="info" />
                      ) : (
                        <StatusBadge label="Pending" tone="neutral" />
                      )}
                      {(s.status === "SUBMITTED" || s.status === "APPLIED") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          disabled={!!busy}
                          onClick={() => reopenOne(s.id)}
                          title="Let this guest fill in their details again"
                        >
                          {busy === `reopen-${s.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlock className="h-3 w-3 mr-1" />}
                          Reopen
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
    </>
  )

  const reopenDialog = (
    <Dialog open={reopenConfirmOpen} onOpenChange={(o) => !o && setReopenConfirmOpen(false)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Regenerate eRegistration link</DialogTitle>
          <DialogDescription>
            These guests already submitted their details. Check who should be able to fill in and submit again on the new link — everything they already entered stays in place until they resubmit, and re-approving never clears a field that&apos;s already on file.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg border p-3">
          {submittedOrApplied.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={reopenSelection.has(s.id)} onCheckedChange={() => toggleReopenSelection(s.id)} />
              {[s.firstName, s.lastName].filter(Boolean).join(" ") || `Guest ${s.slotIndex + 1}`}
              {s.status === "APPLIED" && <StatusBadge label="Already applied" tone="neutral" />}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setReopenConfirmOpen(false)}>Cancel</Button>
          <SubmitButton type="button" onClick={confirmRegenerate} pending={busy === "generate"} pendingLabel="Regenerating…">Regenerate link</SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  if (embedded) return <div className="space-y-4 pt-2">{body}{reopenDialog}</div>

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Send className="h-4 w-4" /> eRegistration</CardTitle>
        <CardDescription>A shareable link for the guest to fill in their own registration details.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{body}</CardContent>
      {reopenDialog}
    </Card>
  )
}
