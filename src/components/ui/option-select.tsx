"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect, SEARCHABLE_THRESHOLD, type SearchableSelectOption } from "@/components/ui/searchable-select"

// ─── OptionSelect: the app's one-line dropdown ───────────────────────────────
// Takes a flat `options` list (the same shape as SearchableSelect) and picks the right
// control for its length:
//   · short list  → a plain dropdown (the styled `Select`, no search box)
//   · long list   → SearchableSelect (type-to-filter)
// `searchable` forces either one. Use this instead of a native <select>, which renders
// as the browser's own unstyled control and ignores the app theme.

export { SEARCHABLE_THRESHOLD }

// base-ui's Select treats "" as "nothing selected", so an option whose value is "" (an
// "All …" filter, a "Select…" prompt) is carried under a sentinel instead.
const EMPTY = "__option_select_empty__"
const encode = (v: string) => (v === "" ? EMPTY : v)
const decode = (v: string) => (v === EMPTY ? "" : v)

export interface OptionSelectProps {
  options: SearchableSelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** true = always searchable, false = never; default switches at SEARCHABLE_THRESHOLD. */
  searchable?: boolean
  size?: "sm" | "default"
  className?: string
  disabled?: boolean
  id?: string
  "aria-label"?: string
}

export function OptionSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchable,
  size = "default",
  className,
  disabled,
  id,
  "aria-label": ariaLabel,
}: OptionSelectProps) {
  const useSearch = searchable ?? options.length > SEARCHABLE_THRESHOLD

  if (useSearch) {
    return (
      <SearchableSelect
        options={options}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        searchable
        className={cn(size === "sm" && "h-7 text-xs", className)}
      />
    )
  }

  const selected = options.find((o) => o.value === value)
  return (
    <Select
      value={encode(value)}
      onValueChange={(v) => onChange(decode(String(v ?? "")))}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} size={size} className={cn("w-full", className)}>
        <SelectValue>
          {selected ? selected.label : <span className="text-muted-foreground">{placeholder}</span>}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={encode(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
