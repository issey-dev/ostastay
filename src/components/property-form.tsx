"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"

const propertyFormSchema = z.object({
  name: z.string().min(2, { message: "Property name must be at least 2 characters." }),
  code: z.string().min(2, { message: "Property code must be at least 2 characters." }).max(5),
  legalName: z.string().min(2, { message: "Legal name is required." }),
  defaultCurrency: z.string().min(3).max(3),
  timeZone: z.string().min(1, { message: "Time zone is required." }),
  checkInTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Must be in HH:MM format"),
  checkOutTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, "Must be in HH:MM format"),
  enterpriseId: z.string().uuid("Invalid Enterprise ID"), // In reality, this would be hidden or context-provided
})

import { useEffect } from "react"

export function PropertyForm({ onSuccess, initialData }: { onSuccess?: () => void, initialData?: any }) {
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
      enterpriseId: "00000000-0000-0000-0000-000000000000", // Dummy for now
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
        enterpriseId: "00000000-0000-0000-0000-000000000000",
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
        <Button type="submit" className="w-full">{isEditing ? 'Update Property' : 'Create Property'}</Button>
      </form>
    </Form>
  )
}
