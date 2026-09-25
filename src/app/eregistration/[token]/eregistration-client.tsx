"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { format } from "date-fns"
import { NationalitySelect } from "@/components/ui/nationality-select"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, type FieldErrors } from "react-hook-form"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { SignaturePad } from "@/components/eregistration/signature-pad"
import {
  Loader2, CheckCircle2, AlertTriangle, Users, ArrowLeft, FileText, Plus, Trash2, Sparkles,
  Contact, ChevronLeft, ChevronRight,
} from "@/components/icons"
import { INPUT_EMAIL, INPUT_PHONE } from "@/lib/input-presets"
import { cn } from "@/lib/utils"
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

// The guest form is split into steps. The ID photo comes first because scanning it
// autofills most of the rest. Each step lists the fields "Next" validates before moving
// on; the final Submit still validates the whole schema (and jumps back to the first step
// with an error if something slipped through).
const STEPS: { title: string; hint: string; fields: (keyof SlotFormValues)[] }[] = [
  {
    title: "ID document",
    hint: "Snap your passport or ID first — we'll fill in as much of the form as we can for you.",
    fields: ["documentType", "documentNumber", "issuingCountry", "documentIssueDate", "documentExpiryDate"],
  },
  {
    title: "Personal details",
    hint: "Check these match your travel document.",
    fields: ["firstName", "middleName", "lastName", "dateOfBirth", "nationality", "gender"],
  },
  {
    title: "Contact & address",
    hint: "How the property can reach you. All optional.",
    fields: ["email", "mobile", "addressFull", "addressCity", "addressCountry"],
  },
  {
    title: "Sign & submit",
    hint: "Sign with your finger to complete eRegistration.",
    fields: [],
  },
]
const LAST_STEP = STEPS.length - 1

// Native date inputs on this guest page (owner decision 2026-09-25, DECISIONS: a calendar
// popover is slow for birth dates). Their value is already yyyy-MM-dd, same as DatePicker's.
const MIN_DATE = "1900-01-01"
const MAX_DOC_DATE = "2100-12-31"
const DATE_INPUT_CLASS = "[&::-webkit-date-and-time-value]:text-left"

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

function scrollToTop() {
  if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "auto" })
}

export function EregistrationClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<LandingData | null>(null)
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null)
  const [justSubmitted, setJustSubmitted] = useState<string | null>(null)

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

  // Switching between the guest list and a guest's form always starts at the top.
  useEffect(() => { scrollToTop() }, [activeSlotId])

  if (loading && !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>This link isn&apos;t available</AlertTitle>
          <AlertDescription>{loadError || "Contact the property for a new link."}</AlertDescription>
        </Alert>
      </div>
    )
  }

  const activeSlot = activeSlotId
    ? data.reservations.flatMap((r) => r.slots.map((s) => ({ ...s, reservationId: r.reservationId }))).find((s) => s.id === activeSlotId)
    : null

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background" style={{ borderTop: `3px solid ${data.brandColor}` }}>
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {data.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoUrl} alt="" className="h-9 max-w-[120px] shrink-0 object-contain" />
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight" style={{ color: data.brandColor }}>{data.propertyName}</p>
            <p className="text-xs text-muted-foreground">Online registration</p>
          </div>
        </div>
      </header>

      <main className={cn("mx-auto max-w-2xl space-y-4 px-4 py-6 sm:py-8", activeSlot && "pb-32")}>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !activeSlot ? (
          <SlotListView
            data={data}
            justSubmitted={justSubmitted}
            onPick={(id) => { setJustSubmitted(null); setActiveSlotId(id) }}
          />
        ) : (
          <SlotFormView
            key={activeSlot.id}
            token={token}
            slot={activeSlot}
            brandColor={data.brandColor}
            onBack={() => setActiveSlotId(null)}
            onSubmitted={(name) => { setJustSubmitted(name); setActiveSlotId(null); fetchLanding() }}
          />
        )}
      </main>
    </div>
  )
}

