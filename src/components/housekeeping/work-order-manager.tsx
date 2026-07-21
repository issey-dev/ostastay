"use client"

import { useState, useEffect } from "react"
import { Wrench, Plus, CheckCircle2, Circle, AlertTriangle, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"

import { MAINTENANCE_ISSUE_TYPES } from "@/lib/maintenance"

const ISSUE_TYPES = MAINTENANCE_ISSUE_TYPES

const PRIORITIES = {
  LOW: { label: "Low", color: "bg-muted text-foreground" },
  MEDIUM: { label: "Medium", color: "bg-info-muted text-info" },
  HIGH: { label: "High", color: "bg-destructive-muted text-destructive" },
}

export function WorkOrderManager({ propertyId, rooms, refreshMatrix }: { propertyId: string | null, rooms: any[], refreshMatrix: () => void }) {
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  
  const [form, setForm] = useState({
    roomId: "",
    issueType: "GENERAL",
    description: "",
    priority: "MEDIUM"
  })

  useEffect(() => {
    if (propertyId) {
      fetchOrders()
    }
  }, [propertyId])

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/maintenance?propertyId=${propertyId}`)
      if (res.ok) {
        setOrders(await res.json())
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleAddOrder = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch(`/api/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      })
      if (res.ok) {
        setForm({ roomId: "", issueType: "GENERAL", description: "", priority: "MEDIUM" })
        setIsAdding(false)
        fetchOrders()
        refreshMatrix()
      }
    } catch (e) {
      console.error(e)
    }
  }

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "RESOLVED" ? "OPEN" : "RESOLVED"
    setOrders(orders.map(o => o.id === id ? { ...o, status: newStatus } : o))
    try {
      await fetch(`/api/maintenance/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      })
      refreshMatrix()
    } catch (e) {
      console.error(e)
      fetchOrders() // Revert on failure
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading work orders...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Maintenance Tickets</h3>
          <p className="text-sm text-muted-foreground">Log and track room-specific issues like plumbing, electrical, or general repairs.</p>
        </div>
        {!isAdding && (
          <Button onClick={() => setIsAdding(true)} className="">
            <Plus className="w-4 h-4 mr-2" /> Raise Ticket
          </Button>
        )}
      </div>

      {isAdding && (
        <div className="bg-card border rounded-xl p-6 shadow-sm mb-6">
          <div className="flex justify-between items-center mb-4 pb-4 border-b">
            <h4 className="font-semibold text-foreground flex items-center"><Wrench className="w-4 h-4 mr-2 text-primary" /> New Work Order</h4>
            <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}><X className="h-4 w-4" /></Button>
          </div>
          <form onSubmit={handleAddOrder} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Room</Label>
              <Select required value={form.roomId} onValueChange={v => setForm(p => ({ ...p, roomId: v ?? "" }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a room">
                    {form.roomId ? `Room ${rooms.find(r => r.id === form.roomId)?.roomNumber || form.roomId}` : "Select a room"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {rooms.map(r => (
                    <SelectItem key={r.id} value={r.id} label={`Room ${r.roomNumber}`}>Room {r.roomNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Issue Type</Label>
              <Select value={form.issueType} onValueChange={v => setForm(p => ({ ...p, issueType: v ?? "" }))}>
                <SelectTrigger>
                  <SelectValue>
                    {ISSUE_TYPES.find(t => t.value === form.issueType)?.label || form.issueType}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ISSUE_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value} label={t.label}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Description</Label>
              <Input required placeholder="E.g., AC is leaking water on the floor..." value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v ?? "" }))}>
                <SelectTrigger>
                  <SelectValue>
                    {form.priority === 'LOW' ? 'Low Priority' : form.priority === 'MEDIUM' ? 'Medium Priority' : 'High Priority (Urgent)'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW" label="Low Priority">Low Priority</SelectItem>
                  <SelectItem value="MEDIUM" label="Medium Priority">Medium Priority</SelectItem>
                  <SelectItem value="HIGH" label="High Priority (Urgent)">High Priority (Urgent)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end justify-end">
              <Button type="submit" className="w-full sm:w-auto">Submit Ticket</Button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {orders.length === 0 ? (
          <div className="col-span-full text-center py-12 border-2 border-dashed rounded-xl bg-card text-muted-foreground">
            No active maintenance tickets! Your property is in perfect shape.
          </div>
        ) : (
          orders.map(order => {
            const isResolved = order.status === "RESOLVED"
            const priorityConfig = PRIORITIES[order.priority as keyof typeof PRIORITIES] || PRIORITIES.MEDIUM
            
            return (
              <div key={order.id} className={`p-5 rounded-xl border bg-card shadow-sm transition-all ${isResolved ? 'opacity-60 bg-muted' : 'hover:shadow-md'}`}>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleStatus(order.id, order.status)} className={`transition-colors ${isResolved ? 'text-success' : 'text-muted-foreground hover:text-muted-foreground'}`}>
                      {isResolved ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6" />}
                    </button>
                    <div>
                      <h4 className={`font-bold text-lg ${isResolved ? 'text-muted-foreground line-through' : 'text-foreground'}`}>Room {order.room.roomNumber}</h4>
                      <Badge variant="outline" className={`${isResolved ? '' : priorityConfig.color} border-none font-medium text-[10px] mt-0.5 uppercase`}>
                        {order.priority} PRIORITY
                      </Badge>
                    </div>
                  </div>
                  {order.priority === 'HIGH' && !isResolved && (
                    <AlertTriangle className="w-5 h-5 text-destructive animate-pulse" />
                  )}
                </div>
                
                <div className="mt-4 pl-8">
                  <Badge variant="secondary" className="mb-2">{ISSUE_TYPES.find(t => t.value === order.issueType)?.label || order.issueType}</Badge>
                  <p className={`text-sm ${isResolved ? 'text-muted-foreground' : 'text-foreground'}`}>{order.description}</p>
                  
                  <p className="text-xs text-muted-foreground mt-4 font-mono">
                    Logged: {new Date(order.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
