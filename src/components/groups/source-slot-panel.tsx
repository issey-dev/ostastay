"use client"

import { useEffect, useMemo, useState } from "react"
import { format, parseISO } from "date-fns"
import { z } from "zod"
import { useForm, useFieldArray, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Plus, Trash2 } from "@/components/icons"
import { MarkerChip } from "@/components/reservations/booking-marker"
import { isMarkerColor, isMarkerIcon } from "@/lib/booking-markers"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { usePermissions } from "@/hooks/use-permissions"

// The Source side of a group block (Agent Portal plan A-7, A-12, A-13; Phase 4): who the
// slot belongs to, its cutoff rules and flexibility, tentative versus confirmed pickups, and
// "Confirm selected" for the tentative ones the hotel has checked.

type Pickup = { id: string; status: string; confirmationNo: string; confirmationRequestedAt?: string | null; primaryGuest?: { firstName?: string; lastName?: string | null } }
type Group = {
  id: string
  status: string
  cutoffDate: string | null
  releaseDays: number | null
  elasticRooms: number
  elasticNightsBefore: number
  elasticNightsAfter: number
  origin: string
  sourceProfile: { upid: string; firstName: string; companyName: string | null; markerIcon: string | null; markerColor: string | null } | null
  checkpoints: { id: string; date: string; minPercent: number; processedAt: string | null; releasedRooms: number | null }[]
  reservations: Pickup[]
}

const rulesSchema = z.object({
  sourceProfileId: z.string(),
  releaseDays: z.string().refine((v) => v === "" || /^\d{1,3}$/.test(v), "Days, or empty"),
  elasticRooms: z.coerce.number().int().min(0, "0 or more").max(500),
  elasticNightsBefore: z.coerce.number().int().min(0, "0 or more").max(60),
  elasticNightsAfter: z.coerce.number().int().min(0, "0 or more").max(60),
  checkpoints: z.array(z.object({ date: z.string().min(1, "Pick a date"), minPercent: z.coerce.number().int().min(1, "1 to 100").max(100, "1 to 100") })).max(6),
})
type RulesValues = z.infer<typeof rulesSchema>

