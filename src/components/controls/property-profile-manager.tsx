"use client"

import { useState, useEffect, useCallback } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { InlineLoading } from "@/components/ui/inline-loading"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionSaveFooter } from "@/components/controls/save-status"
import { useRouter } from "next/navigation"
import { PropertyLogoUploader } from "@/components/controls/property-logo-uploader"
import {
  propertyProfileFormSchema,
  type PropertyProfileFormValues,
} from "@/lib/properties/profile-schema"

type PropertyDetail = {
  id: string
  name: string
  code: string
  legalName: string
  checkInTime: string
  checkOutTime: string
  logoUrl: string | null
  taxId: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
  starRating: number | null
}

const EMPTY: PropertyProfileFormValues = {
  name: "", legalName: "", code: "", starRating: "", checkInTime: "", checkOutTime: "",
  taxId: "", contactPhone: "", contactEmail: "", address: "",
}

function toFormValues(d: PropertyDetail): PropertyProfileFormValues {
  return {
    name: d.name ?? "",
    legalName: d.legalName ?? "",
    code: d.code ?? "",
    starRating: d.starRating == null ? "" : String(d.starRating),
    checkInTime: d.checkInTime ?? "",
    checkOutTime: d.checkOutTime ?? "",
    taxId: d.taxId ?? "",
    contactPhone: d.contactPhone ?? "",
    contactEmail: d.contactEmail ?? "",
    address: d.address ?? "",
  }
}

const FIELDS = Object.keys(EMPTY) as (keyof PropertyProfileFormValues)[]

// Edits ONE property's own profile (name, code, times, logo, contact info) — the property
// named by the Hub page it sits on. Deliberately never shows or accepts an enterprise
// selector, so a property can never be reassigned to a different enterprise from here.
// Validation (APP STANDARD 001) is the shared schema in src/lib/properties/profile-schema.ts,
// which PUT /api/properties/[id] also enforces.
export function PropertyProfileManager({ propertyId }: { propertyId: string }) {
  const router = useRouter()
  const [detail, setDetail] = useState<PropertyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [savedMsg, setSavedMsg] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<PropertyProfileFormValues>({
    resolver: zodResolver(propertyProfileFormSchema),
    mode: "onChange",
    defaultValues: EMPTY,
  })

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/properties")
      if (res.ok) {
        const list: PropertyDetail[] = await res.json()
        const found = list.find((p) => p.id === propertyId) ?? null
        setDetail(found)
        if (found) form.reset(toFormValues(found))
      }
    } finally {
      setLoading(false)
    }
  }, [propertyId, form])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  const onSubmit = async (values: PropertyProfileFormValues) => {
    if (!detail) return
    setSavedMsg(false)
    setServerError(null)
    const res = await fetch(`/api/properties/${detail.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // Only the fields this form edits — the property's tax basis (Finance), check-in rule
      // (Rooms & Inventory) and Night Audit settings are saved on their own pages, and
      // sending the stale copies loaded here would overwrite a change made there.
      body: JSON.stringify({
        ...values,
        code: values.code.toUpperCase(),
        starRating: values.starRating === "" ? null : Number(values.starRating),
      }),
    })
    if (res.ok) {
      const saved = await res.json().catch(() => null)
      if (saved) {
        setDetail((d) => (d ? { ...d, ...saved } : d))
        form.reset(toFormValues({ ...detail, ...saved }))
      }
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 3000)
      // The band and sidebar name this property — refresh them if the name changed.
      router.refresh()
      return
    }
    const data = await res.json().catch(() => ({}))
    // 400 (validation) and 409 (short code already in use) carry per-field messages —
    // show them on the inputs; anything else goes above the Save button.
    const fieldErrors: Record<string, string> = data?.fieldErrors ?? {}
    let placed = false
    for (const [key, message] of Object.entries(fieldErrors)) {
      if ((FIELDS as string[]).includes(key)) {
        form.setError(key as keyof PropertyProfileFormValues, { type: "server", message }, { shouldFocus: !placed })
        placed = true
      }
    }
    if (!placed) setServerError(data?.error ?? "Couldn't save the property. Try again.")
  }

  if (loading) return <InlineLoading className="py-8" label="Loading property" />
  if (!detail) return <EmptyState size="inline" className="py-8" title="No property found. Create one under Inventory first." />

  const saving = form.formState.isSubmitting
  // One Save for the section, disabled until something changed; "Saved" after a save.
  const status = form.formState.isDirty ? "dirty" : savedMsg ? "saved" : "idle"

  const text = (name: keyof PropertyProfileFormValues, label: string, opts: { placeholder?: string; type?: string; description?: string; className?: string; upper?: boolean; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"] } = {}) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={opts.className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type={opts.type ?? "text"}
              inputMode={opts.inputMode}
              placeholder={opts.placeholder}
              {...field}
              onChange={(e) => field.onChange(opts.upper ? e.target.value.toUpperCase() : e.target.value)}
            />
          </FormControl>
          {opts.description && <FormDescription>{opts.description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )

  return (
    <div className="space-y-6">
      {/* Saved on its own the moment it's uploaded — not by the section's Save. Kept outside
          the <form> so its buttons can never submit the profile. */}
      <PropertyLogoUploader
        propertyId={detail.id}
        logoUrl={detail.logoUrl}
        onChange={(logoUrl) => {
          setDetail({ ...detail, logoUrl })
          // The header and band show the logo — refresh them.
          router.refresh()
        }}
      />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {text("name", "Property name")}
            {text("legalName", "Legal name")}
            {text("code", "Short code", { placeholder: "e.g. SGH", upper: true, description: "Letters, digits or dashes (up to 12). Must be unique." })}
            {text("starRating", "Star rating", { placeholder: "0–5 (optional)", inputMode: "numeric" })}
            {text("checkInTime", "Check-in time", { placeholder: "14:00", description: "24-hour HH:MM" })}
            {text("checkOutTime", "Check-out time", { placeholder: "11:00", description: "24-hour HH:MM" })}
            {text("taxId", "Tax ID")}
            {text("contactPhone", "Contact phone", { type: "tel", placeholder: "Optional" })}
            {text("contactEmail", "Contact email", { type: "email", placeholder: "Optional" })}
            {text("address", "Address", {
              className: "md:col-span-2",
              placeholder: "e.g. North Male Atoll, Maldives",
              description: "Shown on every printed stationery header (invoices, receipts, letters, registration cards, statements).",
            })}
          </div>
          <p className="text-xs text-muted-foreground">The enterprise this property belongs to cannot be changed here.</p>

          {serverError && <p className="text-sm text-destructive" role="alert">{serverError}</p>}
          <SectionSaveFooter status={status} saving={saving} />
        </form>
      </Form>
    </div>
  )
}
