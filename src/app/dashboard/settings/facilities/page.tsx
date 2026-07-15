"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Facility = {
  id: string
  name: string
  description: string | null
}

export default function FacilitiesSettings() {
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")

  const propertyId = "00000000-0000-0000-0000-000000000000" // Hardcoded for this UI demo

  const fetchFacilities = () => {
    setLoading(true)
    fetch(`/api/facilities?propertyId=${propertyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setFacilities(data)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchFacilities()
  }, [])

  const handleAdd = async () => {
    if (!newName) return
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
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Master Data: Facilities</h2>
        <p className="text-muted-foreground">
          Manage dynamic dropdowns for property facilities (e.g., Pool, Gym, Spa).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add New Facility</CardTitle>
          <CardDescription>This will appear in the amenities dropdown for the property.</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Facilities</CardTitle>
        </CardHeader>
        <CardContent>
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
                      <Button variant="ghost" size="icon" className="text-red-500">
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
