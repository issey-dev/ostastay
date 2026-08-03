"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { CheckCircle2, Loader2, LogOut, CalendarClock, AlertTriangle, ArrowRight, FileText, Sparkles } from "@/components/icons"
import { Button, buttonVariants } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Skeleton } from "@/components/ui/skeleton"
import { InfoHint } from "@/components/ui/info-hint"
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// The one step that autopilot never runs unattended — it signs staff out and closes
// the date (owner decision 2026-07-26: confirm the very last step).
const CONFIRM_STEP = "finalize"

export default function EndOfDayPage() {
  const { currentProperty } = useProperty()
  const [status, setStatus] = useState<EodStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [autoRunning, setAutoRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [postSummary, setPostSummary] = useState<any>(null)
  const [extendFor, setExtendFor] = useState<string | null>(null)
  const [extendDate, setExtendDate] = useState("")
  // Guards against a double-start of autopilot (button + resume both firing).
  const autoRef = useRef(false)

  const fetchStatus = useCallback(async (): Promise<EodStatus | null> => {
    if (!currentProperty) return null
    try {
      const res = await fetch(`/api/eod/status?propertyId=${currentProperty.id}`)
      if (res.ok) {
        const data = (await res.json()) as EodStatus
        setStatus(data)
        return data
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
    return null
  }, [currentProperty])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // Run a single step. Returns whether it succeeded plus the refreshed status, so the
  // autopilot loop can decide what to do next without reading React state mid-flight.
  const runStepRaw = async (step: string): Promise<{ ok: boolean; status: EodStatus | null }> => {
    if (!currentProperty) return { ok: false, status: null }
    setBusy(step)
    setError(null)
    try {
      const res = await fetch(`/api/eod/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: currentProperty.id, step }),
      })
      const data = await res.json()
      if (step === "post" && res.ok) setPostSummary(data.posting ?? null)
      if (!res.ok) setError(data.error || "Step failed.")
      // Finalize invalidates every session on this property — including this one. Tell
      // EodSessionWatch to check immediately rather than letting the operator sit on a
      // dead page until its next poll, and skip the status refetch that would now 401.
      if (step === "finalize" && res.ok) {
        window.dispatchEvent(new Event("osta:eod-finalized"))
        return { ok: true, status: null }
      }
      const fresh = await fetchStatus()
      return { ok: res.ok, status: fresh }
    } catch {
      setError("An unexpected error occurred.")
      return { ok: false, status: null }
    } finally {
      setBusy(null)
    }
  }

  // Manual single-step trigger (used for the final Roll & Close confirmation).
  const runStep = async (step: string) => { await runStepRaw(step) }

  // Autopilot: advance through the End-of-Day steps on its own, pausing only when a
  // human is genuinely needed — unresolved departures, a step error, or the final
  // Roll & Close. A short beat between steps makes the progress legible.
  const autoRun = useCallback(async () => {
    if (!currentProperty || autoRef.current) return
    autoRef.current = true
    setAutoRunning(true)
    setError(null)
    try {
      let current = await fetchStatus()
      let safety = 0
      while (current && safety++ < 12) {
        const next = current.nextStep
        if (!next) break // fully closed
        if (next === "departures" && (current.pendingDepartures?.length ?? 0) > 0) break // needs resolution
        if (next === CONFIRM_STEP) break // require explicit confirmation for the irreversible close
        await sleep(750) // let the just-finished step's animation land before the next
        const res = await runStepRaw(next)
        if (!res.ok || !res.status) break
        current = res.status
      }
    } finally {
      setAutoRunning(false)
      autoRef.current = false
    }
  }, [currentProperty, fetchStatus])

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
  const doneCount = steps.filter((s) => s.done).length
  const allDone = steps.length > 0 && doneCount === steps.length
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0
  const fmtDate = (d?: string) => (d ? format(new Date(d), "EEEE, dd MMM yyyy") : "—")

  // Where autopilot is paused, if it is — drives the contextual hint under the banner.
  const pausedForDepartures = !autoRunning && nextStep === "departures" && (status?.pendingDepartures?.length ?? 0) > 0
  const pausedForConfirm = !autoRunning && nextStep === CONFIRM_STEP
  const anyBusy = autoRunning || !!busy

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            End of Day
            <InfoHint label="End of Day">Close the business date step by step. The date stays open until every step is done.</InfoHint>
          </h2>
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

      {/* Progress bar — fills as steps complete */}
      {!allDone && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>{doneCount} of {steps.length} steps complete</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground transition-all duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Autopilot control / status */}
      {!allDone && (
        autoRunning ? (
          <div className="flex items-center gap-3 rounded-xl border border-info/30 bg-info-muted p-4 text-info animate-in fade-in slide-in-from-top-2 duration-300">
            <Loader2 className="w-5 h-5 animate-spin shrink-0" />
            <div className="text-sm">
              <p className="font-semibold">Running End of Day…</p>
              <p className="text-info/80">
                {busy ? `Working on “${steps.find((s) => s.key === busy)?.label ?? busy}”` : "Moving to the next step"} — this pauses if anything needs your attention.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div className="text-sm">
              <p className="font-semibold text-foreground">
                {pausedForDepartures ? "Paused — guests still due out" : pausedForConfirm ? "Ready to close the day" : doneCount > 0 ? "Continue End of Day" : "Run End of Day"}
              </p>
              <p className="text-muted-foreground">
                {pausedForDepartures
                  ? "Resolve the departures below, then resume — the rest runs automatically."
                  : pausedForConfirm
                    ? "Every step is done except the final roll. Confirm below to sign staff out and close."
                    : "Runs each step for you and only stops if something needs a decision. The final close still asks for confirmation."}
              </p>
            </div>
            {/* When paused for departures or the final confirm, the actionable control
                lives in the step panel below — keep this card informational only. */}
            {!pausedForConfirm && !pausedForDepartures && (
              <Button onClick={autoRun} disabled={anyBusy} className="shrink-0">
                <Sparkles className="w-4 h-4 mr-2" />
                {doneCount > 0 ? "Resume auto-run" : "Run End of Day"}
              </Button>
            )}
          </div>
        )
      )}

      {/* Progress stepper */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-0">
          {steps.map((s, i) => {
            const isCurrent = !s.done && nextStep === s.key
            const isRunning = busy === s.key || (autoRunning && isCurrent)
            return (
              <div key={s.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
                    s.done ? "bg-success text-success-foreground" : isCurrent ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                  } ${isRunning ? "ring-4 ring-foreground/15 scale-110" : ""}`}>
                    {s.done ? (
                      <CheckCircle2 className="w-5 h-5 animate-in zoom-in duration-300" />
                    ) : isRunning ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <span className="text-sm font-semibold">{i + 1}</span>
                    )}
                  </div>
                  {i < steps.length - 1 && (
                    <div className="w-0.5 flex-1 my-1 bg-border overflow-hidden" style={{ minHeight: 28 }}>
                      <div className={`w-full bg-success transition-all duration-700 ease-out ${s.done ? "h-full" : "h-0"}`} />
                    </div>
                  )}
                </div>
                <div className="pb-6 flex-1">
                  <div className={`font-medium transition-colors ${isCurrent ? "text-foreground" : s.done ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.detail}</div>
                  {isCurrent && !autoRunning && (
                    <div className="mt-3 animate-in fade-in slide-in-from-top-1 duration-300">{renderStepPanel(s.key)}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {allDone && (
          <div className="mt-2 rounded-lg bg-success-muted border border-success/30 p-4 flex items-center gap-3 text-success animate-in fade-in zoom-in duration-500">
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
                      <DatePicker value={extendDate} onChange={setExtendDate} className="w-44" />
                      <Button size="sm" disabled={!extendDate || busy === `ext-${d.id}`} onClick={() => extendStay(d.id)}>
                        {busy === `ext-${d.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <Button disabled={deps.length > 0 || anyBusy} onClick={autoRun}>
            {anyBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
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
          <Button disabled={anyBusy} onClick={() => runStep("cashier")}>
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
          <Button disabled={anyBusy} onClick={() => runStep("post")}>
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
          <Button disabled={anyBusy} onClick={() => runStep("registration")}>
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
            <Button disabled={anyBusy} onClick={() => runStep("reports")}>
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
          <p className="text-sm text-muted-foreground">Close the business date and sign out <strong>everyone</strong> working in this property &mdash; front desk, managers, and you. Everyone signs back in on the new date.</p>
          <Button variant="destructive" disabled={anyBusy} onClick={() => runStep("finalize")}>
            {busy === "finalize" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <LogOut className="w-4 h-4 mr-2" />}
            Roll &amp; close
          </Button>
        </div>
      )
    }
    return null
  }
}
