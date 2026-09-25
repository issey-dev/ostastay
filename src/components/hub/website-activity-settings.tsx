"use client"

import { useCallback, useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/ui/submit-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/lib/toast"
import { Compass, ListChecks, Pencil, Settings2 } from "@/components/icons"

// Hub → Booking API → Excursions & Spa: what each property sells online for the two
// add-ons, and which excursions / treatments are published with what guest-facing copy.
// Server side: src/lib/website-api/activity-settings.ts (BOOKING_API_ADDONS_PLAN.md Phase 1).

type Module = "EXCURSIONS" | "SPA"

type Item = {
  id: string
  code: string | null
  name: string
  group: string | null
  isActive: boolean
  publishOnline: boolean
  publicDescription: string | null
  imageUrls: string[]
  inclusions: string | null
  unpublishableReason: string | null
}

type ModuleSettings = {
  module: Module
  configured: boolean
  enabled: boolean
  holdMinutes: number
  leadHours: number
  maxPartySize: number | null
  offerGenderPreference: boolean
  onlinePaymentMethodId: string | null
  deskRemark: string | null
  policies: string | null
  outletLinked: boolean
  items: Item[]
}

type PropertyRow = {
  property: { id: string; code: string; name: string; currency: string }
  // This property's own payment methods (per property since 2026-09-23).
  paymentMethods: PaymentMethod[]
  modules: ModuleSettings[]
}

type PaymentMethod = { id: string; name: string; type: string }

const MODULE_LABEL: Record<Module, string> = { EXCURSIONS: "Excursions", SPA: "Spa" }
const ITEM_NOUN: Record<Module, [string, string]> = { EXCURSIONS: ["excursion", "excursions"], SPA: ["treatment", "treatments"] }

const whole = (min: number, max: number) =>
  z.string().refine((v) => /^\d+$/.test(v) && parseInt(v) >= min && parseInt(v) <= max, `${min} to ${max}`)

const settingsSchema = z.object({
  enabled: z.boolean(),
  holdMinutes: whole(5, 60),
  leadHours: whole(0, 168),
  // Excursions only; validated in onSubmit against the module being edited.
  maxPartySize: z.string(),
  offerGenderPreference: z.boolean(),
  onlinePaymentMethodId: z.string(),
  deskRemark: z.string().max(500, "Keep it under 500 characters"),
  policies: z.string().max(5000),
})
type SettingsValues = z.infer<typeof settingsSchema>

const detailsSchema = z.object({
  publicDescription: z.string().max(5000),
  imageUrls: z
    .string()
    .refine(
      (v) =>
        v
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .every((s) => /^https?:\/\/\S+$/i.test(s)),
      "Each line must be a full http(s) address"
    ),
  inclusions: z.string().max(2000),
})
type DetailsValues = z.infer<typeof detailsSchema>

function statusOf(m: ModuleSettings): { label: string; variant: "default" | "secondary" | "destructive"; note: string | null } {
  const published = m.items.filter((i) => i.publishOnline).length
  if (!m.enabled) return { label: "Off", variant: "secondary", note: null }
  if (!m.outletLinked) {
    return { label: "Not bookable", variant: "destructive", note: `Link the ${MODULE_LABEL[m.module]} outlet in Controls first — every online booking posts a charge through it.` }
  }
  if (published === 0) {
    return { label: "Not bookable", variant: "destructive", note: `Nothing is published yet — choose the ${ITEM_NOUN[m.module][1]} to sell.` }
  }
  return { label: "Selling online", variant: "default", note: null }
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null)
  return typeof body?.error === "string" ? body.error : fallback
}

