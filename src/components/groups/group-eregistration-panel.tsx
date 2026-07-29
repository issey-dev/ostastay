"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Send, FileStack, Mail, Ban, Loader2, CheckCircle2 } from "@/components/icons"
import { toast } from "@/lib/toast"

type Slot = { id: string; slotIndex: number; isPrimary: boolean; status: string; firstName: string | null; lastName: string | null }
type Pickup = { id: string; confirmationNo: string; slots: Slot[] }
type LinkStatus = { id: string; status: string; expiresAt: string } | null

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", EXPIRED: "Expired", REVOKED: "Revoked", COMPLETED: "Completed" }
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  ACTIVE: "default", EXPIRED: "destructive", REVOKED: "outline", COMPLETED: "secondary",
}

// Group-scoped eRegistration: one link sent to the block's organizer (payeeProfile),
// covering every current pickup — reuses the same slot model/apply flow as the
// reservation-scoped panel, per-pickup, so this is the same session-only-token pattern.
export function GroupERegistrationPanel({ groupId }: { groupId: string }) {
  const [loading, setLoading] = useState(true)
  const [link, setLink] = useState<LinkStatus>(null)
  const [pickups, setPickups] = useState<Pickup[]>([])
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [sessionUrl, setSessionUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refetch = useCallback(() => {
    setLoading(true)
    fetch(`/api/groups/${groupId}/eregistration-link`)
      .then((r) => r.json())
      .then((d) => { setLink(d.link ?? null); setPickups(Array.isArray(d.pickups) ? d.pickups : []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [groupId])

  useEffect(() => { refetch() }, [refetch])

  const generate = async () => {
    setBusy("generate")
    try {
      const res = await fetch(`/api/groups/${groupId}/eregistration-link`, { method: "POST" })
      const body = await res.json()
      if (!res.ok) { toast.error(body.error || "Failed to generate link."); return }
      setSessionToken(body.token)
      setSessionUrl(body.url)
      if (Array.isArray(body.warnings) && body.warnings.length > 0) body.warnings.forEach((w: string) => toast.warning(w))
      toast.success(`eRegistration link generated for ${body.pickupCount} pickup${body.pickupCount > 1 ? "s" : ""}`)
      refetch()
    } finally {
      setBusy(null)
    }
  }

  const revoke = async () => {
    setBusy("revoke")
    try {
      const res = await fetch(`/api/groups/${groupId}/eregistration-link/revoke`, { method: "POST" })
      const body = await res.json()
      if (!res.ok) { toast.error(body.error || "Failed to revoke."); return }
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

  const sendEmail = async () => {
    if (!sessionToken) return
    setBusy("email")
    try {
      const res = await fetch(`/api/groups/${groupId}/eregistration-link/send-email`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: sessionToken }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(body.error || "Failed to send email."); return }
      toast.success(`Sent to ${body.sentTo}`)
    } finally {
      setBusy(null)
    }
  }

  const activeAndUsable = link?.status === "ACTIVE" && sessionToken
  const totalSlots = pickups.reduce((n, p) => n + p.slots.length, 0)
  const doneSlots = pickups.reduce((n, p) => n + p.slots.filter((s) => s.status !== "PENDING").length, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Send className="h-4 w-4" /> Group eRegistration</CardTitle>
        <CardDescription>One link for the group organizer to fill in every pickup&apos;s guest details.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                {link ? (
                  <>
                    <Badge variant={STATUS_VARIANT[link.status] ?? "outline"}>{STATUS_LABEL[link.status] ?? link.status}</Badge>
                    {totalSlots > 0 && <span className="text-muted-foreground">{doneSlots}/{totalSlots} guests submitted</span>}
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
                <Button size="sm" onClick={generate} disabled={!!busy}>
                  {busy === "generate" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  {link ? "Regenerate" : "Generate Link"}
                </Button>
              </div>
            </div>

            {activeAndUsable && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
                <code className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{sessionUrl}</code>
                <Button size="sm" variant="outline" onClick={copyLink}><FileStack className="h-3.5 w-3.5 mr-1.5" /> Copy Link</Button>
                <Button size="sm" variant="outline" onClick={sendEmail} disabled={busy === "email"}>
                  {busy === "email" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Mail className="h-3.5 w-3.5 mr-1.5" />} Send to Organizer
                </Button>
              </div>
            )}
            {link?.status === "ACTIVE" && !sessionToken && (
              <p className="text-xs text-muted-foreground">
                The link itself isn&apos;t stored — Copy/Send only work right after Generate/Regenerate. Click Regenerate to get a fresh sendable link.
              </p>
            )}

            {pickups.length > 0 && (
              <div className="space-y-2 pt-1">
                {pickups.map((p) => (
                  <div key={p.id} className="rounded border p-2">
                    <p className="text-xs font-medium text-muted-foreground">{p.confirmationNo}</p>
                    {p.slots.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm">
                        <span>{[s.firstName, s.lastName].filter(Boolean).join(" ") || `Guest ${s.slotIndex + 1}`}{s.isPrimary && <Badge variant="outline" className="ml-2 text-[10px] uppercase">Lead</Badge>}</span>
                        {s.status === "APPLIED" ? (
                          <Badge variant="secondary" className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Applied</Badge>
                        ) : s.status === "SUBMITTED" ? (
                          <Badge>Submitted</Badge>
                        ) : (
                          <Badge variant="outline">Pending</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
