"use client"

import { useEffect, useState, useCallback } from "react"
import { Plus, GripVertical, Trash2, ChevronUp, ChevronDown, Pencil, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { invalidateSystemCodeCache } from "@/components/ui/system-code-select"

type SystemCode = {
  id: string
  category: string
  code: string
  value: string
  sortOrder: number
  isActive: boolean
}

export type DropdownCategory = { code: string; label: string }

// Split by which Controls tab manages them — Client Relations gets the profile-related
// lists, Inventory gets the operational ones. Both instantiate the same reusable
// DropdownsManager below with a different `categories` prop rather than forking the
// component.
export const PROFILE_LOV_CATEGORIES: DropdownCategory[] = [
  { code: "GENDER",      label: "Gender" },
  { code: "TITLE",       label: "Title (Mr, Mrs)" },
  { code: "NATIONALITY", label: "Nationality" },
  { code: "ID_TYPE",     label: "ID / Document Type" },
  { code: "CLASSIFICATION", label: "Profile Classification" },
  { code: "DIETARY_REQ", label: "Dietary Requirements" },
  { code: "ROOM_PREF",   label: "Room Preferences" },
]

export const OPERATIONS_LOV_CATEGORIES: DropdownCategory[] = [
  { code: "HOUSEKEEPING_REQUEST", label: "Housekeeping Requests" },
]

export function DropdownsManager({ categories = PROFILE_LOV_CATEGORIES }: { categories?: DropdownCategory[] }) {
  const [codes, setCodes] = useState<SystemCode[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [category, setCategory] = useState(categories[0]?.code ?? "")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [form, setForm] = useState({ code: "", value: "" })
  const enterpriseId = "00000000-0000-0000-0000-000000000000"
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const fetchCodes = useCallback(() => {
    setLoading(true)
    fetch(`/api/settings/system-codes?enterpriseId=${enterpriseId}&category=${category}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setCodes(data)
      })
      .finally(() => setLoading(false))
  }, [category, enterpriseId])

  useEffect(() => {
    fetchCodes()
  }, [fetchCodes])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code || !form.value) return

    setSaving(true)
    try {
      const res = await fetch("/api/settings/system-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, category, enterpriseId, sortOrder: codes.length + 1 })
      })

      if (res.ok) {
        setForm({ code: "", value: "" })
        invalidateSystemCodeCache(category, enterpriseId)
        fetchCodes()
        setFeedback({ message: "Code added successfully", type: "success" })
        setTimeout(() => setFeedback(null), 4000)
      } else {
        const error = await res.json()
        setFeedback({ message: error.error || "Failed to add code", type: "error" })
        setTimeout(() => setFeedback(null), 4000)
      }
    } catch (e) {
      console.error(e)
      setFeedback({ message: "An unexpected error occurred.", type: "error" })
      setTimeout(() => setFeedback(null), 4000)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch("/api/settings/system-codes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive: false })
      })
      if (res.ok) {
        invalidateSystemCodeCache(category, enterpriseId)
        fetchCodes()
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleInlineEdit = async (id: string) => {
    if (!editValue.trim()) return
    try {
      const res = await fetch("/api/settings/system-codes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, value: editValue.trim() })
      })
      if (res.ok) {
        setEditingId(null)
        invalidateSystemCodeCache(category, enterpriseId)
        fetchCodes()
      }
    } catch (e) {
      console.error(e)
    }
  }

  const reorder = async (index: number, direction: "up" | "down") => {
    const swapIndex = direction === "up" ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= codes.length) return

    const newCodes = [...codes]
    const tempSort = newCodes[index].sortOrder
    newCodes[index].sortOrder = newCodes[swapIndex].sortOrder
    newCodes[swapIndex].sortOrder = tempSort
    newCodes.sort((a, b) => a.sortOrder - b.sortOrder)
    setCodes(newCodes)

    await fetch("/api/settings/system-codes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCodes.map(c => ({ id: c.id, sortOrder: c.sortOrder, isActive: c.isActive, value: c.value })))
    })
    invalidateSystemCodeCache(category, enterpriseId)
  }

  const currentCategoryLabel = categories.find(c => c.code === category)?.label || category

  return (
    <div className="flex flex-col gap-6">
      {/* Category Selector */}
      <div className="flex items-end gap-4">
        <div className="grid gap-2 w-96">
          <Label className="text-sm font-medium">Category</Label>
          <Select value={category} onValueChange={(val) => setCategory(val ?? "")}>
            <SelectTrigger>
              <SelectValue placeholder="Select Category" />
            </SelectTrigger>
            <SelectContent className="min-w-[24rem]">
              {categories.map(cat => (
                <SelectItem key={cat.code} value={cat.code}>{cat.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground pb-2">
          {codes.length} item{codes.length !== 1 ? "s" : ""} in this list
        </p>
      </div>

      {/* Add New Item */}
      {feedback && (
        <div className={`p-3 rounded-lg text-sm font-medium ${feedback.type === 'success' ? 'bg-success-muted text-success' : 'bg-destructive-muted text-destructive'}`}>
          {feedback.message}
        </div>
      )}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add New {currentCategoryLabel} Option</CardTitle>
          <CardDescription>Enter a unique code and its display label.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex gap-4 items-end">
            <div className="grid gap-2 flex-1">
              <Label className="text-xs text-muted-foreground">Code (Internal)</Label>
              <Input
                placeholder="e.g. M, F, VEG"
                value={form.code}
                onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
              />
            </div>
            <div className="grid gap-2 flex-1">
              <Label className="text-xs text-muted-foreground">Display Value</Label>
              <Input
                placeholder="e.g. Male, Female, Vegan"
                value={form.value}
                onChange={e => setForm(p => ({ ...p, value: e.target.value }))}
              />
            </div>
            <Button type="submit" disabled={saving || !form.code || !form.value}>
              <Plus className="w-4 h-4 mr-2" /> Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Item List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Current {currentCategoryLabel} Options</CardTitle>
          <CardDescription>Reorder items using arrows. The order here determines dropdown order throughout the system.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {loading ? (
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-14 bg-muted rounded-md animate-pulse" />
                ))}
              </div>
            ) : codes.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No items found for <strong>{currentCategoryLabel}</strong>.</p>
                <p className="text-xs mt-1">Add your first option using the form above.</p>
              </div>
            ) : (
              codes.map((c, i) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-3 bg-muted border rounded-lg hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {/* Reorder arrows */}
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => reorder(i, "up")}
                        disabled={i === 0}
                        className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => reorder(i, "down")}
                        disabled={i === codes.length - 1}
                        className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Item content */}
                    {editingId === c.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          className="h-8 w-48"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === "Enter") handleInlineEdit(c.id)
                            if (e.key === "Escape") setEditingId(null)
                          }}
                        />
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-success" onClick={() => handleInlineEdit(c.id)}>
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => setEditingId(null)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="font-medium text-sm">{c.value}</p>
                          <p className="text-xs text-muted-foreground">Code: {c.code}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setEditingId(c.id); setEditValue(c.value) }}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-muted-foreground transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Delete */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive-muted">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete &quot;{c.value}&quot;?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove &quot;{c.value}&quot; ({c.code}) from the {currentCategoryLabel} dropdown.
                          Existing records using this code will not be affected.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(c.id)} className="bg-destructive hover:bg-destructive/90">
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
