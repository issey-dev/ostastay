"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { z } from "zod"
import { useForm, useFieldArray, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Briefcase as Inbox, Plus, Trash2 } from "@/components/icons"
import { MarkerChip } from "@/components/reservations/booking-marker"
import { isMarkerColor, isMarkerIcon } from "@/lib/booking-markers"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { usePermissions } from "@/hooks/use-permissions"

// Group Blocks › Requests (Agent Portal plan A-7, Phase 4). A Source's slot request holds
// nothing until a person approves it: Approve opens the request with everything editable
// (dates, rooms per type, cutoff, rolling release, elasticity, a checkpoint) and checks
// availability on save; Decline asks for a reason. Decided requests stay listed for 30 days.

type Hold = { roomTypeId: string; quantity: number; requestedQuantity: number | null; roomType: { code: string; name: string; isPseudo: boolean } }
type Req = {
  id: string
  code: string
  status: string
  startDate: string
  endDate: string
  requestNote: string | null
  isOverflowRequest: boolean
  decisionReason: string | null
  origin: string
  createdAt: string
  roomHolds: Hold[]
  sourceProfile: { upid: string; companyName: string | null; firstName: string; markerIcon: string | null; markerColor: string | null } | null
}

const dayKey = (d: string) => d.slice(0, 10)

const approveSchema = z
  .object({
    startDate: z.string().min(1, "Pick a start"),
    endDate: z.string().min(1, "Pick an end"),
    rooms: z.array(z.object({ roomTypeId: z.string(), label: z.string(), quantity: z.coerce.number().int().min(0, "0 or more").max(500) })),
    cutoffDate: z.string(),
    releaseDays: z.string().refine((v) => v === "" || /^\d{1,3}$/.test(v), "Days, or empty"),
    elasticRooms: z.coerce.number().int().min(0).max(500),
    elasticNightsBefore: z.coerce.number().int().min(0).max(60),
    elasticNightsAfter: z.coerce.number().int().min(0).max(60),
    checkpoints: z.array(z.object({ date: z.string().min(1, "Pick a date"), minPercent: z.coerce.number().int().min(1, "1 to 100").max(100, "1 to 100") })).max(6),
    note: z.string().max(1000),
  })
  .refine((v) => v.endDate > v.startDate, { message: "The slot must end after it starts", path: ["endDate"] })
  .refine((v) => v.rooms.some((r) => r.quantity > 0), { message: "Approve at least one room", path: ["rooms"] })
type ApproveValues = z.infer<typeof approveSchema>

