"use client"

import { useCallback, useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { InfoHint } from "@/components/ui/info-hint"
import { toast } from "@/lib/toast"
import { CheckCircle, Lock } from "@/components/icons"

type Overview = {
  year: number
  basis: "ACTUAL" | "STANDARD"
  businessDate: string | null
  total: number
  lastNo: number
  lockedThrough: number
  months: { month: number; guests: number; firstNo: number | null; lastNo: number | null; filedAt: string | null; filedById: string | null }[]
  exceptions: {
    registrationId: string
    registrationNo: number
    guest: string
    confirmationNo: string
    room: string
    checkInDate: string
    checkOutDate: string
    issues: { code: string; label: string }[]
    locked: boolean
  }[]
  gaps: { registrationNo: number; locked: boolean }[]
  corrections: {
    id: string
    action: "REMOVE" | "CLOSE_GAP"
    registrationNo: number
    guestName: string | null
    confirmationNo: string | null
    reason: string
    shiftFrom: number | null
    shiftTo: number | null
    userId: string
    createdAt: string
  }[]
  userNames: Record<string, string>
}

// One dialog for all three actions — each needs a confirmation, two need a reason.
type Pending =
  | { kind: "remove"; registrationId: string; registrationNo: number; guest: string }
  | { kind: "gap"; registrationNo: number }
  | { kind: "file"; month: number }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const fmtDay = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
const fmtStamp = (d: string) => new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })

const actionSchema = z.object({ reason: z.string(), note: z.string().max(500) })
type ActionValues = z.infer<typeof actionSchema>

