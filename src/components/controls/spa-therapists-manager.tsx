"use client"

import { todayKey } from "@/lib/date-only"
import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Plus, Pencil, Trash2, ListChecks, Clock, CalendarOff, Users } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { MobileActions } from "@/components/ui/mobile"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { therapistExceptionSchema, THERAPIST_EXCEPTION_TYPES } from "@/lib/spa-exception"
import { StatusBadge } from "@/components/ui/status-badge"
import { SubmitButton } from "@/components/ui/submit-button"
import { useConfirm } from "@/components/providers/confirm-provider"
import { apiError } from "@/lib/api-error"
import { toast } from "@/lib/toast"

type TreatmentOption = { id: string; name: string }

type SkillRow = { treatmentId: string; qualified: boolean; preferred: boolean }
type ScheduleRow = { id: string; dayOfWeek: number; startTime: string; endTime: string; effectiveFrom: string; effectiveTo: string | null }
type ExceptionRow = { id: string; date: string; startTime: string | null; endTime: string | null; exceptionType: string; reason: string | null }

type SpaTherapistDto = {
  id: string
  userId: string | null
  user: { id: string; firstName: string; lastName: string; email: string } | null
  displayName: string
  gender: string | null
  phone: string | null
  email: string | null
  isActive: boolean
  bookable: boolean
  displayOrder: number
  skills: { treatmentId: string; qualified: boolean; preferred: boolean; treatment: { id: string; name: string } }[]
  schedules: ScheduleRow[]
  exceptions: ExceptionRow[]
}

const therapistSchema = z.object({
  displayName: z.string().min(2, "Name must be at least 2 characters"),
  userId: z.string().optional(),
  gender: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  isActive: z.boolean(),
  bookable: z.boolean(),
  displayOrder: z.string().refine((v) => !isNaN(parseInt(v)), "Must be a number"),
})

type TherapistFormValues = z.infer<typeof therapistSchema>

