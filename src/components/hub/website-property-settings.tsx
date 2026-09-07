"use client"

import { useCallback, useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/lib/toast"
import { Building2, Pencil } from "@/components/icons"

type PropertyRow = {
  property: { id: string; code: string; name: string; currency: string; status: string }
  configured: boolean
  headline: string | null
  description: string | null
  imageUrls: string[]
  policies: string | null
  bookingEnabled: boolean
  ratePlanId: string | null
  mealPlanCode: string
  offerMealPlans: boolean
  offerAddOns: boolean
  maxNightsAhead: number
  minNights: number
  deskRemark: string | null
  ratePlans: { id: string; code: string; name: string; isLocked: boolean; parentRatePlanId: string | null }[]
  mealPlans: { code: string; name: string }[]
  addOns: { id: string; code: string; name: string; type: string; publishToApi: boolean }[]
  bundledOnlyCount: number
  keyCount: number
  bookingCount: number
}

const settingsSchema = z.object({
  headline: z.string().max(200, "Keep the headline under 200 characters"),
  description: z.string().max(5000),
  imageUrls: z.string(),
  policies: z.string().max(5000),
  bookingEnabled: z.boolean(),
  offerMealPlans: z.boolean(),
  offerAddOns: z.boolean(),
  publishedAddOnIds: z.array(z.string()),
  ratePlanId: z.string(),
  mealPlanCode: z.string(),
  maxNightsAhead: z.string().refine((v) => /^\d+$/.test(v) && parseInt(v) >= 1 && parseInt(v) <= 730, "1 to 730 nights"),
  minNights: z.string().refine((v) => /^\d+$/.test(v) && parseInt(v) >= 1 && parseInt(v) <= 30, "1 to 30 nights"),
  deskRemark: z.string().max(500),
})
type SettingsFormValues = z.infer<typeof settingsSchema>

function toForm(row: PropertyRow): SettingsFormValues {
  return {
    headline: row.headline ?? "",
    description: row.description ?? "",
    imageUrls: row.imageUrls.join("\n"),
    policies: row.policies ?? "",
    bookingEnabled: row.bookingEnabled,
    offerMealPlans: row.offerMealPlans,
    offerAddOns: row.offerAddOns,
    publishedAddOnIds: row.addOns.filter((a) => a.publishToApi).map((a) => a.id),
    ratePlanId: row.ratePlanId ?? "",
    mealPlanCode: row.mealPlanCode ?? "NONE",
    maxNightsAhead: String(row.maxNightsAhead),
    minNights: String(row.minNights),
    deskRemark: row.deskRemark ?? "",
  }
}

export function WebsitePropertySettings({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<PropertyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [editing, setEditing] = useState<PropertyRow | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<SettingsFormValues>({ resolver: zodResolver(settingsSchema), mode: "onChange" })

  const load = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch("/api/hub/website/properties")
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRows(data.properties ?? [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openEdit = (row: PropertyRow) => {
    setEditing(row)
    setServerError(null)
    form.reset(toForm(row))
  }

  const onSubmit = async (values: SettingsFormValues) => {
    if (!editing) return
    setSubmitting(true)
    setServerError(null)
    try {
      const payload = {
        headline: values.headline || null,
        description: values.description || null,
        imageUrls: values.imageUrls.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        policies: values.policies || null,
        bookingEnabled: values.bookingEnabled,
        offerMealPlans: values.offerMealPlans,
        offerAddOns: values.offerAddOns,
        publishedAddOnIds: values.publishedAddOnIds,
        ratePlanId: values.ratePlanId || null,
        mealPlanCode: values.mealPlanCode || "NONE",
        maxNightsAhead: parseInt(values.maxNightsAhead),
        minNights: parseInt(values.minNights),
        deskRemark: values.deskRemark || null,
      }
      const res = await fetch(`/api/hub/website/properties/${editing.property.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setServerError(typeof body?.error === "string" ? body.error : "Couldn't save the settings")
        return
      }
      setEditing(null)
      toast.success(`Website settings saved for ${editing.property.name}`)
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  const sellsBadge = (row: PropertyRow) => {
    if (!row.bookingEnabled) return <Badge variant="secondary">Booking off</Badge>
    if (!row.ratePlanId) return <Badge variant="destructive">No rate plan</Badge>
    return <Badge variant="default">Bookable</Badge>
  }
  const planName = (row: PropertyRow) => row.ratePlans.find((p) => p.id === row.ratePlanId)?.name ?? "—"

  const bookingEnabled = form.watch("bookingEnabled")

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Properties</CardTitle>
          <CardDescription>
            What each property&apos;s website shows (headline, description, photos, policies) and sells (the rate plan and
            meal plan every online booking is made on). A property with no rate plan chosen is listed but cannot be
            booked online.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : error ? (
            <ErrorState title="Couldn't load properties" onRetry={load} />
          ) : rows.length === 0 ? (
            <EmptyState icon={Building2} title="No active properties" />
          ) : (
            <div className="space-y-3">
              {rows.map((r) => (
                <div key={r.property.id} className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.property.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{r.property.code}</span>
                      {sellsBadge(r)}
                      {!r.configured && <Badge variant="outline">Not set up</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Sells <span className="text-foreground">{planName(r)}</span>
                      {r.mealPlanCode && r.mealPlanCode !== "NONE" ? ` · ${r.mealPlans.find((m) => m.code === r.mealPlanCode)?.name ?? r.mealPlanCode}` : ""}
                      {` · min ${r.minNights} night${r.minNights === 1 ? "" : "s"} · up to ${r.maxNightsAhead} nights ahead`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.keyCount} key{r.keyCount === 1 ? "" : "s"} · {r.bookingCount} website booking{r.bookingCount === 1 ? "" : "s"}
                      {r.imageUrls.length > 0 ? ` · ${r.imageUrls.length} photo${r.imageUrls.length === 1 ? "" : "s"}` : " · no photos"}
                    </div>
                  </div>
                  {canManage && (
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => openEdit(r)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{editing?.property.name} — website settings</DialogTitle>
                <DialogDescription>Shown on the property&apos;s website and used for every booking it makes.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="rounded-md border border-border p-3">
                  <p className="mb-3 text-sm font-medium">Online booking</p>
                  <div className="grid gap-4">
                    <FormField control={form.control} name="bookingEnabled" render={({ field }) => (
                      <FormItem className="flex items-center gap-3">
                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        <FormLabel className="!mt-0 cursor-pointer font-normal">Accept bookings from the website</FormLabel>
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <FormField control={form.control} name="ratePlanId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Rate plan to sell {bookingEnabled ? "*" : ""}</FormLabel>
                          <SearchableSelect
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Choose a rate plan..."
                            options={(editing?.ratePlans ?? []).map((p) => ({
                              label: `${p.name} (${p.code})${p.isLocked ? " — base" : ""}`,
                              value: p.id,
                            }))}
                          />
                          <p className="text-xs text-muted-foreground">Every website booking is made on this plan. Negotiated plans are not offered.</p>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="offerMealPlans" render={({ field }) => (
                      <FormItem className="flex items-start gap-3">
                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        <div className="!mt-0">
                          <FormLabel className="cursor-pointer font-normal">Let guests choose their meal plan</FormLabel>
                          <p className="text-xs text-muted-foreground">
                            Off: every booking uses the plan chosen below. On: the site offers this property&apos;s active
                            meal plans, with that one preselected.
                          </p>
                        </div>
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="offerAddOns" render={({ field }) => (
                      <FormItem className="flex items-start gap-3">
                        <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        <div className="!mt-0">
                          <FormLabel className="cursor-pointer font-normal">Offer paid extras online</FormLabel>
                          <p className="text-xs text-muted-foreground">
                            Transfers, spa treatments and anything else marked &quot;sell separately&quot; in Allocations.
                            Turn this on and pick which of them go out below.
                          </p>
                        </div>
                      </FormItem>
                    )} />
                    {form.watch("offerAddOns") && (
                      <FormField control={form.control} name="publishedAddOnIds" render={({ field }) => {
                        const chosen = new Set(field.value ?? [])
                        const addOns = editing?.addOns ?? []
                        const toggle = (id: string) => {
                          const next = new Set(chosen)
                          if (next.has(id)) next.delete(id)
                          else next.add(id)
                          field.onChange([...next])
                        }
                        return (
                          <FormItem className="rounded-md border border-border p-3 space-y-2 md:col-span-2">
                            <div className="flex items-center justify-between gap-2">
                              <FormLabel className="font-normal">Extras offered through the APIs</FormLabel>
                              {addOns.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs tabular-nums text-muted-foreground">
                                    {chosen.size} of {addOns.length}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7"
                                    onClick={() => field.onChange(chosen.size === addOns.length ? [] : addOns.map((a) => a.id))}
                                  >
                                    {chosen.size === addOns.length ? "None" : "All"}
                                  </Button>
                                </div>
                              )}
                            </div>
                            {addOns.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                Nothing to offer yet — this property has no allocation marked &quot;sell separately&quot;.
                                Mark one in Revenue &rarr; Allocations and it will appear here.
                              </p>
                            ) : (
                              <>
                                <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                                  {addOns.map((a) => (
                                    <li key={a.id} className="min-w-0">
                                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                                        <Checkbox checked={chosen.has(a.id)} onCheckedChange={() => toggle(a.id)} />
                                        <span className="min-w-0 truncate">{a.name}</span>
                                        <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                                      </label>
                                    </li>
                                  ))}
                                </ul>
                                <p className="text-xs text-muted-foreground">
                                  An unticked extra is still there for the front desk to add — it is simply not offered by
                                  the website or the channel manager. A newly created extra starts published.
                                </p>
                              </>
                            )}
                            {editing && editing.bundledOnlyCount > 0 && (
                              <p className="text-xs text-muted-foreground">
                                {editing.bundledOnlyCount} more {editing.bundledOnlyCount === 1 ? "allocation is" : "allocations are"} part of
                                a rate or meal plan only, so there is nothing to sell on its own.
                              </p>
                            )}
                          </FormItem>
                        )
                      }} />
                    )}
                    <FormField control={form.control} name="mealPlanCode" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Meal plan</FormLabel>
                          <SearchableSelect
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="None"
                            options={[
                              { label: "None", value: "NONE" },
                              ...(editing?.mealPlans ?? []).map((m) => ({ label: `${m.name} (${m.code})`, value: m.code })),
                            ]}
                          />
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <FormField control={form.control} name="minNights" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Minimum stay (nights)</FormLabel>
                          <FormControl><Input type="number" min="1" max="30" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="maxNightsAhead" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Booking window (nights ahead)</FormLabel>
                          <FormControl><Input type="number" min="1" max="730" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <FormField control={form.control} name="deskRemark" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Note for the front desk</FormLabel>
                        <FormControl><Input placeholder="e.g. Website bookings: collect payment at check-in" {...field} /></FormControl>
                        <p className="text-xs text-muted-foreground">Added to the remarks of every website reservation.</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>

                <FormField control={form.control} name="headline" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Headline</FormLabel>
                    <FormControl><Input placeholder="e.g. Barefoot luxury on a private island" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Textarea rows={5} placeholder="The property as guests should read about it." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="imageUrls" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Photo URLs (one per line)</FormLabel>
                    <FormControl><Textarea rows={3} placeholder={"https://…/hero.jpg\nhttps://…/pool.jpg"} {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">The first photo is used as the main image. Host the files on your website or a CDN.</p>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="policies" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Policies</FormLabel>
                    <FormControl><Textarea rows={4} placeholder="Cancellation, deposit, children, pets…" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">Shown on the booking page. Write what the desk actually honours — nothing here is enforced by the system.</p>
                    <FormMessage />
                  </FormItem>
                )} />

                {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save settings"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  )
}
