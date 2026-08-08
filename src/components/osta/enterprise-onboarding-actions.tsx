"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Plus, UserPlus, ClipboardList } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { toast } from "@/lib/toast"

// Onboarding actions on the Osta enterprise detail page — the platform admin creates
// the customer's properties and their ONE handover account here (app-owner requirement,
// 2026-08-03). The initial-user button exists only while the enterprise has no users:
// the API refuses afterwards, and hiding the button keeps the UI honest about it.

const propertySchema = z.object({
  name: z.string().trim().min(1, "The property needs a name"),
  code: z
    .string()
    .trim()
    .min(2, "At least 2 characters")
    .max(12, "Keep the code under 12 characters")
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers and dashes only"),
  legalName: z.string().trim().min(1, "The registered legal name is required"),
  defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "3-letter code, e.g. USD or MVR"),
  timeZone: z.string().trim().min(1, "An IANA time zone, e.g. Indian/Maldives"),
  checkInTime: z.string().trim().regex(/^\d{2}:\d{2}$/, "HH:MM"),
  checkOutTime: z.string().trim().regex(/^\d{2}:\d{2}$/, "HH:MM"),
  // Becomes the property's initial business date; Night Audit rolls it on.
  goLiveDate: z.string().trim().min(1, "Pick the go-live date"),
})
type PropertyFormValues = z.infer<typeof propertySchema>

const initialUserSchema = z.object({
  email: z.string().trim().email("A valid email address is required"),
  firstName: z.string().trim().min(1, "Required"),
  lastName: z.string().trim().min(1, "Required"),
})
type InitialUserFormValues = z.infer<typeof initialUserSchema>

