"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type PropertyOption = { id: string; name: string }
type Sequence = { sequenceType: string; currentValue: number; updatedAt: string | null }

const SEQUENCE_LABELS: Record<string, string> = {
  REGISTRATION_NO: "Reservation No (confirmation)",
  PROFORMA_FOLIO: "Proforma Folio",
  TAX_INVOICE: "Tax Invoice",
  RECEIPT_NO: "Receipt No",
  GUEST_REG_NO: "Guest Registration No (Green Tax, resets yearly)",
}
const SEQUENCE_TYPES = Object.keys(SEQUENCE_LABELS)

export function SequenceManager() {
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [propertyId, setPropertyId] = useState("")
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [editingType, setEditingType] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/properties")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProperties(data)
          if (data.length > 0) setPropertyId(data[0].id)
        }
      })
      .catch(console.error)
  }, [])

  const fetchSequences = useCallback(() => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/settings/sequences?propertyId=${propertyId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setSequences(data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [propertyId])

  useEffect(() => { fetchSequences() }, [fetchSequences])

  const startEdit = (sequenceType: string, currentValue: number) => {
    setEditingType(sequenceType)
    setEditValue(String(currentValue))
  }

  const saveEdit = async (sequenceType: string) => {
    const parsed = Number(editValue)
    if (!Number.isInteger(parsed) || parsed < 0) return
    setSaving(true)
    try {
      const res = await fetch("/api/settings/sequences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, sequenceType, currentValue: parsed }),
      })
      if (res.ok) {
        setEditingType(null)
        fetchSequences()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 max-w-xs">
        <Label className="text-sm font-medium">Property</Label>
        <Select value={propertyId} onValueChange={(v) => setPropertyId(v ?? "")}>
          <SelectTrigger>
            <SelectValue placeholder="Select property">{properties.find((p) => p.id === propertyId)?.name}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {properties.length === 0 && <p className="text-xs text-muted-foreground">Create a property first.</p>}
      </div>

      {propertyId && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Current Sequence</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
            ) : (
              SEQUENCE_TYPES.map((sequenceType) => {
                const seq = sequences.find((s) => s.sequenceType === sequenceType)
                const currentValue = seq?.currentValue ?? 0
                const isEditing = editingType === sequenceType
                return (
                  <TableRow key={sequenceType}>
                    <TableCell className="font-medium">{SEQUENCE_LABELS[sequenceType]}</TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-8 w-32"
                          autoFocus
                        />
                      ) : (
                        <span className="tabular-nums">{currentValue}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingType(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => saveEdit(sequenceType)} disabled={saving}>Save</Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => startEdit(sequenceType, currentValue)}>
                          Start from new sequence
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
