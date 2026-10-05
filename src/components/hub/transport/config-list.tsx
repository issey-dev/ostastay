"use client"

import type { ComponentType, ReactNode } from "react"
import { Pencil, Trash2, Ban, RotateCcw } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { MobileCard, MobileCardList, type MobileCardFact } from "@/components/ui/mobile-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// One list shape for every Transportation setup section — the same table-on-desktop,
// cards-on-phone layout as the Excursions and Spa catalogues. Deactivate (never delete
// once used) sits beside Edit; Delete is offered too and the API refuses it when the row
// is in use, with "deactivate instead".

export type ConfigColumn<T> = { header: string; cell: (row: T) => ReactNode; className?: string }

export function ConfigList<T extends { id: string; isActive: boolean }>({
  rows,
  loading,
  columns,
  title,
  subtitle,
  meta,
  onEdit,
  onToggleActive,
  onDelete,
  canUpdate,
  canDelete,
  empty,
  noun,
}: {
  rows: T[]
  loading: boolean
  columns: ConfigColumn<T>[]
  title: (row: T) => ReactNode
  subtitle?: (row: T) => ReactNode
  meta?: (row: T) => MobileCardFact[]
  onEdit: (row: T) => void
  onToggleActive: (row: T) => void
  onDelete: (row: T) => void
  canUpdate: boolean
  canDelete: boolean
  empty: { icon?: ComponentType<{ className?: string }>; title: string; description?: string }
  /** For accessible button labels, e.g. "route". */
  noun: string
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }
  if (rows.length === 0) return <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />

  const status = (r: T) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} label={r.isActive ? "Active" : "Inactive"} />

  return (
    <>
      <MobileCardList className="-mx-6 -mb-6 border-t border-border p-4">
        {rows.map((r) => (
          <MobileCard
            key={r.id}
            tone={r.isActive ? undefined : "muted"}
            title={title(r)}
            subtitle={subtitle?.(r)}
            badge={status(r)}
            meta={meta?.(r)}
            onClick={canUpdate ? () => onEdit(r) : undefined}
            actions={
              canUpdate || canDelete ? (
                <>
                  {canUpdate && (
                    <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => onEdit(r)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                  {canUpdate && (
                    <Button variant="outline" size="sm" className="h-9 flex-1" onClick={() => onToggleActive(r)}>
                      {r.isActive ? <Ban className="mr-1.5 h-3.5 w-3.5" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                      {r.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  )}
                  {canDelete && (
                    <Button variant="outline" size="sm" className="h-9 flex-1 text-destructive hover:text-destructive" onClick={() => onDelete(r)}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                    </Button>
                  )}
                </>
              ) : undefined
            }
          />
        ))}
      </MobileCardList>

      <div className="hidden md:block -mx-6 -mb-6 overflow-x-auto border-t border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.header}>{c.header}</TableHead>
              ))}
              <TableHead>Status</TableHead>
              {(canUpdate || canDelete) && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.isActive ? undefined : "text-muted-foreground"}>
                {columns.map((c) => (
                  <TableCell key={c.header} className={c.className}>
                    {c.cell(r)}
                  </TableCell>
                ))}
                <TableCell>{status(r)}</TableCell>
                {(canUpdate || canDelete) && (
                  <TableCell className="space-x-2 text-right whitespace-nowrap">
                    {canUpdate && (
                      <Button variant="outline" size="icon" aria-label={`Edit ${noun}`} onClick={() => onEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canUpdate && (
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={r.isActive ? `Deactivate ${noun}` : `Activate ${noun}`}
                        title={r.isActive ? "Deactivate" : "Activate"}
                        onClick={() => onToggleActive(r)}
                      >
                        {r.isActive ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Delete ${noun}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => onDelete(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
