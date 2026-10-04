"use client"

import { useEffect, useState, type ReactNode } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, type FieldValues, type UseFormReturn } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { OptionSelect } from "@/components/ui/option-select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { DatePicker } from "@/components/ui/date-picker"
import { SubmitButton } from "@/components/ui/submit-button"
import { apiError } from "@/lib/api-error"
import { toast } from "@/lib/toast"
import { chargeCodeOptions } from "@/lib/charge-code-options"
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
  PRICING_BASES,
  PRICING_BASIS_LABELS,
  PROVIDER_KINDS,
  PROVIDER_KIND_LABELS,
  ROUTE_CATEGORIES,
  ROUTE_CATEGORY_LABELS,
  ROUTE_DIRECTIONS,
  ROUTE_DIRECTION_LABELS,
  TAX_MODES,
  TAX_MODE_LABELS,
  TRANSPORT_MODES,
  TRANSPORT_MODE_LABELS,
  HHMM,
} from "@/lib/transport/constants"
import type {
  TransportConfig,
  TransportLocationDto,
  TransportProviderDto,
  TransportRateDto,
  TransportRouteDto,
  TransportTypeDto,
  TransportVesselDto,
} from "@/components/hub/transport/types"

// The six Transportation setup forms (APP STANDARD 001: Zod + React Hook Form, inline
// errors as you type). Each posts to /api/transport/config/{entity}; the API is the
// authority and repeats every rule.

export type DialogProps<T> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  propertyId: string
  editing: T | null
  config: TransportConfig
  onSaved: () => void
}

const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>) => keys.map((k) => ({ value: k, label: labels[k] }))
const codeField = z.string().trim().min(2, "At least 2 characters").max(12).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only")
const nameField = z.string().trim().min(2, "At least 2 characters").max(80)
const numberString = (min: number, max: number, msg = `Between ${min} and ${max}`) =>
  z.string().trim().refine((v) => v !== "" && !isNaN(Number(v)) && Number(v) >= min && Number(v) <= max, msg)
const optionalNumberString = (min: number, max: number) =>
  z.string().trim().refine((v) => v === "" || (!isNaN(Number(v)) && Number(v) >= min && Number(v) <= max), `Between ${min} and ${max}`)

async function saveEntity(propertyId: string, entity: string, id: string | null, payload: Record<string, unknown>): Promise<string | null> {
  const url = id
    ? `/api/transport/config/${entity}/${id}?propertyId=${propertyId}`
    : `/api/transport/config/${entity}?propertyId=${propertyId}`
  const res = await fetch(url, {
    method: id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (res.ok) return null
  return apiError(res, "Couldn't save. Try again.")
}

function EntityDialog<V extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  form,
  onSubmit,
  children,
  size = "md",
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: string
  form: UseFormReturn<V>
  onSubmit: (values: V) => Promise<string | null>
  children: ReactNode
  size?: "md" | "lg"
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (open) setError(null)
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size}>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(async (v) => {
              setPending(true)
              setError(null)
              try {
                const err = await onSubmit(v)
                if (err) setError(err)
              } finally {
                setPending(false)
              }
            })}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {children}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <SubmitButton pending={pending}>Save</SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function ActiveSwitch({ form, label = "Active" }: { form: UseFormReturn<any>; label?: string }) {
  return (
    <FormField
      control={form.control}
      name="isActive"
      render={({ field }) => (
        <FormItem className="flex items-center gap-3">
          <FormControl>
            <Switch checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
          <FormLabel className="!mt-0 cursor-pointer font-normal">{label}</FormLabel>
        </FormItem>
      )}
    />
  )
}

