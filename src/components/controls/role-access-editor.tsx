"use client"

import { useMemo, useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Users } from "@/components/icons"
import {
  MODULES,
  MODULE_LABELS,
  MODULE_SCOPE_LABELS,
  MODULE_ACTION_MEANINGS,
  ENTERPRISE_ONLY_MODULES,
  moduleScope,
  type Module,
  type Action,
  type ModuleScope,
} from "@/lib/modules"
import { CAPABILITIES, roleCapabilities, summarizeRole, type CapabilityDef, type CapabilityKey } from "@/lib/capabilities"
import type { PermissionMatrix } from "./role-permission-matrix"
import { cn } from "@/lib/utils"

// The roles editor (Agent Portal plan §10, Phase 0b — the owner found the old one-wide-matrix
// screen bland, with no advanced control). One role at a time: modules down the left with a
// summary chip each; the selected module's four actions, each with what it means, then its
// capabilities as labelled switches. Search across both, a plain-language summary at the
// top, "Compare with…" another role, and "Who has this" per capability.

export type CapabilityOverrides = Partial<Record<CapabilityKey, boolean>>

export type CompareRole = {
  id: string
  name: string
  permissions: { module: string; canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }[]
  capabilities?: string[]
}

const ACTIONS: { key: Action; label: string; field: keyof PermissionMatrix[Module] }[] = [
  { key: "view", label: "View", field: "canView" },
  { key: "create", label: "Create", field: "canCreate" },
  { key: "update", label: "Update", field: "canUpdate" },
  { key: "delete", label: "Delete", field: "canDelete" },
]
const SCOPE_ORDER: ModuleScope[] = ["PROPERTY", "HUB"]

function rows(matrix: PermissionMatrix) {
  return MODULES.map((module) => ({ module, ...matrix[module] }))
}

function chipFor(r: PermissionMatrix[Module]): { label: string; tone: string } {
  const n = [r.canView, r.canCreate, r.canUpdate, r.canDelete].filter(Boolean).length
  if (n === 4) return { label: "Full", tone: "bg-success-muted text-success" }
  if (n === 0) return { label: "None", tone: "bg-muted text-muted-foreground" }
  if (n === 1 && r.canView) return { label: "View only", tone: "bg-info-muted text-info" }
  return { label: "Custom", tone: "bg-warning-muted text-warning" }
}

export function effectiveCaps(matrix: PermissionMatrix, overrides: CapabilityOverrides): Set<CapabilityKey> {
  return roleCapabilities(
    rows(matrix),
    Object.entries(overrides).map(([capability, granted]) => ({ capability, granted: !!granted }))
  )
}

