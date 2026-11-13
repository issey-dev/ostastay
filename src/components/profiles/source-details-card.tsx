"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { z } from "zod"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBadge } from "@/components/ui/status-badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Briefcase, Users, FileStack as Copy } from "@/components/icons"
import { MarkerBarPreview } from "@/components/reservations/marker-picker"
import { SETTLEMENT_MODE_LABELS, isMarkerColor, isMarkerIcon, isSettlementMode } from "@/lib/booking-markers"
import { usePermissions } from "@/hooks/use-permissions"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { INPUT_EMAIL } from "@/lib/input-presets"

// The Source side of a profile's Overview (Agent Portal plan A-25): its commercial terms and
// Tape Chart marker at a glance, and its agent portal logins (add, copy the link, suspend,
// reset). Shown only on SOURCE profiles; edits to the terms go through the profile form.

type SourceProfile = {
  upid: string
  companyName?: string | null
  firstName: string
  commissionRate?: number | null
  settlementMode?: string | null
  earlyAccessDays?: number | null
  portalAutoConfirm?: boolean
  markerIcon?: string | null
  markerColor?: string | null
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  )
}

export function SourceDetailsCard({ profile, editHref }: { profile: SourceProfile; editHref: string }) {
  const name = profile.companyName || profile.firstName
  const icon = isMarkerIcon(profile.markerIcon) ? profile.markerIcon : null
  const color = isMarkerColor(profile.markerColor) ? profile.markerColor : null
  return (
    <Card id="source-details">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Briefcase className="h-4 w-4 text-muted-foreground" /> Source details
          </CardTitle>
          <CardDescription>How bookings from this source are paid, confirmed and shown.</CardDescription>
        </div>
        <Link href={`${editHref}#source-settings`} className="text-sm font-medium text-primary hover:underline">Edit</Link>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          <Item label="Commission">{profile.commissionRate != null ? `${profile.commissionRate}%` : <span className="font-normal text-muted-foreground">Not set</span>}</Item>
          <Item label="Who pays">{isSettlementMode(profile.settlementMode) ? SETTLEMENT_MODE_LABELS[profile.settlementMode] : "Agent pays, net of commission"}</Item>
          <Item label="Early access">{profile.earlyAccessDays ? `${profile.earlyAccessDays} day${profile.earlyAccessDays === 1 ? "" : "s"} before sales open` : "None"}</Item>
          <Item label="Confirmation">{profile.portalAutoConfirm ? "Bookings confirm automatically" : "The desk confirms each booking"}</Item>
          <div className="col-span-2 md:col-span-4">
            <dt className="mb-1 text-xs text-muted-foreground">Tape Chart marker</dt>
            <dd>
              {icon || color ? (
                <div className="flex flex-wrap gap-3">
                  <MarkerBarPreview icon={icon ?? "Briefcase"} color={color} guest={name} />
                  <MarkerBarPreview icon={icon ?? "Briefcase"} color={color} guest={name} tentative />
                  <MarkerBarPreview icon={icon ?? "Briefcase"} color={color} guest={name} checkedOut />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Default marker</span>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}

type Login = { id: string; email: string; name: string; status: string; lastLoginAt: string | null; inviteExpiresAt: string | null }

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  name: z.string().trim().max(120),
})
type InviteValues = z.infer<typeof inviteSchema>

export function PortalLoginsCard({ upid }: { upid: string }) {
  const { has } = usePermissions()
  const canManage = has("profiles.portalLogins")
  const confirm = useConfirm()
  const [rows, setRows] = useState<Login[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [shown, setShown] = useState<{ title: string; link: string | null; token: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const form = useForm<InviteValues>({ resolver: zodResolver(inviteSchema) as Resolver<InviteValues>, mode: "onChange", defaultValues: { email: "", name: "" } })

  const load = useCallback(async () => {
    const res = await fetch(`/api/profiles/${upid}/portal-logins`)
    setRows(res.ok ? await res.json() : [])
  }, [upid])
  useEffect(() => {
    load()
  }, [load])

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/profiles/${upid}/portal-logins`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!res.ok) {
        toast.error(await apiError(res, "That didn't work. Try again."))
        return null
      }
      return res.json()
    } finally {
      setBusy(false)
    }
  }

  const invite = form.handleSubmit(async (v) => {
    const r = await post({ action: "invite", email: v.email, name: v.name })
    if (!r) return
    setAdding(false)
    form.reset()
    setShown({ title: `Invite link for ${v.email}`, link: r.link, token: r.token })
    load()
  })

  const reset = async (l: Login) => {
    const r = await post({ action: "reset", id: l.id })
    if (r) setShown({ title: r.kind === "invite" ? `New invite link for ${l.email}` : `Password reset link for ${l.email}`, link: r.link, token: r.token })
  }
  const toggle = async (l: Login) => {
    if (l.status !== "SUSPENDED") {
      const ok = await confirm({ title: `Suspend ${l.email}?`, description: "They are signed out everywhere and cannot sign in until reactivated. Their bookings stay.", confirmLabel: "Suspend", destructive: true })
      if (!ok) return
    }
    if (await post({ action: l.status === "SUSPENDED" ? "reactivate" : "suspend", id: l.id })) {
      toast.success(l.status === "SUSPENDED" ? "Login reactivated" : "Login suspended")
      load()
    }
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied")
    } catch {
      toast.error("Couldn't copy. Select the text and copy it.")
    }
  }

  return (
    <Card id="portal-logins">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-4 w-4 text-muted-foreground" /> Agent portal logins
          </CardTitle>
          <CardDescription>The people at this source who can sign in to the agent portal. Each gets a link to set their own password.</CardDescription>
        </div>
        {canManage && <Button size="sm" variant="outline" onClick={() => setAdding(true)}>Add login</Button>}
      </CardHeader>
      <CardContent>
        {!rows ? null : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No logins yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {l.email}
                    {l.lastLoginAt ? ` · last signed in ${format(new Date(l.lastLoginAt), "d MMM yyyy")}` : l.status === "INVITED" && l.inviteExpiresAt ? ` · invite valid until ${format(new Date(l.inviteExpiresAt), "d MMM")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge label={l.status === "INVITED" ? "Invited" : l.status === "ACTIVE" ? "Active" : "Suspended"} status={l.status === "INVITED" ? "PENDING" : l.status === "ACTIVE" ? "ACTIVE" : "INACTIVE"} />
                  {canManage && (
                    <>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => reset(l)}>{l.status === "INVITED" ? "Resend" : "Reset"}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle(l)}>{l.status === "SUSPENDED" ? "Reactivate" : "Suspend"}</Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent size="sm" mobile="sheet">
          <form onSubmit={invite} className="contents">
            <DialogHeader>
              <DialogTitle>Add a portal login</DialogTitle>
              <DialogDescription>You get a link to send them; it lets them set a password and is valid for 7 days.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pl-email">Email</Label>
                <Input id="pl-email" {...INPUT_EMAIL} {...form.register("email")} />
                {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pl-name">Name</Label>
                <Input id="pl-name" placeholder="Optional" {...form.register("name")} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>Create link</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent size="md" mobile="sheet">
          <DialogHeader>
            <DialogTitle>{shown?.title}</DialogTitle>
            <DialogDescription>Send this to the person. It is shown only once and works only once.</DialogDescription>
          </DialogHeader>
          {shown?.link ? (
            <div className="flex items-center gap-2">
              <Input readOnly value={shown.link} className="font-mono text-xs" aria-label="Link" />
              <Button size="icon" variant="outline" onClick={() => copy(shown.link!)} aria-label="Copy link"><Copy className="size-4" /></Button>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">The agent portal address is not set up on this server yet, so here is the code to paste into the portal instead:</p>
              <div className="flex items-center gap-2">
                <Input readOnly value={shown?.token ?? ""} className="font-mono text-xs" aria-label="Code" />
                <Button size="icon" variant="outline" onClick={() => copy(shown?.token ?? "")} aria-label="Copy code"><Copy className="size-4" /></Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShown(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
