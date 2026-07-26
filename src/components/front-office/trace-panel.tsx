"use client"

import { useState, useEffect } from "react"
import { MessageSquare, Clock, Wrench, ConciergeBell, CheckCircle2, Circle, Trash2, Plus, X } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { Bell } from "@/components/icons"

const TRACE_TYPES = {
  GUEST_MESSAGE: { icon: MessageSquare, color: "text-info", bg: "bg-info-muted", label: "Guest Message" },
  WAKE_UP_CALL: { icon: Clock, color: "text-warning", bg: "bg-warning-muted", label: "Wake-up Call" },
  MAINTENANCE: { icon: Wrench, color: "text-destructive", bg: "bg-destructive-muted", label: "Maintenance" },
  FRONT_DESK: { icon: ConciergeBell, color: "text-primary", bg: "bg-muted", label: "Front Desk Task" }
}

export function TracePanel({ 
  reservationId, 
  isOpen, 
  onClose,
  guestName
}: { 
  reservationId: string | null
  isOpen: boolean
  onClose: () => void
  guestName?: string
}) {
  const [traces, setTraces] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  
  const [form, setForm] = useState({
    traceType: "GUEST_MESSAGE",
    description: "",
    actionDate: "",
    alertOnOpen: false,
  })

  useEffect(() => {
    if (isOpen && reservationId) {
      fetchTraces()
    } else {
      setTraces([])
      setIsAdding(false)
    }
  }, [isOpen, reservationId])

  const fetchTraces = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/reservations/${reservationId}/traces`)
      if (res.ok) {
        setTraces(await res.json())
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleAddTrace = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch(`/api/reservations/${reservationId}/traces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      })
      if (res.ok) {
        setForm({ traceType: "GUEST_MESSAGE", description: "", actionDate: "", alertOnOpen: false })
        setIsAdding(false)
        fetchTraces()
      }
    } catch (e) {
      console.error(e)
    }
  }

  const toggleResolve = async (id: string, currentStatus: boolean) => {
    // Optimistic UI
    setTraces(traces.map(t => t.id === id ? { ...t, isResolved: !currentStatus } : t))
    try {
      await fetch(`/api/traces/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isResolved: !currentStatus })
      })
    } catch (e) {
      console.error(e)
      fetchTraces() // Revert on failure
    }
  }

  const handleDelete = async (id: string) => {
    setTraces(traces.filter(t => t.id !== id))
    try {
      await fetch(`/api/traces/${id}`, { method: "DELETE" })
    } catch (e) {
      console.error(e)
      fetchTraces()
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[400px] sm:w-[540px] flex flex-col p-0">
        <SheetHeader className="p-6 border-b bg-muted/50">
          <SheetTitle className="text-xl">Traces & Messages</SheetTitle>
          <SheetDescription>
            {guestName ? `Managing tasks for ${guestName}` : 'Manage operational tasks for this reservation.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 bg-muted/30">
          {!isAdding ? (
            <Button onClick={() => setIsAdding(true)} className="w-full mb-6 shadow-sm">
              <Plus className="w-4 h-4 mr-2" /> New Trace / Message
            </Button>
          ) : (
            <div className="bg-card border rounded-lg p-4 mb-6 shadow-sm">
              <div className="flex justify-between items-center mb-4 pb-2 border-b">
                <h4 className="font-semibold text-foreground">Add New Trace</h4>
                <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)} className="h-8 w-8 p-0"><X className="h-4 w-4" /></Button>
              </div>
              <form onSubmit={handleAddTrace} className="space-y-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.traceType} onValueChange={v => setForm(p => ({ ...p, traceType: v ?? "" }))}>
                    <SelectTrigger>
                      <SelectValue>
                        {TRACE_TYPES[form.traceType as keyof typeof TRACE_TYPES]?.label || form.traceType}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TRACE_TYPES).map(([key, { label, icon: Icon }]) => (
                        <SelectItem key={key} value={key} label={label}>
                          <div className="flex items-center"><Icon className="w-4 h-4 mr-2" /> {label}</div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Message / Description *</Label>
                  <Input required placeholder="E.g., Package at front desk..." value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Action Date (Optional)</Label>
                  <DatePicker
                    value={form.actionDate}
                    onChange={(date) => setForm(p => ({ ...p, actionDate: date }))}
                    placeholder="Select action date..."
                  />
                </div>
                <label className="flex items-start gap-2.5 rounded-md border border-border p-3 cursor-pointer">
                  <Checkbox
                    checked={form.alertOnOpen}
                    onCheckedChange={(v) => setForm(p => ({ ...p, alertOnOpen: !!v }))}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    <span className="font-medium flex items-center gap-1.5"><Bell className="w-3.5 h-3.5 text-warning" /> Alert on open</span>
                    <span className="text-xs text-muted-foreground">Pop this message up every time the reservation is opened, until it&apos;s marked resolved.</span>
                  </span>
                </label>
                <Button type="submit" className="w-full mt-2">Save Trace</Button>
              </form>
            </div>
          )}

          <div className="space-y-3">
            {loading ? (
              <div className="text-center text-muted-foreground py-8">Loading traces...</div>
            ) : traces.length === 0 ? (
              <div className="text-center text-muted-foreground py-12 border-2 border-dashed rounded-lg bg-card">
                No active messages or traces for this reservation.
              </div>
            ) : (
              traces.map(trace => {
                const config = TRACE_TYPES[trace.traceType as keyof typeof TRACE_TYPES] || TRACE_TYPES.FRONT_DESK
                const Icon = config.icon
                
                return (
                  <div key={trace.id} className={`flex gap-3 p-4 rounded-lg border bg-card shadow-sm transition-all ${trace.isResolved ? 'opacity-60 bg-muted' : ''}`}>
                    <button onClick={() => toggleResolve(trace.id, trace.isResolved)} className={`mt-1 flex-shrink-0 transition-colors ${trace.isResolved ? 'text-success' : 'text-muted-foreground hover:text-muted-foreground'}`}>
                      {trace.isResolved ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                    </button>
                    
                    <div className="flex-1">
                      <div className="flex items-start justify-between">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <Badge variant="outline" className={`${config.bg} ${config.color} border-none font-medium text-xs`}>
                            <Icon className="w-3 h-3 mr-1 inline-block" /> {config.label}
                          </Badge>
                          {trace.alertOnOpen && !trace.isResolved && (
                            <Badge variant="outline" className="bg-warning-muted text-warning border-warning/40 text-[10px]">
                              <Bell className="w-3 h-3 mr-1 inline-block" /> Alerts on open
                            </Badge>
                          )}
                        </div>
                        <button onClick={() => handleDelete(trace.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <p className={`text-sm mt-1 ${trace.isResolved ? 'text-muted-foreground line-through' : 'text-foreground font-medium'}`}>
                        {trace.description}
                      </p>
                      
                      {trace.actionDate && (
                        <p className="text-xs text-muted-foreground mt-2 flex items-center">
                          <Clock className="w-3 h-3 mr-1" />
                          {new Date(trace.actionDate).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