const emptyValues: TherapistFormValues = {
  displayName: "", userId: "", gender: "", phone: "", email: "", isActive: true, bookable: true, displayOrder: "0",
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
type ExceptionFormInput = z.input<typeof therapistExceptionSchema>
type ExceptionFormValues = z.output<typeof therapistExceptionSchema>

export function SpaTherapistsManager({ propertyId }: { propertyId: string }) {
  const confirm = useConfirm()
  const [therapists, setTherapists] = useState<SpaTherapistDto[]>([])
  const [treatments, setTreatments] = useState<TreatmentOption[]>([])
  const [users, setUsers] = useState<{ id: string; firstName: string; lastName: string; email: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SpaTherapistDto | null>(null)
  const [skillsFor, setSkillsFor] = useState<SpaTherapistDto | null>(null)
  const [skillRows, setSkillRows] = useState<Record<string, SkillRow>>({})
  const [scheduleFor, setScheduleFor] = useState<SpaTherapistDto | null>(null)
  const [exceptionsFor, setExceptionsFor] = useState<SpaTherapistDto | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [savingSkills, setSavingSkills] = useState(false)

  const form = useForm<TherapistFormValues>({ resolver: zodResolver(therapistSchema), mode: "onChange", defaultValues: emptyValues })

  const fetchTherapists = () => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/spa/therapists?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTherapists(data) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchTherapists()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  useEffect(() => {
    if (!propertyId) return
    fetch(`/api/spa/treatments?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTreatments(data.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }))) })
  }, [propertyId])

  useEffect(() => {
    fetch(`/api/settings/users`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setUsers(data) })
      .catch(() => {})
  }, [])

  const openCreate = () => {
    setEditing(null)
    setServerError(null)
    form.reset(emptyValues)
    setIsDialogOpen(true)
  }

  const openEdit = (t: SpaTherapistDto) => {
    setEditing(t)
    setServerError(null)
    form.reset({
      displayName: t.displayName,
      userId: t.userId ?? "",
      gender: t.gender ?? "",
      phone: t.phone ?? "",
      email: t.email ?? "",
      isActive: t.isActive,
      bookable: t.bookable,
      displayOrder: String(t.displayOrder),
    })
    setIsDialogOpen(true)
  }

  const onSubmit = async (values: TherapistFormValues) => {
    setSubmitting(true)
    setServerError(null)
    try {
      const payload = { ...values, propertyId, displayOrder: parseInt(values.displayOrder) }
      const url = editing ? `/api/spa/therapists/${editing.id}` : "/api/spa/therapists"
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setIsDialogOpen(false)
        toast.success("Therapist saved")
        fetchTherapists()
      } else {
        setServerError(await apiError(res, "Couldn't save the therapist. Try again."))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async (deleting: SpaTherapistDto) => {
    const ok = await confirm({
      title: "Delete therapist?",
      description: `Delete "${deleting.displayName}"? If they have any appointments assigned this will be blocked — mark inactive instead.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    const res = await fetch(`/api/spa/therapists/${deleting.id}`, { method: "DELETE" })
    if (!res.ok) {
      toast.error(await apiError(res, "Couldn't delete the therapist. Try again."))
    } else {
      setServerError(null)
      toast.success("Therapist deleted")
    }
    fetchTherapists()
  }

  // --- Skills ---
  const openSkills = (t: SpaTherapistDto) => {
    setSkillsFor(t)
    const rows: Record<string, SkillRow> = {}
    for (const s of t.skills) {
      rows[s.treatmentId] = { treatmentId: s.treatmentId, qualified: s.qualified, preferred: s.preferred }
    }
    setSkillRows(rows)
  }

  const saveSkills = async () => {
    if (!skillsFor) return
    const skills = Object.values(skillRows).filter((s) => s.qualified || s.preferred)
    setSavingSkills(true)
    try {
      const res = await fetch(`/api/spa/therapists/${skillsFor.id}/skills`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills }),
      })
      if (res.ok) {
        setSkillsFor(null)
        toast.success("Skills saved")
        fetchTherapists()
      } else {
        setServerError(await apiError(res, "Couldn't save the skills. Try again."))
      }
    } finally {
      setSavingSkills(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} className="shadow-sm">
          <Plus className="mr-2 h-4 w-4" /> Add therapist
        </Button>
      </div>

      {serverError && !isDialogOpen && !skillsFor && !scheduleFor && !exceptionsFor && (
        <p className="text-sm text-destructive">{serverError}</p>
      )}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : therapists.length === 0 ? (
        <EmptyState icon={Users} title="No therapists yet" description="Add your first therapist to start scheduling treatments." />
      ) : (
        <>
          {/* Phone view — the table below takes over at md. */}
          <MobileCardList>
            {therapists.map((t) => {
              const qualifiedCount = t.skills.filter((s) => s.qualified).length
              return (
                <MobileCard
                  key={t.id}
                  tone={t.isActive ? undefined : "muted"}
                  title={t.displayName}
                  subtitle={t.phone || t.email || "—"}
                  badge={
<StatusBadge tone={t.isActive && t.bookable ? "success" : "neutral"} label={t.isActive && t.bookable ? "Active" : t.isActive ? "Not bookable" : "Inactive"} />
                  }
                  meta={[{ label: "Qualified for", value: `${qualifiedCount} treatment${qualifiedCount === 1 ? "" : "s"}` }]}
                  onClick={() => openEdit(t)}
                  actions={
                    <MobileActions
                      className="w-full"
                      primary={
                        <Button variant="outline" onClick={() => openEdit(t)}>
                          <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                        </Button>
                      }
                      more={[
                        { label: "Skills", icon: ListChecks, onSelect: () => openSkills(t) },
                        { label: "Schedule", icon: Clock, onSelect: () => setScheduleFor(t) },
                        { label: "Exceptions", icon: CalendarOff, onSelect: () => setExceptionsFor(t) },
                        { label: "Delete", icon: Trash2, destructive: true, onSelect: () => confirmDelete(t) },
                      ]}
                    />
                  }
                />
              )
            })}
          </MobileCardList>

          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Qualified for</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {therapists.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.displayName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.phone || t.email || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.skills.filter((s) => s.qualified).length} treatment{t.skills.filter((s) => s.qualified).length === 1 ? "" : "s"}</Badge>
                    </TableCell>
                    <TableCell>
<StatusBadge tone={t.isActive && t.bookable ? "success" : "neutral"} label={t.isActive && t.bookable ? "Active" : t.isActive ? "Not bookable" : "Inactive"} />
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => openSkills(t)}>
                        <ListChecks className="h-4 w-4 mr-1.5" /> Skills
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setScheduleFor(t)}>
                        <Clock className="h-4 w-4 mr-1.5" /> Schedule
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setExceptionsFor(t)}>
                        <CalendarOff className="h-4 w-4 mr-1.5" /> Exceptions
                      </Button>
                      <Button variant="outline" size="icon" aria-label="Edit therapist" onClick={() => openEdit(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="icon" aria-label="Delete therapist" className="text-destructive hover:text-destructive" onClick={() => confirmDelete(t)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent size="md">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit therapist" : "Add therapist"}</DialogTitle>
                <DialogDescription>A therapist is a schedulable resource — a PMS login is optional and not required.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <FormField control={form.control} name="displayName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl><Input placeholder="e.g. Aisha" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="gender" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gender</FormLabel>
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="FEMALE">Female</SelectItem>
                          <SelectItem value="MALE">Male</SelectItem>
                          <SelectItem value="OTHER">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="userId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Linked user <span className="text-muted-foreground font-normal">(login)</span></FormLabel>
                      <FormControl>
                        <SearchableSelect
                          value={field.value ?? ""}
                          onChange={(v) => field.onChange(v)}
                          placeholder="Link a PMS user (optional)..."
                          options={[{ label: "— None —", value: "" }, ...users.map((u) => ({ label: `${u.firstName} ${u.lastName} (${u.email})`, value: u.id }))]}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input type="email" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="isActive" render={({ field }) => (
                    <FormItem className="flex items-center gap-3">
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="!mt-0 font-normal cursor-pointer">Active</FormLabel>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="bookable" render={({ field }) => (
                    <FormItem className="flex items-center gap-3">
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="!mt-0 font-normal cursor-pointer">Bookable</FormLabel>
                    </FormItem>
                  )} />
                </div>
                {serverError && <p className="text-sm text-destructive">{serverError}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <SubmitButton pending={submitting}>{editing ? "Save" : "Create"}</SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Skills */}
      <Dialog open={!!skillsFor} onOpenChange={(open) => !open && setSkillsFor(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Treatment skills — {skillsFor?.displayName}</DialogTitle>
            <DialogDescription>Only qualified therapists are offered by the booking engine for a treatment.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto space-y-2 py-2">
            {treatments.length === 0 ? (
              <EmptyState size="inline" title="No treatments configured yet." />
            ) : (
              treatments.map((t) => {
                const row = skillRows[t.id] ?? { treatmentId: t.id, qualified: false, preferred: false }
                return (
                  <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={row.qualified}
                        onCheckedChange={(checked) =>
                          setSkillRows((prev) => ({ ...prev, [t.id]: { ...row, qualified: !!checked, preferred: checked ? row.preferred : false } }))
                        }
                      />
                      <span className="text-sm">{t.name}</span>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={row.preferred}
                        disabled={!row.qualified}
                        onCheckedChange={(checked) => setSkillRows((prev) => ({ ...prev, [t.id]: { ...row, preferred: !!checked } }))}
                      />
                      Preferred
                    </label>
                  </div>
                )
              })
            )}
          </div>
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSkillsFor(null)}>Cancel</Button>
            <SubmitButton type="button" pending={savingSkills} onClick={saveSkills}>Save</SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule */}
      {scheduleFor && (
        <TherapistScheduleDialog
          therapist={scheduleFor}
          onClose={() => setScheduleFor(null)}
          onSaved={() => { setScheduleFor(null); fetchTherapists() }}
        />
      )}

      {/* Exceptions */}
      {exceptionsFor && (
        <TherapistExceptionsDialog
          therapist={exceptionsFor}
          onClose={() => setExceptionsFor(null)}
          onChanged={fetchTherapists}
        />
      )}
    </div>
  )
}

function TherapistScheduleDialog({ therapist, onClose, onSaved }: { therapist: SpaTherapistDto; onClose: () => void; onSaved: () => void }) {
  const [days, setDays] = useState<Record<number, { working: boolean; startTime: string; endTime: string }>>(() => {
    const initial: Record<number, { working: boolean; startTime: string; endTime: string }> = {}
    for (let d = 0; d < 7; d++) {
      const existing = therapist.schedules.find((s) => s.dayOfWeek === d)
      initial[d] = existing
        ? { working: true, startTime: existing.startTime, endTime: existing.endTime }
        : { working: false, startTime: "09:00", endTime: "17:00" }
    }
    return initial
  })
  const firstExisting = therapist.schedules[0]
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(firstExisting?.effectiveFrom.slice(0, 10) ?? todayKey())
  const [effectiveTo, setEffectiveTo] = useState<string | null>(firstExisting?.effectiveTo?.slice(0, 10) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!effectiveFrom) {
      setError("Effective-from date is required")
      return
    }
    setSaving(true)
    setError(null)
    const schedules = Object.entries(days)
      .filter(([, v]) => v.working)
      .map(([dayOfWeek, v]) => ({
        dayOfWeek: parseInt(dayOfWeek),
        startTime: v.startTime,
        endTime: v.endTime,
        effectiveFrom,
        effectiveTo: effectiveTo || null,
      }))
    try {
      const res = await fetch(`/api/spa/therapists/${therapist.id}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedules }),
      })
      if (res.ok) {
        onSaved()
      } else {
        setError(await apiError(res, "Couldn't save the schedule. Try again."))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <form onSubmit={save} className="contents">
        <DialogHeader>
          <DialogTitle>Working hours — {therapist.displayName}</DialogTitle>
          <DialogDescription>Weekly recurring schedule. Day-off/leave exceptions are managed separately.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 py-2 md:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Effective from *</p>
            <DatePicker value={effectiveFrom} onChange={setEffectiveFrom} placeholder="Start" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Effective to</p>
            <DatePicker value={effectiveTo} onChange={setEffectiveTo} placeholder="Open-ended" />
          </div>
        </div>
        <div className="space-y-2 max-h-[45vh] overflow-y-auto">
          {DAY_LABELS.map((label, d) => (
            <div key={d} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 md:grid-cols-[80px_auto_1fr_1fr]">
              <div className="flex items-center gap-2 col-span-2 md:col-span-1">
                <Checkbox
                  checked={days[d].working}
                  onCheckedChange={(checked) => setDays((prev) => ({ ...prev, [d]: { ...prev[d], working: !!checked } }))}
                />
                <span className="text-sm">{label}</span>
              </div>
              <div className="hidden md:block" />
              <Input
                type="time"
                value={days[d].startTime}
                disabled={!days[d].working}
                onChange={(e) => setDays((prev) => ({ ...prev, [d]: { ...prev[d], startTime: e.target.value } }))}
              />
              <Input
                type="time"
                value={days[d].endTime}
                disabled={!days[d].working}
                onChange={(e) => setDays((prev) => ({ ...prev, [d]: { ...prev[d], endTime: e.target.value } }))}
              />
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <SubmitButton pending={saving}>Save</SubmitButton>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TherapistExceptionsDialog({ therapist, onClose, onChanged }: { therapist: SpaTherapistDto; onClose: () => void; onChanged: () => void }) {
  const confirmRemove = useConfirm()
  const [exceptions, setExceptions] = useState<ExceptionRow[]>(therapist.exceptions)
  const [error, setError] = useState<string | null>(null)
  const empty: ExceptionFormInput = { date: "", exceptionType: "DAY_OFF", startTime: "", endTime: "", reason: "" }
  const form = useForm<ExceptionFormInput, unknown, ExceptionFormValues>({
    resolver: zodResolver(therapistExceptionSchema),
    mode: "onChange",
    defaultValues: empty,
  })
  const exceptionType = form.watch("exceptionType")
  const isExtended = exceptionType === "EXTENDED_HOURS"

  const add = async (values: ExceptionFormValues) => {
    setError(null)
    const res = await fetch(`/api/spa/therapists/${therapist.id}/exceptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    })
    if (res.ok) {
      const created = await res.json()
      setExceptions((prev) => [...prev, created])
      form.reset({ ...empty, exceptionType: values.exceptionType })
      onChanged()
    } else {
      setError(await apiError(res, "Couldn't add the exception. Try again."))
    }
  }

  const remove = async (id: string) => {
    if (!(await confirmRemove({ title: "Remove this exception?", confirmLabel: "Remove", destructive: true }))) return
    const res = await fetch(`/api/spa/therapists/${therapist.id}/exceptions/${id}`, { method: "DELETE" })
    if (res.ok) {
      setExceptions((prev) => prev.filter((e) => e.id !== id))
      onChanged()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Availability exceptions — {therapist.displayName}</DialogTitle>
          <DialogDescription>Day off, leave, sick day, or a temporary change to normal working hours.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(add)} className="grid grid-cols-1 gap-2 items-start py-2 md:grid-cols-[1fr_1fr]">
            <FormField control={form.control} name="date" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">Date *</FormLabel>
                <DatePicker value={field.value || null} onChange={(v) => field.onChange(v ?? "")} placeholder="Select date" />
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="exceptionType" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">Type *</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v ?? "DAY_OFF")
                    // Re-check the times against the new type's rule.
                    void form.trigger(["startTime", "endTime"])
                  }}
                >
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {THERAPIST_EXCEPTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="startTime" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">{isExtended ? "Available from *" : "From (optional)"}</FormLabel>
                <FormControl>
                  <Input type="time" {...field} value={field.value ?? ""} onChange={(e) => { field.onChange(e.target.value); void form.trigger("endTime") }} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="endTime" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">{isExtended ? "Available until *" : "Until (optional)"}</FormLabel>
                <FormControl>
                  <Input type="time" {...field} value={field.value ?? ""} onChange={(e) => { field.onChange(e.target.value); void form.trigger("startTime") }} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <p className="text-xs text-muted-foreground md:col-span-2">
              {isExtended
                ? "The therapist can be booked between these times on this date, even outside their weekly schedule or the spa's usual opening hours."
                : "Leave the times empty to block the whole day, or give both to block only part of it."}
            </p>
            <FormField control={form.control} name="reason" render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormControl><Input placeholder="Reason (optional)" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <SubmitButton pending={form.formState.isSubmitting} pendingLabel="Adding…" disabled={!form.formState.isValid} className="md:col-span-2">
              <Plus className="h-4 w-4 mr-1.5" /> Add exception
            </SubmitButton>
          </form>
        </Form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-[35vh] overflow-y-auto space-y-2">
          {exceptions.length === 0 ? (
            <EmptyState size="inline" title="No exceptions recorded." />
          ) : (
            exceptions.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{new Date(e.date).toDateString()}</span>
                  <Badge variant="outline" className="ml-2">{e.exceptionType.replace(/_/g, " ")}</Badge>
                  {e.startTime && <span className="ml-2 tabular-nums">{e.startTime}–{e.endTime ?? "23:59"}</span>}
                  {e.reason && <span className="text-muted-foreground ml-2">{e.reason}</span>}
                </div>
                <Button variant="ghost" size="icon" aria-label="Delete exception" className="text-destructive hover:text-destructive" onClick={() => remove(e.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
