"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { DatePicker } from "@/components/ui/date-picker"
import { SignaturePad } from "@/components/eregistration/signature-pad"
import { Loader2, CheckCircle2, AlertTriangle, Users, ArrowLeft, FileText, Plus, Trash2 } from "@/components/icons"
import { toast } from "@/lib/toast"

type SlotSummary = { id: string; slotIndex: number; isPrimary: boolean; displayName: string | null; status: string }
type ReservationSummary = { reservationId: string; confirmationNo: string; checkInDate: string; checkOutDate: string; slots: SlotSummary[] }
type LandingData = { propertyName: string; logoUrl: string | null; brandColor: string; message: string | null; reservations: ReservationSummary[] }

const slotFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  middleName: z.string().trim().optional(),
  lastName: z.string().trim().min(1, "Last name is required"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  nationality: z.string().trim().min(1, "Nationality is required"),
  gender: z.string().trim().optional(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]).optional(),
  mobile: z.string().trim().optional(),
  addressFull: z.string().trim().optional(),
  addressCity: z.string().trim().optional(),
  addressCountry: z.string().trim().optional(),
  documentType: z.string().min(1, "Document type is required"),
  documentNumber: z.string().trim().min(1, "Document number is required"),
  issuingCountry: z.string().trim().optional(),
  documentIssueDate: z.string().optional(),
  documentExpiryDate: z.string().optional(),
})
type SlotFormValues = z.infer<typeof slotFormSchema>

const EMPTY_VALUES: SlotFormValues = {
  firstName: "", middleName: "", lastName: "", dateOfBirth: "", nationality: "", gender: "",
  email: "", mobile: "", addressFull: "", addressCity: "", addressCountry: "",
  documentType: "", documentNumber: "", issuingCountry: "", documentIssueDate: "", documentExpiryDate: "",
}

type ChildEntry = { name: string; dateOfBirth: string | null }

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

export function EregistrationClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<LandingData | null>(null)
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null)

  const fetchLanding = useCallback(() => {
    setLoading(true)
    fetch(`/api/eregistration/${token}`)
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) {
          setLoadError(body.error || "This link is invalid.")
          return
        }
        setData(body)
      })
      .catch(() => setLoadError("Couldn't reach the server — check your connection and try again."))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { fetchLanding() }, [fetchLanding])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>This link isn&apos;t available</AlertTitle>
          <AlertDescription>{loadError || "Please contact the property for a new link."}</AlertDescription>
        </Alert>
      </div>
    )
  }

  const activeSlot = activeSlotId
    ? data.reservations.flatMap((r) => r.slots.map((s) => ({ ...s, reservationId: r.reservationId }))).find((s) => s.id === activeSlotId)
    : null

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center gap-3" style={{ color: data.brandColor }}>
          {data.logoUrl ? (
            <img src={data.logoUrl} alt={data.propertyName} className="h-10 max-w-[160px] object-contain" />
          ) : (
            <span className="text-xl font-bold">{data.propertyName}</span>
          )}
        </div>

        {!activeSlot ? (
          <SlotListView data={data} onPick={setActiveSlotId} />
        ) : (
          <SlotFormView
            token={token}
            slot={activeSlot}
            brandColor={data.brandColor}
            onBack={() => setActiveSlotId(null)}
            onSubmitted={() => { setActiveSlotId(null); fetchLanding() }}
          />
        )}
      </div>
    </div>
  )
}

function SlotListView({ data, onPick }: { data: LandingData; onPick: (id: string) => void }) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>eRegistration</CardTitle>
          <CardDescription>{data.message || "Please complete registration details ahead of arrival — it only takes a few minutes."}</CardDescription>
        </CardHeader>
      </Card>
      {data.reservations.map((r) => (
        <Card key={r.reservationId}>
          <CardHeader>
            <CardTitle className="text-base">Reservation {r.confirmationNo}</CardTitle>
            <CardDescription>{fmtDate(r.checkInDate)} &ndash; {fmtDate(r.checkOutDate)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {r.slots.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={s.status !== "PENDING"}
                onClick={() => onPick(s.id)}
                className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors enabled:hover:bg-muted/60 disabled:opacity-70"
              >
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  {s.displayName || `Guest ${s.slotIndex + 1}`}
                  {s.isPrimary && <Badge variant="outline" className="text-[10px] uppercase">Lead</Badge>}
                </span>
                {s.status === "PENDING" ? (
                  <Badge>Fill in details</Badge>
                ) : (
                  <Badge variant="secondary" className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Submitted</Badge>
                )}
              </button>
            ))}
          </CardContent>
        </Card>
      ))}
    </>
  )
}