function TextField({ form, name, label, placeholder, upper, type }: { form: UseFormReturn<any>; name: string; label: string; placeholder?: string; upper?: boolean; type?: string }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type={type}
              placeholder={placeholder}
              {...field}
              value={field.value ?? ""}
              onChange={(e) => field.onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function SelectField({
  form,
  name,
  label,
  options,
  placeholder,
}: {
  form: UseFormReturn<any>
  name: string
  label: string
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <OptionSelect value={field.value ?? ""} onChange={field.onChange} options={options} placeholder={placeholder} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

// ── Transport type ─────────────────────────────────────────────────────────────────────

const typeForm = z.object({
  code: codeField,
  name: nameField,
  mode: z.enum(TRANSPORT_MODES),
  requiresFlightDetails: z.boolean(),
  isActive: z.boolean(),
})

export function TypeDialog({ open, onOpenChange, propertyId, editing, onSaved }: DialogProps<TransportTypeDto>) {
  const form = useForm<z.infer<typeof typeForm>>({ resolver: zodResolver(typeForm), mode: "onChange" })
  useEffect(() => {
    if (open)
      form.reset(
        editing
          ? { code: editing.code, name: editing.name, mode: editing.mode as never, requiresFlightDetails: editing.requiresFlightDetails, isActive: editing.isActive }
          : { code: "", name: "", mode: "SPEEDBOAT", requiresFlightDetails: false, isActive: true }
      )
  }, [open, editing, form])
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit transport type" : "Add transport type"}
      description="How guests travel — e.g. SPB Speedboat, SPL Seaplane."
      form={form}
      onSubmit={async (v) => {
        const err = await saveEntity(propertyId, "types", editing?.id ?? null, v)
        if (!err) {
          toast.success("Transport type saved")
          onOpenChange(false)
          onSaved()
        }
        return err
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <TextField form={form} name="code" label="Code *" placeholder="SPB" upper />
        <TextField form={form} name="name" label="Name *" placeholder="Speedboat" />
      </div>
      <SelectField form={form} name="mode" label="Mode *" options={opts(TRANSPORT_MODES, TRANSPORT_MODE_LABELS)} />
      <FormField
        control={form.control}
        name="requiresFlightDetails"
        render={({ field }) => (
          <FormItem className="flex items-center gap-3">
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormLabel className="!mt-0 cursor-pointer font-normal">Needs flight details (shows the airport leg on a booking)</FormLabel>
          </FormItem>
        )}
      />
      <ActiveSwitch form={form} />
    </EntityDialog>
  )
}

// ── Location ───────────────────────────────────────────────────────────────────────────

const locationForm = z.object({
  code: codeField,
  name: nameField,
  type: z.enum(LOCATION_TYPES),
  notes: z.string().max(500),
  isActive: z.boolean(),
})

export function LocationDialog({ open, onOpenChange, propertyId, editing, onSaved }: DialogProps<TransportLocationDto>) {
  const form = useForm<z.infer<typeof locationForm>>({ resolver: zodResolver(locationForm), mode: "onChange" })
  useEffect(() => {
    if (open)
      form.reset(
        editing
          ? { code: editing.code, name: editing.name, type: editing.type as never, notes: editing.notes ?? "", isActive: editing.isActive }
          : { code: "", name: "", type: "JETTY", notes: "", isActive: true }
      )
  }, [open, editing, form])
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit location" : "Add location"}
      description="A place transfers start or end — e.g. MLE Velana International Airport."
      form={form}
      onSubmit={async (v) => {
        const err = await saveEntity(propertyId, "locations", editing?.id ?? null, v)
        if (!err) {
          toast.success("Location saved")
          onOpenChange(false)
          onSaved()
        }
        return err
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <TextField form={form} name="code" label="Code *" placeholder="MLE" upper />
        <TextField form={form} name="name" label="Name *" placeholder="Velana International Airport" />
      </div>
      <SelectField form={form} name="type" label="Type *" options={opts(LOCATION_TYPES, LOCATION_TYPE_LABELS)} />
      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Notes</FormLabel>
            <FormControl>
              <Textarea rows={2} placeholder="Meeting point, opening hours…" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <ActiveSwitch form={form} />
    </EntityDialog>
  )
}

// ── Route ──────────────────────────────────────────────────────────────────────────────

const routeForm = z
  .object({
    code: codeField,
    name: nameField,
    originId: z.string().min(1, "Choose the origin"),
    destinationId: z.string().min(1, "Choose the destination"),
    transportTypeId: z.string().min(1, "Choose the transport type"),
    category: z.enum(ROUTE_CATEGORIES),
    direction: z.enum(ROUTE_DIRECTIONS),
    durationMinutes: optionalNumberString(0, 1440),
    instructions: z.string().max(1000),
    departureSlots: z
      .string()
      .refine((v) => v.trim() === "" || v.split(",").every((s) => HHMM.test(s.trim())), "Times as HH:MM, separated by commas"),
    isActive: z.boolean(),
  })
  .refine((v) => v.originId !== v.destinationId, { message: "Origin and destination must differ", path: ["destinationId"] })

export function RouteDialog({ open, onOpenChange, propertyId, editing, config, onSaved }: DialogProps<TransportRouteDto>) {
  const form = useForm<z.infer<typeof routeForm>>({ resolver: zodResolver(routeForm), mode: "onChange" })
  useEffect(() => {
    if (open)
      form.reset(
        editing
          ? {
              code: editing.code,
              name: editing.name,
              originId: editing.originId,
              destinationId: editing.destinationId,
              transportTypeId: editing.transportTypeId,
              category: editing.category as never,
              direction: editing.direction as never,
              durationMinutes: editing.durationMinutes != null ? String(editing.durationMinutes) : "",
              instructions: editing.instructions ?? "",
              departureSlots: editing.departureSlots.join(", "),
              isActive: editing.isActive,
            }
          : {
              code: "",
              name: "",
              originId: "",
              destinationId: "",
              transportTypeId: "",
              category: "AIRPORT_TRANSFER",
              direction: "BOTH",
              durationMinutes: "",
              instructions: "",
              departureSlots: "",
              isActive: true,
            }
      )
  }, [open, editing, form])
  const locations = config.locations.filter((l) => l.isActive || l.id === editing?.originId || l.id === editing?.destinationId)
  const locOptions = locations.map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` }))
  const typeOptions = config.types
    .filter((t) => t.isActive || t.id === editing?.transportTypeId)
    .map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? "Edit route" : "Add route"}
      description="From where to where, by what. Default departure times are suggestions and can create a day's departures."
      form={form}
      onSubmit={async (v) => {
        const err = await saveEntity(propertyId, "routes", editing?.id ?? null, {
          ...v,
          durationMinutes: v.durationMinutes === "" ? null : Number(v.durationMinutes),
          departureSlots: v.departureSlots.split(",").map((s) => s.trim()).filter(Boolean),
        })
        if (!err) {
          toast.success("Route saved")
          onOpenChange(false)
          onSaved()
        }
        return err
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <TextField form={form} name="code" label="Code *" placeholder="MLE-RES" upper />
        <TextField form={form} name="name" label="Name *" placeholder="Airport to resort" />
        <SelectField form={form} name="originId" label="From *" options={locOptions} placeholder="Select origin…" />
        <SelectField form={form} name="destinationId" label="To *" options={locOptions} placeholder="Select destination…" />
        <SelectField form={form} name="transportTypeId" label="Transport type *" options={typeOptions} placeholder="Select type…" />
        <SelectField form={form} name="category" label="Category *" options={opts(ROUTE_CATEGORIES, ROUTE_CATEGORY_LABELS)} />
        <SelectField form={form} name="direction" label="Used for *" options={opts(ROUTE_DIRECTIONS, ROUTE_DIRECTION_LABELS)} />
        <TextField form={form} name="durationMinutes" label="Duration (minutes)" placeholder="45" type="number" />
      </div>
      <TextField form={form} name="departureSlots" label="Default departure times" placeholder="10:00, 14:00, 17:00" />
      <FormField
        control={form.control}
        name="instructions"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Instructions</FormLabel>
            <FormControl>
              <Textarea rows={2} placeholder="Meet at counter 3, arrivals hall…" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <ActiveSwitch form={form} />
    </EntityDialog>
  )
}

// ── Provider ───────────────────────────────────────────────────────────────────────────

const providerForm = z.object({
  name: nameField,
  kind: z.enum(PROVIDER_KINDS),
  contactName: z.string().max(80),
  phone: z.string().max(40),
  email: z.string().trim().refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email"),
  notes: z.string().max(500),
  isActive: z.boolean(),
})

export function ProviderDialog({ open, onOpenChange, propertyId, editing, onSaved }: DialogProps<TransportProviderDto>) {
  const form = useForm<z.infer<typeof providerForm>>({ resolver: zodResolver(providerForm), mode: "onChange" })
  useEffect(() => {
    if (open)
      form.reset(
        editing
          ? {
              name: editing.name,
              kind: editing.kind as never,
              contactName: editing.contactName ?? "",
              phone: editing.phone ?? "",
              email: editing.email ?? "",
              notes: editing.notes ?? "",
              isActive: editing.isActive,
            }
          : { name: "", kind: "OWN", contactName: "", phone: "", email: "", notes: "", isActive: true }
      )
  }, [open, editing, form])
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit provider" : "Add provider"}
      description="Who runs the transfer — the property's own boats or a third-party operator."
      form={form}
      onSubmit={async (v) => {
        const err = await saveEntity(propertyId, "providers", editing?.id ?? null, v)
        if (!err) {
          toast.success("Provider saved")
          onOpenChange(false)
          onSaved()
        }
        return err
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <TextField form={form} name="name" label="Name *" placeholder="Own speedboats" />
        <SelectField form={form} name="kind" label="Type *" options={opts(PROVIDER_KINDS, PROVIDER_KIND_LABELS)} />
        <TextField form={form} name="contactName" label="Contact" />
        <TextField form={form} name="phone" label="Phone" type="tel" />
      </div>
      <TextField form={form} name="email" label="Email" type="email" />
      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Notes</FormLabel>
            <FormControl>
              <Textarea rows={2} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <ActiveSwitch form={form} />
    </EntityDialog>
  )
}

// ── Vessel / vehicle ───────────────────────────────────────────────────────────────────

const vesselForm = z.object({
  providerId: z.string().min(1, "Choose the provider"),
  name: nameField,
  transportTypeId: z.string(),
  capacity: numberString(1, 500, "1 to 500 seats"),
  registration: z.string().max(40),
  isActive: z.boolean(),
})

export function VesselDialog({ open, onOpenChange, propertyId, editing, config, onSaved }: DialogProps<TransportVesselDto>) {
  const form = useForm<z.infer<typeof vesselForm>>({ resolver: zodResolver(vesselForm), mode: "onChange" })
  useEffect(() => {
    if (open)
      form.reset(
        editing
          ? {
              providerId: editing.providerId,
              name: editing.name,
              transportTypeId: editing.transportTypeId ?? "",
              capacity: String(editing.capacity),
              registration: editing.registration ?? "",
              isActive: editing.isActive,
            }
          : { providerId: config.providers.find((p) => p.isActive)?.id ?? "", name: "", transportTypeId: "", capacity: "12", registration: "", isActive: true }
      )
  }, [open, editing, form, config.providers])
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit vessel or vehicle" : "Add vessel or vehicle"}
      description="Seats drive the over-capacity warning on a departure."
      form={form}
      onSubmit={async (v) => {
        const err = await saveEntity(propertyId, "vessels", editing?.id ?? null, {
          ...v,
          capacity: Number(v.capacity),
          transportTypeId: v.transportTypeId || null,
        })
        if (!err) {
          toast.success("Vessel saved")
          onOpenChange(false)
          onSaved()
        }
        return err
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          form={form}
          name="providerId"
          label="Provider *"
          options={config.providers.filter((p) => p.isActive || p.id === editing?.providerId).map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Select provider…"
        />
        <TextField form={form} name="name" label="Name *" placeholder="Blue Marlin" />
        <SelectField
          form={form}
          name="transportTypeId"
          label="Transport type"
          options={[{ value: "", label: "Any" }, ...config.types.filter((t) => t.isActive || t.id === editing?.transportTypeId).map((t) => ({ value: t.id, label: t.name }))]}
        />
        <TextField form={form} name="capacity" label="Seats *" type="number" />
      </div>
      <TextField form={form} name="registration" label="Registration" />
      <ActiveSwitch form={form} />
    </EntityDialog>
  )
}

// ── Rate ───────────────────────────────────────────────────────────────────────────────

const price = numberString(0, 1_000_000, "A number, 0 or more")
const rateForm = z
  .object({
    routeId: z.string().min(1, "Choose the route"),
    name: z.string().max(80),
    direction: z.enum(ROUTE_DIRECTIONS),
    pricingBasis: z.enum(PRICING_BASES),
    price,
    adultPrice: price,
    childPrice: price,
    infantPrice: price,
    childMinAge: numberString(0, 17),
    childMaxAge: numberString(0, 17),
    validFrom: z.string(),
    validTo: z.string(),
    transportTypeId: z.string(),
    providerId: z.string(),
    chargeCodeId: z.string().min(1, "Choose the charge code"),
    taxMode: z.enum(TAX_MODES),
    taxProfileId: z.string(),
    isBillable: z.boolean(),
    isActive: z.boolean(),
  })
  .refine((v) => Number(v.childMaxAge) >= Number(v.childMinAge), { message: "At least the minimum age", path: ["childMaxAge"] })
  .refine((v) => !v.validFrom || !v.validTo || v.validTo >= v.validFrom, { message: "End date is before start date", path: ["validTo"] })
  .refine((v) => v.taxMode !== "CUSTOM" || !!v.taxProfileId, { message: "Choose a tax profile", path: ["taxProfileId"] })

export function RateDialog({ open, onOpenChange, propertyId, editing, config, onSaved }: DialogProps<TransportRateDto>) {
  const form = useForm<z.infer<typeof rateForm>>({ resolver: zodResolver(rateForm), mode: "onChange" })
  const s = config.settings
  useEffect(() => {
    if (!open) return
    form.reset(
      editing
        ? {
            routeId: editing.routeId,
            name: editing.name ?? "",
            direction: editing.direction as never,
            pricingBasis: editing.pricingBasis as never,
            price: String(editing.price),
            adultPrice: String(editing.adultPrice),
            childPrice: String(editing.childPrice),
            infantPrice: String(editing.infantPrice),
            childMinAge: String(editing.childMinAge),
            childMaxAge: String(editing.childMaxAge),
            validFrom: editing.validFrom ?? "",
            validTo: editing.validTo ?? "",
            transportTypeId: editing.transportTypeId ?? "",
            providerId: editing.providerId ?? "",
            chargeCodeId: editing.chargeCodeId,
            taxMode: editing.taxMode as never,
            taxProfileId: editing.taxProfileId ?? "",
            isBillable: editing.isBillable,
            isActive: editing.isActive,
          }
        : {
            routeId: "",
            name: "",
            direction: "BOTH",
            pricingBasis: "PER_PERSON",
            price: "0",
            adultPrice: "0",
            childPrice: "0",
            infantPrice: "0",
            childMinAge: "2",
            childMaxAge: "11",
            validFrom: "",
            validTo: "",
            transportTypeId: "",
            providerId: "",
            chargeCodeId: s.defaultChargeCodeId ?? "",
            taxMode: (s.defaultTaxMode as never) ?? "CHARGE_CODE",
            taxProfileId: s.defaultTaxProfileId ?? "",
            isBillable: true,
            isActive: true,
          }
    )
  }, [open, editing, form, s.defaultChargeCodeId, s.defaultTaxMode, s.defaultTaxProfileId])
  const basis = form.watch("pricingBasis")
  const taxMode = form.watch("taxMode")
  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? "Edit rate" : "Add rate"}
      description="Prices are entered the way every price at this property is — including or excluding tax per the Finance setting."
      form={form}
      onSubmit={async (v) => {
        const err = await saveEntity(propertyId, "rates", editing?.id ?? null, {
          ...v,
          name: v.name || null,
          price: Number(v.price),
          adultPrice: Number(v.adultPrice),
          childPrice: Number(v.childPrice),
          infantPrice: Number(v.infantPrice),
          childMinAge: Number(v.childMinAge),
          childMaxAge: Number(v.childMaxAge),
          validFrom: v.validFrom || null,
          validTo: v.validTo || null,
          transportTypeId: v.transportTypeId || null,
          providerId: v.providerId || null,
          taxProfileId: v.taxMode === "CUSTOM" ? v.taxProfileId : null,
        })
        if (!err) {
          toast.success("Rate saved")
          onOpenChange(false)
          onSaved()
        }
        return err
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField
          form={form}
          name="routeId"
          label="Route *"
          options={config.routes.filter((r) => r.isActive || r.id === editing?.routeId).map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))}
          placeholder="Select route…"
        />
        <TextField form={form} name="name" label="Label" placeholder="High season" />
        <SelectField form={form} name="direction" label="Applies to *" options={opts(ROUTE_DIRECTIONS, ROUTE_DIRECTION_LABELS)} />
        <SelectField form={form} name="pricingBasis" label="Pricing *" options={opts(PRICING_BASES, PRICING_BASIS_LABELS)} />
      </div>
      {basis === "PER_PERSON" ? (
        <div className="grid grid-cols-3 gap-3">
          <TextField form={form} name="adultPrice" label="Adult $" type="number" />
          <TextField form={form} name="childPrice" label="Child $" type="number" />
          <TextField form={form} name="infantPrice" label="Infant $" type="number" />
          <TextField form={form} name="childMinAge" label="Child from age" type="number" />
          <TextField form={form} name="childMaxAge" label="Child to age" type="number" />
        </div>
      ) : (
        <TextField form={form} name="price" label={basis === "PER_VEHICLE" ? "Price per vehicle $" : "Price per trip $"} type="number" />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          control={form.control}
          name="validFrom"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Valid from</FormLabel>
              <FormControl>
                <DatePicker value={field.value || null} onChange={field.onChange} placeholder="Always" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="validTo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Valid to</FormLabel>
              <FormControl>
                <DatePicker value={field.value || null} onChange={field.onChange} placeholder="Open-ended" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <SelectField
          form={form}
          name="transportTypeId"
          label="Only for transport type"
          options={[{ value: "", label: "Any" }, ...config.types.map((t) => ({ value: t.id, label: t.name }))]}
        />
        <SelectField
          form={form}
          name="providerId"
          label="Only for provider"
          options={[{ value: "", label: "Any" }, ...config.providers.map((p) => ({ value: p.id, label: p.name }))]}
        />
      </div>
      <FormField
        control={form.control}
        name="chargeCodeId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Charge code *</FormLabel>
            <FormControl>
              <SearchableSelect
                value={field.value}
                onChange={field.onChange}
                placeholder="Select charge code…"
                options={chargeCodeOptions(config.chargeCodes, { includeInactive: false })}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField form={form} name="taxMode" label="Tax" options={opts(TAX_MODES, TAX_MODE_LABELS)} />
        {taxMode === "CUSTOM" && (
          <SelectField
            form={form}
            name="taxProfileId"
            label="Tax profile *"
            options={config.taxProfiles.map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Select tax profile…"
          />
        )}
      </div>
      <FormField
        control={form.control}
        name="isBillable"
        render={({ field }) => (
          <FormItem className="flex items-center gap-3">
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormLabel className="!mt-0 cursor-pointer font-normal">Billable — Night Audit posts it to the guest folio</FormLabel>
          </FormItem>
        )}
      />
      <ActiveSwitch form={form} label="Enabled" />
    </EntityDialog>
  )
}
