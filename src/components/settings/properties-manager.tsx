"use client"

import { useEffect, useState } from "react"
import { Plus, Pencil, Trash2, Building2, RotateCcw } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { MobileActions } from "@/components/ui/mobile"
import { ControlsCard } from "@/components/controls/controls-card"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useTableSort, SortableTableHead } from "@/components/controls/use-table-sort"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PropertyForm } from "@/components/property-form"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { useConfirm } from "@/components/providers/confirm-provider"

type Property = {
  id: string
  name: string
  code: string
  status: string
  rejectionReason?: string | null
  legalName: string
  defaultCurrency: string
  timeZone: string
  checkInTime: string
  checkOutTime: string
}

export function PropertiesManager({ title, description, addons }: { title: string; description?: string; addons?: { spa: boolean; excursions: boolean } }) {
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const confirm = useConfirm()
  const fetchProperties = () => {
    setLoading(true)
    fetch("/api/properties")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProperties(data)
        }
      })
      .finally(() => setLoading(false))
  }

  const [resubmitting, setResubmitting] = useState<string | null>(null)
  const handleResubmit = async (propertyId: string) => {
    setResubmitting(propertyId)
    try {
      const res = await fetch(`/api/properties/${propertyId}/resubmit`, { method: "POST" })
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't resubmit the property. Try again."))
        return
      }
      fetchProperties()
    } catch (error) {
      console.error(error)
      toast.error("Couldn't reach the server. Try again.")
    } finally {
      setResubmitting(null)
    }
  }

  const handleDelete = async (propertyToDelete: Property) => {
    const ok = await confirm({
      title: "Delete this property?",
      description: (
        <>
          This action cannot be undone. This will permanently delete the property
          <strong> {propertyToDelete.name} </strong> and remove its data from our servers.
        </>
      ),
      confirmLabel: "Delete property",
      destructive: true,
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/properties/${propertyToDelete.id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error(await apiError(res, "Couldn't delete the property. Try again."))
        return
      }
      toast.success("Property deleted")
      fetchProperties()
    } catch (error) {
      console.error(error)
      toast.error("Couldn't reach the server. Try again.")
    }
  }

  useEffect(() => {
    fetchProperties()
  }, [])

  // First-column (Code) sorting, asc<->desc. Table opens sorted by Code ascending.
  const { sorted: sortedProperties, sort } = useTableSort(
    properties,
    { code: (p) => p.code },
    "code"
  )

  return (
    <ControlsCard
      title={title}
      description={description}
      action={
        <Button onClick={() => setIsDialogOpen(true)} className="shadow-sm">
          <Plus className="mr-2 h-4 w-4" /> Add property
        </Button>
      }
    >
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open)
        if (!open) setSelectedProperty(null)
      }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="text-xl">{selectedProperty ? 'Edit property' : 'Add property'}</DialogTitle>
            <DialogDescription>
              {selectedProperty ? 'Update the details for this property.' : 'Add a new hotel or guest house to your tenant portfolio.'}
            </DialogDescription>
          </DialogHeader>
          <PropertyForm
            initialData={selectedProperty}
            addons={addons}
            onSuccess={() => {
              setIsDialogOpen(false)
              setSelectedProperty(null)
              fetchProperties()
            }}
          />
        </DialogContent>
      </Dialog>

      <div className="-mx-6 -mb-6 border-t border-border">
          {/* Phone — card stack. Table below takes over at md. */}
          <MobileCardList
            className="p-4"
            empty={
              <EmptyState
                icon={Building2}
                title="No properties yet"
                description="You haven't added any properties to your portfolio. Create your first hotel to get started."
                action={
                  <Button onClick={() => setIsDialogOpen(true)} className="shadow-md">
                    <Plus className="mr-2 h-4 w-4" /> Add property
                  </Button>
                }
              />
            }
          >
            {loading
              ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)
              : sortedProperties.map((property) => (
                  <MobileCard
                    key={property.id}
                    title={property.name}
                    subtitle={<>{property.code} · {property.defaultCurrency} · {property.timeZone}</>}
                    badge={<StatusBadge label={property.status} status={property.status} dot className="shadow-sm w-max" />}
                    meta={[
                      { label: "Check-in", value: property.checkInTime },
                      { label: "Check-out", value: property.checkOutTime },
                      ...(property.status === "PENDING" ? [{ label: "Status", value: "Awaiting approval", wide: true }] : []),
                    ]}
                    tone={property.status === "REJECTED" ? "danger" : undefined}
                    onClick={() => {
                      setSelectedProperty(property)
                      setIsDialogOpen(true)
                    }}
                    actions={
                      // Edit is the action; Resubmit and Delete sit behind More (Delete last, red).
                      <MobileActions
                        className="w-full"
                        primary={
                          <Button
                            variant="outline"
                            className="min-h-11"
                            onClick={() => {
                              setSelectedProperty(property)
                              setIsDialogOpen(true)
                            }}
                          >
                            <Pencil className="mr-1.5 h-4 w-4" /> Edit
                          </Button>
                        }
                        more={[
                          ...(property.status === "REJECTED"
                            ? [{
                                label: resubmitting === property.id ? "Resubmitting…" : "Resubmit for approval",
                                icon: RotateCcw,
                                disabled: resubmitting === property.id,
                                onSelect: () => handleResubmit(property.id),
                              }]
                            : []),
                          { label: "Delete property", icon: Trash2, destructive: true, onSelect: () => handleDelete(property) },
                        ]}
                      />
                    }
                  >
                    {property.status === "REJECTED" && property.rejectionReason ? (
                      <p className="text-xs text-destructive">{property.rejectionReason}</p>
                    ) : null}
                  </MobileCard>
                ))}
          </MobileCardList>

          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border hover:bg-transparent">
                <SortableTableHead columnKey="code" sort={sort} className="px-6">Code</SortableTableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6">Property name</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6">Status</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6">Check-in</TableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6">Check-out</TableHead>
                <TableHead className="text-right text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-6"><Skeleton className="h-4 w-14" /></TableCell>
                    <TableCell className="px-6"><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell className="px-6"><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="px-6"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-6"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-6"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : properties.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-0">
                    <EmptyState
                      icon={Building2}
                      title="No properties yet"
                      description="You haven't added any properties to your portfolio. Create your first hotel to get started."
                      action={
                        <Button onClick={() => setIsDialogOpen(true)} className="shadow-md">
                          <Plus className="mr-2 h-4 w-4" /> Add property
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                sortedProperties.map((property) => (
                  <TableRow key={property.id} className="group border-border transition-colors hover:bg-muted/40 cursor-pointer">
                    <TableCell className="text-sm font-medium px-6 py-4 text-foreground">{property.code}</TableCell>
                    <TableCell className="text-sm px-6 py-4">
                      <div className="font-semibold text-foreground">{property.name}</div>
                      <div className="text-xs text-muted-foreground">{property.defaultCurrency} · {property.timeZone}</div>
                    </TableCell>
                    <TableCell className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <StatusBadge label={property.status} status={property.status} dot className="shadow-sm w-max" />
                        {property.status === "PENDING" && (
                          <span className="text-xs text-muted-foreground">Awaiting Osta approval</span>
                        )}
                        {property.status === "REJECTED" && property.rejectionReason && (
                          <span className="text-xs text-destructive max-w-xs">{property.rejectionReason}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm px-6 py-4 text-muted-foreground">{property.checkInTime}</TableCell>
                    <TableCell className="text-sm px-6 py-4 text-muted-foreground">{property.checkOutTime}</TableCell>
                    <TableCell className="text-right px-6 py-4">
                      {/* Actions recede to 60% until the row is hovered/focused (Settings.dc.html
                          row-action reveal) — dimmed, not hidden, so they stay tap-reachable. */}
                      <div className="flex justify-end gap-2 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {property.status === "REJECTED" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-info"
                            disabled={resubmitting === property.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResubmit(property.id);
                            }}
                          >
                            <RotateCcw className="mr-2 h-4 w-4" />
                            {resubmitting === property.id ? "Resubmitting…" : "Resubmit"}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedProperty(property);
                            setIsDialogOpen(true);
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(property);
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
      </div>
    </ControlsCard>
  )
}
