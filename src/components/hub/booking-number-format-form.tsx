"use client"

import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Save } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { formatConfirmationNumber } from "@/lib/confirmation-number"

// One property's booking (confirmation) number format — prefix + zero-padded counter.
// Per property since 2026-09-23; the counter itself is the property's REGISTRATION_NO
// sequence (this property's Sequences page). Server-side validation mirrors this schema
// (propertySettingsPatchSchema in src/lib/property-settings.ts).
const schema = z.object({
  resConfirmPrefix: z
    .string()
    .max(12, "Keep the prefix to 12 characters or fewer")
    .regex(/^[A-Za-z0-9-_/]*$/, "Letters, numbers, - _ / only"),
  resConfirmLength: z.coerce
    .number({ message: "Enter a number" })
    .int("Whole numbers only")
    .min(3, "At least 3 digits")
    .max(12, "At most 12 digits"),
})

type FormInput = z.input<typeof schema>
type FormValues = z.output<typeof schema>

export function BookingNumberFormatForm({
  propertyId,
  propertyCode,
  nextNumber = 1,
}: {
  propertyId: string
  propertyCode: string
  /** The REGISTRATION_NO counter + 1 — the number the next booking will be given. */
  nextNumber?: number
}) {
  const [loading, setLoading] = useState(true)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { resConfirmPrefix: "", resConfirmLength: 6 },
  })

  useEffect(() => {
    setLoading(true)
    fetch(`/api/properties/${propertyId}/settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) form.reset({ resConfirmPrefix: data.resConfirmPrefix ?? "", resConfirmLength: data.resConfirmLength ?? 6 })
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const onSubmit = async (values: FormValues) => {
    setServerError(null)
    setSaved(false)
    const res = await fetch(`/api/properties/${propertyId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    if (res.ok) {
      setSaved(true)
      form.reset(values)
    } else {
      const body = await res.json().catch(() => null)
      setServerError(body?.error || "Couldn't save the booking number format.")
    }
  }

  const prefix = form.watch("resConfirmPrefix") ?? ""
  const length = Number(form.watch("resConfirmLength"))
  const preview = formatConfirmationNumber(
    { resConfirmPrefix: prefix.toUpperCase(), resConfirmLength: Number.isInteger(length) && length >= 3 && length <= 12 ? length : 6 },
    propertyCode,
    nextNumber
  )

  if (loading) return <Skeleton className="h-32 w-full rounded-lg" />

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 max-w-2xl">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="resConfirmPrefix"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Prefix</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={`${propertyCode}-`}
                    className="font-mono uppercase"
                    onChange={(e) => {
                      setSaved(false)
                      field.onChange(e.target.value.toUpperCase())
                    }}
                  />
                </FormControl>
                <FormDescription>Leave empty to use this property&apos;s code ({propertyCode}-).</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="resConfirmLength"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Number of digits</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={3}
                    max={12}
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    value={field.value === undefined || field.value === null ? "" : String(field.value)}
                    onChange={(e) => {
                      setSaved(false)
                      field.onChange(e.target.value)
                    }}
                  />
                </FormControl>
                <FormDescription>The counter is zero-padded to this length.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Next booking will look like </span>
          <span className="font-mono font-semibold text-foreground">{preview}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!form.formState.isValid || !form.formState.isDirty || form.formState.isSubmitting}>
            <Save className="mr-2 h-4 w-4" /> Save format
          </Button>
          {saved && <span className="text-sm text-success">Saved — new bookings at this property use this format.</span>}
          {serverError && <span className="text-sm text-destructive">{serverError}</span>}
        </div>
      </form>
    </Form>
  )
}
