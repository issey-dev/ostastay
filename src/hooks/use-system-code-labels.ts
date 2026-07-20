"use client"

import { useEffect, useState } from "react"

// Read-only display helper for pages that show a SystemCode-backed field (Title,
// Gender, Nationality, Classification, VIP Level, ID/Document Type, ...) as plain
// text rather than through SystemCodeSelect — resolves the stored `code` to its
// configured `value` (e.g. "MRS" -> "Mrs", "NID" -> "National Identity Card").
// Fetches every category in one request (no `category` filter) since a single
// profile page touches several of them.

type SystemCode = { category: string; code: string; value: string }

let cache: { data: SystemCode[]; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

export function useSystemCodeLabels() {
  const [codes, setCodes] = useState<SystemCode[]>(cache?.data ?? [])

  useEffect(() => {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      setCodes(cache.data)
      return
    }
    fetch("/api/settings/system-codes")
      .then((r) => r.json())
      .then((data: SystemCode[]) => {
        if (Array.isArray(data)) {
          cache = { data, ts: Date.now() }
          setCodes(data)
        }
      })
      .catch(() => {})
  }, [])

  function label(category: string, code: string | null | undefined): string | undefined {
    if (!code) return undefined
    return codes.find((c) => c.category === category && c.code === code)?.value ?? code
  }

  return { label }
}
