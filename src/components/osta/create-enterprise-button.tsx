"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Plus } from "@/components/icons"
import { toast } from "@/lib/toast"

const createSchema = z.object({
  name: z.string().trim().min(1, "The enterprise needs a name"),
  // Kept as a string in form state (what an <input> actually holds) and converted at
  // submit — z.coerce's unknown input type fights react-hook-form's resolver generics.
  maxProperties: z
    .string()
    .trim()
    .regex(/^\d+$/, "A whole number")
    .refine((v) => Number(v) >= 1, "At least 1"),
})
type CreateFormValues = z.infer<typeof createSchema>

// "New enterprise" can be started from the Enterprises page, the console header's + New
// menu and the Ctrl+K palette, so the dialog is mounted once in the console header
// (OstaHeaderTools) and opened by this window event; the button only fires it.
export const OPEN_CREATE_ENTERPRISE = "osta-open-create-enterprise"

export function CreateEnterpriseButton() {
  return (
    <Button onClick={() => window.dispatchEvent(new Event(OPEN_CREATE_ENTERPRISE))}>
      <Plus className="h-4 w-4 mr-2" />
      New enterprise
    </Button>
  )
}

export function CreateEnterpriseDialog() {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    const open = () => setCreateOpen(true)
    window.addEventListener(OPEN_CREATE_ENTERPRISE, open)
    return () => window.removeEventListener(OPEN_CREATE_ENTERPRISE, open)
  }, [])

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    mode: "onChange",
    defaultValues: { name: "", maxProperties: "1" },
  })

  // Onboarding starts here: create the enterprise, then land on its detail page where
  // properties and the initial handover user are added.
  const handleCreate = async (values: CreateFormValues) => {
    const res = await fetch("/api/enterprises", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: values.name, maxProperties: Number(values.maxProperties) }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? "Could not create the enterprise")
      return
    }
    toast.success(`Enterprise "${data.name}" created`)
    setCreateOpen(false)
    createForm.reset()
    router.push(`/osta/enterprises/${data.id}`)
  }

  return (
    <>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a customer enterprise</DialogTitle>
            <DialogDescription>
              The URL slug is derived from the name. Properties and the initial user are added on the next screen.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-3">
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Enterprise name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Veyo Hospitality Pvt Ltd" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="maxProperties"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Allowed properties</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} step={1} {...field} />
                    </FormControl>
                    <FormDescription>The license&rsquo;s property limit — adjustable later in Licensing.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createForm.formState.isSubmitting}>
                  {createForm.formState.isSubmitting ? "Creating..." : "Create enterprise"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  )
}