export function RoleAccessEditor({
  matrix,
  onMatrixChange,
  overrides,
  onOverridesChange,
  disabled,
  compareRoles,
}: {
  matrix: PermissionMatrix
  onMatrixChange: (next: PermissionMatrix) => void
  overrides: CapabilityOverrides
  onOverridesChange: (next: CapabilityOverrides) => void
  disabled?: boolean
  compareRoles: CompareRole[]
}) {
  const [selected, setSelected] = useState<Module>("FRONT_DESK")
  const [query, setQuery] = useState("")
  const [compareId, setCompareId] = useState<string>("")
  const [holders, setHolders] = useState<Record<string, { loading: boolean; roles: string[]; people: string[] } | undefined>>({})

  const caps = useMemo(() => effectiveCaps(matrix, overrides), [matrix, overrides])
  const defaults = useMemo(() => effectiveCaps(matrix, {}), [matrix])
  const summary = useMemo(() => summarizeRole(rows(matrix), caps), [matrix, caps])

  const compare = compareRoles.find((r) => r.id === compareId)
  const compareMatrix = useMemo(() => {
    if (!compare) return null
    const m = new Map(compare.permissions.map((p) => [p.module, p]))
    return m
  }, [compare])
  const compareCaps = useMemo(() => new Set(compare?.capabilities ?? []), [compare])

  const q = query.trim().toLowerCase()
  const capsByModule = useMemo(() => {
    const out = new Map<Module, CapabilityDef[]>()
    for (const c of CAPABILITIES as readonly CapabilityDef[]) {
      const list = out.get(c.module) ?? []
      list.push(c)
      out.set(c.module, list)
    }
    return out
  }, [])

  const matchesModule = (m: Module) => {
    if (!q) return true
    if (MODULE_LABELS[m].toLowerCase().includes(q)) return true
    if (Object.values(MODULE_ACTION_MEANINGS[m]).some((t) => t.toLowerCase().includes(q))) return true
    return (capsByModule.get(m) ?? []).some(
      (c) => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.invertedLabel?.toLowerCase().includes(q)
    )
  }
  const visibleModules = MODULES.filter(matchesModule)
  const current = visibleModules.includes(selected) ? selected : visibleModules[0]

  const toggleAction = (m: Module, field: keyof PermissionMatrix[Module]) => {
    if (disabled) return
    onMatrixChange({ ...matrix, [m]: { ...matrix[m], [field]: !matrix[m][field] } })
  }
  const setModuleFull = (m: Module, on: boolean) => {
    if (disabled) return
    onMatrixChange({ ...matrix, [m]: { canView: on, canCreate: on, canUpdate: on, canDelete: on } })
  }
  const setCap = (key: CapabilityKey, on: boolean) => {
    if (disabled) return
    const next = { ...overrides }
    // Stay sparse: an override equal to the default is no override.
    if (defaults.has(key) === on) delete next[key]
    else next[key] = on
    onOverridesChange(next)
  }

  const loadHolders = async (key: string) => {
    setHolders((h) => ({ ...h, [key]: { loading: true, roles: [], people: [] } }))
    try {
      const res = await fetch(`/api/roles/capability-holders?capability=${encodeURIComponent(key)}`)
      const data = await res.json()
      setHolders((h) => ({
        ...h,
        [key]: {
          loading: false,
          roles: (data.roles ?? []).map((r: { name: string }) => r.name),
          people: (data.people ?? []).map((p: { name: string; email: string }) => p.name || p.email),
        },
      }))
    } catch {
      setHolders((h) => ({ ...h, [key]: { loading: false, roles: [], people: [] } }))
    }
  }

  const diffAction = (m: Module, field: keyof PermissionMatrix[Module]) =>
    !!compareMatrix && !!compareMatrix.get(m)?.[field] !== matrix[m][field]
  const moduleDiffers = (m: Module) => ACTIONS.some((a) => diffAction(m, a.field)) ||
    (!!compare && (capsByModule.get(m) ?? []).some((c) => compareCaps.has(c.key) !== caps.has(c.key as CapabilityKey)))

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm" data-testid="role-summary">
        <span className="font-medium">Summary: </span>
        {summary}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modules and options (overbook, refund…)"
            className="pl-8"
            aria-label="Search modules and options"
          />
        </div>
        {compareRoles.length > 0 && (
          <Select value={compareId || "none"} onValueChange={(v) => setCompareId(v === "none" ? "" : String(v))}>
            <SelectTrigger className="w-56 max-sm:w-full" aria-label="Compare with another role">
              <SelectValue placeholder="Compare with…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No comparison</SelectItem>
              {compareRoles.map((r) => (
                <SelectItem key={r.id} value={r.id}>Compare with {r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(220px,280px)_1fr]">
        {/* Modules: a list on every width (stacks above the detail on a phone). */}
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border md:max-h-[60vh] md:overflow-y-auto" role="listbox" aria-label="Modules">
          {SCOPE_ORDER.map((scope) => {
            const mods = visibleModules.filter((m) => moduleScope(m) === scope)
            if (mods.length === 0) return null
            return [
              <li key={`h-${scope}`} className="bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {MODULE_SCOPE_LABELS[scope]}
              </li>,
              ...mods.map((m) => {
                const chip = chipFor(matrix[m])
                return (
                  <li key={m}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={m === current}
                      onClick={() => setSelected(m)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60",
                        m === current && "bg-primary/10 font-medium"
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{MODULE_LABELS[m]}</span>
                        {moduleDiffers(m) && <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="Differs from comparison" />}
                      </span>
                      <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", chip.tone)}>{chip.label}</span>
                    </button>
                  </li>
                )
              }),
            ]
          })}
          {visibleModules.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">Nothing matches “{query}”.</li>}
        </ul>

        {current && (
          <section className="space-y-4 rounded-md border border-border p-3" aria-label={`${MODULE_LABELS[current]} access`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold">
                {MODULE_LABELS[current]}
                {(ENTERPRISE_ONLY_MODULES as readonly Module[]).includes(current) && (
                  <Badge variant="outline" className="ml-2 font-normal">All-Properties users only</Badge>
                )}
              </h3>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Full access</span>
                <Switch
                  checked={ACTIONS.every((a) => matrix[current][a.field])}
                  onCheckedChange={(on) => setModuleFull(current, !!on)}
                  disabled={disabled}
                  aria-label={`Full access to ${MODULE_LABELS[current]}`}
                />
              </div>
            </div>

            <ul className="space-y-2">
              {ACTIONS.map((a) => (
                <li
                  key={a.key}
                  className={cn("flex items-start gap-3 rounded-md px-2 py-1.5", diffAction(current, a.field) && "bg-warning-muted")}
                >
                  <Checkbox
                    id={`act-${current}-${a.key}`}
                    checked={matrix[current][a.field]}
                    onCheckedChange={() => toggleAction(current, a.field)}
                    disabled={disabled}
                    className="mt-0.5"
                  />
                  <label htmlFor={`act-${current}-${a.key}`} className="min-w-0 text-sm">
                    <span className="font-medium">{a.label}</span>
                    <span className="block text-muted-foreground">{MODULE_ACTION_MEANINGS[current][a.key]}</span>
                    {diffAction(current, a.field) && compare && (
                      <span className="block text-xs text-warning">
                        {compare.name}: {compareMatrix?.get(current)?.[a.field] ? "allowed" : "not allowed"}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>

            {(capsByModule.get(current) ?? []).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Options</h4>
                <ul className="space-y-2">
                  {(capsByModule.get(current) ?? []).map((c) => {
                    const key = c.key as CapabilityKey
                    const on = caps.has(key)
                    const inverted = !!c.invertedLabel
                    const shown = inverted ? !on : on
                    const isOverride = key in overrides
                    const differs = !!compare && compareCaps.has(key) !== on
                    const h = holders[key]
                    const blockedByFigures = !!c.needsFigures && !caps.has("figures.see")
                    return (
                      <li key={key} className={cn("rounded-md border border-border p-2.5", differs && "border-warning bg-warning-muted")}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 text-sm">
                            <div className="font-medium">
                              {inverted ? c.invertedLabel : c.label}
                              {isOverride && <Badge variant="outline" className="ml-2 font-normal">Changed from default</Badge>}
                            </div>
                            <p className="text-muted-foreground">{c.description}</p>
                            {blockedByFigures && (
                              <p className="text-xs text-warning">Not available while this role cannot see rates.</p>
                            )}
                            {differs && compare && (
                              <p className="text-xs text-warning">{compare.name}: {compareCaps.has(key) ? "allowed" : "not allowed"}</p>
                            )}
                          </div>
                          <Switch
                            checked={shown}
                            onCheckedChange={(v) => setCap(key, inverted ? !v : !!v)}
                            disabled={disabled || blockedByFigures}
                            aria-label={inverted ? c.invertedLabel : c.label}
                          />
                        </div>
                        <div className="mt-1.5">
                          {!h ? (
                            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => loadHolders(key)}>
                              <Users className="mr-1 size-3.5" /> Who has this?
                            </Button>
                          ) : h.loading ? (
                            <span className="text-xs text-muted-foreground">Loading…</span>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {h.roles.length === 0
                                ? "No saved role has this."
                                : `Roles: ${h.roles.join(", ")}. People: ${h.people.length ? h.people.join(", ") : "none"}.`}
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

// Starting points for a new role (Phase 0b presets). Each is a plain permission matrix plus
// capability overrides; the admin adjusts from there.
type Preset = { name: string; grants: Partial<Record<Module, Action[]>>; overrides?: CapabilityOverrides }
const ALL: Action[] = ["view", "create", "update", "delete"]
const EDIT: Action[] = ["view", "create", "update"]
export const ROLE_PRESETS: Preset[] = [
  {
    name: "Reservations Agent",
    grants: { RESERVATIONS: EDIT, TAPE_CHART: EDIT, AVAILABILITY: ["view"], GROUP_BLOCKS: EDIT, PROFILES: EDIT, FRONT_DESK: ["view"], DASHBOARD: ["view"] },
    overrides: { "reservations.overbook": false },
  },
  {
    name: "Night Auditor",
    grants: { NIGHT_AUDIT: EDIT, FRONT_DESK: EDIT, RESERVATIONS: ["view", "update"], CASHIERING: EDIT, REPORTS: ["view"], DASHBOARD: ["view"] },
  },
  {
    name: "Accounts",
    grants: { DEBTORS: ALL, CASHIERING: ["view"], PROFILES: EDIT, REPORTS: ["view"], REVENUE: ["view"], DASHBOARD: ["view"] },
  },
  {
    name: "Housekeeping Supervisor",
    grants: { HOUSEKEEPING: ALL, MAINTENANCE: EDIT, FRONT_DESK: ["view"], DASHBOARD: ["view"] },
    overrides: { "figures.see": false },
  },
]

export function presetMatrix(preset: Preset, empty: PermissionMatrix): PermissionMatrix {
  const m = { ...empty }
  for (const [mod, acts] of Object.entries(preset.grants) as [Module, Action[]][]) {
    m[mod] = {
      canView: acts.includes("view"),
      canCreate: acts.includes("create"),
      canUpdate: acts.includes("update"),
      canDelete: acts.includes("delete"),
    }
  }
  return m
}
