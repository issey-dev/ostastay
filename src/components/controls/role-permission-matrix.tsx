"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MODULES, MODULE_LABELS, type Module, type Action } from "@/lib/modules"

export type PermissionMatrix = Record<Module, { canView: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean }>

export function emptyPermissionMatrix(): PermissionMatrix {
  return Object.fromEntries(
    MODULES.map((m) => [m, { canView: false, canCreate: false, canUpdate: false, canDelete: false }])
  ) as PermissionMatrix
}

const ACTIONS: { key: Action; label: string; field: keyof PermissionMatrix[Module] }[] = [
  { key: "view", label: "View", field: "canView" },
  { key: "create", label: "Create", field: "canCreate" },
  { key: "update", label: "Update", field: "canUpdate" },
  { key: "delete", label: "Delete", field: "canDelete" },
]

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

  return (
    <div className="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Module</TableHead>
            {ACTIONS.map((a) => (
              <TableHead key={a.key} className="text-center">{a.label}</TableHead>
            ))}
            <TableHead className="text-center">Full Access</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {MODULES.map((module) => {
            const row = value[module]
            const isFull = row.canView && row.canCreate && row.canUpdate && row.canDelete
            return (
              <TableRow key={module}>
                <TableCell className="font-medium">{MODULE_LABELS[module]}</TableCell>
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
          })}
        </TableBody>
      </Table>
    </div>
  )
}
