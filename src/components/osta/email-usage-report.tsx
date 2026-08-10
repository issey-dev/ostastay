"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import type { DateRange } from "react-day-picker"

// Billable email usage per enterprise — the figures an "Uppsolut Mail Service" line on a
// licensing invoice is written from.
//
// Deliberately shows counts and no money. Every LicenseInvoice amount in this product is
// set by hand (owner decision: no formula), so a rate rendered here would be a second
// pricing model competing with the real one.

type UsageRow = {
  enterpriseId: string
  enterpriseName: string
  slug: string
  onMailService: boolean
  billableSent: number
  billableFailed: number
  ownSmtpSent: number
  uppsolutOwnMail: number
  byKind: Record<string, number>
}

type Usage = {
  periodStart: string
  periodEnd: string
  totals: { billableSent: number; billableFailed: number; ownSmtpSent: number; uppsolutOwnMail: number }
  enterprises: UsageRow[]
}

// Defaults to the current calendar month — the billing period.
function defaultRange(): DateRange {
  const now = new Date()
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now }
}

function dayStart(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString()
}

function dayEnd(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString()
}

export function EmailUsageReport() {
  const [range, setRange] = useState<DateRange | undefined>(defaultRange)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!range?.from) return
    setLoading(true)
    try {
      // The end date is inclusive to the operator, so send end-of-day.
      const to = range.to ?? range.from
      const res = await fetch(`/api/osta/email-usage?from=${dayStart(range.from)}&to=${dayEnd(to)}`)
      if (res.ok) setUsage(await res.json())
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { void load() }, [load])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email usage</CardTitle>
        <CardDescription>
          Messages sent through <strong>Uppsolut&apos;s</strong> SMTP on each enterprise&apos;s behalf — the billable
          figure for the Uppsolut Mail Service add-on. Enterprises sending through their own SMTP are shown for
          contrast and cost us nothing. Counts only: invoice amounts stay hand-set, as everywhere else in licensing.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <DateRangePicker value={range} onChange={setRange} className="w-full sm:w-80" />
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        ) : !usage ? (
          <p className="text-sm text-muted-foreground">Could not load usage.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Billable sent" value={usage.totals.billableSent} emphasis />
              <Stat label="Billable failed" value={usage.totals.billableFailed} />
              <Stat label="Sent via own SMTP" value={usage.totals.ownSmtpSent} />
              <Stat label="Uppsolut's own mail" value={usage.totals.uppsolutOwnMail} />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Enterprise</th>
                    <th className="py-2 pr-3 font-medium">Mail service</th>
                    <th className="py-2 pr-3 font-medium text-right">Billable sent</th>
                    <th className="py-2 pr-3 font-medium text-right">Failed</th>
                    <th className="py-2 pr-3 font-medium text-right">Own SMTP</th>
                    <th className="py-2 font-medium">Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.enterprises.map((r) => (
                    <tr key={r.enterpriseId} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">{r.enterpriseName}</td>
                      <td className="py-2 pr-3">
                        {r.onMailService ? (
                          <Badge variant="outline" className="bg-success-muted text-success border-success/30">On</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums">{r.billableSent}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${r.billableFailed > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {r.billableFailed}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{r.ownSmtpSent}</td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {Object.entries(r.byKind).length === 0
                          ? "—"
                          : Object.entries(r.byKind)
                              .sort((a, b) => b[1] - a[1])
                              .map(([kind, n]) => `${kind} ${n}`)
                              .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* An enterprise billing for mail it never received is the dispute worth pre-empting. */}
            {usage.totals.billableFailed > 0 && (
              <p className="text-xs text-warning">
                {usage.totals.billableFailed} message(s) were rejected by the provider and are excluded from the
                billable count — worth checking before invoicing.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${emphasis ? "text-foreground" : "text-muted-foreground"}`}>
        {value}
      </div>
    </div>
  )
}
