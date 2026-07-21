"use client"

import { useEffect, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Check, X } from "lucide-react"

type PropertyRow = {
  id: string
  name: string
  code: string
  status: string
  rejectionReason: string | null
  createdAt: string
  enterprise: { id: string; name: string; slug: string }
  reviewedBy: { firstName: string; lastName: string } | null
}

const FILTERS = [
  { value: "PENDING", label: "Pending" },
  { value: "ACTIVE", label: "Active" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ALL", label: "All" },
]

export function PropertyApprovalQueue() {
  const [filter, setFilter] = useState("PENDING")
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchProperties = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/osta/properties?status=${filter}`)
      if (res.ok) setProperties(await res.json())
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { fetchProperties() }, [fetchProperties])

  const approve = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/osta/properties/${id}/approve`, { method: "POST" })
      if (res.ok) fetchProperties()
    } finally {
      setBusyId(null)
    }
  }

  const reject = async (id: string) => {
    if (!rejectionReason.trim()) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/osta/properties/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionReason }),
      })
      if (res.ok) {
        setRejectingId(null)
        setRejectionReason("")
        fetchProperties()
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={filter} onValueChange={(v) => setFilter(v ?? "PENDING")}>
          <SelectTrigger className="w-40"><SelectValue>{FILTERS.find((f) => f.value === filter)?.label}</SelectValue></SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground italic">Loading...</p>
      ) : properties.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-8 text-center border rounded-md bg-muted/40">
          No {filter !== "ALL" ? filter.toLowerCase() : ""} properties.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {properties.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">{p.name} <span className="text-muted-foreground font-mono text-sm">({p.code})</span></CardTitle>
                    <CardDescription>
                      {p.enterprise.name} · submitted {new Date(p.createdAt).toLocaleDateString()}
                      {p.reviewedBy && ` · reviewed by ${p.reviewedBy.firstName} ${p.reviewedBy.lastName}`}
                    </CardDescription>
                  </div>
                  <StatusBadge label={p.status} status={p.status} dot />
                </div>
              </CardHeader>
              {p.status === "REJECTED" && p.rejectionReason && (
                <CardContent className="pt-0 pb-3">
                  <p className="text-sm text-destructive">Reason: {p.rejectionReason}</p>
                </CardContent>
              )}
              {p.status === "PENDING" && (
                <CardContent className="pt-0 flex flex-col gap-3">
                  {rejectingId === p.id ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        placeholder="Reason for rejection (shown to the enterprise's admin)"
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                      />
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => { setRejectingId(null); setRejectionReason("") }}>Cancel</Button>
                        <Button variant="destructive" size="sm" disabled={busyId === p.id || !rejectionReason.trim()} onClick={() => reject(p.id)}>
                          {busyId === p.id ? "Rejecting..." : "Confirm Reject"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => setRejectingId(p.id)}>
                        <X className="h-4 w-4 mr-1.5" /> Reject
                      </Button>
                      <Button size="sm" disabled={busyId === p.id} onClick={() => approve(p.id)}>
                        <Check className="h-4 w-4 mr-1.5" /> {busyId === p.id ? "Approving..." : "Approve"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
