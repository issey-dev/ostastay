"use client"

import { todayKey } from "@/lib/date-only"
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

const propertyFormSchema = z.object({
  name: z.string().min(2, { message: "Property name must be at least 2 characters." }),
  code: z.string().min(2, { message: "Property code must be at least 2 characters." }).max(5),
  legalName: z.string().min(2, { message: "Legal name is required." }),
  defaultCurrency: z.string().min(3).max(3),
  timeZone: z.string().min(1, { message: "Time zone is required." }),
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

import { useEffect } from "react"

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
  const form = useForm<z.infer<typeof propertyFormSchema>>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: initialData || {
      name: "",
      code: "",
      legalName: "",
      defaultCurrency: "USD",
      timeZone: "UTC",
      checkInTime: "14:00",
      checkOutTime: "11:00",
      goLiveDate: todayKey(),
      offersSpa: true,
      offersExcursions: true,
    },
  })

  useEffect(() => {
    if (initialData) {
      form.reset(initialData)
    } else {
      form.reset({
        name: "",
        code: "",
        legalName: "",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
        goLiveDate: todayKey(),
        offersSpa: true,
        offersExcursions: true,
      })
    }
  }, [initialData, form])

  async function onSubmit(values: z.infer<typeof propertyFormSchema>) {
    try {
      const url = isEditing ? `/api/properties/${initialData.id}` : '/api/properties'
      const method = isEditing ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      })
      
      if (!response.ok) {
        throw new Error(`Failed to ${isEditing ? 'update' : 'create'} property`)
      }
      
      form.reset()
      if (onSuccess) onSuccess()
      
    } catch (error) {
      console.error(error)
      // We would use a toast notification here in a full app
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
                <FormLabel>Property Name</FormLabel>
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
                <FormLabel>Short Code</FormLabel>
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
              <FormLabel>Legal Entity Name</FormLabel>
              <FormControl>
                <Input placeholder="Sunset Hospitality LLC" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="checkInTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Check-in Time</FormLabel>
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
                <FormLabel>Check-out Time</FormLabel>
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
        <Button type="submit" className="w-full">{isEditing ? 'Update Property' : 'Create Property'}</Button>
      </form>
    </Form>
  )
}
