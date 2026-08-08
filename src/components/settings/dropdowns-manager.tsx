"use client"

import { useEffect, useState, useCallback } from "react"
import { Plus, Trash2, ChevronUp, ChevronDown, Pencil, Check, X, ListChecks } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ControlsSectionHeader, ControlsSectionBody } from "@/components/controls/controls-section-header"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
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
  { code: "VIP_LEVEL",   label: "VIP Level" },
  { code: "DIETARY_REQ", label: "Dietary Requirements" },
  { code: "PREFERENCE",  label: "Preferences" },
]

export const OPERATIONS_LOV_CATEGORIES: DropdownCategory[] = [
  { code: "HOUSEKEEPING_REQUEST", label: "Housekeeping Requests" },
  // A user's POST, as opposed to their role. HOUSEKEEPING and MAINTENANCE drive the
  // assignment pickers — see src/lib/job-functions.ts before renaming or removing them.
  { code: "JOB_FUNCTION", label: "Job Functions (staff posts)" },
]

export const RESERVATION_LOV_CATEGORIES: DropdownCategory[] = [
  { code: "SPECIAL_REQUEST", label: "Special Requests" },
  { code: "TRANSPORT_TYPE", label: "Transport Type (Pickup / Dropoff)" },
]

// Room-specific feature lists, assigned per Room Type (all multi-select) via the Room
// Types form's Room Features picker.
export const ROOM_FEATURE_LOV_CATEGORIES: DropdownCategory[] = [
  { code: "BED_TYPE",     label: "Bed Type" },
  { code: "ROOM_VIEW",    label: "View" },
  { code: "ROOM_AMENITY", label: "Amenities" },
]

export function DropdownsManager({ categories = PROFILE_LOV_CATEGORIES }: { categories?: DropdownCategory[] }) {
  const [codes, setCodes] = useState<SystemCode[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [category, setCategory] = useState(categories[0]?.code ?? "")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [form, setForm] = useState({ code: "", value: "" })
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const fetchCodes = useCallback(() => {
    setLoading(true)
    fetch(`/api/settings/system-codes?category=${category}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setCodes(data)
      })
      .finally(() => setLoading(false))
  }, [category])

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
        body: JSON.stringify({ ...form, category, sortOrder: codes.length + 1 })
      })

      if (res.ok) {
        setForm({ code: "", value: "" })
        invalidateSystemCodeCache(category)
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
        invalidateSystemCodeCache(category)
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
        invalidateSystemCodeCache(category)
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
    invalidateSystemCodeCache(category)
  }

  const currentCategoryLabel = categories.find(c => c.code === category)?.label || category

  return (
    <div className="flex flex-col gap-6">
      {/* Category Switcher — a Select when there's only one category would just be a
          single dead-end option, so tabs only render once there's more than one. */}
      {categories.length > 1 ? (
        <Tabs value={category} onValueChange={(val) => setCategory(val ?? category)}>
          {/* Some category sets run to 8 items (e.g. profile LOVs) — flex-wrap pushed
              those into 4+ rows before any content was visible on a phone. A single
              horizontally-scrollable row keeps every tab reachable without pushing the
              list below the fold. */}
          <div className="overflow-x-auto">
            <TabsList className="h-auto w-max flex-nowrap">
              {categories.map(cat => (
                <TabsTrigger key={cat.code} value={cat.code} className="shrink-0 grow-0">{cat.label}</TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
      ) : (
        <Label className="text-sm font-medium">{currentCategoryLabel}</Label>
      )}

      {/* Add New Item */}
      {feedback && (
        <div className={`p-3 rounded-lg text-sm font-medium ${feedback.type === 'success' ? 'bg-success-muted text-success' : 'bg-destructive-muted text-destructive'}`}>
          {feedback.message}
        </div>
      )}
      <div>
        <ControlsSectionHeader
          title={`Add New ${currentCategoryLabel} Option`}
          description="Enter a unique code and its display label."
        />
        <form onSubmit={handleAdd} className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="grid gap-2 md:flex-1">
            <Label className="text-xs text-muted-foreground">Code (Internal)</Label>
            <Input
              placeholder="e.g. M, F, VEG"
              value={form.code}
              onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
            />
          </div>
          <div className="grid gap-2 md:flex-1">
            <Label className="text-xs text-muted-foreground">Display Value</Label>
            <Input
              placeholder="e.g. Male, Female, Vegan"
              value={form.value}
              onChange={e => setForm(p => ({ ...p, value: e.target.value }))}
            />
          </div>
          <Button type="submit" className="w-full md:w-auto" disabled={saving || !form.code || !form.value}>
            <Plus className="w-4 h-4 mr-2" /> Add
          </Button>
        </form>
      </div>

      {/* Item List — a simple table, not a reorderable card stack */}
      <div>
        <ControlsSectionHeader
          title={`Current ${currentCategoryLabel} Options`}
          description="Use the arrows to reorder — that order is the dropdown order throughout the system."
        />
        <ControlsSectionBody>
          {/* Phone — reorderable card stack. Table below takes over at md. */}
          <div className="p-4 md:hidden">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))}
              </div>
            ) : codes.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title={`No items found for ${currentCategoryLabel}`}
                description="Add your first option using the form above."
              />
            ) : (
              <div className="space-y-3">
                {codes.map((c, i) => (
                  <div key={c.id} className="rounded-lg border border-border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">{c.code}</p>
                        {editingId === c.id ? (
                          <div className="mt-1 flex items-center gap-2">
                            <Input
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              className="h-8"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === "Enter") handleInlineEdit(c.id)
                                if (e.key === "Escape") setEditingId(null)
                              }}
                            />
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 text-success" onClick={() => handleInlineEdit(c.id)}>
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 text-muted-foreground" onClick={() => setEditingId(null)}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="mt-0.5 flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{c.value}</span>
                            <button
                              type="button"
                              onClick={() => { setEditingId(c.id); setEditValue(c.value) }}
                              className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors shrink-0"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-9 w-9 shrink-0 p-0 text-destructive hover:text-destructive hover:bg-destructive-muted">
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
                    <div className="flex items-center gap-2 border-t border-border/50 pt-3">
                      <Button variant="outline" size="sm" className="h-8 flex-1" disabled={i === 0} onClick={() => reorder(i, "up")}>
                        <ChevronUp className="w-3.5 h-3.5 mr-1.5" /> Move up
                      </Button>
                      <Button variant="outline" size="sm" className="h-8 flex-1" disabled={i === codes.length - 1} onClick={() => reorder(i, "down")}>
                        <ChevronDown className="w-3.5 h-3.5 mr-1.5" /> Move down
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-16"></TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Display Value</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={4}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))
              ) : codes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-0">
                    <EmptyState
                      icon={ListChecks}
                      title={`No items found for ${currentCategoryLabel}`}
                      description="Add your first option using the form above."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                codes.map((c, i) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => reorder(i, "up")}
                          disabled={i === 0}
                          className="p-0.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => reorder(i, "down")}
                          disabled={i === codes.length - 1}
                          className="p-0.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-muted-foreground">{c.code}</TableCell>
                    <TableCell>
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
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{c.value}</span>
                          <button
                            type="button"
                            onClick={() => { setEditingId(c.id); setEditValue(c.value) }}
                            className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
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
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
        </ControlsSectionBody>
      </div>
    </div>
  )
}
