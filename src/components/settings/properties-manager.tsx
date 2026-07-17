"use client"

import { useEffect, useState } from "react"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
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
      <div className="flex justify-end items-center">
        <div>
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Property
          </Button>
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
        </div>
      </div>
      
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

      <Card className="overflow-hidden">
        <CardHeader className="bg-muted/50 border-b border-border pb-4">
          <CardTitle className="text-lg">Property Portfolio</CardTitle>
          <CardDescription>A list of all properties currently managed in the PMS.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
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
                  <TableCell colSpan={6} className="text-center py-24">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="h-20 w-20 bg-muted rounded-full flex items-center justify-center mb-6 shadow-inner">
                        <Plus className="h-10 w-10 text-muted-foreground" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground mb-2">No Properties Yet</h3>
                      <p className="text-muted-foreground text-sm mb-6">You haven't added any properties to your portfolio. Create your first hotel to get started.</p>
                      <Button onClick={() => setIsDialogOpen(true)} className="shadow-md">
                        <Plus className="mr-2 h-4 w-4" /> Create Property
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                properties.map((property) => (
                  <TableRow key={property.id} className="group border-border transition-colors hover:bg-muted/40 cursor-pointer">
                    <TableCell className="text-sm font-medium px-6 py-4 text-foreground">{property.code}</TableCell>
                    <TableCell className="text-sm px-6 py-4 font-semibold text-foreground">{property.name}</TableCell>
                    <TableCell className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                        property.status === 'ACTIVE' 
                          ? 'bg-success-muted text-success border-success/30 shadow-sm' 
                          : 'bg-muted text-muted-foreground border-border shadow-sm'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${property.status === 'ACTIVE' ? 'bg-success' : 'bg-muted-foreground'}`}></span>
                        {property.status}
                      </span>
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
        </CardContent>
      </Card>
    </div>
  )
}