export function SourceSlotPanel({ group, onChanged }: { group: Group; onChanged: () => void }) {
  const { can, has } = usePermissions()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sources, setSources] = useState<{ value: string; label: string }[]>([])

  const tentative = useMemo(() => group.reservations.filter((r) => r.status === "TENTATIVE"), [group.reservations])
  const confirmed = group.reservations.filter((r) => r.status !== "TENTATIVE" && r.status !== "CANCELLED" && r.status !== "NO_SHOW").length
  const src = group.sourceProfile
  const marker = src && isMarkerIcon(src.markerIcon) && isMarkerColor(src.markerColor) ? { icon: src.markerIcon, color: src.markerColor, label: src.companyName || src.firstName } : null
  const pendingCheckpoints = group.checkpoints.filter((c) => !c.processedAt)

  const form = useForm<RulesValues>({ resolver: zodResolver(rulesSchema) as Resolver<RulesValues>, mode: "onChange" })
  const cps = useFieldArray({ control: form.control, name: "checkpoints" })
  useEffect(() => {
    if (!editing) return
    fetch("/api/profiles?profileType=SOURCE")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setSources([{ value: "none", label: "No source" }, ...(Array.isArray(rows) ? rows : []).map((p: { upid: string; companyName?: string; firstName: string }) => ({ value: p.upid, label: p.companyName || p.firstName }))]))
      .catch(() => setSources([]))
    form.reset({
      sourceProfileId: src?.upid ?? "none",
      releaseDays: group.releaseDays === null ? "" : String(group.releaseDays),
      elasticRooms: group.elasticRooms,
      elasticNightsBefore: group.elasticNightsBefore,
      elasticNightsAfter: group.elasticNightsAfter,
      checkpoints: pendingCheckpoints.map((c) => ({ date: c.date.slice(0, 10), minPercent: c.minPercent })),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const saveRules = form.handleSubmit(async (v) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/groups/${group.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceProfileId: v.sourceProfileId === "none" ? null : v.sourceProfileId,
          releaseDays: v.releaseDays === "" ? null : Number(v.releaseDays),
          elasticRooms: v.elasticRooms,
          elasticNightsBefore: v.elasticNightsBefore,
          elasticNightsAfter: v.elasticNightsAfter,
          checkpoints: v.checkpoints,
        }),
      })
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't save the slot rules."))
        return
      }
      toast.success("Slot rules saved")
      setEditing(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  })

  const confirmSelected = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/reservations/confirm-many", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "Couldn't confirm the bookings.")
        return
      }
      const failed = (data.results ?? []).filter((r: { ok: boolean }) => !r.ok)
      if (failed.length) toast.error(`${data.confirmed} confirmed, ${failed.length} not`, { description: failed[0].error })
      else toast.success(`${data.confirmed} booking${data.confirmed === 1 ? "" : "s"} confirmed`)
      setSelected(new Set())
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const hasRules = group.cutoffDate || group.releaseDays !== null || group.elasticRooms || group.elasticNightsBefore || group.elasticNightsAfter || group.checkpoints.length
  if (!src && !hasRules && tentative.length === 0 && !can("GROUP_BLOCKS", "update")) return null
  const err = form.formState.errors

  return (
    <Card className="shadow-elevation-1 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          {marker && <MarkerChip marker={marker} />}
          {src ? `Slot for ${src.companyName || src.firstName}` : "Slot rules"}
        </CardTitle>
        {can("GROUP_BLOCKS", "update") && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit slot rules</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Tentative</dt><dd className="font-semibold tabular-nums">{tentative.length}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Confirmed</dt><dd className="font-semibold tabular-nums">{confirmed}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Cutoff</dt><dd>{group.cutoffDate ? format(parseISO(group.cutoffDate), "d MMM yyyy") : "None"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Rolling release</dt><dd>{group.releaseDays === null ? "Off" : `${group.releaseDays} days before each night`}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-muted-foreground">Flexibility</dt><dd>{group.elasticRooms || group.elasticNightsBefore || group.elasticNightsAfter ? `+${group.elasticRooms} rooms a night, ${group.elasticNightsBefore} nights before, ${group.elasticNightsAfter} after` : "None (hard edges)"}</dd></div>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Checkpoints</dt>
            <dd>
              {group.checkpoints.length === 0
                ? "None"
                : group.checkpoints.map((c) => (
                    <span key={c.id} className="mr-3 inline-block">
                      {format(parseISO(c.date), "d MMM")}: {c.minPercent}%{c.processedAt ? (c.releasedRooms ? ` (missed, ${c.releasedRooms} released)` : " (met)") : ""}
                    </span>
                  ))}
            </dd>
          </div>
        </dl>

        {tentative.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Tentative bookings</p>
              {has("reservations.manageOption") && (
                <Button size="sm" disabled={busy || selected.size === 0} onClick={confirmSelected}>
                  Confirm selected{selected.size ? ` (${selected.size})` : ""}
                </Button>
              )}
            </div>
            <ul className="divide-y divide-border rounded-md border border-border">
              {tentative.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                  <Checkbox
                    checked={selected.has(r.id)}
                    onCheckedChange={(v) => setSelected((prev) => { const n = new Set(prev); if (v) n.add(r.id); else n.delete(r.id); return n })}
                    aria-label={`Select ${r.confirmationNo}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{`${r.primaryGuest?.firstName ?? ""} ${r.primaryGuest?.lastName ?? ""}`.trim() || r.confirmationNo}</span>
                  <span className="font-mono text-xs text-muted-foreground">{r.confirmationNo}</span>
                  {r.confirmationRequestedAt && <span className="text-xs font-medium text-warning">Confirmation requested</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent size="md" mobile="fullscreen">
          <form onSubmit={saveRules} className="contents">
            <DialogHeader>
              <DialogTitle>Slot rules</DialogTitle>
              <DialogDescription>The source this block belongs to, and how its unsold rooms go back on sale.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-1.5">
                <Label>Source</Label>
                <Controller control={form.control} name="sourceProfileId" render={({ field }) => <SearchableSelect value={field.value} onChange={field.onChange} options={sources} placeholder="No source" />} />
              </div>
              <div className="grid gap-1.5">
                <Label>Rolling release (days before each night)</Label>
                <Input inputMode="numeric" placeholder="Off" {...form.register("releaseDays")} />
                {err.releaseDays && <p className="text-xs text-destructive">{err.releaseDays.message}</p>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="grid gap-1 text-xs text-muted-foreground">Extra rooms a night<Input inputMode="numeric" {...form.register("elasticRooms")} /></label>
                <label className="grid gap-1 text-xs text-muted-foreground">Nights before<Input inputMode="numeric" {...form.register("elasticNightsBefore")} /></label>
                <label className="grid gap-1 text-xs text-muted-foreground">Nights after<Input inputMode="numeric" {...form.register("elasticNightsAfter")} /></label>
              </div>
              <div className="grid gap-1.5">
                <Label>Quota checkpoints</Label>
                {cps.fields.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <Controller control={form.control} name={`checkpoints.${i}.date`} render={({ field }) => <DatePicker value={field.value || null} onChange={field.onChange} className="w-40" />} />
                    <Input className="w-16" inputMode="numeric" aria-label="Percent booked" {...form.register(`checkpoints.${i}.minPercent`)} />
                    <span className="text-xs text-muted-foreground">% booked</span>
                    <Button type="button" variant="ghost" size="icon" onClick={() => cps.remove(i)} aria-label="Remove checkpoint"><Trash2 className="size-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => cps.append({ date: "", minPercent: 50 })}>
                  <Plus className="mr-1.5 size-4" /> Add checkpoint
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
