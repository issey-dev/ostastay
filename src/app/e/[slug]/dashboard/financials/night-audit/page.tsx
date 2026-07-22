"use client"

import { useState, useEffect } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { MoonStar, AlertTriangle, CheckCircle2, PlayCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export default function NightAuditDashboard() {
  const { currentProperty } = useProperty()
  const [running, setRunning] = useState(false)
  const [auditResult, setAuditResult] = useState<any>(null)

  // 12-hour recency override prompt (running EOD again too soon)
  const [overridePrompt, setOverridePrompt] = useState<string | null>(null)
  const [overrideAgree, setOverrideAgree] = useState(false)
  const [overrideReason, setOverrideReason] = useState("")

  // Dummy checks for the UI
  const [checks, setChecks] = useState({
    pendingArrivals: 0,
    pendingDepartures: 0,
    unbalancedFolios: 0,
    loading: true
  })

  useEffect(() => {
    // In a real app, we'd fetch this from the backend
    setTimeout(() => {
      setChecks({
        pendingArrivals: 0,
        pendingDepartures: 0,
        unbalancedFolios: 0,
        loading: false
      })
    }, 1000)
  }, [])

  const canRunAudit = !checks.loading && checks.pendingArrivals === 0 && checks.pendingDepartures === 0

  const doRun = async (confirmed: boolean, reason?: string) => {
    setRunning(true)
    setAuditResult(null)
    try {
      const res = await fetch('/api/night-audit/run', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: currentProperty?.id, confirmed, reason })
      })
      const data = await res.json()
      if (res.ok) {
        setAuditResult(data.log)
        setOverridePrompt(null)
      } else if (res.status === 409 && data.requiresConfirmation) {
        // EOD was run within the last 12 hours — require an explicit acknowledgement + reason.
        setOverrideAgree(false)
        setOverrideReason("")
        setOverridePrompt(data.error)
      } else {
        alert(data.error || "Failed to run Night Audit")
      }
    } catch (e) {
      console.error(e)
      alert("Error running audit")
    } finally {
      setRunning(false)
    }
  }

  const handleRunAudit = async () => {
    if (!confirm("Run End-of-Day? This posts room and tax charges to all in-house guests and rolls the business date forward one day.")) return
    doRun(false)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Night Audit & End of Day</h2>
        <p className="text-muted-foreground">Verify checklist items and execute the end of day processing.</p>
      </div>

      {/* Checklist */}
      <div className="bg-card border rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-bold text-foreground mb-6">Pre-Audit Checklist</h2>
        
        {checks.loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-4 rounded-lg bg-muted border">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-6 h-6 rounded-none" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <Skeleton className="h-4 w-6" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-muted border">
              <div className="flex items-center gap-3">
                {checks.pendingArrivals === 0 ? <CheckCircle2 className="w-6 h-6 text-success" /> : <AlertTriangle className="w-6 h-6 text-warning" />}
                <span className="font-medium text-foreground">Pending Arrivals (No-Shows)</span>
              </div>
              <span className="font-bold">{checks.pendingArrivals}</span>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg bg-muted border">
              <div className="flex items-center gap-3">
                {checks.pendingDepartures === 0 ? <CheckCircle2 className="w-6 h-6 text-success" /> : <AlertTriangle className="w-6 h-6 text-warning" />}
                <span className="font-medium text-foreground">Pending Departures</span>
              </div>
              <span className="font-bold">{checks.pendingDepartures}</span>
            </div>
            
            <div className="flex items-center justify-between p-4 rounded-lg bg-muted border">
              <div className="flex items-center gap-3">
                {checks.unbalancedFolios === 0 ? <CheckCircle2 className="w-6 h-6 text-success" /> : <AlertTriangle className="w-6 h-6 text-warning" />}
                <span className="font-medium text-foreground">Unbalanced Master Folios</span>
              </div>
              <span className="font-bold">{checks.unbalancedFolios}</span>
            </div>
          </div>
        )}
      </div>

      {/* Action Area */}
      <div className="bg-foreground text-background rounded-xl p-8 flex flex-col items-center justify-center text-center space-y-4 shadow-elevation-3">
        <MoonStar className="w-12 h-12 text-background/60" />
        <h2 className="text-2xl font-bold">Ready for End of Day</h2>
        <p className="text-background/70 max-w-md">Running the Night Audit will automatically calculate and post room and tax charges to all in-house folios and roll the business date forward.</p>

        <Button
          size="lg"
          className="mt-4 bg-background text-foreground hover:bg-background/90 border-none h-14 px-8 text-lg"
          disabled={!canRunAudit || running}
          onClick={handleRunAudit}
        >
          {running ? (
            <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Processing Audit...</>
          ) : (
            <><PlayCircle className="w-5 h-5 mr-2" /> Execute Night Audit</>
          )}
        </Button>
      </div>

      {/* Results area */}
      {auditResult && (
        <div className="bg-success-muted border border-success/30 rounded-xl p-6 text-success animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle2 className="w-6 h-6 text-success" />
            <h3 className="text-xl font-bold">Night Audit Completed Successfully!</h3>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="bg-card/60 p-4 rounded-lg">
              <p className="text-sm font-medium text-success/70 uppercase">Rooms Occupied</p>
              <p className="text-2xl font-bold mt-1">{auditResult.roomsOccupied}</p>
            </div>
            <div className="bg-card/60 p-4 rounded-lg">
              <p className="text-sm font-medium text-success/70 uppercase">Room Revenue</p>
              <p className="text-2xl font-bold mt-1">${auditResult.roomRevenue.toFixed(2)}</p>
            </div>
            <div className="bg-card/60 p-4 rounded-lg">
              <p className="text-sm font-medium text-success/70 uppercase">Tax Posted</p>
              <p className="text-2xl font-bold mt-1">${auditResult.taxPosted.toFixed(2)}</p>
            </div>
            <div className="bg-card/60 p-4 rounded-lg">
              <p className="text-sm font-medium text-success/70 uppercase">Total Postings</p>
              <p className="text-2xl font-bold mt-1">{auditResult.totalPostings}</p>
            </div>
          </div>
        </div>
      )}

      {/* 12-hour recency override — running EOD again too soon */}
      <Dialog open={!!overridePrompt} onOpenChange={(o) => { if (!o) setOverridePrompt(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle className="w-5 h-5" /> Run End-of-Day again?
            </DialogTitle>
            <DialogDescription>{overridePrompt}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={overrideAgree}
                onChange={(e) => setOverrideAgree(e.target.checked)}
              />
              <span>I understand this advances the business date another day, and I want to proceed.</span>
            </label>
            <div className="space-y-1.5">
              <Label>Reason <span className="text-destructive">*</span></Label>
              <Textarea
                rows={3}
                placeholder="Why is End-of-Day being run again within 12 hours?"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverridePrompt(null)} disabled={running}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!overrideAgree || !overrideReason.trim() || running}
              onClick={() => doRun(true, overrideReason.trim())}
            >
              {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Proceed with End-of-Day
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
