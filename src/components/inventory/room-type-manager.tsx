"use client"

import { useState, useEffect } from "react"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

type RoomType = {
  id: string
  name: string
  code: string
  maxOccupancy: number
  basePrice: number
  description?: string
}

export function RoomTypeManager({ propertyId }: { propertyId: string }) {
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    name: "",
    code: "",
    maxOccupancy: "2",
    basePrice: "100.00",
    description: "",
  })

  const fetchRoomTypes = () => {
    setLoading(true)
    fetch(`/api/room-types?propertyId=${propertyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setRoomTypes(data)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchRoomTypes()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const url = isEditMode ? `/api/room-types/${editingId}` : "/api/room-types"
      const method = isEditMode ? "PUT" : "POST"

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          name: formData.name,
          code: formData.code,
          maxOccupancy: parseInt(formData.maxOccupancy),
          basePrice: parseFloat(formData.basePrice),
          description: formData.description || undefined,
        }),
      })

      if (response.ok) {
        setIsDialogOpen(false)
        resetForm()
        fetchRoomTypes()
      } else {
        console.error("Failed to save room type")
      }
    } catch (error) {
      console.error(error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingId) return
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/room-types/${deletingId}`, {
        method: "DELETE",
      })
      if (response.ok) {
        setIsDeleteDialogOpen(false)
        setDeletingId(null)
        fetchRoomTypes()
      }
    } catch (error) {
      console.error(error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setFormData({ name: "", code: "", maxOccupancy: "2", basePrice: "100.00", description: "" })
    setIsEditMode(false)
    setEditingId(null)
  }

  const openEdit = (rt: RoomType) => {
    setFormData({
      name: rt.name,
      code: rt.code,
      maxOccupancy: rt.maxOccupancy.toString(),
      basePrice: rt.basePrice.toString(),
      description: rt.description || "",
    })
    setIsEditMode(true)
    setEditingId(rt.id)
    setIsDialogOpen(true)
  }

  const openDelete = (id: string) => {
    setDeletingId(id)
    setIsDeleteDialogOpen(true)
  }

  return (
    <Card className="overflow-hidden mt-6">
      <CardHeader className="bg-muted/50 border-b border-border pb-4 flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-lg">Room Types</CardTitle>
          <CardDescription>Manage your property's room categories, pricing, and occupancy limits.</CardDescription>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open)
          if (!open) resetForm()
        }}>
          <Button onClick={() => setIsDialogOpen(true)} className="shadow-sm">
            <Plus className="mr-2 h-4 w-4" /> Add Room Type
          </Button>
          <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>{isEditMode ? "Edit Room Type" : "Create Room Type"}</DialogTitle>
                <DialogDescription>
                  {isEditMode ? "Update the details for this room category." : "Define a new category of rooms for this property."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Type Name</Label>
                  <Input 
                    id="name" 
                    placeholder="e.g. Deluxe Ocean View" 
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    required 
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="code">Code</Label>
                    <Input 
                      id="code" 
                      placeholder="e.g. DLX" 
                      value={formData.code}
                      onChange={(e) => setFormData({...formData, code: e.target.value})}
                      required 
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="maxOccupancy">Max Occupancy</Label>
                    <Input 
                      id="maxOccupancy" 
                      type="number" 
                      min="1" 
                      value={formData.maxOccupancy}
                      onChange={(e) => setFormData({...formData, maxOccupancy: e.target.value})}
                      required 
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="basePrice">Default Base Price</Label>
                  <Input 
                    id="basePrice" 
                    type="number" 
                    step="0.01" 
                    min="0"
                    value={formData.basePrice}
                    onChange={(e) => setFormData({...formData, basePrice: e.target.value})}
                    required 
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Input 
                    id="description" 
                    placeholder="Brief description of the room amenities" 
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save Room Type"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Delete Room Type</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this room type? This action cannot be undone and will cascade delete all rooms associated with it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
                {isSubmitting ? "Deleting..." : "Delete Permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border">
              <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Code</TableHead>
              <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Name</TableHead>
              <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Max Occupancy</TableHead>
              <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4">Base Price</TableHead>
              <TableHead className="text-muted-foreground uppercase tracking-wider text-xs font-semibold px-6 py-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Loading...</TableCell>
              </TableRow>
            ) : roomTypes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                  No room types found. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              roomTypes.map((rt) => (
                <TableRow key={rt.id} className="hover:bg-muted/40">
                  <TableCell className="px-6 py-4 font-semibold text-foreground">{rt.code}</TableCell>
                  <TableCell className="px-6 py-4 font-medium text-foreground">{rt.name}</TableCell>
                  <TableCell className="px-6 py-4 text-muted-foreground">{rt.maxOccupancy} Persons</TableCell>
                  <TableCell className="px-6 py-4 text-muted-foreground">${rt.basePrice.toFixed(2)}</TableCell>
                  <TableCell className="px-6 py-4 text-right">
                    <div className="flex gap-2 transition-opacity" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-primary"
                        onClick={() => openEdit(rt)}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-destructive"
                        onClick={() => openDelete(rt.id)}
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
  )
}
