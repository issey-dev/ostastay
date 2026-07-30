"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"

// Saves on blur rather than per keystroke — an id is typed, not incrementally meaningful,
// and a request per character would be pointless traffic. Shared by the Room Type and Rate
// Plan tabs, which both edit a small external-id field this same way.
export function MappingInput({
  value,
  placeholder,
  disabled,
  onSave,
}: {
  value: string
  placeholder: string
  disabled?: boolean
  onSave: (value: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <Input
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      className="h-8 max-w-[220px] font-mono text-xs"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() === value) return
        void onSave(draft.trim())
      }}
    />
  )
}
