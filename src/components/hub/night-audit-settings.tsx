"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { OptionSelect } from "@/components/ui/option-select"
import { toast } from "@/lib/toast"
import { PhoneHint } from "@/components/hub/phone-hint"
import { SavedTick, useSavedFlash } from "@/components/controls/save-status"

// What this property's Night Audit does when it runs. Each change saves as it is made —
// there is no form to submit, so a switch can never sit half-saved. A save confirms with a
// brief inline "Saved" tick beside the control (Hub save model: auto-save only single
// toggles/selects); only a failure raises a toast.

type Levy = "greenTaxEnabled" | "tgstEnabled" | "serviceChargeEnabled"

const LEVIES: { field: Levy; label: string; hint: string }[] = [
  { field: "greenTaxEnabled", label: "Post Green Tax", hint: "Green Tax is calculated and posted to each in-house folio every night. Its amounts and rules are set under Finance." },
  { field: "tgstEnabled", label: "Post GST", hint: "GST is calculated on the night's room revenue (base + Service Charge). Its rate is set under Finance." },
  { field: "serviceChargeEnabled", label: "Post Service Charge", hint: "Service Charge is calculated on the night's room revenue. Its rate is set under Finance." },
]

/** The nightly tax postings — whether each Maldives levy is posted at Night Audit. */
export function NightlyPostingsManager({
  propertyId,
  initial,
  canEdit,
}: {
  propertyId: string
  initial: Record<Levy, boolean>
  canEdit: boolean
}) {
  const [values, setValues] = useState(initial)
  const [saving, setSaving] = useState<Levy | null>(null)
  const [savedField, setSavedField] = useState<Levy | null>(null)
  const [savedShown, flashSaved] = useSavedFlash()

  const toggle = async (field: Levy, on: boolean) => {
    setSaving(field)
    setValues((v) => ({ ...v, [field]: on }))
    try {
      const res = await fetch(`/api/properties/${propertyId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: on }),
      })
      if (!res.ok) throw new Error()
      setSavedField(field)
      flashSaved()
    } catch {
      setValues((v) => ({ ...v, [field]: !on }))
      toast.error("Couldn't save — nothing was changed")
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {LEVIES.map((l) => (
        <div key={l.field} className="flex items-start justify-between gap-4 p-3">
          <div className="min-w-0">
            <Label htmlFor={l.field}>{l.label}<PhoneHint label={l.label}>{l.hint}</PhoneHint></Label>
            <p className="text-xs text-muted-foreground max-sm:hidden">{l.hint}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SavedTick show={savedShown && savedField === l.field} />
            <Switch
              id={l.field}
              checked={values[l.field]}
              disabled={!canEdit || saving !== null}
              onCheckedChange={(on) => void toggle(l.field, !!on)}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** What Night Audit does to vacant rooms' housekeeping status. */
export function EodRoomStatusManager({
  propertyId,
  initialMode,
  initialTarget,
  canEdit,
}: {
  propertyId: string
  initialMode: string
  initialTarget: string | null
  canEdit: boolean
}) {
  const [mode, setMode] = useState(initialMode)
  const [target, setTarget] = useState(initialTarget ?? "DIRTY")
  const [savedShown, flashSaved] = useSavedFlash()

  const save = async (nextMode: string, nextTarget: string) => {
    const previous = { mode, target }
    setMode(nextMode)
    setTarget(nextTarget)
    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eodHousekeepingMode: nextMode, eodHousekeepingTargetStatus: nextMode === "SET_STATUS" ? nextTarget : null }),
      })
      if (!res.ok) throw new Error()
      flashSaved()
    } catch {
      setMode(previous.mode)
      setTarget(previous.target)
      toast.error("Couldn't save — nothing was changed")
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Occupied rooms always become Dirty for daily service; this rule applies to <strong>vacant rooms only</strong>.
          Out-of-Order / Out-of-Service rooms are never changed.
        </p>
        <SavedTick show={savedShown} className="shrink-0" />
      </div>
      <OptionSelect
        id="eodHousekeepingMode"
        value={mode}
        disabled={!canEdit}
        options={[
          { label: "Off — don't change statuses", value: "OFF" },
          { label: "Move one status down (Inspected → Clean, Clean → Dirty, Dirty stays)", value: "STEP_DOWN" },
          { label: "Set all vacant rooms to a specific status…", value: "SET_STATUS" },
        ]}
        onChange={(m) => void save(m, target)}
      />
      {mode === "SET_STATUS" && (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="eodHousekeepingTargetStatus" className="text-xs">Target status for vacant rooms</Label>
          <OptionSelect
            id="eodHousekeepingTargetStatus"
            value={target}
            disabled={!canEdit}
            onChange={(v) => void save(mode, v)}
            options={[
              { label: "Clean", value: "CLEAN" },
              { label: "Dirty", value: "DIRTY" },
              { label: "Inspected", value: "INSPECTED" },
            ]}
          />
        </div>
      )}
    </div>
  )
}

/** One on/off property setting (a Property column), saved as it is switched. */
export function PropertySwitchSetting({
  propertyId,
  field,
  label,
  description,
  initial,
  canEdit,
}: {
  propertyId: string
  field: "pricesIncludeTaxes" | "requireInspectionOnCheckIn"
  label: string
  description: React.ReactNode
  initial: boolean
  canEdit: boolean
}) {
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [savedShown, flashSaved] = useSavedFlash()

  const toggle = async (next: boolean) => {
    setSaving(true)
    setOn(next)
    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      })
      if (!res.ok) throw new Error()
      flashSaved()
    } catch {
      setOn(!next)
      toast.error("Couldn't save — nothing was changed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={field}>{label}<PhoneHint label={label}>{description}</PhoneHint></Label>
        <p className="text-xs text-muted-foreground max-sm:hidden">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SavedTick show={savedShown} />
        <Switch id={field} checked={on} disabled={!canEdit || saving} onCheckedChange={(v) => void toggle(!!v)} />
      </div>
    </div>
  )
}

// ── No-shows ────────────────────────────────────────────────────────────────────────

const NO_SHOW_TIMING_OPTIONS = [
  { value: "FIRST_AUDIT", label: "At the arrival night's audit" },
  { value: "SECOND_AUDIT", label: "Hold one night for late arrivals, then mark" },
  { value: "MANUAL", label: "Never automatically — the front desk marks no-shows" },
]

const NO_SHOW_FEE_HINT =
  "When Night Audit marks a no-show, post the reservation's selected No-Show fee rule to its folio. Off: the reservation is marked, and any fee is left to the front desk."

/** When Night Audit marks a never-arrived reservation as a No-Show, and whether it posts the fee. */
export function NoShowManager({
  propertyId,
  initialTiming,
  initialPostFee,
  canEdit,
}: {
  propertyId: string
  initialTiming: string
  initialPostFee: boolean
  canEdit: boolean
}) {
  const router = useRouter()
  const [timing, setTiming] = useState(initialTiming)
  const [postFee, setPostFee] = useState(initialPostFee)
  const [saving, setSaving] = useState(false)
  const [savedWhat, setSavedWhat] = useState<"timing" | "fee" | null>(null)
  const [savedShown, flashSaved] = useSavedFlash()

  const save = async (patch: { noShowTiming?: string; noShowPostFee?: boolean }, undo: () => void) => {
    const what = patch.noShowTiming !== undefined ? "timing" : "fee"
    setSaving(true)
    try {
      const res = await fetch(`/api/properties/${propertyId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error()
      setSavedWhat(what)
      flashSaved()
      // The Scheduled Night Audit card warns about the timing — let it see the change.
      router.refresh()
    } catch {
      undo()
      toast.error("Couldn't save — nothing was changed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="noShowTiming">Mark a reservation that never arrived as a no-show</Label>
          <SavedTick show={savedShown && savedWhat === "timing"} className="shrink-0" />
        </div>
        <OptionSelect
          id="noShowTiming"
          value={timing}
          disabled={!canEdit || saving}
          options={NO_SHOW_TIMING_OPTIONS}
          onChange={(v) => {
            const previous = timing
            setTiming(v)
            void save({ noShowTiming: v }, () => setTiming(previous))
          }}
        />
        <p className="text-xs text-muted-foreground">
          {timing === "FIRST_AUDIT" && "Night Audit marks every arrival that has not checked in by tonight's audit."}
          {timing === "SECOND_AUDIT" &&
            "A guest arriving after midnight can still be checked in the next day; if they still have not arrived by the following audit, they are marked then."}
          {timing === "MANUAL" &&
            "Night Audit leaves arrivals that have not checked in as they are and lists them in its summary. They stay on the arrivals list until the desk checks them in or marks them a no-show."}
        </p>
      </div>
      <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
        <div className="min-w-0">
          <Label htmlFor="noShowPostFee">
            Post the no-show fee
            <PhoneHint label="Post the no-show fee">{NO_SHOW_FEE_HINT}</PhoneHint>
          </Label>
          <p className="text-xs text-muted-foreground max-sm:hidden">{NO_SHOW_FEE_HINT}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SavedTick show={savedShown && savedWhat === "fee"} />
          <Switch
            id="noShowPostFee"
            checked={postFee}
            disabled={!canEdit || saving || timing === "MANUAL"}
            onCheckedChange={(on) => {
              setPostFee(!!on)
              void save({ noShowPostFee: !!on }, () => setPostFee(!on))
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Departures ──────────────────────────────────────────────────────────────────────

const DEPARTURES_HINT =
  "On: when Night Audit resolves departures — run from the Night Audit screen or on schedule — it checks out every guest due out whose folios are fully settled, through the normal check-out. It still stops for guests who owe money, are owed a refund, or settle by City Ledger. Off: every departure is left for the front desk."

/** Whether Night Audit checks out settled (zero-balance) departures by itself. */
export function DeparturesManager({
  propertyId,
  initial,
  canEdit,
}: {
  propertyId: string
  initial: boolean
  canEdit: boolean
}) {
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [savedShown, flashSaved] = useSavedFlash()

  const toggle = async (next: boolean) => {
    setSaving(true)
    setOn(next)
    try {
      const res = await fetch(`/api/properties/${propertyId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoCheckOutZeroBalance: next }),
      })
      if (!res.ok) throw new Error()
      flashSaved()
    } catch {
      setOn(!next)
      toast.error("Couldn't save — nothing was changed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
      <div className="min-w-0">
        <Label htmlFor="autoCheckOutZeroBalance">
          Check out settled departures automatically
          <PhoneHint label="Check out settled departures automatically">{DEPARTURES_HINT}</PhoneHint>
        </Label>
        <p className="text-xs text-muted-foreground max-sm:hidden">{DEPARTURES_HINT}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SavedTick show={savedShown} />
        <Switch
          id="autoCheckOutZeroBalance"
          checked={on}
          disabled={!canEdit || saving}
          onCheckedChange={(v) => void toggle(!!v)}
        />
      </div>
    </div>
  )
}
