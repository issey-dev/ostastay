"use client"

import { useEffect, useState } from "react"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
          <Button onClick={() => setIsDialogOpen(true)} className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all duration-200 hover:from-indigo-500 hover:to-indigo-400 active:scale-95">
            <Plus className="mr-2 h-4 w-4" /> Add Property
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open)
            if (!open) setSelectedProperty(null)
          }}>
            <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="font-outfit text-xl">{selectedProperty ? 'Edit Property' : 'Create New Property'}</DialogTitle>
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

      <Card className="premium-card overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <CardTitle className="font-outfit text-lg">Property Portfolio</CardTitle>
          <CardDescription>A list of all properties currently managed in the PMS.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow className="border-slate-100 hover:bg-transparent">
                <TableHead className="font-outfit text-slate-500 uppercase tracking-wider text-xs font-semibold px-6">Code</TableHead>
                <TableHead className="font-outfit text-slate-500 uppercase tracking-wider text-xs font-semibold px-6">Property Name</TableHead>
                <TableHead className="font-outfit text-slate-500 uppercase tracking-wider text-xs font-semibold px-6">Status</TableHead>
                <TableHead className="font-outfit text-slate-500 uppercase tracking-wider text-xs font-semibold px-6">Check-in</TableHead>
                <TableHead className="font-outfit text-slate-500 uppercase tracking-wider text-xs font-semibold px-6">Check-out</TableHead>
                <TableHead className="text-right font-outfit text-slate-500 uppercase tracking-wider text-xs font-semibold px-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-20 text-slate-500">
                    <div className="flex flex-col items-center justify-center animate-pulse">
                      <div className="h-10 w-10 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin mb-4" />
                      Loading properties...
                    </div>
                  </TableCell>
                </TableRow>
              ) : properties.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-24">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="h-20 w-20 bg-indigo-50 rounded-full flex items-center justify-center mb-6 shadow-inner">
                        <Plus className="h-10 w-10 text-indigo-400" />
                      </div>
                      <h3 className="font-outfit text-lg font-semibold text-slate-800 mb-2">No Properties Yet</h3>
                      <p className="text-slate-500 text-sm mb-6">You haven't added any properties to your portfolio. Create your first hotel to get started.</p>
                      <Button onClick={() => setIsDialogOpen(true)} className="bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 shadow-md">
                        <Plus className="mr-2 h-4 w-4" /> Create Property
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                properties.map((property) => (
                  <TableRow key={property.id} className="group border-slate-50 transition-colors hover:bg-indigo-50/40 cursor-pointer">
                    <TableCell className="text-sm font-medium px-6 py-4 text-slate-700">{property.code}</TableCell>
                    <TableCell className="text-sm px-6 py-4 font-semibold text-slate-900">{property.name}</TableCell>
                    <TableCell className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                        property.status === 'ACTIVE' 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm' 
                          : 'bg-slate-100 text-slate-600 border-slate-200 shadow-sm'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${property.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                        {property.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm px-6 py-4 text-slate-600">{property.checkInTime}</TableCell>
                    <TableCell className="text-sm px-6 py-4 text-slate-600">{property.checkOutTime}</TableCell>
                    <TableCell className="text-right px-6 py-4">
                      <div className="flex gap-2 transition-opacity" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          style={{ color: '#4f46e5' }}
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
                          style={{ color: '#dc2626' }}
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
