"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import { SubmitButton } from "@/components/ui/submit-button"
import { EmptyState } from "@/components/ui/empty-state"
import { InlineLoading } from "@/components/ui/inline-loading"
import { apiError } from "@/lib/api-error"
import { toast } from "@/lib/toast"
import { ShieldCheck, ShieldOff, LogIn } from "@/components/icons"
import { InfoHint } from "@/components/ui/info-hint"

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
  const status = expired ? "EXPIRED" : grant.status
  return <StatusBadge status={status} label={status.charAt(0) + status.slice(1).toLowerCase()} />
}

export function SupportAccessManager({ isInternal }: { isInternal: boolean }) {
  const [grants, setGrants] = useState<Grant[]>([])
  const [enterprises, setEnterprises] = useState<EnterpriseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [requestEnterpriseId, setRequestEnterpriseId] = useState("")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // The grant whose approve/deny/revoke/enter is in flight — one click, one request.
  const [busyId, setBusyId] = useState<string | null>(null)

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
        setErrorMsg(await apiError(res, "Couldn't send the request. Try again."))
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Runs one grant action with a busy guard; a refusal is a toast instead of silence.
  const run = async (id: string, request: () => Promise<Response>, fallback: string, onOk: () => void) => {
    if (busyId) return
    setBusyId(id)
    try {
      const res = await request()
      if (res.ok) onOk()
      else toast.error(await apiError(res, fallback))
    } catch {
      toast.error(fallback)
    } finally {
      setBusyId(null)
    }
  }

  const respond = (id: string, action: "approve" | "deny") =>
    run(id, () => fetch(`/api/support-access/${id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }), "Couldn't save your answer. Try again.", fetchGrants)

  const revoke = (id: string) =>
    run(id, () => fetch(`/api/support-access/${id}/revoke`, { method: "POST" }), "Couldn't revoke access. Try again.", fetchGrants)

  const enter = (id: string) =>
    run(id, () => fetch(`/api/support-access/enter/${id}`, { method: "POST" }), "Couldn't enter support mode. Try again.", () => window.location.reload())

  const exit = async () => {
    await fetch("/api/support-access/exit", { method: "POST" })
    window.location.reload()
  }

  if (loading) return <InlineLoading className="p-8" label="Loading support access requests" />

  return (
    <div className="space-y-6">
      {isInternal && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
            Request support access
            <InfoHint label="Request support access">You have no implicit access to any enterprise&apos;s data — the enterprise&apos;s own admin must approve a time-boxed request before you can view/troubleshoot their configuration.</InfoHint>
          </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {errorMsg && <div className="bg-destructive-muted border border-destructive/30 text-destructive text-sm p-3 rounded-md">{errorMsg}</div>}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
              <SubmitButton type="button" onClick={handleRequest} pending={submitting} pendingLabel="Sending…" disabled={!requestEnterpriseId}>
                Request access
              </SubmitButton>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <h3 className="text-lg font-medium">Your requests</h3>
            {grants.map((g) => {
              const isLive = g.status === "APPROVED" && (!g.expiresAt || new Date(g.expiresAt) > new Date())
              return (
                <Card key={g.id}>
                  <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-medium flex flex-wrap items-center gap-2">{g.enterprise.name} {statusBadge(g)}</div>
                      {g.reason && <p className="text-sm text-muted-foreground mt-1">{g.reason}</p>}
                      {g.expiresAt && g.status === "APPROVED" && (
                        <p className="text-xs text-muted-foreground mt-1">Expires {new Date(g.expiresAt).toLocaleString()}</p>
                      )}
                    </div>
                    {isLive && (
                      <Button size="sm" variant="outline" className="w-full sm:w-auto" disabled={busyId === g.id} onClick={() => enter(g.id)}>
                        <LogIn className="w-4 h-4 mr-1" /> Enter support mode
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
            {grants.length === 0 && <EmptyState size="inline" title="No requests yet." />}
          </div>
        </>
      )}

      {!isInternal && (
        // Phones: a flex column so pending requests (the ones waiting on this admin) sort
        // above the rest via `order`; desktop keeps the plain stacked list.
        <div className="space-y-3 max-sm:flex max-sm:flex-col max-sm:gap-3 max-sm:space-y-0">
          <h3 className="flex items-center gap-2 text-lg font-medium">
            Support access requests
            <InfoHint label="Support access requests">Osta support staff need your explicit, time-boxed approval before viewing this enterprise&apos;s configuration.</InfoHint>
          </h3>
          {grants.map((g) => (
            <Card key={g.id} className={g.status === "PENDING" ? undefined : "max-sm:order-1"}>
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium flex flex-wrap items-center gap-2">
                    {g.requestedBy.firstName} {g.requestedBy.lastName} {statusBadge(g)}
                  </div>
                  {g.reason && <p className="text-sm text-muted-foreground mt-1">{g.reason}</p>}
                  <p className="text-xs text-muted-foreground mt-1">Requested {new Date(g.requestedAt).toLocaleString()}</p>
                </div>
                <div className="flex gap-2">
                  {g.status === "PENDING" && (
                    <>
                      <Button size="sm" variant="outline" className="flex-1 sm:flex-none" disabled={busyId === g.id} onClick={() => respond(g.id, "approve")}>
                        <ShieldCheck className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button size="sm" variant="ghost" className="flex-1 sm:flex-none" disabled={busyId === g.id} onClick={() => respond(g.id, "deny")}>
                        <ShieldOff className="w-4 h-4 mr-1 text-destructive" /> Deny
                      </Button>
                    </>
                  )}
                  {g.status === "APPROVED" && (!g.expiresAt || new Date(g.expiresAt) > new Date()) && (
                    <Button size="sm" variant="ghost" disabled={busyId === g.id} onClick={() => revoke(g.id)}>
                      <ShieldOff className="w-4 h-4 mr-1 text-destructive" /> Revoke
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {grants.length === 0 && <EmptyState size="inline" title="No support access requests for your enterprise." />}
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
