"use client"

import { useEffect, useState } from "react"
import { z } from "zod"
import { useForm, useFieldArray, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowUp, ChevronDown as ArrowDown, Trash2, Plus, RotateCcw } from "@/components/icons"
import {
  DEFAULT_MARKER_RULES,
  MARKER_COLOR_KEYS,
  MARKER_ICONS,
  MARKER_MATCHES,
  MARKER_MATCH_LABELS,
  type MarkerRule,
} from "@/lib/booking-markers"
import { MarkerPickerField } from "@/components/reservations/marker-picker"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"

// Hub › Property › Reservations › Booking markers (Agent Portal plan A-22). An ordered list:
// the first rule a booking matches decides its icon and colour on the Tape Chart and lists.
// A Source with its own icon and colour (set on its profile) shows that instead of a rule.

const rule = z
  .object({
    label: z.string().trim().min(1, "Name it").max(60),
    match: z.enum(MARKER_MATCHES),
    matchValue: z.string().nullable().optional(),
    icon: z.enum(MARKER_ICONS),
    colorToken: z.enum(MARKER_COLOR_KEYS as [string, ...string[]]),
    isActive: z.boolean(),
  })
  .refine((r) => r.match !== "SPECIFIC_SOURCE" || !!r.matchValue, { message: "Choose the source", path: ["matchValue"] })
const schema = z.object({ rules: z.array(rule).max(40) })
type Values = z.infer<typeof schema>

const toForm = (rules: MarkerRule[]): Values => ({
  rules: rules.map((r) => ({ label: r.label, match: r.match, matchValue: r.matchValue ?? null, icon: r.icon, colorToken: r.colorToken, isActive: r.isActive !== false })),
})

export function BookingMarkersEditor({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sources, setSources] = useState<{ upid: string; name: string }[]>([])
  const form = useForm<Values>({ resolver: zodResolver(schema), mode: "onChange", defaultValues: { rules: [] } })
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: "rules" })

  useEffect(() => {
    let live = true
    Promise.all([
      fetch(`/api/booking-markers?propertyId=${propertyId}`).then((r) => (r.ok ? r.json() : DEFAULT_MARKER_RULES)),
      fetch(`/api/profiles?profileType=SOURCE`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([rules, profiles]) => {
      if (!live) return
      form.reset(toForm(rules))
      setSources(
        (Array.isArray(profiles) ? profiles : [])
          .filter((p: { profileType: string }) => p.profileType === "SOURCE")
          .map((p: { upid: string; companyName?: string; firstName: string }) => ({ upid: p.upid, name: p.companyName || p.firstName }))
      )
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [propertyId, form])

  const save = form.handleSubmit(async (v) => {
    setSaving(true)
    try {
      const res = await fetch("/api/booking-markers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, rules: v.rules }),
      })
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't save the markers. Try again."))
        return
      }
      form.reset(toForm(await res.json()))
      toast.success("Booking markers saved")
    } finally {
      setSaving(false)
    }
  })

  if (loading) return <Skeleton className="h-40 w-full" />
  const disabled = !canEdit
  const rules = form.watch("rules")

  return (
    <form onSubmit={save} className="space-y-3">
      <ul className="divide-y divide-border rounded-md border border-border">
        {fields.map((f, i) => {
          const r = rules[i]
          const err = form.formState.errors.rules?.[i]
          return (
            <li key={f.id} className="grid gap-2 p-2.5 md:grid-cols-[1fr_1.3fr_auto_auto_auto] md:items-center">
              <div>
                <Input aria-label="Name" disabled={disabled} {...form.register(`rules.${i}.label`)} />
                {err?.label && <p className="text-xs text-destructive">{err.label.message}</p>}
              </div>
              <div className="grid gap-1">
                <Controller
                  control={form.control}
                  name={`rules.${i}.match`}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
                      <SelectTrigger aria-label="When" className="w-full"><SelectValue>{MARKER_MATCH_LABELS[field.value as keyof typeof MARKER_MATCH_LABELS]}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {MARKER_MATCHES.map((m) => <SelectItem key={m} value={m}>{MARKER_MATCH_LABELS[m]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
                {r?.match === "SPECIFIC_SOURCE" && (
                  <Controller
                    control={form.control}
                    name={`rules.${i}.matchValue`}
                    render={({ field }) => (
                      <SearchableSelect
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        placeholder="Which source…"
                        options={sources.map((s) => ({ label: s.name, value: s.upid }))}
                        disabled={disabled}
                      />
                    )}
                  />
                )}
                {r?.match === "VIP" && (
                  <Input aria-label="VIP level (empty = any)" placeholder="VIP level (empty = any)" disabled={disabled} {...form.register(`rules.${i}.matchValue`)} />
                )}
                {err?.matchValue && <p className="text-xs text-destructive">{err.matchValue.message}</p>}
              </div>
              <MarkerPickerField
                icon={r?.icon}
                color={r?.colorToken}
                guest={r?.label || "Guest name"}
                title={`Marker: ${r?.label ?? ""}`}
                allowClear={false}
                disabled={disabled}
                onChange={({ icon, color }) => {
                  if (icon) form.setValue(`rules.${i}.icon`, icon, { shouldDirty: true, shouldValidate: true })
                  if (color) form.setValue(`rules.${i}.colorToken`, color, { shouldDirty: true, shouldValidate: true })
                }}
              />
              <Controller
                control={form.control}
                name={`rules.${i}.isActive`}
                render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} disabled={disabled} aria-label="On" />}
              />
              <div className="flex items-center gap-0.5">
                <Button type="button" size="icon" variant="ghost" disabled={disabled || i === 0} onClick={() => move(i, i - 1)} aria-label="Move up"><ArrowUp className="size-4" /></Button>
                <Button type="button" size="icon" variant="ghost" disabled={disabled || i === fields.length - 1} onClick={() => move(i, i + 1)} aria-label="Move down"><ArrowDown className="size-4" /></Button>
                <Button type="button" size="icon" variant="ghost" disabled={disabled} onClick={() => remove(i)} aria-label="Remove"><Trash2 className="size-4 text-destructive" /></Button>
              </div>
            </li>
          )
        })}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => append({ label: "New marker", match: "SOURCE", matchValue: null, icon: "Star", colorToken: "sky", isActive: true })}>
              <Plus className="mr-1.5 size-4" /> Add rule
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => form.reset(toForm(DEFAULT_MARKER_RULES), { keepDefaultValues: true })}>
              <RotateCcw className="mr-1.5 size-4" /> Defaults
            </Button>
          </div>
          <Button type="submit" size="sm" disabled={saving || !form.formState.isValid}>{saving ? "Saving…" : "Save markers"}</Button>
        </div>
      )}
    </form>
  )
}
