"use client"

import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { Plus, Pencil, Trash2, ListChecks, Clock, CalendarOff, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { useProperty } from "@/components/providers/property-provider"

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
const EXCEPTION_TYPES = ["DAY_OFF", "LEAVE", "TRAINING", "SICK", "EXTENDED_HOURS", "UNAVAILABLE"] as const

export function SpaTherapistsManager() {
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  const [therapists, setTherapists] = useState<SpaTherapistDto[]>([])
  const [treatments, setTreatments] = useState<TreatmentOption[]>([])
  const [users, setUsers] = useState<{ id: string; firstName: string; lastName: string; email: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SpaTherapistDto | null>(null)
  const [deleting, setDeleting] = useState<SpaTherapistDto | null>(null)
  const [skillsFor, setSkillsFor] = useState<SpaTherapistDto | null>(null)
  const [skillRows, setSkillRows] = useState<Record<string, SkillRow>>({})
  const [scheduleFor, setScheduleFor] = useState<SpaTherapistDto | null>(null)
  const [exceptionsFor, setExceptionsFor] = useState<SpaTherapistDto | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
        fetchTherapists()
      } else {
        const body = await res.json().catch(() => null)
        setServerError(body?.error || "Failed to save therapist")
      }
    } finally {
      setSubmitting(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const res = await fetch(`/api/spa/therapists/${deleting.id}`, { method: "DELETE" })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setServerError(body?.error || "Failed to delete therapist")
    } else {
      setServerError(null)
    }
    setDeleting(null)
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
    const res = await fetch(`/api/spa/therapists/${skillsFor.id}/skills`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skills }),
    })
    if (res.ok) {
      setSkillsFor(null)
      fetchTherapists()
    } else {
      const body = await res.json().catch(() => null)
      setServerError(body?.error || "Failed to save skills")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} className="shadow-sm">
          <Plus className="mr-2 h-4 w-4" /> New Therapist
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Qualified For</TableHead>
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
                  {t.isActive && t.bookable ? (
                    <Badge variant="outline" className="bg-success-muted text-success border-success/30">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">{t.isActive ? "Not bookable" : "Inactive"}</Badge>
                  )}
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
                  <Button variant="outline" size="icon" onClick={() => openEdit(t)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleting(t)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Therapist" : "New Therapist"}</DialogTitle>
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
                <div className="grid grid-cols-2 gap-4">
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
                      <FormLabel>Linked User <span className="text-muted-foreground font-normal">(login)</span></FormLabel>
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
                <div className="grid grid-cols-2 gap-4">
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
                <div className="grid grid-cols-2 gap-4">
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
                <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save Therapist"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Therapist</DialogTitle>
            <DialogDescription>
              Delete &quot;{deleting?.displayName}&quot;? If they have any appointments assigned this will be blocked — mark inactive instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Skills */}
      <Dialog open={!!skillsFor} onOpenChange={(open) => !open && setSkillsFor(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Treatment Skills — {skillsFor?.displayName}</DialogTitle>
            <DialogDescription>Only qualified therapists are offered by the booking engine for a treatment.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto space-y-2 py-2">
            {treatments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No treatments configured yet.</p>
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
            <Button onClick={saveSkills}>Save</Button>
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
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(firstExisting?.effectiveFrom.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
  const [effectiveTo, setEffectiveTo] = useState<string | null>(firstExisting?.effectiveTo?.slice(0, 10) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
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
        const body = await res.json().catch(() => null)
        setError(body?.error || "Failed to save schedule")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Working Hours — {therapist.displayName}</DialogTitle>
          <DialogDescription>Weekly recurring schedule. Day-off/leave exceptions are managed separately.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Effective From *</p>
            <DatePicker value={effectiveFrom} onChange={setEffectiveFrom} placeholder="Start" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Effective To</p>
            <DatePicker value={effectiveTo} onChange={setEffectiveTo} placeholder="Open-ended" />
          </div>
        </div>
        <div className="space-y-2 max-h-[45vh] overflow-y-auto">
          {DAY_LABELS.map((label, d) => (
            <div key={d} className="grid grid-cols-[80px_auto_1fr_1fr] items-center gap-2 rounded-md border p-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={days[d].working}
                  onCheckedChange={(checked) => setDays((prev) => ({ ...prev, [d]: { ...prev[d], working: !!checked } }))}
                />
                <span className="text-sm">{label}</span>
              </div>
              <div />
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
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Schedule"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TherapistExceptionsDialog({ therapist, onClose, onChanged }: { therapist: SpaTherapistDto; onClose: () => void; onChanged: () => void }) {
  const [exceptions, setExceptions] = useState<ExceptionRow[]>(therapist.exceptions)
  const [date, setDate] = useState<string | null>(null)
  const [exceptionType, setExceptionType] = useState<string>("DAY_OFF")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const add = async () => {
    if (!date) {
      setError("Date is required")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/spa/therapists/${therapist.id}/exceptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, exceptionType, reason: reason || null }),
      })
      if (res.ok) {
        const created = await res.json()
        setExceptions((prev) => [...prev, created])
        setDate(null)
        setReason("")
        onChanged()
      } else {
        const body = await res.json().catch(() => null)
        setError(body?.error || "Failed to add exception")
      }
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    const res = await fetch(`/api/spa/therapists/${therapist.id}/exceptions/${id}`, { method: "DELETE" })
    if (res.ok) {
      setExceptions((prev) => prev.filter((e) => e.id !== id))
      onChanged()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Availability Exceptions — {therapist.displayName}</DialogTitle>
          <DialogDescription>Day off, leave, sick day, or a temporary change to normal working hours.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_1fr] gap-2 items-end py-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Date *</p>
            <DatePicker value={date} onChange={setDate} placeholder="Select date" />
          </div>
          <Select value={exceptionType} onValueChange={(v) => setExceptionType(v ?? "DAY_OFF")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {EXCEPTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="col-span-2" />
          <Button type="button" onClick={add} disabled={saving} className="col-span-2">
            <Plus className="h-4 w-4 mr-1.5" /> Add Exception
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="max-h-[35vh] overflow-y-auto space-y-2">
          {exceptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exceptions recorded.</p>
          ) : (
            exceptions.map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div>
                  <span className="font-medium">{new Date(e.date).toDateString()}</span>
                  <Badge variant="outline" className="ml-2">{e.exceptionType.replace(/_/g, " ")}</Badge>
                  {e.reason && <span className="text-muted-foreground ml-2">{e.reason}</span>}
                </div>
                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => remove(e.id)}>
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
