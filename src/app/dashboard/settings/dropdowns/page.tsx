"use client"

import { useEffect, useState } from "react"
import { Plus, GripVertical, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type SystemCode = {
  id: string
  category: string
  code: string
  value: string
  sortOrder: number
  isActive: boolean
}

export default function DropdownsSettings() {
  const [codes, setCodes] = useState<SystemCode[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState("GENDER")
  
  const [form, setForm] = useState({ code: "", value: "" })
  const enterpriseId = "00000000-0000-0000-0000-000000000000" // Demo

  const fetchCodes = () => {
    setLoading(true)
    fetch(`/api/settings/system-codes?enterpriseId=${enterpriseId}&category=${category}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setCodes(data)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchCodes()
  }, [category])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code || !form.value) return

    try {
      const res = await fetch("/api/settings/system-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, category, enterpriseId, sortOrder: codes.length })
      })

      if (res.ok) {
        setForm({ code: "", value: "" })
        fetchCodes()
      } else {
        const error = await res.json()
        alert(error.error || "Failed to add code")
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleDelete = async (id: string) => {
    // Soft delete or just update isActive to false
    try {
      const res = await fetch("/api/settings/system-codes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive: false })
      })
      if (res.ok) fetchCodes()
    } catch (e) {
      console.error(e)
    }
  }

  const moveUp = async (index: number) => {
    if (index === 0) return
    const newCodes = [...codes]
    const temp = newCodes[index].sortOrder
    newCodes[index].sortOrder = newCodes[index - 1].sortOrder
    newCodes[index - 1].sortOrder = temp
    
    // Sort array
    newCodes.sort((a, b) => a.sortOrder - b.sortOrder)
    setCodes(newCodes)

    // Save
    await fetch("/api/settings/system-codes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCodes)
    })
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dropdown Settings</h2>
        <p className="text-muted-foreground">
          Manage dynamic lists like Genders, Titles, and Preferences used across the PMS.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Category Selection</CardTitle>
          <CardDescription>Select a category to manage its options.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Label>Category</Label>
            <Select value={category} onValueChange={(val) => setCategory(val ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Select Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GENDER">Gender</SelectItem>
                <SelectItem value="TITLE">Title (Mr, Mrs)</SelectItem>
                <SelectItem value="NATIONALITY">Nationality / Country</SelectItem>
                <SelectItem value="ID_TYPE">ID / Document Type</SelectItem>
                <SelectItem value="CLASSIFICATION">Profile Classification</SelectItem>
                <SelectItem value="DIETARY_REQ">Dietary Requirements</SelectItem>
                <SelectItem value="ROOM_PREF">Room Preferences</SelectItem>
                <SelectItem value="HOUSEKEEPING_REQUEST">Housekeeping Requests</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manage {category}</CardTitle>
          <CardDescription>Add or reorder items in this list.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex gap-4 items-end mb-6">
            <div className="grid gap-2 flex-1">
              <Label>Code (Internal)</Label>
              <Input placeholder="e.g. M, F, VEG" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} />
            </div>
            <div className="grid gap-2 flex-1">
              <Label>Display Value</Label>
              <Input placeholder="e.g. Male, Female, Vegan" value={form.value} onChange={e => setForm(p => ({ ...p, value: e.target.value }))} />
            </div>
            <Button type="submit"><Plus className="w-4 h-4 mr-2" /> Add</Button>
          </form>

          <div className="space-y-2 border rounded-md p-4">
            {loading ? (
              <p className="text-sm text-slate-500">Loading...</p>
            ) : codes.length === 0 ? (
              <p className="text-sm text-slate-500">No items found for this category.</p>
            ) : (
              codes.map((c, i) => (
                <div key={c.id} className="flex items-center justify-between p-3 bg-slate-50 border rounded-md">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => moveUp(i)} 
                      disabled={i === 0}
                      className="cursor-pointer text-slate-400 hover:text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <GripVertical className="w-4 h-4" />
                    </button>
                    <div>
                      <p className="font-medium text-sm">{c.value}</p>
                      <p className="text-xs text-slate-500">Code: {c.code}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
