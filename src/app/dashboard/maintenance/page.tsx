"use client"

import { useState, useEffect } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Wrench, Clock, CheckCircle2, AlertTriangle, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"

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
  const [showResolved, setShowResolved] = useState(false)

  const fetchMaintenanceTeam = async () => {
    if (!currentProperty) return
    try {
      const res = await fetch(`/api/settings/users?enterpriseId=${currentProperty.enterpriseId}`)
      if (res.ok) {
        const data = await res.json()
        setMaintenanceTeam(data.filter((u: any) => u.role?.name === "Maintenance" && u.isActive))
      }
    } catch (e) {
      console.error(e)
    }
  }

  const fetchTickets = async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const res = await fetch(`/api/maintenance?propertyId=${currentProperty.id}`)
      if (res.ok) {
        const data = await res.json()
        setTickets(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTickets()
    fetchMaintenanceTeam()
  }, [currentProperty])

  const handleStatusChange = async (ticketId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/maintenance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, status: newStatus })
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
      
      const payload: any = { ticketId, assignedToId }
      // Automatically move to IN_PROGRESS if assigned (and not already resolved)
      if (assignedToId && currentStatus === "OPEN") {
        payload.status = "IN_PROGRESS"
      }
      
      const res = await fetch(`/api/maintenance`, {
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

  const columns = [
    { id: "OPEN", title: "Open", color: "bg-rose-50 border-rose-200 text-rose-700", icon: <AlertTriangle className="w-5 h-5" /> },
    { id: "IN_PROGRESS", title: "In Progress", color: "bg-amber-50 border-amber-200 text-amber-700", icon: <Clock className="w-5 h-5" /> },
    { id: "RESOLVED", title: "Resolved", color: "bg-emerald-50 border-emerald-200 text-emerald-700", icon: <CheckCircle2 className="w-5 h-5" /> }
  ]

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "HIGH": return "bg-rose-100 text-rose-700"
      case "MEDIUM": return "bg-amber-100 text-amber-700"
      case "LOW": return "bg-blue-100 text-blue-700"
      default: return "bg-slate-100 text-slate-700"
    }
  }

  if (loading) {
    return <div className="p-8 flex justify-center text-slate-400">Loading...</div>
  }

  return (
    <div className="p-8 max-w-7xl mx-auto min-h-screen">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Wrench className="w-6 h-6 text-amber-600" />
            </div>
            Maintenance Dashboard
          </h1>
          <p className="text-slate-500 mt-2">Track, manage, and resolve property maintenance issues.</p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => setShowResolved(!showResolved)}
          className="text-slate-600 flex items-center gap-2"
        >
          {showResolved ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {showResolved ? "Hide Resolved" : "Show Resolved"}
        </Button>
      </div>

      <div className={`grid grid-cols-1 ${showResolved ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-6`}>
        {columns.map(col => {
          if (col.id === "RESOLVED" && !showResolved) return null;
          
          const colTickets = tickets.filter(t => t.status === col.id)
          return (
            <div key={col.id} className="bg-slate-50/50 border border-slate-200 rounded-2xl p-4 min-h-[500px]">
              <div className={`flex items-center gap-3 p-3 rounded-xl border mb-4 ${col.color}`}>
                {col.icon}
                <h2 className="font-bold text-lg">{col.title}</h2>
                <div className="ml-auto bg-white/50 px-2 py-0.5 rounded-full text-sm font-semibold">
                  {colTickets.length}
                </div>
              </div>

              <div className="space-y-4">
                {colTickets.map(ticket => (
                  <div key={ticket.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lg text-slate-900">Room {ticket.room?.roomNumber}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${getPriorityColor(ticket.priority)}`}>
                          {ticket.priority}
                        </span>
                      </div>
                      <select 
                        className="text-xs bg-slate-50 border border-slate-200 rounded p-1 text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        value={ticket.status}
                        onChange={(e) => handleStatusChange(ticket.id, e.target.value)}
                      >
                        <option value="OPEN">Open</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="RESOLVED">Resolved</option>
                      </select>
                    </div>
                    
                    <div className="mb-3">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{ticket.issueType}</span>
                      <p className="text-sm text-slate-700 mt-1">{ticket.description}</p>
                    </div>

                    <div className="border-t border-slate-100 pt-3 mt-3 space-y-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Assignee</label>
                        <select 
                          className="text-xs bg-slate-50 border border-slate-200 rounded p-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          value={(ticket as any).assignedToId || "UNASSIGNED"}
                          onChange={(e) => handleAssignChange(ticket.id, ticket.status, e.target.value)}
                        >
                          <option value="UNASSIGNED">Unassigned</option>
                          {maintenanceTeam.map(user => (
                            <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex justify-between items-center text-xs text-slate-400 border-t pt-2">
                        <span>Reported {new Date(ticket.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {colTickets.length === 0 && (
                  <div className="text-center py-10 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
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