export function WebsiteActivitySettings({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const [rows, setRows] = useState<PropertyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Which dialog is open, and for what.
  const [editing, setEditing] = useState<{ row: PropertyRow; settings: ModuleSettings } | null>(null)
  const [catalogue, setCatalogue] = useState<{ row: PropertyRow; module: Module } | null>(null)
  const [detail, setDetail] = useState<{ row: PropertyRow; module: Module; item: Item } | null>(null)

  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)

  const settingsForm = useForm<SettingsValues>({ resolver: zodResolver(settingsSchema), mode: "onChange" })
  const detailsForm = useForm<DetailsValues>({ resolver: zodResolver(detailsSchema), mode: "onChange" })

  const load = useCallback(async () => {
    setError(false)
    try {
      // This property only — the Hub's property area never lists another property.
      const res = await fetch(`/api/hub/website/activities/${propertyId}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRows(data.properties ?? [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    load()
  }, [load])

  // The catalogue dialog reads its items from `rows`, so a publish toggle shows at once.
  const catalogueSettings = catalogue
    ? rows.find((r) => r.property.id === catalogue.row.property.id)?.modules.find((m) => m.module === catalogue.module) ?? null
    : null

  const openSettings = (row: PropertyRow, settings: ModuleSettings) => {
    setServerError(null)
    settingsForm.reset({
      enabled: settings.enabled,
      holdMinutes: String(settings.holdMinutes),
      leadHours: String(settings.leadHours),
      maxPartySize: settings.maxPartySize != null ? String(settings.maxPartySize) : "",
      offerGenderPreference: settings.offerGenderPreference,
      onlinePaymentMethodId: settings.onlinePaymentMethodId ?? "",
      deskRemark: settings.deskRemark ?? "",
      policies: settings.policies ?? "",
    })
    setEditing({ row, settings })
  }

  const saveSettings = async (values: SettingsValues) => {
    if (!editing) return
    const mod = editing.settings.module
    if (mod === "EXCURSIONS" && !(/^\d+$/.test(values.maxPartySize) && +values.maxPartySize >= 1 && +values.maxPartySize <= 100)) {
      settingsForm.setError("maxPartySize", { message: "1 to 100" })
      return
    }
    setSubmitting(true)
    setServerError(null)
    try {
      const res = await fetch(`/api/hub/website/activities/${editing.row.property.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: mod,
          enabled: values.enabled,
          holdMinutes: parseInt(values.holdMinutes),
          leadHours: parseInt(values.leadHours),
          ...(mod === "EXCURSIONS" ? { maxPartySize: parseInt(values.maxPartySize) } : { offerGenderPreference: values.offerGenderPreference }),
          onlinePaymentMethodId: values.onlinePaymentMethodId || null,
          deskRemark: values.deskRemark || null,
          policies: values.policies || null,
        }),
      })
      if (!res.ok) {
        setServerError(await readError(res, "Couldn't save the settings"))
        return
      }
      setEditing(null)
      toast.success(`Online ${MODULE_LABEL[mod]} settings saved for ${editing.row.property.name}`)
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  const togglePublish = async (module: Module, item: Item, publishOnline: boolean) => {
    setBusyItemId(item.id)
    try {
      const res = await fetch(`/api/hub/website/activity-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module, publishOnline }),
      })
      if (!res.ok) {
        toast.error(await readError(res, "Couldn't change what is sold online"))
        return
      }
      await load()
    } finally {
      setBusyItemId(null)
    }
  }

  const openDetails = (row: PropertyRow, module: Module, item: Item) => {
    setServerError(null)
    detailsForm.reset({
      publicDescription: item.publicDescription ?? "",
      imageUrls: item.imageUrls.join("\n"),
      inclusions: item.inclusions ?? "",
    })
    // One dialog at a time: the catalogue closes while the item is edited, then reopens.
    setCatalogue(null)
    setDetail({ row, module, item })
  }

  const closeDetails = () => {
    if (detail) setCatalogue({ row: detail.row, module: detail.module })
    setDetail(null)
  }

  const saveDetails = async (values: DetailsValues) => {
    if (!detail) return
    setSubmitting(true)
    setServerError(null)
    try {
      const res = await fetch(`/api/hub/website/activity-items/${detail.item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: detail.module,
          publicDescription: values.publicDescription || null,
          imageUrls: values.imageUrls.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
          inclusions: values.inclusions || null,
        }),
      })
      if (!res.ok) {
        setServerError(await readError(res, "Couldn't save the details"))
        return
      }
      toast.success(`Saved ${detail.item.name}`)
      await load()
      closeDetails()
    } finally {
      setSubmitting(false)
    }
  }

  const editingModule = editing?.settings.module

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Excursions &amp; Spa</CardTitle>
          <CardDescription>
            What each property sells online for its excursions and spa, and which of them the website may book. Guests
            book instantly whenever there is space. The website takes payment itself and tells us whether the guest has
            paid; a paid booking is settled with the payment method chosen here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : error ? (
            <ErrorState title="Couldn't load the online settings" onRetry={load} />
          ) : rows.length === 0 ? (
            <EmptyState icon={Compass} title="No active properties" />
          ) : (
            <div className="space-y-3">
              {rows.map((r) => (
                <div key={r.property.id} className="space-y-3 rounded-md border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.property.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{r.property.code}</span>
                  </div>
                  {r.modules.map((m) => {
                    const status = statusOf(m)
                    const published = m.items.filter((i) => i.publishOnline).length
                    return (
                      <div
                        key={m.module}
                        className="flex flex-col gap-3 border-t border-border pt-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{MODULE_LABEL[m.module]}</span>
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {published} of {m.items.length} {ITEM_NOUN[m.module][m.items.length === 1 ? 0 : 1]} published
                            {` · holds ${m.holdMinutes} min · book at least ${m.leadHours} h ahead`}
                            {m.module === "EXCURSIONS" && m.maxPartySize ? ` · up to ${m.maxPartySize} guests` : ""}
                          </div>
                          {status.note && <div className="text-xs text-destructive">{status.note}</div>}
                          {m.enabled && !m.onlinePaymentMethodId && (
                            <div className="text-xs text-muted-foreground">
                              No payment method chosen — the website can only send bookings to be paid at the property.
                            </div>
                          )}
                        </div>
                        {canManage && (
                          <div className="flex shrink-0 gap-2">
                            <Button variant="outline" size="sm" onClick={() => setCatalogue({ row: r, module: m.module })}>
                              <ListChecks className="mr-1.5 h-3.5 w-3.5" /> What&apos;s sold
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => openSettings(r, m)}>
                              <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Settings
                            </Button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Module settings */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent size="md">
          <Form {...settingsForm}>
            <form onSubmit={settingsForm.handleSubmit(saveSettings)}>
              <DialogHeader>
                <DialogTitle>
                  {editing?.row.property.name} — online {editingModule ? MODULE_LABEL[editingModule].toLowerCase() : ""}
                </DialogTitle>
                <DialogDescription>Applies to every {editingModule === "SPA" ? "treatment" : "excursion"} booked through the website.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <FormField control={settingsForm.control} name="enabled" render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="!mt-0 cursor-pointer font-normal">Accept bookings from the website</FormLabel>
                  </FormItem>
                )} />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField control={settingsForm.control} name="holdMinutes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hold while paying (minutes)</FormLabel>
                      <FormControl><Input type="number" min="5" max="60" {...field} /></FormControl>
                      <p className="text-xs text-muted-foreground">How long a place is kept while the guest pays on the website.</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={settingsForm.control} name="leadHours" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Book at least (hours ahead)</FormLabel>
                      <FormControl><Input type="number" min="0" max="168" {...field} /></FormControl>
                      <p className="text-xs text-muted-foreground">Online bookings close this long before the start.</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  {editingModule === "EXCURSIONS" && (
                    <FormField control={settingsForm.control} name="maxPartySize" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Largest party per booking</FormLabel>
                        <FormControl><Input type="number" min="1" max="100" {...field} /></FormControl>
                        <p className="text-xs text-muted-foreground">Larger groups book with the property directly.</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                  <FormField control={settingsForm.control} name="onlinePaymentMethodId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment method for paid bookings</FormLabel>
                      <SearchableSelect
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="None — pay at the property"
                        options={[
                          { label: "None — pay at the property", value: "" },
                          ...(editing?.row.paymentMethods ?? []).map((p) => ({ label: p.name, value: p.id })),
                        ]}
                      />
                      <p className="text-xs text-muted-foreground">When the website says the guest has paid, the bill is settled with this.</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                {editingModule === "SPA" && (
                  <FormField control={settingsForm.control} name="offerGenderPreference" render={({ field }) => (
                    <FormItem className="flex items-start gap-3">
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      <div className="!mt-0">
                        <FormLabel className="cursor-pointer font-normal">Let guests ask for a male or female therapist</FormLabel>
                        <p className="text-xs text-muted-foreground">Therapists&apos; names are never shown to the website.</p>
                      </div>
                    </FormItem>
                  )} />
                )}
                <FormField control={settingsForm.control} name="deskRemark" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Note for the desk</FormLabel>
                    <FormControl><Input placeholder="e.g. Website booking — check payment reference" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">Added to the notes of every online booking.</p>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={settingsForm.control} name="policies" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Policies</FormLabel>
                    <FormControl><Textarea rows={4} placeholder="Cancellation, what to bring, age limits…" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">
                      Shown on the website. The cancellation cutoff itself comes from the{" "}
                      {editingModule === "SPA" ? "Spa settings" : "excursion"} in Controls.
                    </p>
                    <FormMessage />
                  </FormItem>
                )} />
                {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <SubmitButton pending={submitting}>Save</SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* What's sold */}
      <Dialog open={!!catalogue} onOpenChange={(open) => !open && setCatalogue(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {catalogue?.row.property.name} — {catalogue ? MODULE_LABEL[catalogue.module].toLowerCase() : ""} sold online
            </DialogTitle>
            <DialogDescription>
              Switch on what the website may sell. Prices, times and capacity come from Controls; here you only choose what
              is published and how the website describes it.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {!catalogueSettings || catalogueSettings.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing set up yet — create {catalogue ? ITEM_NOUN[catalogue.module][1] : "items"} in Controls first.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {catalogueSettings.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-2.5">
                    <Switch
                      checked={item.publishOnline}
                      disabled={busyItemId === item.id || (!item.publishOnline && !!item.unpublishableReason)}
                      onCheckedChange={(v) => catalogue && togglePublish(catalogue.module, item, v)}
                      aria-label={`Sell ${item.name} online`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="truncate">{item.name}</span>
                        {item.code && <span className="font-mono text-xs text-muted-foreground">{item.code}</span>}
                        {item.group && <span className="text-xs text-muted-foreground">· {item.group}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.unpublishableReason
                          ? item.unpublishableReason
                          : [
                              item.publicDescription ? "Description" : "No description",
                              `${item.imageUrls.length} photo${item.imageUrls.length === 1 ? "" : "s"}`,
                            ].join(" · ")}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit online details of ${item.name}`}
                      onClick={() => catalogue && openDetails(catalogue.row, catalogue.module, item)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setCatalogue(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One item's online details */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && closeDetails()}>
        <DialogContent size="md">
          <Form {...detailsForm}>
            <form onSubmit={detailsForm.handleSubmit(saveDetails)}>
              <DialogHeader>
                <DialogTitle>{detail?.item.name} — online details</DialogTitle>
                <DialogDescription>What the website shows guests. Leave blank to show nothing.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <FormField control={detailsForm.control} name="publicDescription" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl><Textarea rows={5} placeholder="What the guest will experience." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={detailsForm.control} name="inclusions" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Included</FormLabel>
                    <FormControl><Textarea rows={3} placeholder={"Snorkel gear\nDrinking water"} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={detailsForm.control} name="imageUrls" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Photo URLs (one per line)</FormLabel>
                    <FormControl><Textarea rows={3} placeholder={"https://…/snorkel.jpg"} {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">The first photo is the main image. Host the files on your website or a CDN.</p>
                    <FormMessage />
                  </FormItem>
                )} />
                {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDetails}>Cancel</Button>
                <SubmitButton pending={submitting}>Save</SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  )
}
