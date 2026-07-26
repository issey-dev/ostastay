"use client"

import { useEffect, useState } from "react"
import { Plus, Pencil, Trash2, Building2, RotateCcw } from "@/components/icons"
import { Button } from "@/components/ui/button"
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
  DialogFooter,
} from "@/components/ui/dialog"
import { PropertyForm } from "@/components/property-form"

type Property = {
  id: string
  name: string
  code: string
  status: string
  rejectionReason?: string | null
  checkInTime: string
  checkOutTime: string
}

export function PropertiesManager({ title, description }: { title: string; description?: string }) {
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [propertyToDelete, setPropertyToDelete] = useState<Property | null>(null)
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
      if (!res.ok) throw new Error("Failed to resubmit property")
      fetchProperties()
    } catch (error) {
      console.error(error)
    } finally {
      setResubmitting(null)
    }
  }

  const handleDelete = async () => {
    if (!propertyToDelete) return
    
    try {
      const res = await fetch(`/api/properties/${propertyToDelete.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete property')
      setPropertyToDelete(null)
      fetchProperties()
    } catch (error) {
      console.error(error)
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
          <Plus className="mr-2 h-4 w-4" /> Add Property
        </Button>
      }
    >
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open)
        if (!open) setSelectedProperty(null)
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-xl">{selectedProperty ? 'Edit Property' : 'Create New Property'}</DialogTitle>
            <DialogDescription>
              {selectedProperty ? 'Update the details for this property.' : 'Add a new hotel or guest house to your tenant portfolio.'}
            </DialogDescription>
          </DialogHeader>
          <PropertyForm
            initialData={selectedProperty}
            onSuccess={() => {
              setIsDialogOpen(false)
              setSelectedProperty(null)
              fetchProperties()
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!propertyToDelete} onOpenChange={(open) => !open && setPropertyToDelete(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Are you absolutely sure?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the property 
              <strong> {propertyToDelete?.name} </strong> and remove its data from our servers.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button 
              variant="outline" 
              onClick={() => setPropertyToDelete(null)}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDelete}
            >
              Delete Property
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="-mx-6 -mb-6 border-t border-border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border hover:bg-transparent">
                <SortableTableHead columnKey="code" sort={sort} className="px-6">Code</SortableTableHead>
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6">Property Name</TableHead>
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
                      title="No Properties Yet"
                      description="You haven't added any properties to your portfolio. Create your first hotel to get started."
                      action={
                        <Button onClick={() => setIsDialogOpen(true)} className="shadow-md">
                          <Plus className="mr-2 h-4 w-4" /> Create Property
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                sortedProperties.map((property) => (
                  <TableRow key={property.id} className="group border-border transition-colors hover:bg-muted/40 cursor-pointer">
                    <TableCell className="text-sm font-medium px-6 py-4 text-foreground">{property.code}</TableCell>
                    <TableCell className="text-sm px-6 py-4 font-semibold text-foreground">{property.name}</TableCell>
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
                            {resubmitting === property.id ? "Resubmitting..." : "Resubmit"}
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
                            setPropertyToDelete(property);
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
    </ControlsCard>
  )
}
