"use client"

import { useEffect, useState, useRef } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type SystemCode = {
  id: string
  code: string
  value: string
  sortOrder: number
}

// Simple in-memory cache to avoid re-fetching the same category
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
  /** Tenant ID — defaults to the demo tenant */
  tenantId?: string
}

export function SystemCodeSelect({
  category,
  value,
  onValueChange,
  placeholder = "Select...",
  required = false,
  disabled = false,
  tenantId = "00000000-0000-0000-0000-000000000000",
}: SystemCodeSelectProps) {
  const [options, setOptions] = useState<SystemCode[]>([])
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef(false)

  useEffect(() => {
    // Prevent double-fetch in strict mode
    if (fetchedRef.current) return
    fetchedRef.current = true

    const cacheKey = `${tenantId}:${category}`
    const cached = cache[cacheKey]

    // Return cached data if still fresh
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setOptions(cached.data)
      setLoading(false)
      return
    }

    fetch(`/api/settings/system-codes?tenantId=${tenantId}&category=${category}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setOptions(data)
          cache[cacheKey] = { data, ts: Date.now() }
        }
      })
      .catch((err) => {
        console.error(`Failed to fetch system codes for ${category}:`, err)
      })
      .finally(() => setLoading(false))
  }, [category, tenantId])

  if (loading) {
    return (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="Loading..." />
        </SelectTrigger>
      </Select>
    )
  }

  if (options.length === 0) {
    return (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="No options available" />
        </SelectTrigger>
      </Select>
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
export function invalidateSystemCodeCache(category?: string, tenantId?: string) {
  if (category && tenantId) {
    delete cache[`${tenantId}:${category}`]
  } else {
    // Clear everything
    for (const key of Object.keys(cache)) {
      delete cache[key]
    }
  }
}
