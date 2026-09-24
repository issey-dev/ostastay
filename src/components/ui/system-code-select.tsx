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

// Simple in-memory cache to avoid re-fetching the same list. Keyed by category AND
// property — a property list (src/lib/system-code-scope.ts) differs per property, so two
// properties' lists must never share an entry. No enterprise key: the API scopes by the
// caller's session enterprise, and one browser tab is always one logged-in enterprise.
const cache: Record<string, { data: SystemCode[]; ts: number }> = {}
const CACHE_TTL = 60_000 // 1 minute

export function systemCodeCacheKey(category: string, propertyId?: string | null) {
  return `${category}|${propertyId ?? ""}`
}

export function systemCodesUrl(category: string, propertyId?: string | null) {
  const params = new URLSearchParams({ category })
  if (propertyId) params.set("propertyId", propertyId)
  return `/api/settings/system-codes?${params}`
}

interface SystemCodeSelectProps {
  /** The system-code category to fetch, e.g. "GENDER", "TITLE", "ID_TYPE" */
  category: string
  /** The property whose list to use — required for a property list (SPECIAL_REQUEST,
   *  TRANSPORT_TYPE, ...; see src/lib/system-code-scope.ts), ignored for an enterprise one. */
  propertyId?: string | null
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
  propertyId,
  value,
  onValueChange,
  placeholder = "Select...",
  required = false,
  disabled = false,
}: SystemCodeSelectProps) {
  const [options, setOptions] = useState<SystemCode[]>([])
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef<string | null>(null)

  useEffect(() => {
    const key = systemCodeCacheKey(category, propertyId)
    // Prevent double-fetch in strict mode (but refetch when the list changes)
    if (fetchedRef.current === key) return
    fetchedRef.current = key

    const cached = cache[key]

    // Return cached data if still fresh
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setOptions(cached.data)
      setLoading(false)
      return
    }

    setLoading(true)
    fetch(systemCodesUrl(category, propertyId))
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setOptions(data)
          cache[key] = { data, ts: Date.now() }
        }
      })
      .catch((err) => {
        console.error(`Failed to fetch system codes for ${category}:`, err)
      })
      .finally(() => setLoading(false))
  }, [category, propertyId])

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
 * Utility: Invalidate the cache for a specific category (at every property) so the next
 * render re-fetches. Call this after adding/editing/deleting system codes.
 */
export function invalidateSystemCodeCache(category?: string) {
  if (category) {
    for (const key of Object.keys(cache)) {
      if (key.startsWith(`${category}|`)) delete cache[key]
    }
  } else {
    // Clear everything
    for (const key of Object.keys(cache)) {
      delete cache[key]
    }
  }
}
