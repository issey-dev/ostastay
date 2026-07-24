"use client"

import { useCallback, useEffect, useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { CheckCircle2, Loader2, LogOut, CalendarClock, AlertTriangle, ArrowRight, FileText } from "@/components/icons"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "next/link"
import { format } from "date-fns"

type StepState = { key: string; label: string; detail: string; done: boolean; at: string | null }
type Departure = { id: string; confirmationNo: string; guestName: string; roomNumber: string | null; checkOutDate: string }
type EodStatus = {
  businessDate: string
  run: { id: string; businessDate: string; status: string } | null
  steps: StepState[]
  nextStep: string | null
  pendingDepartures: Departure[]
  pendingArrivals: number
  openShifts: { id: string; userId: string; openingFloat: number }[]
}

export default function EndOfDayPage() {
  const { currentProperty } = useProperty()
  const [status, setStatus] = useState<EodStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [postSummary, setPostSummary] = useState<any>(null)
  const [extendFor, setExtendFor] = useState<string | null>(null)
  const [extendDate, setExtendDate] = useState("")

  const fetchStatus = useCallback(async () => {
    if (!currentProperty) return
    try {
      const res = await fetch(`/api/eod/status?propertyId=${currentProperty.id}`)
      if (res.ok) setStatus(await res.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [currentProperty])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const runStep = async (step: string) => {
    if (!currentProperty) return
    setBusy(step)
    setError(null)
    try {
      const res = await fetch(`/api/eod/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: currentProperty.id, step }),
      })
      const data = await res.json()
      if (res.ok) {
        if (step === "post") setPostSummary(data.posting ?? null)
        await fetchStatus()
      } else {
        setError(data.error || "Step failed.")
        await fetchStatus()
      }
    } catch {
      setError("An unexpected error occurred.")
    } finally {
      setBusy(null)
    }
  }

  const forceCheckout = async (id: string) => {
    setBusy(`co-${id}`)
    setError(null)
    try {
      const res = await fetch(`/api/reservations/${id}/check-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ early: false }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error || "Check-out failed.")
      await fetchStatus()
    } finally {
      setBusy(null)
    }
  }

  const extendStay = async (id: string) => {
    if (!extendDate) return
    setBusy(`ext-${id}`)
    setError(null)
    try {
      const res = await fetch(`/api/eod/extend-stay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId: id, checkOutDate: extendDate }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error || "Extend failed.")
      else { setExtendFor(null); setExtendDate("") }
      await fetchStatus()
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  const businessDate = status?.businessDate
  const steps = status?.steps ?? []
  const nextStep = status?.nextStep
  const allDone = steps.length > 0 && steps.every((s) => s.done)
  const fmtDate = (d?: string) => (d ? format(new Date(d), "EEEE, dd MMM yyyy") : "—")

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">End of Day</h2>
          <p className="text-muted-foreground">Close the business date step by step. The date stays open until every step is done.</p>
        </div>
        <div className="flex items-center gap-3">
        <Link href="night-audit/reports" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <FileText className="w-4 h-4 mr-2" /> Report archive
        </Link>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <CalendarClock className="w-5 h-5 text-muted-foreground" />
          <div className="text-sm">
            <div className="font-semibold text-foreground">{fmtDate(businessDate)}</div>
            <div className="text-xs">
              <span className={`font-medium ${allDone ? "text-success" : "text-warning"}`}>{allDone ? "CLOSED" : "OPEN"}</span>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Progress stepper */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-0">
          {steps.map((s, i) => {
            const isCurrent = !s.done && nextStep === s.key
            return (
              <div key={s.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                    s.done ? "bg-success text-success-foreground" : isCurrent ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                  }`}>
                    {s.done ? <CheckCircle2 className="w-5 h-5" /> : busy && isCurrent ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="text-sm font-semibold">{i + 1}</span>}
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`w-0.5 flex-1 my-1 transition-colors ${s.done ? "bg-success" : "bg-border"}`} style={{ minHeight: 28 }} />
                  )}
                </div>
                <div className="pb-6 flex-1">
                  <div className={`font-medium ${isCurrent ? "text-foreground" : s.done ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.detail}</div>
                  {isCurrent && (
                    <div className="mt-3">{renderStepPanel(s.key)}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {allDone && (
          <div className="mt-2 rounded-lg bg-success-muted border border-success/30 p-4 flex items-center gap-3 text-success">
            <CheckCircle2 className="w-6 h-6" />
            <div>
              <p className="font-semibold">End of Day complete.</p>
              <p className="text-sm text-success/80">The business date has rolled forward and property staff have been signed out.</p>
            </div>
          </div>
        )}
      </div>

      {postSummary && (postSummary.zeroRateWarning || postSummary.overstayWarning || postSummary.noShowFeesOwedWarning) && (
        <div className="rounded-lg border border-warning/30 bg-warning-muted p-3 text-sm text-warning space-y-1">
          {postSummary.zeroRateWarning && <p>{postSummary.zeroRateWarning}</p>}
          {postSummary.overstayWarning && <p>{postSummary.overstayWarning}</p>}
          {postSummary.noShowFeesOwedWarning && <p>{postSummary.noShowFeesOwedWarning}</p>}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive-muted p-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
    </div>
  )

  function renderStepPanel(key: string) {
    if (key === "departures") {
      const deps = status?.pendingDepartures ?? []
      return (
        <div className="space-y-3">
          {deps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No guests are due out. You can continue.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-warning font-medium">{deps.length} guest{deps.length > 1 ? "s" : ""} still due out — resolve each:</p>
              {deps.map((d) => (
                <div key={d.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-sm">
                      <span className="font-medium">{d.guestName}</span>
                      <span className="text-muted-foreground"> · {d.confirmationNo} · Room {d.roomNumber ?? "—"} · out {format(new Date(d.checkOutDate), "dd MMM")}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={busy === `co-${d.id}`} onClick={() => forceCheckout(d.id)}>
                        {busy === `co-${d.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check out"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setExtendFor(extendFor === d.id ? null : d.id); setExtendDate("") }}>Extend</Button>
                    </div>
                  </div>
                  {extendFor === d.id && (
                    <div className="mt-2 flex items-center gap-2">
                      <Input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} className="w-44" />
                      <Button size="sm" disabled={!extendDate || busy === `ext-${d.id}`} onClick={() => extendStay(d.id)}>
                        {busy === `ext-${d.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <Button disabled={deps.length > 0 || busy === "departures"} onClick={() => runStep("departures")}>
            {busy === "departures" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
            Continue
          </Button>
        </div>
      )
    }
    if (key === "cashier") {
      const shifts = status?.openShifts ?? []
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {shifts.length === 0 ? "No open cashier shifts." : `${shifts.length} open cashier shift${shifts.length > 1 ? "s" : ""} will be force-closed at the expected cash (no discrepancy).`}
          </p>
          <Button disabled={busy === "cashier"} onClick={() => runStep("cashier")}>
            {busy === "cashier" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {shifts.length === 0 ? "Continue" : "Force-close cashiers"}
          </Button>
        </div>
      )
    }
    if (key === "post") {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Posts room charges, extra occupancy, packages, and Green Tax to every in-house folio, marks {status?.pendingArrivals ?? 0} un-arrived booking{(status?.pendingArrivals ?? 0) === 1 ? "" : "s"} as no-show, and rolls the business date forward. Protected against double posting.
          </p>
          <Button disabled={busy === "post"} onClick={() => runStep("post")}>
            {busy === "post" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Post room &amp; tax
          </Button>
        </div>
      )
    }
    if (key === "registration") {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Assigns each guest who arrived today a sequential Green Tax registration number (primary and accompanying guests; day-use/pseudo rooms excluded).
          </p>
          <Button disabled={busy === "registration"} onClick={() => runStep("registration")}>
            {busy === "registration" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Assign registration numbers
          </Button>
        </div>
      )
    }
    if (key === "reports") {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Freezes the six reports for this date (Trial Balance, Guest / AR / Deposit Ledgers, Cashier Summary, Manager Flash) as an immutable snapshot you can view and print from the archive.</p>
          <div className="flex items-center gap-2">
            <Button disabled={busy === "reports"} onClick={() => runStep("reports")}>
              {busy === "reports" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Generate reports
            </Button>
            <Link href="night-audit/reports" className={buttonVariants({ variant: "outline" })}>
              <FileText className="w-4 h-4 mr-2" /> View archive
            </Link>
          </div>
        </div>
      )
    }
    if (key === "finalize") {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Sign property staff out and close the business date. They'll sign back in on the new date.</p>
          <Button variant="destructive" disabled={busy === "finalize"} onClick={() => runStep("finalize")}>
            {busy === "finalize" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LogOut className="w-4 h-4 mr-2" />}
            Roll &amp; close
          </Button>
        </div>
      )
    }
    return null
  }
}
