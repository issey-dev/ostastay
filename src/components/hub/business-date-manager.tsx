"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Skeleton } from "@/components/ui/skeleton"
import { useConfirm } from "@/components/providers/confirm-provider"
import { CheckCircle2, XCircle, CalendarDays } from "@/components/icons"
import { toast } from "@/lib/toast"

// Move this property's business date by hand — src/lib/business-date-change.ts has the
// rules. Pick a date and the checks run straight away, each shown passing or failing with
// the reason; the change is only offered once every check passes (and the server checks
// again when it is made).

type Check = { key: string; label: string; ok: boolean; detail: string | null }
type Assessment = { current: string; target: string; fresh: boolean; checks: Check[]; allowed: boolean }

const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the new business date") })
type Values = z.infer<typeof schema>

const pretty = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })

export function BusinessDateManager({ propertyId, current, canChange }: { propertyId: string; current: string; canChange: boolean }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [checking, setChecking] = useState(false)
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onChange", defaultValues: { date: "" } })
  const date = form.watch("date")

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setAssessment(null)
      return
    }
    let cancelled = false
    setChecking(true)
    fetch(`/api/properties/${propertyId}/business-date?date=${date}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          toast.error(data.error ?? "Couldn't check that date")
          setAssessment(null)
        } else setAssessment(data)
      })
      .finally(() => !cancelled && setChecking(false))
    return () => {
      cancelled = true
    }
  }, [propertyId, date])

  const onSubmit = async (values: Values) => {
    const ok = await confirm({
      title: `Move the business date to ${pretty(values.date)}?`,
      description:
        "The property's working day changes immediately and its staff are signed out, as after Night Audit. Night Audit is not run for the days skipped.",
      confirmLabel: "Change business date",
      destructive: true,
    })
    if (!ok) return
    const res = await fetch(`/api/properties/${propertyId}/business-date`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: values.date }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? "Couldn't change the business date")
      return
    }
    toast.success(`Business date is now ${pretty(values.date)}`)
    form.reset({ date: "" })
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-4 py-3 max-sm:py-4">
        <CalendarDays className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-xs text-muted-foreground">Current business date</p>
          <p className="text-base font-semibold max-sm:text-xl">{pretty(current)}</p>
        </div>
      </div>

      {canChange ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="date" render={({ field }) => (
              <FormItem className="max-w-xs">
                <FormLabel>New business date</FormLabel>
                <FormControl>
                  <DatePicker value={field.value || null} onChange={field.onChange} placeholder="Pick a date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {checking ? (
              <Skeleton className="h-28 w-full" />
            ) : assessment ? (
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">
                  {assessment.fresh
                    ? "Nothing has happened at this property yet, so any date can be set."
                    : "The date can only move forward, and only when nothing would be skipped over:"}
                </p>
                <ul className="space-y-1.5">
                  {assessment.checks.map((c) => (
                    <li key={c.key} className="flex items-start gap-2 text-sm">
                      {c.ok ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <span>
                        <span className={c.ok ? "text-foreground" : "font-medium text-foreground"}>{c.label}</span>
                        {c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Button type="submit" className="max-sm:w-full" disabled={!assessment?.allowed || form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Changing…" : "Change business date"}
            </Button>
          </form>
        </Form>
      ) : (
        <p className="text-sm text-muted-foreground">Changing the business date needs Night Audit rights.</p>
      )}
    </div>
  )
}
