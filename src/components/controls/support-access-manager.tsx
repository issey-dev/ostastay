"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ShieldCheck, ShieldOff, LogIn } from "lucide-react"

type Grant = {
  id: string
  status: "PENDING" | "APPROVED" | "DENIED" | "REVOKED" | "EXPIRED"
  reason: string | null
  requestedAt: string
  respondedAt: string | null
  expiresAt: string | null
  enterprise: { id: string; name: string; slug: string }
  requestedBy: { id: string; firstName: string; lastName: string; email: string }
  approvedBy: { id: string; firstName: string; lastName: string; email: string } | null
}

type EnterpriseOption = { id: string; name: string; slug: string }

function statusBadge(grant: Grant) {
  const expired = grant.status === "APPROVED" && grant.expiresAt && new Date(grant.expiresAt) <= new Date()
  const label = expired ? "EXPIRED" : grant.status
  const cls: Record<string, string> = {
    PENDING: "bg-warning-muted text-warning",
    APPROVED: "bg-success-muted text-success",
    DENIED: "bg-destructive-muted text-destructive",
    REVOKED: "bg-muted text-muted-foreground",
    EXPIRED: "bg-muted text-muted-foreground",
  }
  return <Badge variant="secondary" className={cls[label]}>{label}</Badge>
}

export function SupportAccessManager({ isInternal }: { isInternal: boolean }) {
  const [grants, setGrants] = useState<Grant[]>([])
  const [enterprises, setEnterprises] = useState<EnterpriseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [requestEnterpriseId, setRequestEnterpriseId] = useState("")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const fetchGrants = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/support-access")
      if (res.ok) setGrants(await res.json())
      if (isInternal) {
        const entRes = await fetch("/api/enterprises")
        if (entRes.ok) setEnterprises(await entRes.json())
      }
    } finally {
      setLoading(false)
    }
  }, [isInternal])

  useEffect(() => { fetchGrants() }, [fetchGrants])

  const handleRequest = async () => {
    if (!requestEnterpriseId) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      const res = await fetch("/api/support-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enterpriseId: requestEnterpriseId, reason }),
      })
      if (res.ok) {
        setReason("")
        setRequestEnterpriseId("")
        fetchGrants()
      } else {
        const err = await res.json()
        setErrorMsg(err.error || "Failed to submit request")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const respond = async (id: string, action: "approve" | "deny") => {
    const res = await fetch(`/api/support-access/${id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    if (res.ok) fetchGrants()
  }

  const revoke = async (id: string) => {
    const res = await fetch(`/api/support-access/${id}/revoke`, { method: "POST" })
    if (res.ok) fetchGrants()
  }

  const enter = async (id: string) => {
    const res = await fetch(`/api/support-access/enter/${id}`, { method: "POST" })
    if (res.ok) {
      window.location.reload()
    }
  }

  const exit = async () => {
    await fetch("/api/support-access/exit", { method: "POST" })
    window.location.reload()
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading support access requests...</div>

  return (
    <div className="space-y-6">
      {isInternal && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Request Support Access</CardTitle>
              <CardDescription>
                You have no implicit access to any enterprise&apos;s data — the enterprise&apos;s own admin must approve a
                time-boxed request before you can view/troubleshoot their configuration.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {errorMsg && <div className="bg-destructive-muted border border-destructive/30 text-destructive text-sm p-3 rounded-md">{errorMsg}</div>}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Enterprise</label>
                  <Select value={requestEnterpriseId} onValueChange={(v) => setRequestEnterpriseId(v ?? "")}>
                    <SelectTrigger><SelectValue placeholder="Select enterprise">{enterprises.find((e) => e.id === requestEnterpriseId)?.name}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {enterprises.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason</label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why do you need access? (shown to the enterprise's admin)" />
              </div>
              <Button className="" onClick={handleRequest} disabled={submitting || !requestEnterpriseId}>
                {submitting ? "Submitting..." : "Request Access"}
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <h3 className="text-lg font-medium">Your Requests</h3>
            {grants.map((g) => {
              const isLive = g.status === "APPROVED" && (!g.expiresAt || new Date(g.expiresAt) > new Date())
              return (
                <Card key={g.id}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <div className="font-medium flex items-center gap-2">{g.enterprise.name} {statusBadge(g)}</div>
                      {g.reason && <p className="text-sm text-muted-foreground mt-1">{g.reason}</p>}
                      {g.expiresAt && g.status === "APPROVED" && (
                        <p className="text-xs text-muted-foreground mt-1">Expires {new Date(g.expiresAt).toLocaleString()}</p>
                      )}
                    </div>
                    {isLive && (
                      <Button size="sm" variant="outline" onClick={() => enter(g.id)}>
                        <LogIn className="w-4 h-4 mr-1" /> Enter Support Mode
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
            {grants.length === 0 && <p className="text-sm text-muted-foreground">No requests yet.</p>}
          </div>
        </>
      )}

      {!isInternal && (
        <div className="space-y-3">
          <h3 className="text-lg font-medium">Support Access Requests</h3>
          <p className="text-sm text-muted-foreground">Osta support staff need your explicit, time-boxed approval before viewing this enterprise&apos;s configuration.</p>
          {grants.map((g) => (
            <Card key={g.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {g.requestedBy.firstName} {g.requestedBy.lastName} {statusBadge(g)}
                  </div>
                  {g.reason && <p className="text-sm text-muted-foreground mt-1">{g.reason}</p>}
                  <p className="text-xs text-muted-foreground mt-1">Requested {new Date(g.requestedAt).toLocaleString()}</p>
                </div>
                <div className="flex gap-2">
                  {g.status === "PENDING" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => respond(g.id, "approve")}>
                        <ShieldCheck className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => respond(g.id, "deny")}>
                        <ShieldOff className="w-4 h-4 mr-1 text-destructive" /> Deny
                      </Button>
                    </>
                  )}
                  {g.status === "APPROVED" && (!g.expiresAt || new Date(g.expiresAt) > new Date()) && (
                    <Button size="sm" variant="ghost" onClick={() => revoke(g.id)}>
                      <ShieldOff className="w-4 h-4 mr-1 text-destructive" /> Revoke
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {grants.length === 0 && <p className="text-sm text-muted-foreground">No support access requests for your enterprise.</p>}
        </div>
      )}

      {isInternal && (
        <div className="pt-4 border-t">
          <Button variant="ghost" size="sm" onClick={exit}>Exit support mode (if currently active)</Button>
        </div>
      )}
    </div>
  )
}
