"use client"

import { useEffect, useState } from "react"
import { NationalitySelect } from "@/components/ui/nationality-select"
import { useRouter, useParams } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, Resolver } from "react-hook-form"
import * as z from "zod"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SystemCodeSelect } from "@/components/ui/system-code-select"
import { DatePicker } from "@/components/ui/date-picker"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Save, ArrowLeft } from "@/components/icons"
import { differenceInYears } from "date-fns"
import { useProperty } from "@/components/providers/property-provider"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { useUnsavedGuard } from "@/lib/use-unsaved-guard"
import { SubmitButton } from "@/components/ui/submit-button"
import { CommunicationsManager } from "@/components/profiles/communications-manager"
import { AddressManager } from "@/components/profiles/address-manager"
import { IdentificationManager } from "@/components/profiles/identification-manager"
import { AttachmentsManager } from "@/components/profiles/attachments-manager"
import { NotesPanel } from "@/components/profiles/notes-panel"
import { PreferencesEditor } from "@/components/profiles/preferences-editor"
import { NegotiatedRatesManager } from "@/components/profiles/negotiated-rates-manager"
import { InfoHint } from "@/components/ui/info-hint"
import { PageHeader } from "@/components/ui/page-header"
import { BOOKING_METHODS } from "@/lib/green-tax-sheet"
import { MobileActionBar } from "@/components/ui/mobile"
import { INPUT_EMAIL, INPUT_MONEY, INPUT_PHONE } from "@/lib/input-presets"

const profileFormSchema = z.object({
  profileType: z.string(),
  classification: z.string().optional(),
  title: z.string().optional(),
  firstName: z.string().regex(/^[^0-9]*$/, { message: "Name cannot contain numbers" }).optional(),
  middleName: z.string().optional(),
  lastName: z.string().regex(/^[^0-9]*$/, { message: "Name cannot contain numbers" }).optional(),
  companyName: z.string().optional(),
  gender: z.string().optional(),
  preferredLanguage: z.string().optional(),
  dateOfBirth: z.coerce.date().max(new Date(), { message: "Date of birth cannot be in the future." }).optional().nullable(),
  nationality: z.string().optional(),
  anniversaryDate: z.coerce.date().optional().nullable(),
  vipLevel: z.string().optional(),
  membershipNumber: z.string().optional(),
  photoUrl: z.string().url({ message: "Invalid URL" }).optional().or(z.literal("")),
  greenTaxExempt: z.boolean().default(false),
  marketingOptIn: z.boolean().default(false),
  isIncognito: z.boolean().default(false),
  iataNumber: z.string().optional(),
  tinNumber: z.string().trim().max(50, { message: "TIN is too long" }).optional(),
  bookingMethod: z.string().optional(),
  commissionRate: z.coerce.number().min(0).max(100).optional().nullable(),
  arNumber: z.string().optional(),
  creditLimit: z.coerce.number().min(0).optional().nullable(),
  isCreditAccount: z.boolean().default(false),
  // Create-mode-only convenience fields — an initial Communications/Address/
  // Identification row, submitted as arrays to POST. Once a profile exists, the real
  // multi-row managers (Communications/Address/Identification) take over.
  initialEmail: z.string().email({ message: "Invalid email address" }).optional().or(z.literal("")),
  initialMobile: z.string().regex(/^[0-9+\-() \s]*$/, { message: "Invalid phone number format" }).optional(),
  initialFullAddress: z.string().optional(),
  initialCity: z.string().optional(),
  initialStateProvince: z.string().optional(),
  initialPostalCode: z.string().optional(),
  initialCountry: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.profileType === "COMPANY" || data.profileType === "TRAVEL_AGENT") {
    if (!data.companyName || data.companyName.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Company / agency name is required.",
        path: ["companyName"],
      })
    }
  } else {
    if (!data.firstName || data.firstName.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "First name is required.",
        path: ["firstName"],
      })
    }
    if (!data.lastName || data.lastName.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Last name is required.",
        path: ["lastName"],
      })
    }
  }
})

export type ProfileFormValues = z.infer<typeof profileFormSchema>

const PROFILE_TYPE_LABELS: Record<string, string> = {
  GUEST: "Guest",
  STAFF: "Staff",
  COMPANY: "Company",
  TRAVEL_AGENT: "Travel agent",
}