export function EnterpriseOnboardingActions({
  enterpriseId,
  enterpriseName,
  userCount,
  propertyCount,
  maxProperties,
}: {
  enterpriseId: string
  enterpriseName: string
  userCount: number
  propertyCount: number
  maxProperties: number
}) {
  const router = useRouter()
  const [propertyOpen, setPropertyOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  // The handover credentials — the single moment the generated password is visible.
  const [handover, setHandover] = useState<{
    email: string
    password: string
    enterpriseSlug: string
    emailed: boolean
    emailError: string | null
  } | null>(null)

  const propertyForm = useForm<PropertyFormValues>({
    resolver: zodResolver(propertySchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      code: "",
      legalName: "",
      defaultCurrency: "USD",
      timeZone: "Indian/Maldives",
      checkInTime: "14:00",
      checkOutTime: "11:00",
      goLiveDate: new Date().toISOString().slice(0, 10),
    },
  })
  const userForm = useForm<InitialUserFormValues>({
    resolver: zodResolver(initialUserSchema),
    mode: "onChange",
    defaultValues: { email: "", firstName: "", lastName: "" },
  })

  const handleCreateProperty = async (values: PropertyFormValues) => {
    const res = await fetch("/api/osta/properties/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, enterpriseId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? "Could not create the property")
      return
    }
    toast.success(`Property "${values.name}" created and active`)
    setPropertyOpen(false)
    propertyForm.reset()
    router.refresh()
  }

  const handleCreateInitialUser = async (values: InitialUserFormValues) => {
    const res = await fetch(`/api/osta/enterprises/${enterpriseId}/initial-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? "Could not create the user")
      return
    }
    setUserOpen(false)
    userForm.reset()
    setHandover({
      email: data.email,
      password: data.password,
      enterpriseSlug: data.enterpriseSlug,
      emailed: data.emailed ?? false,
      emailError: data.emailError ?? null,
    })
    router.refresh()
  }

  const copyHandover = async () => {
    if (!handover) return
    await navigator.clipboard.writeText(
      `Uppsolut Stay sign-in\nURL: ${window.location.origin}/login\nEnterprise code: ${handover.enterpriseSlug}\nEmail: ${handover.email}\nPassword: ${handover.password}\n\nPlease change this password after your first sign-in.`
    )
    toast.success("Sign-in details copied")
  }

  const atPropertyLimit = propertyCount >= maxProperties

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setPropertyOpen(true)} disabled={atPropertyLimit} title={atPropertyLimit ? "The license's property limit is reached — raise it in Licensing" : undefined}>
        <Plus className="h-4 w-4 mr-2" />
        Add property
      </Button>
      {userCount === 0 && (
        <Button variant="outline" onClick={() => setUserOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Create initial user
        </Button>
      )}

      {/* Add property */}
      <Dialog open={propertyOpen} onOpenChange={setPropertyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a property to {enterpriseName}</DialogTitle>
            <DialogDescription>
              Created active immediately — the approval queue is for tenant-submitted properties. Rate plan, charge
              codes and fee rules are provisioned automatically.
            </DialogDescription>
          </DialogHeader>
          <Form {...propertyForm}>
            <form onSubmit={propertyForm.handleSubmit(handleCreateProperty)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={propertyForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Property name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Veyo Lagoon Retreat" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={propertyForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. VEYO" {...field} />
                      </FormControl>
                      <FormDescription>Prefixes document numbers.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={propertyForm.control}
                  name="legalName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Legal name</FormLabel>
                      <FormControl>
                        <Input placeholder="Registered company name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={propertyForm.control}
                  name="defaultCurrency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <FormControl>
                        <Input placeholder="USD" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={propertyForm.control}
                  name="timeZone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Time zone</FormLabel>
                      <FormControl>
                        <Input placeholder="Indian/Maldives" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={propertyForm.control}
                  name="checkInTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Check-in</FormLabel>
                      <FormControl>
                        <Input placeholder="14:00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={propertyForm.control}
                  name="checkOutTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Check-out</FormLabel>
                      <FormControl>
                        <Input placeholder="11:00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={propertyForm.control}
                  name="goLiveDate"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Go-live date</FormLabel>
                      <FormControl>
                        <DatePicker value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormDescription>The property&apos;s first business date.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPropertyOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={propertyForm.formState.isSubmitting}>
                  {propertyForm.formState.isSubmitting ? "Creating..." : "Create property"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Create initial user */}
      <Dialog open={userOpen} onOpenChange={setUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create the initial user for {enterpriseName}</DialogTitle>
            <DialogDescription>
              One handover admin account with a generated password, shown once. After this, the client manages their
              own users from Controls — this button disappears and the API refuses further platform-side accounts.
            </DialogDescription>
          </DialogHeader>
          <Form {...userForm}>
            <form onSubmit={userForm.handleSubmit(handleCreateInitialUser)} className="space-y-3">
              <FormField
                control={userForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="owner@client.com" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={userForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={userForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setUserOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={userForm.formState.isSubmitting}>
                  {userForm.formState.isSubmitting ? "Creating..." : "Create user"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Show-once handover credentials — mirrors the webhook URL dialog: closing this
          is the last time the password is visible anywhere. */}
      <Dialog open={handover !== null} onOpenChange={(o) => !o && setHandover(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Handover sign-in details</DialogTitle>
            <DialogDescription>
              Copy these now — the password is shown only once and stored only as a hash. Ask the client to change it
              after their first sign-in.
            </DialogDescription>
          </DialogHeader>
          {/* Whether the welcome email actually went out. The account exists either way —
              this only tells the operator if they still need to hand the details over. */}
          {handover?.emailed ? (
            <div className="rounded-md border border-success/30 bg-success-muted p-3 text-sm text-success">
              A welcome email with these details was sent to {handover.email}.
            </div>
          ) : (
            <div className="rounded-md border border-warning/40 bg-warning-muted p-3 text-sm text-warning">
              {handover?.emailError ?? "The welcome email was not sent."} Pass the details below to the client yourself.
            </div>
          )}
          <div className="rounded-md border border-border bg-muted p-3 text-sm space-y-1">
            <div>
              <span className="text-muted-foreground">Enterprise code:</span>{" "}
              <code className="font-mono">{handover?.enterpriseSlug}</code>
            </div>
            <div>
              <span className="text-muted-foreground">Email:</span> <code className="font-mono">{handover?.email}</code>
            </div>
            <div>
              <span className="text-muted-foreground">Password:</span>{" "}
              <code className="font-mono">{handover?.password}</code>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setHandover(null)}>
              Done
            </Button>
            <Button type="button" onClick={() => void copyHandover()}>
              <ClipboardList className="h-4 w-4 mr-2" />
              Copy sign-in details
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
