"use client"

import { PageHeader } from "@/components/ui/page-header"
import { useState, useEffect } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Clock, CheckCircle2, AlertTriangle, Eye, EyeOff, RefreshCw } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { OptionSelect } from "@/components/ui/option-select"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { ErrorState } from "@/components/ui/error-state"
import { InfoHint } from "@/components/ui/info-hint"
import { toneMutedClasses, type StatusTone } from "@/lib/status-tone"
import { maintenanceStaff } from "@/lib/job-functions"

type Ticket = {
  id: string
  roomId: string
  issueType: string
  description: string
  priority: string
  status: string
  createdAt: string
  room: {
    roomNumber: string
  }
}

export default function MaintenanceDashboard() {
  const { currentProperty } = useProperty()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [maintenanceTeam, setMaintenanceTeam] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  // Phones show one column at a time behind a segmented switch (desktop keeps the kanban).
  const [phoneTab, setPhoneTab] = useState<string>("OPEN")

  const fetchMaintenanceTeam = async () => {
    if (!currentProperty) return
    try {
      const res = await fetch(`/api/staff`)
      if (res.ok) {
        const data = await res.json()
        setMaintenanceTeam(maintenanceStaff(data))
      }
    } catch (e) {
      console.error(e)
    }
  }

  const fetchTickets = async (silent = false) => {
    if (!currentProperty) return
    if (!silent) {
      setLoading(true)
      setLoadError(false)
    }
    try {
      const res = await fetch(`/api/maintenance?propertyId=${currentProperty.id}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTickets(data)
    } catch (e) {
      console.error(e)
      if (!silent) setLoadError(true)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    fetchTickets()
    fetchMaintenanceTeam()
  }, [currentProperty])

  // The kanban previously fetched once on mount and went stale for the rest of
  // the shift — silently refresh whenever the tab regains focus.
  useEffect(() => {
    const onFocus = () => fetchTickets(true)
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [currentProperty])

  const handleStatusChange = async (ticketId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/maintenance/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      })
      if (res.ok) {
        setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: newStatus } : t))
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleAssignChange = async (ticketId: string, currentStatus: string, newAssignedToId: string) => {
    try {
      const assignedToId = newAssignedToId === "UNASSIGNED" ? null : newAssignedToId;
      
      const payload: any = { assignedToId }
      // Automatically move to IN_PROGRESS if assigned (and not already resolved)
      if (assignedToId && currentStatus === "OPEN") {
        payload.status = "IN_PROGRESS"
      }

      const res = await fetch(`/api/maintenance/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        fetchTickets() // refresh to get the updated relation and status
      }
    } catch (e) {
      console.error(e)
    }
  }

  const columns: { id: string; title: string; tone: StatusTone; icon: React.ReactNode }[] = [
    { id: "OPEN", title: "Open", tone: "danger", icon: <AlertTriangle className="w-5 h-5" /> },
    { id: "IN_PROGRESS", title: "In Progress", tone: "info", icon: <Clock className="w-5 h-5" /> },
    { id: "RESOLVED", title: "Resolved", tone: "success", icon: <CheckCircle2 className="w-5 h-5" /> }
  ]

  const priorityTone: Record<string, StatusTone> = { HIGH: "danger", MEDIUM: "warning", LOW: "info" }

  if (loading) {
    return (
      <div>
        <div className="flex justify-between items-end mb-8">
          <div>
            <Skeleton className="h-9 w-64 mb-2" />
            <Skeleton className="h-5 w-96" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-[500px] rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div>
        <div className="flex justify-between items-end mb-8">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
            Maintenance Dashboard
            <InfoHint label="Maintenance Dashboard">Track, manage, and resolve property maintenance issues.</InfoHint>
          </h2>
          </div>
        </div>
        <ErrorState title="Couldn't load maintenance tickets" onRetry={() => fetchTickets()} />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        className="mb-8"
        align="end"
        title="Maintenance Dashboard"
        hint="Track, manage, and resolve property maintenance issues."
        actions={<>
          <Button variant="outline" onClick={() => fetchTickets()} className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowResolved(!showResolved)}
            className="flex items-center gap-2 max-md:hidden"
          >
            {showResolved ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showResolved ? "Hide Resolved" : "Show Resolved"}
          </Button>
        </>}
      />

      {/* Phones: Open / In progress / Resolved switch, one list below */}
      <div role="tablist" aria-label="Ticket status" className="mb-4 grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted/50 p-1 md:hidden">
        {columns.map(col => {
          const count = tickets.filter(t => t.status === col.id).length
          const active = phoneTab === col.id
          return (
            <button
              key={col.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setPhoneTab(col.id)}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-colors ${active ? `border shadow-sm ${toneMutedClasses(col.tone)}` : "text-muted-foreground"}`}
            >
              {col.title}
              <span className="text-xs tabular-nums opacity-80">{count}</span>
            </button>
          )
        })}
      </div>

      <div className={`grid grid-cols-1 ${showResolved ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-6`}>
        {columns.map(col => {
          // Resolved is always reachable from the phone switch; desktop still needs "Show Resolved".
          const phoneOnly = col.id === "RESOLVED" && !showResolved
          if (phoneOnly && phoneTab !== "RESOLVED") return null;
          
          const colTickets = tickets.filter(t => t.status === col.id)
          return (
            <div key={col.id} className={`bg-muted/50 border border-border rounded-2xl p-4 min-h-[500px] max-md:min-h-0 max-md:border-0 max-md:bg-transparent max-md:p-0${phoneTab !== col.id ? " max-md:hidden" : ""}${phoneOnly ? " md:hidden" : ""}`}>
              <div className={`flex items-center gap-3 p-3 rounded-xl border mb-4 max-md:hidden ${toneMutedClasses(col.tone)}`}>
                {col.icon}
                <h2 className="font-bold text-lg">{col.title}</h2>
                <div className="ml-auto bg-background/50 px-2 py-0.5 rounded-none text-sm font-semibold">
                  {colTickets.length}
                </div>
              </div>

              <div className="space-y-4">
                {colTickets.map(ticket => (
                  <div key={ticket.id} className="bg-card border border-border rounded-xl p-4 shadow-elevation-1 hover:shadow-elevation-2 transition-shadow">
                    <div className="flex justify-between items-start mb-2 max-md:flex-wrap max-md:gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lg text-foreground">Room {ticket.room?.roomNumber}</span>
                        <StatusBadge label={ticket.priority} tone={priorityTone[ticket.priority] ?? "neutral"} className="font-bold" />
                      </div>
                      <OptionSelect
                        size="sm"
                        aria-label="Ticket status"
                        className="w-32 text-xs max-md:w-full"
                        value={ticket.status}
                        onChange={(v) => handleStatusChange(ticket.id, v)}
                        options={[
                          { label: "Open", value: "OPEN" },
                          { label: "In Progress", value: "IN_PROGRESS" },
                          { label: "Resolved", value: "RESOLVED" },
                        ]}
                      />
                    </div>

                    <div className="mb-3">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{ticket.issueType}</span>
                      <p className="text-sm text-foreground mt-1">{ticket.description}</p>
                    </div>

                    <div className="border-t border-border pt-3 mt-3 space-y-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Assignee</label>
                        <OptionSelect
                          size="sm"
                          aria-label="Assigned to"
                          className="w-44 text-xs max-md:w-full"
                          value={(ticket as any).assignedToId || "UNASSIGNED"}
                          onChange={(v) => handleAssignChange(ticket.id, ticket.status, v)}
                          options={[
                            { label: "Unassigned", value: "UNASSIGNED" },
                            ...maintenanceTeam.map(user => ({ label: `${user.firstName} ${user.lastName ?? ""}`.trim(), value: user.id })),
                          ]}
                        />
                      </div>

                      <div className="flex justify-between items-center text-xs text-muted-foreground border-t pt-2">
                        <span>Reported {new Date(ticket.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {colTickets.length === 0 && (
                  <div className="text-center py-10 text-muted-foreground text-sm border-2 border-dashed border-border rounded-xl">
                    No tickets
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
