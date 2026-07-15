"use client"

import { useState, useEffect } from "react"
import { MessageSquare, Clock, Wrench, ConciergeBell, CheckCircle2, Circle, Trash2, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { DatePicker } from "@/components/ui/date-picker"

const TRACE_TYPES = {
  GUEST_MESSAGE: { icon: MessageSquare, color: "text-blue-500", bg: "bg-blue-50", label: "Guest Message" },
  WAKE_UP_CALL: { icon: Clock, color: "text-amber-500", bg: "bg-amber-50", label: "Wake-up Call" },
  MAINTENANCE: { icon: Wrench, color: "text-rose-500", bg: "bg-rose-50", label: "Maintenance" },
  FRONT_DESK: { icon: ConciergeBell, color: "text-indigo-500", bg: "bg-indigo-50", label: "Front Desk Task" }
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
    actionDate: ""
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
        setForm({ traceType: "GUEST_MESSAGE", description: "", actionDate: "" })
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
        <SheetHeader className="p-6 border-b bg-slate-50/50">
          <SheetTitle className="text-xl">Traces & Messages</SheetTitle>
          <SheetDescription>
            {guestName ? `Managing tasks for ${guestName}` : 'Manage operational tasks for this reservation.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
          {!isAdding ? (
            <Button onClick={() => setIsAdding(true)} className="w-full mb-6 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
              <Plus className="w-4 h-4 mr-2" /> New Trace / Message
            </Button>
          ) : (
            <div className="bg-white border rounded-lg p-4 mb-6 shadow-sm">
              <div className="flex justify-between items-center mb-4 pb-2 border-b">
                <h4 className="font-semibold text-slate-800">Add New Trace</h4>
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
                <Button type="submit" className="w-full mt-2">Save Trace</Button>
              </form>
            </div>
          )}

          <div className="space-y-3">
            {loading ? (
              <div className="text-center text-slate-500 py-8">Loading traces...</div>
            ) : traces.length === 0 ? (
              <div className="text-center text-slate-500 py-12 border-2 border-dashed rounded-lg bg-white">
                No active messages or traces for this reservation.
              </div>
            ) : (
              traces.map(trace => {
                const config = TRACE_TYPES[trace.traceType as keyof typeof TRACE_TYPES] || TRACE_TYPES.FRONT_DESK
                const Icon = config.icon
                
                return (
                  <div key={trace.id} className={`flex gap-3 p-4 rounded-lg border bg-white shadow-sm transition-all ${trace.isResolved ? 'opacity-60 bg-slate-50' : ''}`}>
                    <button onClick={() => toggleResolve(trace.id, trace.isResolved)} className={`mt-1 flex-shrink-0 transition-colors ${trace.isResolved ? 'text-emerald-500' : 'text-slate-300 hover:text-indigo-400'}`}>
                      {trace.isResolved ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                    </button>
                    
                    <div className="flex-1">
                      <div className="flex items-start justify-between">
                        <Badge variant="outline" className={`${config.bg} ${config.color} border-none font-medium text-xs mb-1`}>
                          <Icon className="w-3 h-3 mr-1 inline-block" /> {config.label}
                        </Badge>
                        <button onClick={() => handleDelete(trace.id)} className="text-slate-400 hover:text-rose-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <p className={`text-sm mt-1 ${trace.isResolved ? 'text-slate-500 line-through' : 'text-slate-800 font-medium'}`}>
                        {trace.description}
                      </p>
                      
                      {trace.actionDate && (
                        <p className="text-xs text-slate-500 mt-2 flex items-center">
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
