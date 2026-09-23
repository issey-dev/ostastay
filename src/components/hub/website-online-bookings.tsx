"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ListChecks } from "@/components/icons"

// Hub → Booking API → Online bookings: every booking the brand websites made, or tried to
// make, across rooms, excursions and spa — failed attempts and expired holds included, so
// "the website says it booked but I can't find it" has an answer.
// Server side: src/lib/website-api/online-bookings.ts.

type Row = {
  id: string
  createdAt: string
  module: "ROOMS" | "EXCURSIONS" | "SPA"
  reference: string | null
  property: { id: string; name: string }
  keyName: string
  guest: { name: string | null; email: string | null }
  summary: string
  total: number | null
  currency: string | null
  payment: string | null
  paymentFlagged: boolean
  status: string
  problem: string | null
}

const MODULE_LABEL: Record<Row["module"], string> = { ROOMS: "Rooms", EXCURSIONS: "Excursions", SPA: "Spa" }
const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
  HELD: "Held",
  EXPIRED: "Expired",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  OTHER: "Other",
}

function money(total: number | null, currency: string | null) {
  return total == null ? "—" : `${total.toFixed(2)} ${currency ?? ""}`.trim()
}

export function WebsiteOnlineBookings({ propertyId, modules }: { propertyId: string; modules: Row["module"][] }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [moduleFilter, setModuleFilter] = useState("ALL")
  const [statusFilter, setStatusFilter] = useState("ALL")

  const load = useCallback(async () => {
    setError(false)
    setLoading(true)
    try {
      const qs = new URLSearchParams({ propertyId })
      if (moduleFilter !== "ALL") qs.set("module", moduleFilter)
      if (statusFilter !== "ALL") qs.set("status", statusFilter)
      const res = await fetch(`/api/hub/website/bookings?${qs}`)
      if (!res.ok) throw new Error()
      setRows((await res.json()).bookings ?? [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [propertyId, moduleFilter, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  const statusBadge = (r: Row) => (
    <StatusBadge
      label={STATUS_LABEL[r.status] ?? r.status}
      tone={r.status === "FAILED" ? "danger" : r.status === "HELD" ? "info" : r.status === "EXPIRED" || r.status === "CANCELLED" ? "neutral" : undefined}
      status={r.status}
    />
  )

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Online bookings</CardTitle>
          <CardDescription>
            Everything websites booked or tried to book at this property, newest first. Failed attempts show why; a hold is a place
            kept while the guest paid, and expires by itself if not booked.
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Select value={moduleFilter} onValueChange={(v) => setModuleFilter(v ?? "ALL")}>
            <SelectTrigger className="w-[140px]" aria-label="Module">
              <SelectValue>{moduleFilter === "ALL" ? "All modules" : MODULE_LABEL[moduleFilter as Row["module"]]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All modules</SelectItem>
              {modules.map((m) => <SelectItem key={m} value={m}>{MODULE_LABEL[m]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "ALL")}>
            <SelectTrigger className="w-[140px]" aria-label="Status">
              <SelectValue>{statusFilter === "ALL" ? "All statuses" : STATUS_LABEL[statusFilter]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "FAILED", "HELD", "EXPIRED"].map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : error ? (
          <ErrorState title="Couldn't load online bookings" onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState icon={ListChecks} title="No online bookings yet" description="Bookings made through your websites will appear here." />
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {rows.map((r) => (
                <div key={`${r.module}-${r.id}`} className="space-y-1.5 rounded-md border border-border bg-card p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{r.guest.name || "—"}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.summary}</div>
                    </div>
                    {statusBadge(r)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{MODULE_LABEL[r.module]}</Badge>
                    {r.reference && <span className="font-mono">{r.reference}</span>}
                    <span>{new Date(r.createdAt).toLocaleString()}</span>
                    <span>{money(r.total, r.currency)}</span>
                  </div>
                  {r.problem && <div className="text-xs text-destructive">{r.problem}</div>}
                  {r.paymentFlagged && <div className="text-xs text-destructive">Paid amount differs from the total — check the payment.</div>}
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:-mx-6 md:-mb-6 md:block md:border-t md:border-border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="px-6">When</TableHead>
                    <TableHead>Guest</TableHead>
                    <TableHead>Booking</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="px-6">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={`${r.module}-${r.id}`}>
                      <TableCell className="px-6 text-xs text-muted-foreground">
                        <div>{new Date(r.createdAt).toLocaleString()}</div>
                        <div>{r.keyName}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.guest.name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.guest.email}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{MODULE_LABEL[r.module]}</Badge>
                          {r.reference && <span className="font-mono text-xs">{r.reference}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{r.property.name} · {r.summary}</div>
                        {r.problem && <div className="text-xs text-destructive">{r.problem}</div>}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{money(r.total, r.currency)}</TableCell>
                      <TableCell className="text-xs">
                        <div className="text-muted-foreground">{r.payment ?? "—"}</div>
                        {r.paymentFlagged && <div className="text-destructive">Check payment</div>}
                      </TableCell>
                      <TableCell className="px-6">{statusBadge(r)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
