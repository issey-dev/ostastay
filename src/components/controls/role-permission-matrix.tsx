"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  MODULES,
  MODULE_LABELS,
  MODULE_SCOPE_LABELS,
  MODULE_SCOPE_DESCRIPTIONS,
  moduleScope,
  type Module,
  type Action,
  type ModuleScope,
} from "@/lib/modules"

export type PermissionMatrix = Record<Module, { canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }>

export function emptyPermissionMatrix(): PermissionMatrix {
  return Object.fromEntries(
    MODULES.map((m) => [m, { canView: false, canCreate: false, canUpdate: false, canDelete: false }])
  ) as PermissionMatrix
}

/** True when this role grants any Hub module — used to warn before it is given to a
 *  property-scoped user, who can never actually reach the Hub. */
export function grantsHubAccess(value: PermissionMatrix): boolean {
  return MODULES.some((m) => moduleScope(m) === "HUB" && value[m]?.canView)
}

const ACTIONS: { key: Action; label: string; field: keyof PermissionMatrix[Module] }[] = [
  { key: "view", label: "View", field: "canView" },
  { key: "create", label: "Create", field: "canCreate" },
  { key: "update", label: "Update", field: "canUpdate" },
  { key: "delete", label: "Delete", field: "canDelete" },
]

const SCOPE_ORDER: ModuleScope[] = ["PROPERTY", "HUB"]

// Grouped by scope level rather than listed flat, because the two are not
// interchangeable: a Hub module gates the enterprise-wide shell (channel-manager
// credentials, sharing, sync logs) and is unreachable for a user pinned to one property,
// whatever their role says. Ticking Integrations for such a user used to save happily and
// then do nothing — the grouping and the note below make that rule visible where the
// decision is actually made.
export function RolePermissionMatrix({
  value,
  onChange,
  disabled,
}: {
  value: PermissionMatrix
  onChange: (next: PermissionMatrix) => void
  disabled?: boolean
}) {
  const toggle = (module: Module, field: keyof PermissionMatrix[Module]) => {
    if (disabled) return
    onChange({
      ...value,
      [module]: { ...value[module], [field]: !value[module][field] },
    })
  }

  const setFullRow = (module: Module, enabled: boolean) => {
    if (disabled) return
    onChange({
      ...value,
      [module]: { canView: enabled, canCreate: enabled, canUpdate: enabled, canDelete: enabled },
    })
  }

  const setScope = (scope: ModuleScope, enabled: boolean) => {
    if (disabled) return
    const next = { ...value }
    for (const m of MODULES) {
      if (moduleScope(m) !== scope) continue
      next[m] = { canView: enabled, canCreate: enabled, canUpdate: enabled, canDelete: enabled }
    }
    onChange(next)
  }

  const scopeState = (scope: ModuleScope) => {
    const mods = MODULES.filter((m) => moduleScope(m) === scope)
    const full = mods.filter((m) => {
      const r = value[m]
      return r.canView && r.canCreate && r.canUpdate && r.canDelete
    }).length
    return full === 0 ? "none" : full === mods.length ? "all" : "some"
  }

  // A genuine roles x modules matrix doesn't reduce to card-stacking cleanly — forcing
  // one row per module into a stacked card would mean five checkboxes per card with no
  // spatial relationship to the column they toggle, which is worse than the table. Instead
  // this stays a real table at every tier, sticky first column for module identity plus
  // the shared `<Table>` component's built-in horizontal scroll (its outer wrapper is
  // `overflow-x-auto`) — so on a 375px screen Module names stay pinned on the left while
  // the desk scrolls right to reach View/Create/Update/Delete/Full Access.
  return (
    <div className="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-card">Module</TableHead>
            {ACTIONS.map((a) => (
              <TableHead key={a.key} className="text-center">{a.label}</TableHead>
            ))}
            <TableHead className="text-center">Full Access</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SCOPE_ORDER.map((scope) => {
            const mods = MODULES.filter((m) => moduleScope(m) === scope)
            if (mods.length === 0) return null
            const state = scopeState(scope)
            return [
              <TableRow key={`${scope}-header`} className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={ACTIONS.length + 1} className="whitespace-normal py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                      {MODULE_SCOPE_LABELS[scope]}
                    </span>
                    {scope === "HUB" && (
                      <Badge variant="outline" className="font-normal">All-Properties users only</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                    {MODULE_SCOPE_DESCRIPTIONS[scope]}
                  </p>
                </TableCell>
                <TableCell className="text-center align-top pt-3">
                  <Checkbox
                    checked={state === "all"}
                    indeterminate={state === "some"}
                    onCheckedChange={() => setScope(scope, state !== "all")}
                    disabled={disabled}
                  />
                </TableCell>
              </TableRow>,
              ...mods.map((module) => {
                const row = value[module]
                const isFull = row.canView && row.canCreate && row.canUpdate && row.canDelete
                return (
                  <TableRow key={module} className="group">
                    <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-card pl-6 font-medium group-hover:bg-muted/50">
                      {MODULE_LABELS[module]}
                    </TableCell>
                    {ACTIONS.map((a) => (
                      <TableCell key={a.key} className="text-center">
                        <Checkbox
                          checked={row[a.field]}
                          onCheckedChange={() => toggle(module, a.field)}
                          disabled={disabled}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-center">
                      <Checkbox
                        checked={isFull}
                        onCheckedChange={(checked) => setFullRow(module, !!checked)}
                        disabled={disabled}
                      />
                    </TableCell>
                  </TableRow>
                )
              }),
            ]
          })}
        </TableBody>
      </Table>
    </div>
  )
}
