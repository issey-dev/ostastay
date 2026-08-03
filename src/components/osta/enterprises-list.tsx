"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Building2, Plus } from "@/components/icons"
import { toast } from "@/lib/toast"

type EnterpriseRow = {
  id: string
  name: string
  slug: string
  license: { tier: string; maxProperties: number } | null
  _count: { properties: number; users: number }
}

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

export function EnterprisesList() {
  const router = useRouter()
  const [enterprises, setEnterprises] = useState<EnterpriseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    mode: "onChange",
    defaultValues: { name: "", maxProperties: "1" },
  })

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/enterprises")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setEnterprises(data) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

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

  if (loading) return <p className="text-sm text-muted-foreground italic">Loading...</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Onboard a client here, then add their properties and initial user from the enterprise&rsquo;s page.
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create enterprise
        </Button>
      </div>

      {enterprises.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-8 text-center border rounded-md bg-muted/40">No customer enterprises yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {enterprises.map((e) => (
            <a key={e.id} href={`/osta/enterprises/${e.id}`}>
              <Card className="hover:bg-muted/40 transition-colors h-full">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" /> {e.name}</CardTitle>
                  <CardDescription>/e/{e.slug}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline">{e.license?.tier ?? "STANDARD"}</Badge>
                  <span>{e._count.properties} propert{e._count.properties === 1 ? "y" : "ies"}</span>
                  <span>·</span>
                  <span>{e._count.users} user{e._count.users === 1 ? "" : "s"}</span>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      )}

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
    </div>
  )
}