function SlotListView({
  data, justSubmitted, onPick,
}: {
  data: LandingData
  justSubmitted: string | null
  onPick: (id: string) => void
}) {
  const allSlots = data.reservations.flatMap((r) => r.slots)
  const doneCount = allSlots.filter((s) => s.status !== "PENDING").length
  const allDone = allSlots.length > 0 && doneCount === allSlots.length
  const firstCheckIn = data.reservations[0]?.checkInDate

  return (
    <>
      {allDone ? (
        <Card className="hover:translate-y-0 hover:shadow-elevation-1">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: data.brandColor }}
            >
              <CheckCircle2 className="h-8 w-8" />
            </span>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">You&apos;re all done</h1>
              <p className="text-sm text-muted-foreground">
                Registration is complete for every guest{allSlots.length === 1 ? "" : ` (${allSlots.length})`}.
                {firstCheckIn ? ` We look forward to welcoming you on ${fmtDate(firstCheckIn)}.` : " We look forward to welcoming you."}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">You can close this page.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="hover:translate-y-0 hover:shadow-elevation-1">
          <CardHeader>
            <CardTitle>eRegistration</CardTitle>
            <CardDescription>{data.message || "Complete your registration details ahead of arrival — it only takes a few minutes."}</CardDescription>
            {allSlots.length > 1 && (
              <div className="space-y-1.5 pt-2">
                <p className="text-xs font-medium text-muted-foreground">{doneCount} of {allSlots.length} guests completed</p>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(doneCount / allSlots.length) * 100}%`, backgroundColor: data.brandColor }}
                  />
                </div>
              </div>
            )}
          </CardHeader>
        </Card>
      )}

      {justSubmitted && !allDone && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Thank you{justSubmitted ? `, ${justSubmitted}` : ""} — details submitted</AlertTitle>
          <AlertDescription>Pick the next guest below to continue.</AlertDescription>
        </Alert>
      )}

      {data.reservations.map((r) => (
        <Card key={r.reservationId} className="hover:translate-y-0 hover:shadow-elevation-1">
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
                className="flex min-h-14 w-full items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors enabled:hover:bg-muted/60 disabled:opacity-70"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{s.displayName || `Guest ${s.slotIndex + 1}`}</span>
                  {s.isPrimary && <Badge variant="outline" className="text-[10px] uppercase">Lead</Badge>}
                </span>
                {s.status === "PENDING" ? (
                  <Badge className="shrink-0">Fill in details <ChevronRight className="ml-0.5 h-3 w-3" /></Badge>
                ) : (
                  <Badge variant="secondary" className="flex shrink-0 items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Submitted</Badge>
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
  onSubmitted: (displayName: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(0)
  const [signature, setSignature] = useState<string | null>(null)
  const [hasPhoto, setHasPhoto] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [children, setChildren] = useState<ChildEntry[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [autofillNote, setAutofillNote] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), [])

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

  const goToStep = (next: number) => {
    setStep(next)
    scrollToTop()
  }

  const goNext = async () => {
    const ok = await form.trigger(STEPS[step].fields, { shouldFocus: true })
    if (ok) goToStep(Math.min(step + 1, LAST_STEP))
  }

  const handlePhotoSelect = async (file: File) => {
    setPhotoFile(file)
    setPhotoPreviewUrl(URL.createObjectURL(file))
    setAutofillNote(null)
    setUploading(true)
    const fd = new FormData()
    fd.append("photo", file)
    try {
      const res = await fetch(`/api/eregistration/${token}/slots/${slot.id}/photo`, { method: "POST", body: fd })
      if (res.ok) {
        setHasPhoto(true)
        toast.success("Photo uploaded")
        scanAndAutofill(file)
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error || "Photo upload failed")
      }
    } catch {
      toast.error("Photo upload failed")
    } finally {
      setUploading(false)
    }
  }

  // Experimental: OCR's the just-uploaded photo (passport MRZ or a best-effort read of a
  // Maldivian NID) and fills in only the fields the guest hasn't already typed themselves —
  // never overwrites something they've already entered, and never touches the form at all
  // if nothing usable was detected.
  const scanAndAutofill = async (file: File | null) => {
    if (!file) return
    setScanning(true)
    try {
      const fd = new FormData()
      fd.append("photo", file)
      const res = await fetch(`/api/eregistration/${token}/slots/${slot.id}/scan-document`, { method: "POST", body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || "Couldn't read that document — you can still fill the form in manually.")
        return
      }
      const fields: Record<string, string | null | undefined> = body.fields || {}
      const current = form.getValues()
      const fillable: (keyof SlotFormValues)[] = [
        "firstName", "lastName", "dateOfBirth", "nationality", "gender",
        "issuingCountry", "documentNumber", "documentExpiryDate",
      ]
      let filled = 0
      fillable.forEach((key) => {
        const value = fields[key]
        if (value && !current[key]) {
          form.setValue(key, value, { shouldDirty: true, shouldValidate: true })
          filled += 1
        }
      })
      if (body.documentType && !current.documentType) {
        form.setValue("documentType", body.documentType, { shouldDirty: true, shouldValidate: true })
        filled += 1
      }
      if (filled > 0) {
        setAutofillNote(
          body.confidence === "low"
            ? "Auto-filled from your ID — this is a best-effort read, please double-check every field before submitting."
            : "Auto-filled from your passport — please review before submitting."
        )
        toast.success(`Auto-filled ${filled} field${filled === 1 ? "" : "s"} from your document`)
      }
    } catch {
      toast.error("Couldn't reach the server to scan that document.")
    } finally {
      setScanning(false)
    }
  }

  const addChild = () => setChildren((c) => [...c, { name: "", dateOfBirth: null }])
  const updateChild = (i: number, patch: Partial<ChildEntry>) =>
    setChildren((c) => c.map((child, idx) => (idx === i ? { ...child, ...patch } : child)))
  const removeChild = (i: number) => setChildren((c) => c.filter((_, idx) => idx !== i))

  const onSubmit = async (values: SlotFormValues) => {
    setSubmitError(null)
    if (!signature) {
      setSubmitError("Sign above before submitting — it's required to complete eRegistration.")
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
      toast.success("eRegistration submitted — thank you.")
      onSubmitted([values.firstName, values.lastName].filter(Boolean).join(" ") || slot.displayName || "")
    } catch {
      setSubmitError("An unexpected error occurred.")
    } finally {
      setSubmitting(false)
    }
  }

  // Whole-form validation failed on Submit: send the guest to the first step with an error.
  const onInvalid = (errors: FieldErrors<SlotFormValues>) => {
    const firstBad = STEPS.findIndex((s) => s.fields.some((f) => errors[f]))
    if (firstBad >= 0 && firstBad !== step) goToStep(firstBad)
  }

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // Enter in a field (or the bar's button) advances until the last step, then submits.
    if (step < LAST_STEP) {
      e.preventDefault()
      void goNext()
      return
    }
    return form.handleSubmit(onSubmit, onInvalid)(e)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    )
  }

  const busy = uploading || scanning
  const guestName = slot.displayName || `Guest ${slot.slotIndex + 1}`

  return (
    <Card className="hover:translate-y-0 hover:shadow-elevation-1">
      <CardHeader className="space-y-2">
        <Button type="button" variant="ghost" size="sm" className="w-fit -ml-2" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to guest list
        </Button>
        <CardTitle>{guestName}</CardTitle>
        <div className="space-y-2 pt-1" aria-live="polite">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{STEPS[step].title}</p>
            <p className="shrink-0 text-xs text-muted-foreground">Step {step + 1} of {STEPS.length}</p>
          </div>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }} aria-hidden>
            {STEPS.map((s, i) => (
              <div
                key={s.title}
                className={cn("h-1.5 rounded-full", i > step && "bg-muted")}
                style={i <= step ? { backgroundColor: brandColor, opacity: i < step ? 0.55 : 1 } : undefined}
              />
            ))}
          </div>
          <CardDescription>{STEPS[step].hint}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={handleFormSubmit} className="space-y-6" noValidate>
            {step === 0 && (
              <div className="space-y-5">
                {/* Scan first — the photo upload autofills document and personal fields. */}
                <div className="space-y-3 rounded-xl border border-dashed p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Contact className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium">Scan your passport or ID</p>
                      <p className="text-xs text-muted-foreground">
                        Take a clear photo of the photo page. We&apos;ll read it and fill in the form — you can check everything before submitting. Optional.
                      </p>
                    </div>
                  </div>

                  {photoPreviewUrl && (
                    <div className="relative overflow-hidden rounded-lg border bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photoPreviewUrl} alt="ID document" className="max-h-56 w-full object-contain" />
                      {busy && (
                        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-sm font-medium">
                          <Loader2 className="h-4 w-4 animate-spin" /> {uploading ? "Uploading…" : "Reading your document…"}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <label
                      className={cn(
                        "flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition-opacity hover:opacity-90",
                        busy && "pointer-events-none opacity-60",
                      )}
                      style={{ backgroundColor: brandColor }}
                    >
                      <Contact className="h-4 w-4" /> {hasPhoto || photoFile ? "Retake photo" : "Take photo of ID"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        disabled={busy}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoSelect(f); e.target.value = "" }}
                      />
                    </label>
                    {/* Touch devices: the camera input above opens the camera directly, so offer the gallery too. */}
                    <label
                      className={cn(
                        "hidden min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 text-sm hover:bg-muted/60 pointer-coarse:flex",
                        busy && "pointer-events-none opacity-60",
                      )}
                    >
                      <FileText className="h-4 w-4" /> Choose from photos
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        disabled={busy}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoSelect(f); e.target.value = "" }}
                      />
                    </label>
                    {photoFile && (
                      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => scanAndAutofill(photoFile)}>
                        {scanning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                        {scanning ? "Scanning…" : "Scan & autofill again"}
                      </Button>
                    )}
                  </div>

                  {autofillNote && (
                    <Alert>
                      <Sparkles className="h-4 w-4" />
                      <AlertDescription>{autofillNote}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Document details</h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField control={form.control} name="documentType" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Document type</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="PASSPORT">Passport</SelectItem>
                            <SelectItem value="NATIONAL_ID">National ID</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="documentNumber" render={({ field }) => (
                      <FormItem><FormLabel>Document number</FormLabel><FormControl>
                        <Input {...field} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="issuingCountry" render={({ field }) => (
                    <FormItem><FormLabel>Issuing country</FormLabel><FormControl><NationalitySelect standardOnly mode="country" value={field.value ?? ""} onValueChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField control={form.control} name="documentIssueDate" render={({ field }) => (
                      <FormItem><FormLabel>Issue date</FormLabel><FormControl>
                        <Input type="date" min={MIN_DATE} max={today} className={DATE_INPUT_CLASS} {...field} value={field.value ?? ""} />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="documentExpiryDate" render={({ field }) => (
                      <FormItem><FormLabel>Expiry date</FormLabel><FormControl>
                        <Input type="date" min={MIN_DATE} max={MAX_DOC_DATE} className={DATE_INPUT_CLASS} {...field} value={field.value ?? ""} />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-3">
                {autofillNote && (
                  <Alert>
                    <Sparkles className="h-4 w-4" />
                    <AlertDescription>{autofillNote}</AlertDescription>
                  </Alert>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField control={form.control} name="firstName" render={({ field }) => (
                    <FormItem><FormLabel>First name</FormLabel><FormControl>
                      <Input {...field} autoComplete="given-name" autoCapitalize="words" enterKeyHint="next" />
                    </FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="middleName" render={({ field }) => (
                    <FormItem><FormLabel>Middle name</FormLabel><FormControl>
                      <Input {...field} autoComplete="additional-name" autoCapitalize="words" enterKeyHint="next" />
                    </FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="lastName" render={({ field }) => (
                    <FormItem><FormLabel>Last name</FormLabel><FormControl>
                      <Input {...field} autoComplete="family-name" autoCapitalize="words" enterKeyHint="next" />
                    </FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField control={form.control} name="dateOfBirth" render={({ field }) => (
                    <FormItem><FormLabel>Date of birth</FormLabel><FormControl>
                      <Input type="date" autoComplete="bday" min={MIN_DATE} max={today} className={DATE_INPUT_CLASS} {...field} />
                    </FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="nationality" render={({ field }) => (
                    <FormItem><FormLabel>Nationality</FormLabel><FormControl><NationalitySelect standardOnly value={field.value} onValueChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="gender" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gender</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
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
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem><FormLabel>Email</FormLabel><FormControl>
                      <Input {...INPUT_EMAIL} {...field} enterKeyHint="next" />
                    </FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="mobile" render={({ field }) => (
                    <FormItem><FormLabel>Mobile</FormLabel><FormControl>
                      <Input {...INPUT_PHONE} {...field} enterKeyHint="next" />
                    </FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Address</h4>
                  <FormField control={form.control} name="addressFull" render={({ field }) => (
                    <FormItem><FormLabel>Address</FormLabel><FormControl>
                      <Textarea rows={2} autoComplete="street-address" {...field} />
                    </FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField control={form.control} name="addressCity" render={({ field }) => (
                      <FormItem><FormLabel>City</FormLabel><FormControl>
                        <Input {...field} autoComplete="address-level2" autoCapitalize="words" enterKeyHint="next" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="addressCountry" render={({ field }) => (
                      <FormItem><FormLabel>Country</FormLabel><FormControl>
                        <Input {...field} autoComplete="country-name" autoCapitalize="words" enterKeyHint="next" />
                      </FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                </div>
              </div>
            )}

            {step === LAST_STEP && (
              <div className="space-y-6">
                {slot.isPrimary && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold">Traveling with children?</h4>
                    {children.map((child, i) => (
                      <div
                        key={i}
                        className="space-y-2 rounded-lg border p-3 sm:grid sm:grid-cols-[1fr_12rem_auto] sm:items-center sm:gap-2 sm:space-y-0 sm:border-0 sm:p-0"
                      >
                        <div className="flex items-center justify-between sm:hidden">
                          <span className="text-xs font-medium text-muted-foreground">Child {i + 1}</span>
                          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeChild(i)}>
                            <Trash2 className="mr-1 h-4 w-4" /> Remove
                          </Button>
                        </div>
                        <Input
                          placeholder="Child's name"
                          aria-label={`Child ${i + 1} name`}
                          autoComplete="off"
                          autoCapitalize="words"
                          value={child.name}
                          onChange={(e) => updateChild(i, { name: e.target.value })}
                        />
                        <div className="space-y-1 sm:space-y-0">
                          <Label className="text-xs text-muted-foreground sm:sr-only" htmlFor={`child-dob-${i}`}>Date of birth</Label>
                          <Input
                            id={`child-dob-${i}`}
                            type="date"
                            min={MIN_DATE}
                            max={today}
                            className={DATE_INPUT_CLASS}
                            value={child.dateOfBirth ?? ""}
                            onChange={(e) => updateChild(i, { dateOfBirth: e.target.value || null })}
                          />
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label="Remove child" onClick={() => removeChild(i)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={addChild}>
                      <Plus className="mr-1.5 h-4 w-4" /> Add child
                    </Button>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Signature <span className="text-destructive">*</span></Label>
                  <SignaturePad value={signature} onChange={(v) => { setSignature(v); if (v) setSubmitError(null) }} />
                </div>
              </div>
            )}

            {submitError && <p className="text-sm text-destructive" role="alert">{submitError}</p>}

            {/* Primary action pinned to the bottom of the screen, clear of the iPhone home bar. */}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <div className="mx-auto flex max-w-2xl gap-2 px-4">
                {step > 0 && (
                  <Button type="button" variant="outline" className="h-11 px-4" disabled={submitting} onClick={() => goToStep(step - 1)}>
                    <ChevronLeft className="mr-1 h-4 w-4" /> Back
                  </Button>
                )}
                <Button
                  type="submit"
                  className="h-11 flex-1 text-base text-white"
                  disabled={submitting || busy}
                  style={{ backgroundColor: brandColor }}
                >
                  {step < LAST_STEP ? (
                    <>
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {busy ? "Reading your ID…" : "Next"}
                      {!busy && <ChevronRight className="ml-1 h-4 w-4" />}
                    </>
                  ) : (
                    <>
                      {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {submitting ? "Submitting…" : "Submit eRegistration"}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