export default function ProfileForm({ initialData, upid, defaultType = "GUEST", contextMode }: { initialData?: any, upid?: string, defaultType?: string, contextMode?: "debtor" }) {
  const router = useRouter()
  const { slug } = useParams<{ slug: string }>()
  const { currentProperty } = useProperty()
  const isEditMode = !!upid
  const isDebtorContext = contextMode === "debtor"

  const [submitting, setSubmitting] = useState(false)
  const [visitsToProperty, setVisitsToProperty] = useState<number | null>(null)

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema) as Resolver<ProfileFormValues>,
    mode: "onChange",
    defaultValues: {
      profileType: initialData?.profileType || defaultType,
      classification: initialData?.classification || "REGULAR",
      title: initialData?.title || "",
      firstName: initialData?.firstName || "",
      middleName: initialData?.middleName || "",
      lastName: initialData?.lastName || "",
      companyName: initialData?.companyName || "",
      gender: initialData?.gender || "",
      preferredLanguage: initialData?.preferredLanguage || "en",
      dateOfBirth: initialData?.dateOfBirth ? new Date(initialData.dateOfBirth) : null,
      nationality: initialData?.nationality || "",
      anniversaryDate: initialData?.anniversaryDate ? new Date(initialData.anniversaryDate) : null,
      vipLevel: initialData?.vipLevel || "",
      membershipNumber: initialData?.membershipNumber || "",
      photoUrl: initialData?.photoUrl || "",
      greenTaxExempt: initialData?.greenTaxExempt ?? false,
      marketingOptIn: initialData?.marketingOptIn ?? false,
      isIncognito: initialData?.isIncognito ?? false,
      iataNumber: initialData?.iataNumber || "",
      tinNumber: initialData?.tinNumber || "",
      bookingMethod: initialData?.bookingMethod || "",
      commissionRate: initialData?.commissionRate || null,
      arNumber: initialData?.arNumber || "",
      creditLimit: initialData?.creditLimit || null,
      isCreditAccount: initialData?.isCreditAccount ?? isDebtorContext,
      initialEmail: "",
      initialMobile: "",
      initialFullAddress: "",
      initialCity: "",
      initialStateProvince: "",
      initialPostalCode: "",
      initialCountry: "",
    }
  })

  // Warn before a reload/tab close throws away unsaved edits (DESKTOP_PLAN D11). `saved`
  // switches it off for the success navigation.
  const [saved, setSaved] = useState(false)
  useUnsavedGuard(form.formState.isDirty && !submitting && !saved)

  const profileType = form.watch("profileType")
  const isB2B = profileType === "COMPANY" || profileType === "TRAVEL_AGENT"
  const isIndividual = !isB2B // GUEST or STAFF — full Personal Information + Identification

  const dateOfBirth = form.watch("dateOfBirth")
  const age = dateOfBirth ? differenceInYears(new Date(), dateOfBirth) : null

  // "No of Visits to Property" is live-computed (Profile has no propertyId of its own —
  // see stay-history route) and only meaningful once the profile exists and there's an
  // active property context.
  useEffect(() => {
    if (!isEditMode || !currentProperty?.id) return
    fetch(`/api/profiles/${upid}/stay-history?propertyId=${currentProperty.id}`)
      .then((r) => r.json())
      .then((data) => setVisitsToProperty(data?.visitsToProperty ?? null))
      .catch(() => setVisitsToProperty(null))
  }, [isEditMode, upid, currentProperty?.id])

  // "Add ID", "Add note"… on the profile page link to /edit#<section>. The browser can't
  // jump there on its own — the form mounts after the profile loads — so scroll once here.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id) return
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150)
    return () => clearTimeout(t)
  }, [])

  const onSubmit = async (data: ProfileFormValues) => {
    setSubmitting(true)

    const { initialEmail, initialMobile, initialFullAddress, initialCity, initialStateProvince, initialPostalCode, initialCountry, ...scalarData } = data

    const payload: Record<string, unknown> = { ...scalarData }

    if (!isEditMode) {
      const communications = []
      if (initialEmail) communications.push({ type: "EMAIL", value: initialEmail, isPrimary: true })
      if (initialMobile) communications.push({ type: "MOBILE", value: initialMobile, isPrimary: !initialEmail })
      if (communications.length > 0) payload.communications = communications

      if (initialFullAddress || initialCity || initialStateProvince || initialPostalCode || initialCountry) {
        payload.addresses = [{
          type: "HOME",
          fullAddress: initialFullAddress || "",
          city: initialCity,
          stateProvince: initialStateProvince,
          postalCode: initialPostalCode,
          country: initialCountry,
          isPrimary: true,
        }]
      }

      if (currentProperty?.id) payload.originPropertyId = currentProperty.id
    }

    const url = isEditMode ? `/api/profiles/${upid}` : "/api/profiles"
    const method = isEditMode ? "PUT" : "POST"

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        setSaved(true)
        if (isDebtorContext) {
          const saved = await res.json()
          router.push(`/e/${slug}/dashboard/debtors/${saved.upid}`)
        } else if (!isEditMode) {
          // Created — go straight to Edit so Communications/Address/Identification/
          // Attachments/Notes management (which needs a real upid) is available.
          const saved = await res.json()
          router.push(`/e/${slug}/dashboard/profiles/${saved.upid}/edit`)
        } else {
          router.push(`/e/${slug}/dashboard/profiles/${upid}`)
        }
        router.refresh()
      } else {
        toast.error(await apiError(res, "Couldn't save the profile. Try again."))
      }
    } catch (e) {
      console.error(e)
      toast.error("Couldn't save the profile. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const formTitle = isDebtorContext ? "New credit account" : isEditMode ? "Edit profile" : "New profile"

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 pb-12">
        {/* Sticky Header. Breadcrumbs ("Client Relations › New") replace the back arrow from
            md up; the debtors page renders its own breadcrumb and tab title around this form. */}
        <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur-md pb-4 pt-2 border-b border-border flex items-start gap-4 max-md:static max-md:bg-transparent max-md:backdrop-blur-none">
          <Button type="button" variant="ghost" size="icon" onClick={() => router.back()} aria-label="Back" className="shrink-0 md:hidden">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <PageHeader
            className="min-w-0 flex-1"
            crumb={isDebtorContext ? undefined : isEditMode ? "Edit" : "New"}
            title={<>{formTitle}</>}
            tabTitle={isDebtorContext ? null : formTitle}
            hint={
              isDebtorContext
                ? "Register a Company or Travel Agent as a Debtors credit account."
                : isEditMode ? undefined : "Fill out the details to register a new profile."
            }
            actionsClassName="gap-2 max-md:hidden"
            actions={
              <>
                <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => router.back()}>Cancel</Button>
                <SubmitButton className="flex-1 sm:flex-none" pending={submitting} disabled={!form.formState.isValid}>
                  <Save className="mr-2 h-4 w-4" /> Save profile
                </SubmitButton>
              </>
            }
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 mt-4 items-start">

          {/* ---------------- LEFT COLUMN (MAIN) ---------------- */}
          <div className="lg:col-span-2 flex flex-col gap-6">

            {/* Section: Personal Information */}
            <Card id="personal-info">
              <CardHeader>
                <CardTitle>{isB2B ? "Company details" : "Personal information"}</CardTitle>
                <CardDescription>
                  {isB2B ? "Primary identification details for this entity." : "Primary identification details for this profile."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isB2B ? (
                  <FormField
                    control={form.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company / agency name <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="Acme Corp" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem className="md:col-span-1">
                          <FormLabel>Title</FormLabel>
                          <FormControl>
                            <SystemCodeSelect category="TITLE" value={field.value || ""} onValueChange={field.onChange} placeholder="Title" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>First name <span className="text-destructive">*</span></FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="middleName"
                      render={({ field }) => (
                        <FormItem className="md:col-span-1">
                          <FormLabel>Middle</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Last name <span className="text-destructive">*</span></FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="gender"
                      render={({ field }) => (
                        <FormItem className="md:col-span-1">
                          <FormLabel>Gender</FormLabel>
                          <FormControl>
                            <SystemCodeSelect category="GENDER" value={field.value || ""} onValueChange={field.onChange} placeholder="Gender" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="preferredLanguage"
                      render={({ field }) => (
                        <FormItem className="md:col-span-1">
                          <FormLabel>Language</FormLabel>
                          <FormControl>
                            <Input placeholder="en" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section: Communications */}
            <Card id="communications">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
            Communications
            <InfoHint label="Communications">Email, mobile, and social contact methods — one may be marked primary.</InfoHint>
          </CardTitle>
              </CardHeader>
              <CardContent>
                {isEditMode ? (
                  <CommunicationsManager upid={upid!} />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="initialEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input {...INPUT_EMAIL} placeholder="email@example.com" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="initialMobile"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Mobile / Phone</FormLabel>
                          <FormControl>
                            <Input {...INPUT_PHONE} placeholder="+1 234 567 8900" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <p className="md:col-span-2 text-xs text-muted-foreground">
                      More contact methods (and marking one primary) can be added once the profile is saved.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section: Address */}
            <Card id="address">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
            Address
            <InfoHint label="Address">Home, business, or billing addresses — one may be marked primary.</InfoHint>
          </CardTitle>
              </CardHeader>
              <CardContent>
                {isEditMode ? (
                  <AddressManager upid={upid!} />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="initialFullAddress"
                      render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Full address</FormLabel>
                          <FormControl>
                            <Input placeholder="123 Main St, Apt 4B" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="initialCity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="initialStateProvince"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State / Province</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="initialPostalCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ZIP / postal code</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="initialCountry"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Country</FormLabel>
                          <FormControl>
                            <NationalitySelect mode="country" value={field.value || ""} onValueChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <p className="md:col-span-2 text-xs text-muted-foreground">
                      More addresses (and marking one primary) can be added once the profile is saved.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section: Identification (Guest/Staff only) */}
            {isIndividual && (
              <Card id="identification" className="scroll-mt-32">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
            Identification
            <InfoHint label="Identification">Passport or national ID documents — one may be marked primary.</InfoHint>
          </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {isEditMode ? (
                    <IdentificationManager upid={upid!} />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Identification documents can be added once the profile is saved.
                    </p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border">
                    <FormField
                      control={form.control}
                      name="dateOfBirth"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <div className="flex justify-between items-center mb-1">
                            <FormLabel className="mb-0">Birthdate</FormLabel>
                            {age !== null && <span className="text-xs text-muted-foreground font-medium">{age} yrs</span>}
                          </div>
                          <FormControl>
                            <DatePicker value={field.value} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="nationality"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nationality</FormLabel>
                          <FormControl>
                            <NationalitySelect value={field.value || ""} onValueChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Section: CRM (Guest/Staff only — stay history, VIP status, and guest
                preferences don't apply to a Company/Travel Agent account record) */}
            {isIndividual && (
            <Card id="crm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
            CRM
            <InfoHint label="CRM">Stay history summary, guest preferences, and VIP status.</InfoHint>
          </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="anniversaryDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Anniversary</FormLabel>
                        <FormControl>
                          <DatePicker value={field.value} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="vipLevel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>VIP level</FormLabel>
                        <FormControl>
                          <SystemCodeSelect category="VIP_LEVEL" value={field.value || ""} onValueChange={field.onChange} placeholder="None" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {isEditMode && (
                  <div className="grid grid-cols-2 gap-4 rounded-md border p-3 bg-muted/30">
                    <div>
                      <Label className="text-xs text-muted-foreground">Visits to this property</Label>
                      <p className="text-lg font-semibold">{visitsToProperty ?? "—"}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Visits to property chain (enterprise)</Label>
                      <p className="text-lg font-semibold">{initialData?.totalStays ?? 0}</p>
                    </div>
                  </div>
                )}

                <div className="grid gap-2">
                  <Label>Dietary requirements</Label>
                  {isEditMode ? (
                    <PreferencesEditor upid={upid!} category="DIETARY" lovCategory="DIETARY_REQ" />
                  ) : (
                    <p className="text-xs text-muted-foreground">Can be set once the profile is saved.</p>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label>Preferences</Label>
                  {isEditMode ? (
                    <PreferencesEditor upid={upid!} category="PREFERENCE" lovCategory="PREFERENCE" />
                  ) : (
                    <p className="text-xs text-muted-foreground">Can be set once the profile is saved.</p>
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="membershipNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Membership number</FormLabel>
                      <FormControl>
                        <Input placeholder="MEM-12345" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
            )}

            {/* Section: Negotiated Rates (Company/Travel Agent only) — links this
                profile to negotiated Rate Plans; the reservation form's rate-plan
                selector then only offers those plans when this profile is the
                booking's Travel Agent/Booking Source. See RatePlanAgentAccess. */}
            {isB2B && (
              <Card id="negotiated-rates">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
            Negotiated rates
            <InfoHint label="Negotiated rates">Which negotiated rate plans this account can book with — restricted to bookings made through this profile.</InfoHint>
          </CardTitle>
                </CardHeader>
                <CardContent>
                  {isEditMode ? (
                    <NegotiatedRatesManager upid={upid!} />
                  ) : (
                    <p className="text-xs text-muted-foreground">Negotiated rates can be linked once the profile is saved.</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Section: Attachments */}
            <Card id="attachments">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
            Attachments
            <InfoHint label="Attachments">Linked files (label + URL) — passport scans, signed contracts, etc.</InfoHint>
          </CardTitle>
              </CardHeader>
              <CardContent>
                {isEditMode ? (
                  <AttachmentsManager upid={upid!} />
                ) : (
                  <p className="text-xs text-muted-foreground">Attachments can be added once the profile is saved.</p>
                )}
              </CardContent>
            </Card>

            {/* Section: Notes */}
            <Card id="notes">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
            Notes
            <InfoHint label="Notes">Feedback, complaints, and other notable things about this profile.</InfoHint>
          </CardTitle>
              </CardHeader>
              <CardContent>
                {isEditMode ? (
                  <NotesPanel upid={upid!} />
                ) : (
                  <p className="text-xs text-muted-foreground">Notes can be added once the profile is saved.</p>
                )}
              </CardContent>
            </Card>

          </div>

          {/* ---------------- RIGHT COLUMN (SIDEBAR) ---------------- */}
          <div className="flex flex-col gap-6">

            {/* Section: Profile Status */}
            <Card id="profile-status" className="bg-muted/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Profile settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="profileType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Profile type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="bg-card">
                            <SelectValue placeholder="Select type">{PROFILE_TYPE_LABELS[field.value]}</SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {!isDebtorContext && <SelectItem value="GUEST">Guest</SelectItem>}
                          <SelectItem value="COMPANY">Company</SelectItem>
                          <SelectItem value="TRAVEL_AGENT">Travel agent</SelectItem>
                          {!isDebtorContext && <SelectItem value="STAFF">Staff</SelectItem>}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="classification"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Classification</FormLabel>
                      <FormControl>
                        <SystemCodeSelect category="CLASSIFICATION" value={field.value || ""} onValueChange={field.onChange} placeholder="Select classification" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {isEditMode && initialData?.originProperty && (
                  <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                    Originated at <span className="font-medium text-foreground">{initialData.originProperty.name}</span>
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Section: Finance & Billing (AR — unchanged) */}
            <Card id="billing-finance">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Finance & billing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="arNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>AR number (accounts rec.)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. AR-1002" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="creditLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Credit limit</FormLabel>
                      <FormControl>
                        <Input {...INPUT_MONEY} type="number" step="100" placeholder="e.g. 5000" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isB2B && (
                  <>
                    <FormField
                      control={form.control}
                      name="isCreditAccount"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-2 space-y-0">
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={field.onChange} disabled={isDebtorContext} />
                          </FormControl>
                          <div>
                            <FormLabel className="cursor-pointer text-sm">Credit account (Debtors)</FormLabel>
                            <p className="text-xs text-muted-foreground">
                              Activates the AR number and credit limit as a live account — enables billing charges to this profile from the Debtors module.
                            </p>
                          </div>
                        </FormItem>
                      )}
                    />
                    <div className="pt-2 border-t border-border">
                      <FormField
                        control={form.control}
                        name="iataNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>IATA number</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. 12345678" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="tinNumber"
                        render={({ field }) => (
                          <FormItem className="mt-4">
                            <FormLabel className="flex items-center gap-1">
                              TIN
                              <InfoHint label="TIN">Tax Identification Number. Printed against every invoice booked through this profile on the GST Report.</InfoHint>
                            </FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. 1234567GST501" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="bookingMethod"
                        render={({ field }) => (
                          <FormItem className="mt-4">
                            <FormLabel className="flex items-center gap-1">
                              Booking method
                              <InfoHint label="Booking method">Reported on the MIRA Green Tax sheet for every reservation booked through this profile as its Travel Agent. Guests booked without an agent are reported as FIT.</InfoHint>
                            </FormLabel>
                            <Select value={field.value || ""} onValueChange={(v) => field.onChange(v === "NONE" ? "" : v)}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select booking method" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="NONE">Not set</SelectItem>
                                {BOOKING_METHODS.map((m) => (
                                  <SelectItem key={m} value={m}>{m}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Section: Marketing / Compliance */}
            <Card id="marketing-compliance">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Marketing & compliance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="photoUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Photo / logo URL</FormLabel>
                      <FormControl>
                        <Input placeholder="https://..." {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex flex-col gap-3 pt-2 border-t border-border">
                  <FormField
                    control={form.control}
                    name="marketingOptIn"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="cursor-pointer text-sm">Mail list (marketing)</FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="greenTaxExempt"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="cursor-pointer text-sm">Green Tax exempt</FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="isIncognito"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="cursor-pointer text-sm">Incognito mode</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

          </div>

        </div>

        {/* Phones: Save stays in reach however far down the form the user is. */}
        <MobileActionBar>
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <SubmitButton className="flex-1" pending={submitting} disabled={!form.formState.isValid}>
            <Save className="mr-2 h-4 w-4" /> Save profile
          </SubmitButton>
        </MobileActionBar>
      </form>
    </Form>
  )
}
