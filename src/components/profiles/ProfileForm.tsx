"use client"

import { useState } from "react"
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
import { Save, ArrowLeft } from "lucide-react"
import { differenceInYears } from "date-fns"

const profileFormSchema = z.object({
  profileType: z.string(),
  classification: z.string().optional(),
  title: z.string().optional(),
  firstName: z.string().regex(/^[^0-9]*$/, { message: "Name cannot contain numbers" }).optional(),
  lastName: z.string().regex(/^[^0-9]*$/, { message: "Name cannot contain numbers" }).optional(),
  companyName: z.string().optional(),
  gender: z.string().optional(),
  mobile: z.string().regex(/^[0-9\+\-\(\)\s]*$/, { message: "Invalid phone number format" }).optional(),
  email: z.string().email({ message: "Invalid email address" }).optional().or(z.literal("")),
  addressStreet: z.string().optional(),
  addressCity: z.string().optional(),
  addressState: z.string().optional(),
  addressZip: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  preferredLanguage: z.string().optional(),
  dateOfBirth: z.coerce.date().max(new Date(), { message: "Date of birth cannot be in the future." }).optional().nullable(),
  anniversaryDate: z.coerce.date().optional().nullable(),
  loyaltyTier: z.string().optional(),
  membershipNumber: z.string().optional(),
  photoUrl: z.string().url({ message: "Invalid URL" }).optional().or(z.literal("")),
  greenTaxExempt: z.boolean().default(false),
  marketingOptIn: z.boolean().default(false),
  isIncognito: z.boolean().default(false),
  documentType: z.string().optional(),
  documentNumber: z.string().optional(),
  issuingCountry: z.string().optional(),
  expiryDate: z.coerce.date().min(new Date(), { message: "Document expiry must be in the future." }).optional().nullable(),
  iataNumber: z.string().optional(),
  commissionRate: z.coerce.number().min(0).max(100).optional().nullable(),
  arNumber: z.string().optional(),
  creditLimit: z.coerce.number().min(0).optional().nullable(),
  dietaryRequirement: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.profileType === "COMPANY" || data.profileType === "TRAVEL_AGENT") {
    if (!data.companyName || data.companyName.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Company / Agency Name is required.",
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

export default function ProfileForm({ initialData, upid, defaultType = "GUEST" }: { initialData?: any, upid?: string, defaultType?: string }) {
  const router = useRouter()
  const { slug } = useParams<{ slug: string }>()
  const isEditMode = !!upid
  const enterpriseId = "00000000-0000-0000-0000-000000000000" // Hardcoded for demo

  const [submitting, setSubmitting] = useState(false)

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema) as Resolver<ProfileFormValues>,
    mode: "onChange",
    defaultValues: {
      profileType: initialData?.profileType || defaultType,
      classification: initialData?.classification || "REGULAR",
      title: initialData?.title || "",
      firstName: initialData?.firstName || "",
      lastName: initialData?.lastName || "",
      companyName: initialData?.companyName || "",
      gender: initialData?.gender || "",
      mobile: initialData?.contacts?.[0]?.mobile || initialData?.mobile || "",
      email: initialData?.contacts?.[0]?.email || initialData?.email || "",
      addressStreet: initialData?.contacts?.[0]?.address || initialData?.addressStreet || "",
      addressCity: initialData?.contacts?.[0]?.city || initialData?.addressCity || "",
      addressState: initialData?.contacts?.[0]?.stateProvince || initialData?.addressState || "",
      addressZip: initialData?.contacts?.[0]?.postalCode || initialData?.addressZip || "",
      country: initialData?.contacts?.[0]?.country || initialData?.country || "",
      preferredLanguage: initialData?.preferredLanguage || "en",
      dateOfBirth: initialData?.dateOfBirth ? new Date(initialData.dateOfBirth) : null,
      anniversaryDate: initialData?.anniversaryDate ? new Date(initialData.anniversaryDate) : null,
      loyaltyTier: initialData?.loyaltyTier || "",
      membershipNumber: initialData?.membershipNumber || "",
      photoUrl: initialData?.photoUrl || "",
      greenTaxExempt: initialData?.greenTaxExempt ?? false,
      marketingOptIn: initialData?.marketingOptIn ?? false,
      isIncognito: initialData?.isIncognito ?? false,
      documentType: initialData?.documents?.[0]?.documentType || initialData?.documentType || "",
      documentNumber: initialData?.documents?.[0]?.documentNumber || initialData?.documentNumber || "",
      issuingCountry: initialData?.documents?.[0]?.issuingCountry || initialData?.issuingCountry || "",
      expiryDate: initialData?.documents?.[0]?.expiryDate ? new Date(initialData.documents[0].expiryDate) : (initialData?.expiryDate ? new Date(initialData.expiryDate) : null),
      iataNumber: initialData?.iataNumber || "",
      commissionRate: initialData?.commissionRate || null,
      arNumber: initialData?.arNumber || "",
      creditLimit: initialData?.creditLimit || null,
      dietaryRequirement: initialData?.preferences?.find((p: any) => p.category === "DIETARY")?.value || initialData?.dietaryRequirement || "",
    }
  })

  const profileType = form.watch("profileType")
  const isB2B = profileType === "COMPANY" || profileType === "TRAVEL_AGENT"

  const dateOfBirth = form.watch("dateOfBirth")
  const age = dateOfBirth ? differenceInYears(new Date(), dateOfBirth) : null

  const onSubmit = async (data: ProfileFormValues) => {
    setSubmitting(true)

    const combinedAddress = `${data.addressStreet} ${data.addressCity} ${data.addressState} ${data.addressZip}`.trim()
    
    const payload = {
      ...data,
      address: combinedAddress,
      enterpriseId,
      preferences: data.dietaryRequirement ? [{ category: "DIETARY", value: data.dietaryRequirement }] : []
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
        router.push(`/e/${slug}/dashboard/profiles`)
        router.refresh()
      } else {
        const error = await res.json()
        alert(error.error || "Failed to save profile")
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 max-w-7xl w-full mx-auto pb-12 p-4">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-slate-50/80 backdrop-blur-md pb-4 pt-2 border-b border-slate-200 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button type="button" variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                {isEditMode ? "Edit Profile" : "New Profile"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isEditMode ? `Updating Profile` : "Fill out the details to register a new profile."}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button type="submit" disabled={submitting || !form.formState.isValid}>
              <Save className="mr-2 h-4 w-4" /> {submitting ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 mt-4 items-start">
          
          {/* ---------------- LEFT COLUMN (MAIN) ---------------- */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            
            {/* Section: Basic Information */}
            <Card id="personal-info">
              <CardHeader>
                <CardTitle>{isB2B ? "Company Details" : "Personal Information"}</CardTitle>
                <CardDescription>Primary identification details for this profile.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isB2B && (
                  <FormField
                    control={form.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company / Agency Name <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="Acme Corp" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {isB2B ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contact First Name</FormLabel>
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
                        <FormItem>
                          <FormLabel>Contact Last Name</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
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
                          <FormLabel>First Name <span className="text-red-500">*</span></FormLabel>
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
                          <FormLabel>Last Name <span className="text-red-500">*</span></FormLabel>
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
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section: Contact Details */}
            <Card id="contact-info">
              <CardHeader>
                <CardTitle>Contact Details</CardTitle>
                <CardDescription>Primary address and contact methods.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="email@example.com" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="mobile"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mobile / Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="+1 234 567 8900" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="addressStreet"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Street Address</FormLabel>
                        <FormControl>
                          <Input placeholder="123 Main St" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressCity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input placeholder="City" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressState"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State / Province</FormLabel>
                        <FormControl>
                          <Input placeholder="State" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressZip"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ZIP / Postal Code</FormLabel>
                        <FormControl>
                          <Input placeholder="12345" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country / Nationality</FormLabel>
                        <FormControl>
                          <SystemCodeSelect category="NATIONALITY" value={field.value || ""} onValueChange={field.onChange} placeholder="Select country" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="preferredLanguage"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Preferred Language</FormLabel>
                        <FormControl>
                          <Input placeholder="en" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Section: Identification (Only for Guests) */}
            {!isB2B && (
              <Card id="identification" className="scroll-mt-32">
                <CardHeader>
                  <CardTitle>Identification</CardTitle>
                  <CardDescription>Passport or National ID details.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="documentType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Document Type</FormLabel>
                          <FormControl>
                            <SystemCodeSelect category="ID_TYPE" value={field.value || ""} onValueChange={field.onChange} placeholder="Select ID Type" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="documentNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Document Number</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. AB123456" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="issuingCountry"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Issuing Country</FormLabel>
                          <FormControl>
                            <SystemCodeSelect category="NATIONALITY" value={field.value || ""} onValueChange={field.onChange} placeholder="Select country" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="expiryDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Expiry Date</FormLabel>
                          <FormControl>
                            <DatePicker value={field.value} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

          </div>

          {/* ---------------- RIGHT COLUMN (SIDEBAR) ---------------- */}
          <div className="flex flex-col gap-6">

            {/* Section: Profile Status */}
            <Card id="profile-status" className="bg-slate-50/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Profile Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="profileType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Profile Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="bg-white">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="GUEST">Guest</SelectItem>
                          <SelectItem value="COMPANY">Company</SelectItem>
                          <SelectItem value="TRAVEL_AGENT">Travel Agent</SelectItem>
                          <SelectItem value="STAFF">Staff</SelectItem>
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
              </CardContent>
            </Card>

            {/* Section: Finance & Billing */}
            <Card id="billing-finance">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Finance & Billing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="arNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>AR Number (Accounts Rec.)</FormLabel>
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
                      <FormLabel>Credit Limit</FormLabel>
                      <FormControl>
                        <Input type="number" step="100" placeholder="e.g. 5000" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isB2B && (
                  <>
                    <div className="pt-2 border-t border-slate-100">
                      <FormField
                        control={form.control}
                        name="iataNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>IATA Number</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. 12345678" {...field} value={field.value || ""} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="commissionRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Commission Rate (%)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.1" placeholder="e.g. 15.0" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
              </CardContent>
            </Card>

            {/* Section: CRM & Privacy Toggles */}
            <Card id="crm-loyalty">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">CRM & Privacy</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isB2B && (
                  <>
                    <div className="grid grid-cols-1 gap-4 mb-2">
                      <FormField
                        control={form.control}
                        name="dateOfBirth"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <div className="flex justify-between items-center mb-1">
                              <FormLabel className="text-xs mb-0">Date of Birth</FormLabel>
                              {age !== null && (
                                <span className="text-xs text-slate-500 font-medium">
                                  {age} yrs
                                </span>
                              )}
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
                        name="anniversaryDate"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel className="text-xs">Anniversary</FormLabel>
                            <FormControl>
                              <DatePicker value={field.value} onChange={field.onChange} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="dietaryRequirement"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Dietary Requirement</FormLabel>
                          <FormControl>
                            <SystemCodeSelect category="DIETARY_REQ" value={field.value || ""} onValueChange={field.onChange} placeholder="Select requirement" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
                <FormField
                  control={form.control}
                  name="loyaltyTier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Loyalty Tier</FormLabel>
                      <FormControl>
                        <Input placeholder="Gold" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="membershipNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Membership Number</FormLabel>
                      <FormControl>
                        <Input placeholder="MEM-12345" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="photoUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Photo / Logo URL</FormLabel>
                      <FormControl>
                        <Input placeholder="https://..." {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-slate-100">
                  <FormField
                    control={form.control}
                    name="marketingOptIn"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="cursor-pointer text-sm">Opt-in to Marketing</FormLabel>
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
                        <FormLabel className="cursor-pointer text-sm">Green Tax Exempt</FormLabel>
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
                        <FormLabel className="cursor-pointer text-sm">Incognito Mode</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

          </div>

        </div>
      </form>
    </Form>
  )
}