export function SlotRequestsPanel({ propertyId }: { propertyId: string }) {
  const [rows, setRows] = useState<Req[] | null>(null)
  const [approving, setApproving] = useState<Req | null>(null)
  const [declining, setDeclining] = useState<Req | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const { has } = usePermissions()
  const canDecide = has("groups.decideSlotRequest")

  const load = useCallback(async () => {
    const res = await fetch(`/api/groups/requests?propertyId=${propertyId}`)
    setRows(res.ok ? await res.json() : [])
  }, [propertyId])
  useEffect(() => {
    load()
  }, [load])

  const form = useForm<ApproveValues>({ resolver: zodResolver(approveSchema) as Resolver<ApproveValues>, mode: "onChange" })
  const rooms = useFieldArray({ control: form.control, name: "rooms" })
  const cps = useFieldArray({ control: form.control, name: "checkpoints" })

  const openApprove = (r: Req) => {
    form.reset({
      startDate: dayKey(r.startDate),
      endDate: dayKey(r.endDate),
      rooms: r.roomHolds.map((h) => ({ roomTypeId: h.roomTypeId, label: `${h.roomType.code} · ${h.roomType.name}`, quantity: h.quantity })),
      cutoffDate: "",
      releaseDays: "",
      elasticRooms: 0,
      elasticNightsBefore: 0,
      elasticNightsAfter: 0,
      checkpoints: [],
      note: "",
    })
    setApproving(r)
  }

  const approve = form.handleSubmit(async (v) => {
    if (!approving) return
    setBusy(true)
    try {
      const res = await fetch(`/api/groups/${approving.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          startDate: v.startDate,
          endDate: v.endDate,
          rooms: v.rooms.filter((r) => r.quantity > 0).map((r) => ({ roomTypeId: r.roomTypeId, quantity: r.quantity })),
          note: v.note || null,
          rules: {
            cutoffDate: v.cutoffDate || null,
            releaseDays: v.releaseDays === "" ? null : Number(v.releaseDays),
            elasticRooms: v.elasticRooms,
            elasticNightsBefore: v.elasticNightsBefore,
            elasticNightsAfter: v.elasticNightsAfter,
            checkpoints: v.checkpoints,
          },
        }),
      })
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't approve the request."))
        return
      }
      toast.success(`Slot ${approving.code} approved`, { description: "The rooms are held as a tentative block." })
      setApproving(null)
      load()
    } finally {
      setBusy(false)
    }
  })

  const decline = async () => {
    if (!declining || !reason.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/groups/${declining.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline", reason }),
      })
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't decline the request."))
        return
      }
      toast.success(`Slot request ${declining.code} declined`)
      setDeclining(null)
      setReason("")
      load()
    } finally {
      setBusy(false)
    }
  }

  if (!rows) return <Skeleton className="h-40 w-full" />
  if (rows.length === 0) {
    return <EmptyState icon={Inbox} title="No slot requests" description="When a source asks for a slot, it appears here for you to approve or decline. A request holds no rooms." />
  }

  const err = form.formState.errors
  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {rows.map((r) => {
          const src = r.sourceProfile
          const marker = src && isMarkerIcon(src.markerIcon) && isMarkerColor(src.markerColor) ? { icon: src.markerIcon, color: src.markerColor, label: src.companyName || src.firstName } : null
          const total = r.roomHolds.reduce((s, h) => s + h.quantity, 0)
          return (
            <li key={r.id} className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold">
                    {marker && <MarkerChip marker={marker} />}
                    <span className="truncate">{src ? src.companyName || src.firstName : "No source"}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{r.code} · asked {format(new Date(r.createdAt), "d MMM, HH:mm")}{r.origin === "AGENT_PORTAL" ? " · from the agent portal" : ""}</p>
                </div>
                <StatusBadge label={r.status === "REQUESTED" ? "Waiting" : r.status === "DECLINED" ? "Declined" : "Approved"} status={r.status === "REQUESTED" ? "PENDING" : r.status === "DECLINED" ? "DENIED" : "APPROVED"} />
              </div>
              <p>
                {format(new Date(r.startDate), "EEE d MMM")} to {format(new Date(r.endDate), "EEE d MMM yyyy")} · {total} room{total === 1 ? "" : "s"}
                {r.isOverflowRequest && <span className="ml-1 font-medium">(overflow: partner hotel)</span>}
              </p>
              <ul className="text-xs text-muted-foreground">
                {r.roomHolds.map((h) => (
                  <li key={h.roomTypeId}>
                    {h.roomType.name}: {h.quantity}
                    {h.requestedQuantity !== null && h.requestedQuantity !== h.quantity ? ` (asked ${h.requestedQuantity})` : ""}
                  </li>
                ))}
              </ul>
              {r.requestNote && <p className="rounded bg-muted/60 p-2 text-xs">{r.requestNote}</p>}
              {r.decisionReason && r.status !== "REQUESTED" && <p className="text-xs text-muted-foreground">Note: {r.decisionReason}</p>}
              {r.status === "REQUESTED" && canDecide && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={() => openApprove(r)}>Review and approve</Button>
                  <Button size="sm" variant="outline" onClick={() => setDeclining(r)}>Decline</Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <Dialog open={!!approving} onOpenChange={(o) => !o && setApproving(null)}>
        <DialogContent size="lg" mobile="fullscreen">
          <form onSubmit={approve} className="contents">
            <DialogHeader>
              <DialogTitle>Approve slot {approving?.code}</DialogTitle>
              <DialogDescription>
                Change anything before approving. Availability is checked when you save; the rooms are then held as a tentative block and the source can enter bookings.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>From</Label>
                <Controller control={form.control} name="startDate" render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />} />
              </div>
              <div className="grid gap-1.5">
                <Label>To</Label>
                <Controller control={form.control} name="endDate" render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />} />
                {err.endDate && <p className="text-xs text-destructive">{err.endDate.message}</p>}
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Rooms</Label>
                {rooms.fields.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm">{f.label}</span>
                    <Input className="w-24" inputMode="numeric" aria-label={`Rooms of ${f.label}`} {...form.register(`rooms.${i}.quantity`)} />
                  </div>
                ))}
                {err.rooms?.message && <p className="text-xs text-destructive">{err.rooms.message}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label>Cutoff (unsold rooms return to sale)</Label>
                <Controller control={form.control} name="cutoffDate" render={({ field }) => <DatePicker value={field.value || null} onChange={field.onChange} placeholder="No cutoff" />} />
              </div>
              <div className="grid gap-1.5">
                <Label>Rolling release (days before each night)</Label>
                <Input inputMode="numeric" placeholder="Off" {...form.register("releaseDays")} />
                {err.releaseDays && <p className="text-xs text-destructive">{err.releaseDays.message}</p>}
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Flexibility past the slot</Label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="grid gap-1 text-xs text-muted-foreground">Extra rooms a night<Input inputMode="numeric" {...form.register("elasticRooms")} /></label>
                  <label className="grid gap-1 text-xs text-muted-foreground">Nights before<Input inputMode="numeric" {...form.register("elasticNightsBefore")} /></label>
                  <label className="grid gap-1 text-xs text-muted-foreground">Nights after<Input inputMode="numeric" {...form.register("elasticNightsAfter")} /></label>
                </div>
                <p className="text-xs text-muted-foreground">Always subject to the house having the room. 0 keeps the slot&rsquo;s edges hard.</p>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Quota checkpoints</Label>
                {cps.fields.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">By</span>
                    <Controller control={form.control} name={`checkpoints.${i}.date`} render={({ field }) => <DatePicker value={field.value || null} onChange={field.onChange} className="w-40" />} />
                    <span className="text-xs text-muted-foreground">at least</span>
                    <Input className="w-16" inputMode="numeric" aria-label="Percent booked" {...form.register(`checkpoints.${i}.minPercent`)} />
                    <span className="text-xs text-muted-foreground">% booked</span>
                    <Button type="button" variant="ghost" size="icon" onClick={() => cps.remove(i)} aria-label="Remove checkpoint"><Trash2 className="size-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => cps.append({ date: "", minPercent: 50 })}>
                  <Plus className="mr-1.5 size-4" /> Add checkpoint
                </Button>
                <p className="text-xs text-muted-foreground">A missed checkpoint releases the unsold rooms; the block carries on with what is booked.</p>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Note to the source (optional)</Label>
                <Textarea rows={2} {...form.register("note")} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setApproving(null)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Checking…" : "Approve"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!declining} onOpenChange={(o) => !o && setDeclining(null)}>
        <DialogContent size="sm" mobile="sheet">
          <DialogHeader>
            <DialogTitle>Decline {declining?.code}</DialogTitle>
            <DialogDescription>The source sees this reason.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" aria-label="Reason" />
          {!reason.trim() && <p className="text-xs text-muted-foreground">A reason is required.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclining(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy || !reason.trim()} onClick={decline}>Decline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
