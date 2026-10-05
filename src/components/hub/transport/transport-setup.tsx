"use client"

import { useCallback, useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Plus, Ship, MapPin, ArrowLeftRight, Users, Receipt, Wand2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { OptionSelect } from "@/components/ui/option-select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { SubmitButton } from "@/components/ui/submit-button"
import { ErrorState } from "@/components/ui/error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ControlsCard } from "@/components/controls/controls-card"
import { useConfirm } from "@/components/providers/confirm-provider"
import { apiError } from "@/lib/api-error"
import { toast } from "@/lib/toast"
import { chargeCodeOptions } from "@/lib/charge-code-options"
import {
  LOCATION_TYPE_LABELS,
  PRICING_BASIS_LABELS,
  PROVIDER_KIND_LABELS,
  ROUTE_CATEGORY_LABELS,
  ROUTE_DIRECTION_LABELS,
  TAX_MODES,
  TAX_MODE_LABELS,
  TRANSPORT_MODE_LABELS,
  label,
} from "@/lib/transport/constants"
import { ConfigList } from "@/components/hub/transport/config-list"
import { LocationDialog, ProviderDialog, RateDialog, RouteDialog, TypeDialog, VesselDialog } from "@/components/hub/transport/dialogs"
import { money, type TransportConfig, type TransportRateDto } from "@/components/hub/transport/types"

// Hub › property › Transportation: the module switch and defaults, then the catalogue —
// transport types, locations, routes, providers with their boats/vehicles, and rates.
// One read (GET /api/transport/config) feeds every section, so a type added above shows
// up in the route form below without a reload.

type Perms = { create: boolean; update: boolean; delete: boolean }
type Entity = "types" | "locations" | "routes" | "providers" | "vessels" | "rates"

const settingsForm = z
  .object({
    enabled: z.boolean(),
    attentionToleranceMinutes: z
      .string()
      .refine((v) => /^\d+$/.test(v) && Number(v) <= 720, "0 to 720 minutes"),
    requireProvider: z.boolean(),
    defaultChargeCodeId: z.string(),
    defaultTaxMode: z.enum(TAX_MODES),
    defaultTaxProfileId: z.string(),
  })
  .refine((v) => v.defaultTaxMode !== "CUSTOM" || !!v.defaultTaxProfileId, { message: "Choose a tax profile", path: ["defaultTaxProfileId"] })

function SettingsForm({ propertyId, config, canEdit, onSaved }: { propertyId: string; config: TransportConfig; canEdit: boolean; onSaved: () => void }) {
  const s = config.settings
  const form = useForm<z.infer<typeof settingsForm>>({
    resolver: zodResolver(settingsForm),
    mode: "onChange",
    values: {
      enabled: s.enabled,
      attentionToleranceMinutes: String(s.attentionToleranceMinutes),
      requireProvider: s.requireProvider,
      defaultChargeCodeId: s.defaultChargeCodeId ?? "",
      defaultTaxMode: s.defaultTaxMode as never,
      defaultTaxProfileId: s.defaultTaxProfileId ?? "",
    },
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taxMode = form.watch("defaultTaxMode")

  const onSubmit = async (v: z.infer<typeof settingsForm>) => {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/transport/settings?propertyId=${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...v,
          attentionToleranceMinutes: Number(v.attentionToleranceMinutes),
          defaultChargeCodeId: v.defaultChargeCodeId || null,
          defaultTaxProfileId: v.defaultTaxMode === "CUSTOM" ? v.defaultTaxProfileId : null,
        }),
      })
      if (!res.ok) setError(await apiError(res, "Couldn't save the settings. Try again."))
      else {
        toast.success("Transportation settings saved")
        onSaved()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5">
        <FormField
          control={form.control}
          name="enabled"
          render={({ field }) => (
            <FormItem className="flex items-center gap-3">
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
              </FormControl>
              <FormLabel className="!mt-0 cursor-pointer font-normal">
                Transportation is on for this property — the board, the reservation panel and Night Audit posting
              </FormLabel>
            </FormItem>
          )}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="attentionToleranceMinutes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Time to allow around a flight (minutes)</FormLabel>
                <FormControl>
                  <Input type="number" min={0} max={720} disabled={!canEdit} {...field} />
                </FormControl>
                <p className="text-xs text-muted-foreground">
                  A boat leaving sooner than this after landing, or reaching the airport later than this before take-off, is marked Needs attention.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="defaultChargeCodeId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Default charge code for new rates</FormLabel>
                <FormControl>
                  <SearchableSelect
                    value={field.value}
                    onChange={field.onChange}
                    disabled={!canEdit}
                    placeholder="Select charge code…"
                    options={chargeCodeOptions(config.chargeCodes)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="defaultTaxMode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Default tax for new rates</FormLabel>
                <FormControl>
                  <OptionSelect
                    value={field.value}
                    onChange={field.onChange}
                    disabled={!canEdit}
                    options={TAX_MODES.map((m) => ({ value: m, label: TAX_MODE_LABELS[m] }))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {taxMode === "CUSTOM" && (
            <FormField
              control={form.control}
              name="defaultTaxProfileId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax profile *</FormLabel>
                  <FormControl>
                    <OptionSelect
                      value={field.value}
                      onChange={field.onChange}
                      disabled={!canEdit}
                      placeholder="Select tax profile…"
                      options={config.taxProfiles.map((t) => ({ value: t.id, label: t.name }))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>
        <FormField
          control={form.control}
          name="requireProvider"
          render={({ field }) => (
            <FormItem className="flex items-center gap-3">
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
              </FormControl>
              <FormLabel className="!mt-0 cursor-pointer font-normal">
                A provider must be assigned before a booking is Assigned or a departure is Confirmed
              </FormLabel>
            </FormItem>
          )}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        {canEdit && (
          <div>
            <SubmitButton pending={pending}>Save settings</SubmitButton>
          </div>
        )}
      </form>
    </Form>
  )
}

function rateSummary(r: TransportRateDto): string {
  if (r.pricingBasis === "PER_PERSON") return `A ${money(r.adultPrice)} / C ${money(r.childPrice)} / I ${money(r.infantPrice)}`
  return `${money(r.price)} ${r.pricingBasis === "PER_VEHICLE" ? "per vehicle" : "per trip"}`
}

function validity(r: TransportRateDto): string {
  if (!r.validFrom && !r.validTo) return "Always"
  return `${r.validFrom ?? "…"} → ${r.validTo ?? "…"}`
}

export function TransportSetup({ propertyId, perms }: { propertyId: string; perms: Perms }) {
  const confirm = useConfirm()
  const [config, setConfig] = useState<TransportConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [dialog, setDialog] = useState<{ entity: Entity; row: any } | null>(null)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch(`/api/transport/config?propertyId=${propertyId}`)
      if (!res.ok) throw new Error()
      setConfig(await res.json())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    load()
  }, [load])

  const open = (entity: Entity, row: any = null) => setDialog({ entity, row })
  const close = (o: boolean) => {
    if (!o) setDialog(null)
  }

  const toggleActive = async (entity: Entity, row: { id: string; isActive: boolean; name?: string | null }) => {
    const res = await fetch(`/api/transport/config/${entity}/${row.id}?propertyId=${propertyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !row.isActive }),
    })
    if (!res.ok) toast.error(await apiError(res, "Couldn't change it. Try again."))
    else toast.success(row.isActive ? "Deactivated" : "Activated")
    load()
  }

  const remove = async (entity: Entity, row: { id: string; name?: string | null; code?: string }) => {
    const ok = await confirm({
      title: "Delete?",
      description: `Delete ${row.name ?? row.code ?? "this item"}? Anything already used by a booking, rate or departure can't be deleted — deactivate it instead.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    const res = await fetch(`/api/transport/config/${entity}/${row.id}?propertyId=${propertyId}`, { method: "DELETE" })
    if (!res.ok) toast.error(await apiError(res, "Couldn't delete it. Try again."))
    else toast.success("Deleted")
    load()
  }

  const loadDefaults = async () => {
    setSeeding(true)
    try {
      const res = await fetch(`/api/transport/defaults?propertyId=${propertyId}`, { method: "POST" })
      if (!res.ok) toast.error(await apiError(res, "Couldn't load the defaults. Try again."))
      else {
        const r = (await res.json()) as { created: string[]; skipped: string[] }
        toast.success(r.created.length ? `Added ${r.created.length}: ${r.created.join(", ")}` : "Everything was already set up")
      }
      load()
    } finally {
      setSeeding(false)
    }
  }

  if (error) return <ErrorState onRetry={load} />
  if (loading || !config) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const addButton = (entity: Entity, text: string, disabled = false) =>
    perms.create && (
      <Button onClick={() => open(entity)} className="shadow-sm" disabled={disabled}>
        <Plus className="mr-2 h-4 w-4" /> {text}
      </Button>
    )
  const common = {
    loading: false,
    canUpdate: perms.update,
    canDelete: perms.delete,
  }
  const allVessels = config.providers.flatMap((p) => p.vessels.map((v) => ({ ...v, provider: { id: p.id, name: p.name, kind: p.kind } })))

  return (
    <div className="flex flex-col gap-6">
      <ControlsCard
        title="Module"
        description="Switch Transportation on for this property and set the defaults. Everything here is this property's own — nothing is shared with other properties."
        action={
          perms.create && (
            <Button variant="outline" onClick={loadDefaults} disabled={seeding}>
              <Wand2 className="mr-2 h-4 w-4" /> {seeding ? "Loading…" : "Load defaults"}
            </Button>
          )
        }
      >
        <SettingsForm propertyId={propertyId} config={config} canEdit={perms.update} onSaved={load} />
      </ControlsCard>

      <ControlsCard
        title="Transport types"
        description="Speedboat, seaplane, domestic flight, ferry, land. A type that needs flight details shows the airport leg on every booking that uses it."
        action={addButton("types", "Add type")}
      >
        <ConfigList
          {...common}
          rows={config.types}
          noun="transport type"
          empty={{ icon: Ship, title: "No transport types yet", description: "Use Load defaults above, or add one — e.g. SPB Speedboat." }}
          title={(t) => (
            <span>
              <span className="mr-1.5 font-mono text-sm font-bold text-info">{t.code}</span>
              {t.name}
            </span>
          )}
          meta={(t) => [
            { label: "Mode", value: label(TRANSPORT_MODE_LABELS, t.mode) },
            { label: "Flight details", value: t.requiresFlightDetails ? "Required" : "—" },
          ]}
          columns={[
            { header: "Code", cell: (t) => <span className="font-mono font-bold text-info">{t.code}</span> },
            { header: "Name", cell: (t) => t.name, className: "font-medium" },
            { header: "Mode", cell: (t) => label(TRANSPORT_MODE_LABELS, t.mode) },
            { header: "Flight details", cell: (t) => (t.requiresFlightDetails ? <Badge variant="outline">Required</Badge> : "—") },
          ]}
          onEdit={(t) => open("types", t)}
          onToggleActive={(t) => toggleActive("types", t)}
          onDelete={(t) => remove("types", t)}
        />
      </ControlsCard>

      <ControlsCard
        title="Locations"
        description="Airports, jetties, seaplane platforms, islands, resorts and guesthouses that transfers start or end at."
        action={addButton("locations", "Add location")}
      >
        <ConfigList
          {...common}
          rows={config.locations}
          noun="location"
          empty={{ icon: MapPin, title: "No locations yet", description: "Add the airport and the property's jetty, e.g. MLE Velana International Airport." }}
          title={(l) => (
            <span>
              <span className="mr-1.5 font-mono text-sm font-bold text-info">{l.code}</span>
              {l.name}
            </span>
          )}
          subtitle={(l) => label(LOCATION_TYPE_LABELS, l.type)}
          columns={[
            { header: "Code", cell: (l) => <span className="font-mono font-bold text-info">{l.code}</span> },
            { header: "Name", cell: (l) => l.name, className: "font-medium" },
            { header: "Type", cell: (l) => label(LOCATION_TYPE_LABELS, l.type) },
            { header: "Notes", cell: (l) => <span className="line-clamp-1 max-w-xs text-muted-foreground">{l.notes ?? "—"}</span> },
          ]}
          onEdit={(l) => open("locations", l)}
          onToggleActive={(l) => toggleActive("locations", l)}
          onDelete={(l) => remove("locations", l)}
        />
      </ControlsCard>

      <ControlsCard
        title="Routes"
        description="From where to where, by what transport. Airport transfers show the flight on each booking; local transfers do not. Default departure times are suggested on bookings and can create a day's departures."
        action={addButton("routes", "Add route", config.locations.length < 2 || config.types.length === 0)}
      >
        <ConfigList
          {...common}
          rows={config.routes}
          noun="route"
          empty={{ icon: ArrowLeftRight, title: "No routes yet", description: "Add at least two locations and a transport type first, then a route such as MLE → resort by speedboat." }}
          title={(r) => (
            <span>
              <span className="mr-1.5 font-mono text-sm font-bold text-info">{r.code}</span>
              {r.name}
            </span>
          )}
          subtitle={(r) => `${r.origin.code} → ${r.destination.code} · ${r.transportType.name}`}
          meta={(r) => [
            { label: "Category", value: label(ROUTE_CATEGORY_LABELS, r.category) },
            { label: "Used for", value: label(ROUTE_DIRECTION_LABELS, r.direction) },
            { label: "Departures", value: r.departureSlots.join(", ") || "—", wide: true },
          ]}
          columns={[
            { header: "Code", cell: (r) => <span className="font-mono font-bold text-info">{r.code}</span> },
            { header: "Route", cell: (r) => (
              <div>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.origin.code} → {r.destination.code}</div>
              </div>
            ) },
            { header: "Type", cell: (r) => r.transportType.name },
            { header: "Category", cell: (r) => label(ROUTE_CATEGORY_LABELS, r.category) },
            { header: "Used for", cell: (r) => label(ROUTE_DIRECTION_LABELS, r.direction) },
            { header: "Duration", cell: (r) => (r.durationMinutes != null ? `${r.durationMinutes} min` : "—") },
            { header: "Departures", cell: (r) => <span className="font-mono text-xs">{r.departureSlots.join(" · ") || "—"}</span> },
          ]}
          onEdit={(r) => open("routes", r)}
          onToggleActive={(r) => toggleActive("routes", r)}
          onDelete={(r) => remove("routes", r)}
        />
      </ControlsCard>

      <ControlsCard
        title="Providers"
        description="Who runs the transfers — the property's own boats and cars, or third-party operators."
        action={addButton("providers", "Add provider")}
      >
        <ConfigList
          {...common}
          rows={config.providers}
          noun="provider"
          empty={{ icon: Users, title: "No providers yet", description: "Add your own fleet, e.g. \"Own speedboats\", and any operators you book." }}
          title={(p) => p.name}
          subtitle={(p) => label(PROVIDER_KIND_LABELS, p.kind)}
          meta={(p) => [
            { label: "Contact", value: [p.contactName, p.phone].filter(Boolean).join(" · ") || "—", wide: true },
            { label: "Vessels", value: String(p.vessels.length) },
          ]}
          columns={[
            { header: "Name", cell: (p) => p.name, className: "font-medium" },
            { header: "Type", cell: (p) => label(PROVIDER_KIND_LABELS, p.kind) },
            { header: "Contact", cell: (p) => [p.contactName, p.phone].filter(Boolean).join(" · ") || "—" },
            { header: "Vessels", cell: (p) => p.vessels.length },
          ]}
          onEdit={(p) => open("providers", p)}
          onToggleActive={(p) => toggleActive("providers", p)}
          onDelete={(p) => remove("providers", p)}
        />
      </ControlsCard>

      <ControlsCard
        title="Vessels and vehicles"
        description="Boats, seaplanes and vehicles under each provider. Seats are used for the over-capacity warning on a departure — a warning only, never a block."
        action={addButton("vessels", "Add vessel", config.providers.length === 0)}
      >
        <ConfigList
          {...common}
          rows={allVessels}
          noun="vessel"
          empty={{ icon: Ship, title: "No vessels yet", description: "Add a provider first, then its boats or vehicles with their seats." }}
          title={(v) => v.name}
          subtitle={(v) => v.provider.name}
          meta={(v) => [
            { label: "Seats", value: String(v.capacity) },
            { label: "Type", value: v.transportType?.name ?? "Any" },
          ]}
          columns={[
            { header: "Name", cell: (v) => v.name, className: "font-medium" },
            { header: "Provider", cell: (v) => v.provider.name },
            { header: "Type", cell: (v) => v.transportType?.name ?? "Any" },
            { header: "Seats", cell: (v) => v.capacity },
            { header: "Registration", cell: (v) => v.registration ?? "—" },
          ]}
          onEdit={(v) => open("vessels", v)}
          onToggleActive={(v) => toggleActive("vessels", v)}
          onDelete={(v) => remove("vessels", v)}
        />
      </ControlsCard>

      <ControlsCard
        title="Rates"
        description="What a transfer costs, per route. The most specific enabled rate is suggested on a booking (a provider's own rate first, then a transport type's). A route with no rate is complimentary. Night Audit posts billable rates on the transfer date with the rate's charge code and tax."
        action={addButton("rates", "Add rate", config.routes.length === 0)}
      >
        <ConfigList
          {...common}
          rows={config.rates}
          noun="rate"
          empty={{ icon: Receipt, title: "No rates yet", description: "Add a rate to a route — e.g. adult $120 / child $60 per person. Routes without a rate are complimentary." }}
          title={(r) => `${r.route.code}${r.name ? ` · ${r.name}` : ""}`}
          subtitle={(r) => rateSummary(r)}
          meta={(r) => [
            { label: "Applies to", value: label(ROUTE_DIRECTION_LABELS, r.direction) },
            { label: "Valid", value: validity(r) },
            { label: "Charge code", value: r.chargeCode.code },
            { label: "Billable", value: r.isBillable ? "Yes" : "No" },
          ]}
          columns={[
            { header: "Route", cell: (r) => (
              <div>
                <div className="font-medium">{r.route.code}{r.name ? ` · ${r.name}` : ""}</div>
                <div className="text-xs text-muted-foreground">
                  {[r.transportType?.name, r.provider?.name].filter(Boolean).join(" · ") || "Any type, any provider"}
                </div>
              </div>
            ) },
            { header: "Applies to", cell: (r) => label(ROUTE_DIRECTION_LABELS, r.direction) },
            { header: "Price", cell: (r) => (
              <div>
                <div className="font-mono text-sm">{rateSummary(r)}</div>
                <div className="text-xs text-muted-foreground">{label(PRICING_BASIS_LABELS, r.pricingBasis)}</div>
              </div>
            ) },
            { header: "Valid", cell: (r) => <span className="text-xs">{validity(r)}</span> },
            { header: "Charge code / tax", cell: (r) => (
              <div className="text-xs">
                <div className="font-mono">{r.chargeCode.code}</div>
                <div className="text-muted-foreground">{r.taxMode === "CUSTOM" ? r.taxProfile?.name : label(TAX_MODE_LABELS, r.taxMode)}</div>
              </div>
            ) },
            { header: "Billable", cell: (r) => (r.isBillable ? "Yes" : <Badge variant="outline">Not billed</Badge>) },
          ]}
          onEdit={(r) => open("rates", r)}
          onToggleActive={(r) => toggleActive("rates", r)}
          onDelete={(r) => remove("rates", r)}
        />
      </ControlsCard>

      {(["types", "locations", "routes", "providers", "vessels", "rates"] as const).map((entity) => {
        const props = {
          open: dialog?.entity === entity,
          onOpenChange: close,
          propertyId,
          editing: dialog?.entity === entity ? dialog.row : null,
          config,
          onSaved: load,
        }
        if (entity === "types") return <TypeDialog key={entity} {...props} />
        if (entity === "locations") return <LocationDialog key={entity} {...props} />
        if (entity === "routes") return <RouteDialog key={entity} {...props} />
        if (entity === "providers") return <ProviderDialog key={entity} {...props} />
        if (entity === "vessels") return <VesselDialog key={entity} {...props} />
        return <RateDialog key={entity} {...props} />
      })}
    </div>
  )
}
