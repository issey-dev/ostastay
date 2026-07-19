"use client"

import { useEffect, useState } from "react"
import { Plus, Pencil, Trash2, Building2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ControlsSectionHeader, ControlsSectionBody } from "@/components/controls/controls-section-header"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { PropertyForm } from "@/components/property-form"

type Property = {
  id: string
  name: string
  code: string
  status: string
  checkInTime: string
  checkOutTime: string
}

export function PropertiesManager() {
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

  return (
    <div className="flex flex-col gap-6">
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

      <ControlsSectionHeader
        action={
          <Button onClick={() => setIsDialogOpen(true)} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> Add Property
          </Button>
        }
      />
      <ControlsSectionBody>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6">Code</TableHead>
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
                properties.map((property) => (
                  <TableRow key={property.id} className="group border-border transition-colors hover:bg-muted/40 cursor-pointer">
                    <TableCell className="text-sm font-medium px-6 py-4 text-foreground">{property.code}</TableCell>
                    <TableCell className="text-sm px-6 py-4 font-semibold text-foreground">{property.name}</TableCell>
                    <TableCell className="px-6 py-4">
                      <StatusBadge label={property.status} status={property.status} dot className="shadow-sm" />
                    </TableCell>
                    <TableCell className="text-sm px-6 py-4 text-muted-foreground">{property.checkInTime}</TableCell>
                    <TableCell className="text-sm px-6 py-4 text-muted-foreground">{property.checkOutTime}</TableCell>
                    <TableCell className="text-right px-6 py-4">
                      <div className="flex gap-2 transition-opacity" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
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
      </ControlsSectionBody>
    </div>
  )
}
