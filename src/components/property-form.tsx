"use client"

import { todayKey } from "@/lib/date-only"
import { useEffect, useMemo, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Switch } from "@/components/ui/switch"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { toast } from "@/lib/toast"
import {
  DEFAULT_PROPERTY_CURRENCY,
  DEFAULT_PROPERTY_TIME_ZONE,
  isValidTimeZone,
  timeZoneOptions,
} from "@/lib/properties/property-input"
import { PROFILE_MESSAGES, PROPERTY_CODE } from "@/lib/properties/profile-schema"

const propertyFormSchema = z.object({
  name: z.string().trim().min(2, { message: PROFILE_MESSAGES.name }),
  code: z.string().trim().toUpperCase().regex(PROPERTY_CODE, PROFILE_MESSAGES.code),
  legalName: z.string().trim().min(2, { message: PROFILE_MESSAGES.legalName }),
  // Currency and time zone are chosen here, at creation (they used to be missing, so every
  // tenant-added property silently became USD/UTC). Editable while PENDING / REJECTED;
  // read-only once ACTIVE — the API refuses a change then (src/app/api/properties/[id]).
  defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "3-letter code, e.g. USD or MVR"),
  timeZone: z
    .string()
    .trim()
    .min(1, { message: "Pick the property's time zone." })
    .refine(isValidTimeZone, "Pick a valid time zone."),
  checkInTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Must be in HH:MM format"),
  checkOutTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Must be in HH:MM format"),
  // The day the property starts operating in OstaStay — it becomes the initial
  // business date, which Night Audit then rolls forward. Create-only: once the
  // property is live, moving the business date is Night Audit's job, not a form's.
  goLiveDate: z.string().min(1, { message: "Pick the go-live date." }).optional(),
  // Create-only: which add-on modules THIS property offers. Its chart of accounts is
  // seeded with Spa / Excursions codes only when it does (each property keeps its own
  // chart — .agents/docs/HUB_SETUP_PLAN.md). Adding one later is harmless.
  offersSpa: z.boolean().optional(),
  offersExcursions: z.boolean().optional(),
})

type PropertyFormValues = z.infer<typeof propertyFormSchema>

const emptyValues = (): PropertyFormValues => ({
  name: "",
  code: "",
  legalName: "",
  defaultCurrency: DEFAULT_PROPERTY_CURRENCY,
  timeZone: DEFAULT_PROPERTY_TIME_ZONE,
  checkInTime: "14:00",
  checkOutTime: "11:00",
  goLiveDate: todayKey(),
  offersSpa: true,
  offersExcursions: true,
})

// The edit dialog is handed the whole Property row from GET /api/properties — pick the
// fields this form edits (a null legal name etc. would otherwise block the save).
function toFormValues(p: any): PropertyFormValues {
  return {
    name: p.name ?? "",
    code: p.code ?? "",
    legalName: p.legalName ?? "",
    defaultCurrency: p.defaultCurrency ?? DEFAULT_PROPERTY_CURRENCY,
    timeZone: p.timeZone ?? DEFAULT_PROPERTY_TIME_ZONE,
    checkInTime: p.checkInTime ?? "14:00",
    checkOutTime: p.checkOutTime ?? "11:00",
  }
}

export function PropertyForm({
  onSuccess,
  initialData,
  addons = { spa: false, excursions: false },
}: {
  onSuccess?: () => void
  initialData?: any
  // The add-ons the enterprise holds — only those are offered as per-property choices.
  addons?: { spa: boolean; excursions: boolean }
}) {
  const isEditing = !!initialData
  // Once live, currency and time zone are fixed — shown, not editable.
  const regionalLocked = isEditing && initialData?.status === "ACTIVE"
  const zones = useMemo(() => timeZoneOptions().map((tz) => ({ label: tz.replace(/_/g, " "), value: tz })), [])
  // The server's answer to a failed save (duplicate code 409, plan limit 403, validation
  // 400) — shown above the button as well as in a toast, so it outlives the toast.
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<PropertyFormValues>({
    resolver: zodResolver(propertyFormSchema),
    mode: "onChange",
    defaultValues: initialData ? toFormValues(initialData) : emptyValues(),
  })

  useEffect(() => {
    setServerError(null)
    form.reset(initialData ? toFormValues(initialData) : emptyValues())
  }, [initialData, form])

  async function onSubmit(values: PropertyFormValues) {
    setServerError(null)
    const url = isEditing ? `/api/properties/${initialData.id}` : '/api/properties'
    const method = isEditing ? 'PUT' : 'POST'
    // A live property's currency / zone are not sent at all — there is nothing to change.
    const { defaultCurrency, timeZone, ...rest } = values
    const body = regionalLocked ? rest : { ...rest, defaultCurrency, timeZone }
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const message: string = data?.error ?? `Could not ${isEditing ? 'update' : 'create'} the property.`
        // Field-level messages (validation, duplicate code) also go on their inputs.
        const fieldErrors: Record<string, string> = data?.fieldErrors ?? {}
        for (const [key, msg] of Object.entries(fieldErrors)) {
          if (key in propertyFormSchema.shape) {
            form.setError(key as keyof PropertyFormValues, { type: "server", message: msg })
          }
        }
        setServerError(message)
        toast.error(message)
        return
      }

      toast.success(isEditing ? `Property "${values.name}" updated` : `Property "${values.name}" submitted for approval`)
      form.reset()
      if (onSuccess) onSuccess()
    } catch (error) {
      console.error(error)
      const message = "Could not reach the server. Check the connection and try again."
      setServerError(message)
      toast.error(message)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Property name</FormLabel>
                <FormControl>
                  <Input placeholder="Sunset Guest House" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Short code</FormLabel>
                <FormControl>
                  <Input placeholder="SGH" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="legalName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Legal entity name</FormLabel>
              <FormControl>
                <Input placeholder="Sunset Hospitality LLC" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {regionalLocked ? (
          <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Currency</p>
              <p className="font-medium">{initialData.defaultCurrency}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Time zone</p>
              <p className="font-medium">{initialData.timeZone}</p>
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">
              Fixed once the property is active — its amounts and business dates depend on them.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="defaultCurrency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="USD"
                      maxLength={3}
                      {...field}
                      onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="timeZone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Time zone</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Select time zone..."
                      searchPlaceholder="Search time zones..."
                      options={zones}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="checkInTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Check-in time</FormLabel>
                <FormControl>
                  <Input placeholder="14:00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="checkOutTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Check-out time</FormLabel>
                <FormControl>
                  <Input placeholder="11:00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {/* Create only — after go-live the business date belongs to Night Audit. */}
        {!isEditing && (
          <FormField
            control={form.control}
            name="goLiveDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Go-live date</FormLabel>
                <FormControl>
                  <DatePicker value={field.value ?? ""} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        {!isEditing && (addons.spa || addons.excursions) && (
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-sm font-medium">This property offers</p>
            {addons.spa && (
              <FormField
                control={form.control}
                name="offersSpa"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="!mt-0 font-normal">Spa</FormLabel>
                  </FormItem>
                )}
              />
            )}
            {addons.excursions && (
              <FormField
                control={form.control}
                name="offersExcursions"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="!mt-0 font-normal">Excursions</FormLabel>
                  </FormItem>
                )}
              />
            )}
            <p className="text-xs text-muted-foreground">
              Its charge codes are set up to match — a property without a spa gets no spa codes.
            </p>
          </div>
        )}
        {serverError && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {serverError}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Saving...' : isEditing ? 'Update property' : 'Create property'}
        </Button>
      </form>
    </Form>
  )
}
