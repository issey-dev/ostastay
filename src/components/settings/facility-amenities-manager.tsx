"use client"

import { useState, useEffect, useCallback } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Facility = { id: string; name: string; description: string | null }
type PropertyOption = { id: string; name: string }

// Folded in from the previously-orphaned /dashboard/settings/facilities page — this is
// the amenities list (Pool, Gym, Spa) shown on a property's public/guest-facing profile,
// distinct from "Facilities & Rooms" tab's Buildings/Floors/RoomTypes management above.
// NOTE: /api/facilities itself is not yet session-scoped (see Phase 2 of the rollout).
export function FacilityAmenitiesManager() {
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [propertyId, setPropertyId] = useState("")
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")

  useEffect(() => {
    fetch("/api/properties")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProperties(data)
          if (data.length > 0) setPropertyId(data[0].id)
        }
      })
  }, [])

  const fetchFacilities = useCallback(() => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/facilities?propertyId=${propertyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setFacilities(data)
      })
      .finally(() => setLoading(false))
  }, [propertyId])

  useEffect(() => { fetchFacilities() }, [fetchFacilities])

  const handleAdd = async () => {
    if (!newName || !propertyId) return
    await fetch("/api/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, name: newName, description: newDesc }),
    })
    setNewName("")
    setNewDesc("")
    fetchFacilities()
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 max-w-xs">
        <label className="text-sm font-medium">Property</label>
        <Select value={propertyId} onValueChange={(v) => setPropertyId(v ?? "")}>
          <SelectTrigger><SelectValue placeholder="Select property">{properties.find((p) => p.id === propertyId)?.name}</SelectValue></SelectTrigger>
          <SelectContent>
            {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {properties.length === 0 && <p className="text-xs text-muted-foreground">Create a property above first.</p>}
      </div>

      {propertyId && (
        <>
          <div className="flex gap-4 items-end">
            <div className="space-y-2 flex-1">
              <label className="text-sm font-medium">Facility Name</label>
              <Input placeholder="e.g. Infinity Pool" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-2 flex-1">
              <label className="text-sm font-medium">Description (Optional)</label>
              <Input placeholder="Located on the rooftop" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </div>
            <Button onClick={handleAdd} disabled={!newName}>
              <Plus className="h-4 w-4 mr-2" /> Add
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={3} className="text-center">Loading...</TableCell></TableRow>
              ) : facilities.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="text-center">No facilities configured.</TableCell></TableRow>
              ) : (
                facilities.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell>{f.description || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  )
}
