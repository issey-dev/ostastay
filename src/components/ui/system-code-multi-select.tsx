"use client"

import { useEffect, useState, useRef } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

type SystemCode = {
  id: string
  code: string
  value: string
  sortOrder: number
}

// Same fetch/cache convention as SystemCodeSelect (src/components/ui/system-code-select.tsx)
// but renders a chip-style multi-select instead of a single dropdown — used for
// Dietary Requirements and Preferences, which the app owner asked to become genuine
// multi-selects instead of one SystemCodeSelect mapped to a single value.
const cache: Record<string, { data: SystemCode[]; ts: number }> = {}
const CACHE_TTL = 60_000

interface SystemCodeMultiSelectProps {
  category: string
  values: string[]
  onChange: (values: string[]) => void
  disabled?: boolean
}

export function SystemCodeMultiSelect({ category, values, onChange, disabled }: SystemCodeMultiSelectProps) {
  const [options, setOptions] = useState<SystemCode[]>([])
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    const cached = cache[category]
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
      .finally(() => setLoading(false))
  }, [category])

  const toggle = (code: string) => {
    if (disabled) return
    onChange(values.includes(code) ? values.filter((v) => v !== code) : [...values, code])
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading options...</p>
  }
  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No options configured yet — add some in Controls.</p>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const selected = values.includes(opt.code)
        return (
          <button
            type="button"
            key={opt.code}
            disabled={disabled}
            onClick={() => toggle(opt.code)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              selected
                ? "border-primary text-primary bg-primary/5 font-medium"
                : "border-border text-muted-foreground hover:border-foreground/40"
            )}
          >
            {selected && <Check className="h-3.5 w-3.5" />}
            {opt.value}
          </button>
        )
      })}
    </div>
  )
}