export function GreenTaxRegister({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<ActionValues>({
    resolver: zodResolver(
      actionSchema.superRefine((v, c) => {
        if (pending?.kind !== "file" && v.reason.trim().length < 5) {
          c.addIssue({ code: "custom", path: ["reason"], message: "Give a reason (at least 5 characters)" })
        }
      })
    ),
    mode: "onChange",
    defaultValues: { reason: "", note: "" },
  })

  const load = useCallback(() => {
    if (!propertyId) return
    setLoading(true)
    setLoadError(false)
    fetch(`/api/hub/green-tax?propertyId=${encodeURIComponent(propertyId)}&year=${year}`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then(setData)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [propertyId, year])

  useEffect(() => { load() }, [load])

  const open = (p: Pending) => {
    form.reset({ reason: "", note: "" })
    setServerError(null)
    setPending(p)
  }

  const submit = async (v: ActionValues) => {
    if (!pending || !data) return
    setSubmitting(true)
    setServerError(null)
    const [url, body] =
      pending.kind === "remove"
        ? ["/api/hub/green-tax/remove", { propertyId, registrationId: pending.registrationId, reason: v.reason }]
        : pending.kind === "gap"
          ? ["/api/hub/green-tax/close-gap", { propertyId, year, registrationNo: pending.registrationNo, reason: v.reason }]
          : ["/api/hub/green-tax/file", { propertyId, year, month: pending.month, note: v.note || null }]
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const out = await res.json().catch(() => null)
      if (!res.ok) {
        setServerError(typeof out?.error === "string" ? out.error : "The change could not be saved.")
        return
      }
      toast.success(pending.kind === "file" ? `${MONTHS[pending.month - 1]} ${year} marked as filed` : "Registration numbers corrected")
      setPending(null)
      load()
    } finally {
      setSubmitting(false)
    }
  }

  // What the pending correction will do to the numbers after it.
  const shiftPreview = (from: number) => {
    if (!data || data.lastNo <= from) return "No other numbers change."
    const count = data.lastNo - from
    return `Reg Nos ${from + 1}–${data.lastNo} become ${from}–${data.lastNo - 1} (${count} guest${count === 1 ? "" : "s"}).`
  }
  const openExceptions = data?.exceptions.filter((e) => !e.locked) ?? []
  const lockedExceptions = data?.exceptions.filter((e) => e.locked) ?? []
  const openGaps = data?.gaps.filter((g) => !g.locked) ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        {data && (
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{data.total} guests · last Reg No {data.lastNo || "—"}</Badge>
            <Badge variant="outline">{data.lockedThrough ? `Filed through Reg No ${data.lockedThrough}` : "Nothing filed yet"}</Badge>
            <Badge variant="outline">12-hour rule: {data.basis === "ACTUAL" ? "actual check-in time" : "standard check-in/out times"}</Badge>
          </div>
        )}
      </div>

      {loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : loadError ? (
        <ErrorState title="Couldn't load the register" onRetry={load} />
      ) : data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Needs correction
                <InfoHint label="Needs correction">
                  Guests who have a Reg No they should not have. Removing one renumbers every later guest of the year down by one, so the sequence never has a gap. Numbers in a month already filed with MIRA can&apos;t be changed here.
                </InfoHint>
              </CardTitle>
              <CardDescription>Fix these before filing the month they fall in.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {openExceptions.length === 0 && openGaps.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle className="h-4 w-4 text-success" /> Nothing to correct.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Reg No</TableHead>
                      <TableHead>Guest</TableHead>
                      <TableHead>Stay</TableHead>
                      <TableHead>Issue</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openGaps.map((g) => (
                      <TableRow key={`gap-${g.registrationNo}`}>
                        <TableCell className="font-medium">{g.registrationNo}</TableCell>
                        <TableCell className="text-muted-foreground italic">— missing —</TableCell>
                        <TableCell />
                        <TableCell><Badge variant="destructive">Gap in the sequence</Badge></TableCell>
                        <TableCell className="text-right">
                          {canManage && <Button size="sm" variant="outline" onClick={() => open({ kind: "gap", registrationNo: g.registrationNo })}>Close gap</Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {openExceptions.map((e) => (
                      <TableRow key={e.registrationId}>
                        <TableCell className="font-medium">{e.registrationNo}</TableCell>
                        <TableCell>
                          <div>{e.guest}</div>
                          <div className="text-xs text-muted-foreground">{e.confirmationNo}{e.room && ` · Room ${e.room}`}</div>
                        </TableCell>
                        <TableCell className="text-sm">{fmtDay(e.checkInDate)} – {fmtDay(e.checkOutDate)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">{e.issues.map((i) => <Badge key={i.code} variant="secondary">{i.label}</Badge>)}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && (
                            <Button size="sm" variant="outline" onClick={() => open({ kind: "remove", registrationId: e.registrationId, registrationNo: e.registrationNo, guest: e.guest })}>
                              Remove
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {(lockedExceptions.length > 0 || data.gaps.some((g) => g.locked)) && (
                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium"><Lock className="h-4 w-4" /> In a filed month — can&apos;t be changed here</p>
                  <ul className="mt-1 list-disc pl-6 text-muted-foreground">
                    {data.gaps.filter((g) => g.locked).map((g) => <li key={`lg-${g.registrationNo}`}>Reg No {g.registrationNo} — gap in the sequence</li>)}
                    {lockedExceptions.map((e) => (
                      <li key={e.registrationId}>Reg No {e.registrationNo} — {e.guest} ({e.confirmationNo}): {e.issues.map((i) => i.label).join(", ")}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Monthly filing
                <InfoHint label="Monthly filing">
                  The MIRA sheet is filed per month by stay date — download it from Reports › Green Tax Report. Once a month is marked as filed, every Reg No its guests carry is frozen. Months are filed in order.
                </InfoHint>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Guests stayed</TableHead>
                    <TableHead>Reg Nos</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-36" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.months.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="font-medium">{MONTHS[m.month - 1]}</TableCell>
                      <TableCell>{m.guests || "—"}</TableCell>
                      <TableCell>{m.firstNo ? `${m.firstNo}–${m.lastNo}` : "—"}</TableCell>
                      <TableCell>
                        {m.filedAt ? (
                          <span className="flex items-center gap-1.5 text-sm">
                            <Lock className="h-3.5 w-3.5" /> Filed {fmtStamp(m.filedAt)}
                            {m.filedById && data.userNames[m.filedById] && <span className="text-muted-foreground">by {data.userNames[m.filedById]}</span>}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Open</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && !m.filedAt && m.guests > 0 && (
                          <Button size="sm" variant="outline" onClick={() => open({ kind: "file", month: m.month })}>Mark as filed</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Correction history</CardTitle>
            </CardHeader>
            <CardContent>
              {data.corrections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No corrections in {year}.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.corrections.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="whitespace-nowrap text-sm">{fmtStamp(c.createdAt)}</TableCell>
                        <TableCell className="text-sm">
                          {c.action === "REMOVE" ? `Removed Reg No ${c.registrationNo} — ${c.guestName ?? "guest"} (${c.confirmationNo ?? ""})` : `Closed gap at Reg No ${c.registrationNo}`}
                          {c.shiftFrom != null && <div className="text-xs text-muted-foreground">Nos {c.shiftFrom}–{c.shiftTo} moved down by one</div>}
                        </TableCell>
                        <TableCell className="text-sm">{c.reason}</TableCell>
                        <TableCell className="text-sm">{data.userNames[c.userId] ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === "remove" && `Remove Reg No ${pending.registrationNo}`}
              {pending?.kind === "gap" && `Close the gap at Reg No ${pending.registrationNo}`}
              {pending?.kind === "file" && `Mark ${MONTHS[pending.month - 1]} ${year} as filed`}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === "remove" && `${pending.guest} will no longer have a Green Tax registration number. ${shiftPreview(pending.registrationNo)}`}
              {pending?.kind === "gap" && shiftPreview(pending.registrationNo)}
              {pending?.kind === "file" && "Confirm the sheet has been submitted to MIRA. After this, no Reg No of any guest who stayed this month can be changed — this can't be undone in the app."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
              {pending?.kind === "file" ? (
                <FormField control={form.control} name="note" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Note (optional)</FormLabel>
                    <FormControl><Textarea placeholder="e.g. MIRA submission reference" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ) : (
                <FormField control={form.control} name="reason" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason</FormLabel>
                    <FormControl><Textarea placeholder="e.g. Day-use guest checked out after 6 hours" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
              {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPending(null)}>Cancel</Button>
                <Button type="submit" disabled={submitting} variant={pending?.kind === "file" ? "default" : "destructive"}>
                  {submitting ? "Saving..." : pending?.kind === "file" ? "Mark as filed" : "Renumber"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
