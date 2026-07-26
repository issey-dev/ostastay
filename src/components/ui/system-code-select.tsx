"use client"

import { useEffect, useState, useRef } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"

// Above this many options a plain dropdown is painful to scan (Country/Nationality carry
// 200+), so switch to the searchable variant. Short LOVs (Gender, Title, ID Type…) stay a
// plain Select. One threshold here fixes every SystemCodeSelect call site at once.
const SEARCHABLE_THRESHOLD = 12

type SystemCode = {
  id: string
  code: string
  value: string
  sortOrder: number
}

// Simple in-memory cache to avoid re-fetching the same category. Scoped by category
// only — the API itself scopes by the caller's session enterprise, and this cache is
// already session-local (one browser tab is always one logged-in enterprise), so no
// enterprise key is needed here.
const cache: Record<string, { data: SystemCode[]; ts: number }> = {}
const CACHE_TTL = 60_000 // 1 minute

interface SystemCodeSelectProps {
  /** The system-code category to fetch, e.g. "GENDER", "TITLE", "ID_TYPE" */
  category: string
  /** Current value (code) */
  value: string
  /** Callback when the user selects a value */
  onValueChange: (value: string) => void
  /** Placeholder text shown when nothing is selected */
  placeholder?: string
  /** Whether the field is required */
  required?: boolean
  /** Whether the field is disabled */
  disabled?: boolean
}

export function SystemCodeSelect({
  category,
  value,
  onValueChange,
  placeholder = "Select...",
  required = false,
  disabled = false,
}: SystemCodeSelectProps) {
  const [options, setOptions] = useState<SystemCode[]>([])
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef(false)

  useEffect(() => {
    // Prevent double-fetch in strict mode
    if (fetchedRef.current) return
    fetchedRef.current = true

    const cached = cache[category]

    // Return cached data if still fresh
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setOptions(cached.data)
      setLoading(false)
      return
    }

    fetch(`/api/settings/system-codes?category=${category}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setOptions(data)
          cache[category] = { data, ts: Date.now() }
        }
      })
      .catch((err) => {
        console.error(`Failed to fetch system codes for ${category}:`, err)
      })
      .finally(() => setLoading(false))
  }, [category])

  if (loading) {
    return (
      <Select value={value} disabled>
        <SelectTrigger>
          <SelectValue placeholder="Loading..." />
        </SelectTrigger>
      </Select>
    )
  }

  if (options.length === 0) {
    return (
      <Select value={value} disabled>
        <SelectTrigger>
          <SelectValue placeholder="No options available" />
        </SelectTrigger>
      </Select>
    )
  }

  // Long lists (Country, Nationality…) get a type-to-filter combobox; short LOVs keep the
  // plain dropdown. Same value/onChange contract either way, so every call site is unchanged.
  if (options.length > SEARCHABLE_THRESHOLD) {
    return (
      <SearchableSelect
        value={value}
        onChange={(val) => onValueChange(val ?? "")}
        options={options.map((opt) => ({ label: opt.value, value: opt.code }))}
        placeholder={placeholder}
        searchPlaceholder="Search..."
        disabled={disabled}
        required={required}
      />
    )
  }

  return (
    <Select
      value={value}
      onValueChange={(val) => onValueChange(val ?? "")}
      required={required}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder}>
          {value ? options.find((o) => o.code === value)?.value : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.code} value={opt.code}>
            {opt.value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Utility: Invalidate the cache for a specific category so the next
 * render re-fetches. Call this after adding/editing/deleting system codes.
 */
export function invalidateSystemCodeCache(category?: string) {
  if (category) {
    delete cache[category]
  } else {
    // Clear everything
    for (const key of Object.keys(cache)) {
      delete cache[key]
    }
  }
}