function SlotFormView({
  token, slot, brandColor, onBack, onSubmitted,
}: {
  token: string
  slot: SlotSummary & { reservationId: string }
  brandColor: string
  onBack: () => void
  onSubmitted: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [signature, setSignature] = useState<string | null>(null)
  const [hasPhoto, setHasPhoto] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [children, setChildren] = useState<ChildEntry[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const form = useForm<SlotFormValues>({ resolver: zodResolver(slotFormSchema), mode: "onBlur", defaultValues: EMPTY_VALUES })

  useEffect(() => {
    setLoading(true)
    fetch(`/api/eregistration/${token}/slots/${slot.id}`)
      .then((r) => r.json())
      .then((d) => {
        form.reset({
          firstName: d.firstName || "", middleName: d.middleName || "", lastName: d.lastName || "",
          dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth).toISOString().slice(0, 10) : "",
          nationality: d.nationality || "", gender: d.gender || "", email: d.email || "", mobile: d.mobile || "",
          addressFull: d.addressFull || "", addressCity: d.addressCity || "", addressCountry: d.addressCountry || "",
          documentType: d.documentType || "", documentNumber: d.documentNumber || "",
          issuingCountry: d.issuingCountry || "",
          documentIssueDate: d.documentIssueDate ? new Date(d.documentIssueDate).toISOString().slice(0, 10) : "",
          documentExpiryDate: d.documentExpiryDate ? new Date(d.documentExpiryDate).toISOString().slice(0, 10) : "",
        })
        setSignature(d.signatureDataUrl || null)
        setHasPhoto(!!d.hasPhoto)
        if (d.hasPhoto) setPhotoPreviewUrl(`/api/eregistration/${token}/slots/${slot.id}/photo`)
        if (slot.isPrimary && Array.isArray(d.childrenInfo)) setChildren(d.childrenInfo)
      })
      .catch(() => toast.error("Couldn't load this guest's saved draft."))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, slot.id])

  const saveDraft = useCallback((values: Partial<SlotFormValues>) => {
    fetch(`/api/eregistration/${token}/slots/${slot.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values),
    }).catch(() => {})
  }, [token, slot.id])

  // Debounced autosave on any field change — a flaky connection loses at most the last
  // half-second of typing, never the whole form.
  useEffect(() => {
    const sub = form.watch((values) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => saveDraft(values as SlotFormValues), 600)
    })
    return () => sub.unsubscribe()
  }, [form, saveDraft])

  const handlePhotoSelect = async (file: File) => {
    setPhotoFile(file)
    setPhotoPreviewUrl(URL.createObjectURL(file))
    const fd = new FormData()
    fd.append("photo", file)
    const res = await fetch(`/api/eregistration/${token}/slots/${slot.id}/photo`, { method: "POST", body: fd })
    if (res.ok) {
      setHasPhoto(true)
      toast.success("Photo uploaded")
    } else {
      const body = await res.json().catch(() => ({}))
      toast.error(body.error || "Photo upload failed")
    }
  }

  const addChild = () => setChildren((c) => [...c, { name: "", dateOfBirth: null }])
  const updateChild = (i: number, patch: Partial<ChildEntry>) =>
    setChildren((c) => c.map((child, idx) => (idx === i ? { ...child, ...patch } : child)))
  const removeChild = (i: number) => setChildren((c) => c.filter((_, idx) => idx !== i))

  const onSubmit = async (values: SlotFormValues) => {
    setSubmitError(null)
    if (!signature) {
      setSubmitError("Please sign above before submitting — it's required to complete eRegistration.")
      return
    }
    setSubmitting(true)
    try {
      const patchBody: Record<string, unknown> = { ...values, signatureDataUrl: signature }
      if (slot.isPrimary) patchBody.childrenInfo = children.filter((c) => c.name.trim())
      const patchRes = await fetch(`/api/eregistration/${token}/slots/${slot.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patchBody),
      })
      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => ({}))
        setSubmitError(body.error || "Couldn't save your details.")
        return
      }
      const finalizeRes = await fetch(`/api/eregistration/${token}/slots/${slot.id}/finalize`, { method: "POST" })
      const finalizeBody = await finalizeRes.json().catch(() => ({}))
      if (!finalizeRes.ok) {
        setSubmitError(finalizeBody.error || "Couldn't submit — please check the form and try again.")
        return
      }
      toast.success("eRegistration submitted — thank you!")
      onSubmitted()
    } catch {
      setSubmitError("An unexpected error occurred.")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <Button type="button" variant="ghost" size="sm" className="w-fit -ml-2" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to guest list
        </Button>
        <CardTitle>{slot.displayName || `Guest ${slot.slotIndex + 1}`}</CardTitle>
        <CardDescription>Fill in your details below, then sign to complete eRegistration.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Personal Details</h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField control={form.control} name="firstName" render={({ field }) => (
                  <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="middleName" render={({ field }) => (
                  <FormItem><FormLabel>Middle Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="lastName" render={({ field }) => (
                  <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField control={form.control} name="dateOfBirth" render={({ field }) => (
                  <FormItem><FormLabel>Date of Birth</FormLabel><FormControl><DatePicker value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="nationality" render={({ field }) => (
                  <FormItem><FormLabel>Nationality</FormLabel><FormControl><Input {...field} placeholder="e.g. British" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="gender" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gender</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="MALE">Male</SelectItem>
                        <SelectItem value="FEMALE">Female</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="mobile" render={({ field }) => (
                  <FormItem><FormLabel>Mobile</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Address</h4>
              <FormField control={form.control} name="addressFull" render={({ field }) => (
                <FormItem><FormLabel>Address</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField control={form.control} name="addressCity" render={({ field }) => (
                  <FormItem><FormLabel>City</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="addressCountry" render={({ field }) => (
                  <FormItem><FormLabel>Country</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Identification</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField control={form.control} name="documentType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Document Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="PASSPORT">Passport</SelectItem>
                        <SelectItem value="NATIONAL_ID">National ID</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="documentNumber" render={({ field }) => (
                  <FormItem><FormLabel>Document Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField control={form.control} name="issuingCountry" render={({ field }) => (
                  <FormItem><FormLabel>Issuing Country</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="documentIssueDate" render={({ field }) => (
                  <FormItem><FormLabel>Issue Date</FormLabel><FormControl><DatePicker value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="documentExpiryDate" render={({ field }) => (
                  <FormItem><FormLabel>Expiry Date</FormLabel><FormControl><DatePicker value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="space-y-2">
                <Label>ID / Passport Photo (optional)</Label>
                <div className="flex items-center gap-3">
                  {photoPreviewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreviewUrl} alt="ID document" className="h-16 w-24 rounded border object-cover" />
                  )}
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/60">
                    <FileText className="h-4 w-4" /> {hasPhoto || photoFile ? "Replace photo" : "Add photo"}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoSelect(f) }}
                    />
                  </label>
                </div>
              </div>
            </div>

            {slot.isPrimary && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Traveling with children?</h4>
                {children.map((child, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                    <Input placeholder="Child's name" value={child.name} onChange={(e) => updateChild(i, { name: e.target.value })} />
                    <DatePicker value={child.dateOfBirth ?? undefined} onChange={(v) => updateChild(i, { dateOfBirth: v })} placeholder="Date of birth" />
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeChild(i)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addChild}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add child</Button>
              </div>
            )}

            <div className="space-y-2">
              <Label>Signature <span className="text-destructive">*</span></Label>
              <SignaturePad value={signature} onChange={setSignature} />
            </div>

            {submitError && <p className="text-sm text-destructive">{submitError}</p>}

            <Button type="submit" className="w-full" disabled={submitting} style={{ backgroundColor: brandColor }}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {submitting ? "Submitting…" : "Submit eRegistration"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
