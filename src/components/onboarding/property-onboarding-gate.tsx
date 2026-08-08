"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Building2, ClipboardCheck, ShieldAlert, Plus, LogOut } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PropertyForm } from "@/components/property-form"
import { InfoHint } from "@/components/ui/info-hint"
import { toast } from "@/lib/toast"

// Shown INSTEAD of the whole dashboard while an enterprise has no property it may
// actually work in (app-owner requirement, 2026-08-03). Before this, such a session
// rendered the normal shell where every page waits on `currentProperty` and therefore
// sat in a permanent loading state — the app looked broken rather than unfinished.
//
// Three states, because "no usable property" has three very different causes:
//   NONE      — nothing created yet. Show the create form; this IS the onboarding step.
//   AWAITING  — created, waiting on Osta. Nothing to do but wait (or fix a rejection).
//   NO_RIGHTS — a property-scoped user, or one without CONTROLS create, cannot solve
//               this themselves; telling them to "add a property" would be a dead end.
//
// The gate lives in the layout, so it covers every dashboard route at once and cannot
// be bypassed by navigating directly to a page. It is a UX gate, not the security
// boundary: assertPropertyAccess() independently refuses non-ACTIVE properties on every
// API route, which is what actually stops a pending property being used.

export type GateProperty = {
  id: string
  name: string
  code: string
  status: string
  rejectionReason: string | null
}

export function PropertyOnboardingGate({
  enterpriseName,
  properties,
  state,
  canManage,
}: {
  enterpriseName: string
  properties: GateProperty[]
  /** Decided server-side by decidePropertyGate — see src/lib/properties/onboarding-gate.ts. */
  state: "NONE" | "AWAITING" | "NO_RIGHTS"
  /** Whether this user may create/resubmit properties at all. */
  canManage: boolean
}) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [resubmitting, setResubmitting] = useState<string | null>(null)

  const rejected = properties.filter((p) => p.status === "REJECTED")

  const handleResubmit = async (propertyId: string) => {
    setResubmitting(propertyId)
    try {
      const res = await fetch(`/api/properties/${propertyId}/resubmit`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Could not resubmit")
        return
      }
      toast.success("Resubmitted for approval")
      router.refresh()
    } finally {
      setResubmitting(null)
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-none bg-primary text-primary-foreground mb-4 shadow-lg">
            <Building2 size={28} />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{enterpriseName}</h1>
          <p className="text-muted-foreground mt-1">
            {state === "AWAITING"
              ? "Your property is being reviewed"
              : "Let's set up your first property"}
          </p>
        </div>

        {state === "NONE" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
            No property yet
            <InfoHint label="No property yet">Everything in Uppsolut Stay — reservations, rooms, rates, billing — belongs to a property, so there is nothing to show until you add one. Create it here; Osta reviews and approves it before it goes live.</InfoHint>
          </CardTitle>
            </CardHeader>
            <CardContent>
              <Button onClick={() => setCreateOpen(true)} className="w-full h-11">
                <Plus className="mr-2 h-4 w-4" />
                Create your property
              </Button>
            </CardContent>
          </Card>
        )}

        {state === "AWAITING" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
                {rejected.length > 0 ? "Needs your attention" : "Waiting for Osta approval"}
              </CardTitle>
              <CardDescription>
                {rejected.length > 0
                  ? "Osta could not approve this property as submitted. Correct the issue below, then resubmit."
                  : "Your property has been submitted. Osta reviews new properties before they go live — the dashboard unlocks automatically once it is approved. You do not need to do anything else."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {properties.map((p) => (
                <div key={p.id} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {p.name} <span className="font-mono text-xs text-muted-foreground">({p.code})</span>
                    </span>
                    <StatusBadge label={p.status} status={p.status} dot />
                  </div>
                  {p.status === "REJECTED" && (
                    <>
                      <p className="text-sm text-destructive">
                        <span className="font-medium">Reason:</span> {p.rejectionReason || "No reason given."}
                      </p>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resubmitting === p.id}
                          onClick={() => void handleResubmit(p.id)}
                        >
                          {resubmitting === p.id ? "Resubmitting..." : "Resubmit for approval"}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ))}
              <Button variant="outline" className="w-full" onClick={() => router.refresh()}>
                Check again
              </Button>
            </CardContent>
          </Card>
        )}

        {state === "NO_RIGHTS" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-muted-foreground" />
                No property available
              <InfoHint>Your account is not attached to an active property yet. Your administrator needs to add one — or have it approved — before you can use the system. Please contact them.</InfoHint>
            </CardTitle>
            </CardHeader>
          </Card>
        )}

        {/* The gate replaces the whole shell, so the sidebar's sign-out is gone with it —
            without this the user would be stuck on this screen with no way out. */}
        <div className="text-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" })
              window.location.href = "/login"
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create your property</DialogTitle>
              <DialogDescription>
                Submitted to Osta for approval. You can change these details later in Controls.
              </DialogDescription>
            </DialogHeader>
            <PropertyForm
              onSuccess={() => {
                setCreateOpen(false)
                // Re-runs the server layout, which re-reads the gate state — the screen
                // becomes "waiting for approval" without a manual reload.
                router.refresh()
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
