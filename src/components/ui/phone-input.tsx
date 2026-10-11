"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { CountryFlag } from "@/components/ui/country-flag"
import { DIAL_CODES, DIAL_OPTIONS, joinPhone, splitPhone } from "@/lib/dial-codes"
import { INPUT_PHONE } from "@/lib/input-presets"

// The one phone field: a searchable country-code dropdown plus a number-only box. The value
// stays a single string in the same column as before ("+960 7771234"), so nothing is
// migrated; an older value with no "+code" is shown whole in the number box until edited.
const OPTIONS = DIAL_OPTIONS.map((o) => ({
  value: o.alpha2,
  label: `${o.name}  +${o.dial}`,
  triggerLabel: `+${o.dial}`,
  icon: <span className="inline-flex w-5 shrink-0 justify-center"><CountryFlag value={o.alpha2} /></span>,
  keywords: `${o.dial} +${o.dial} ${o.alpha2} ${o.name}`,
}))

export function PhoneInput({
  value,
  onChange,
  onBlur,
  defaultCountry = "MV",
  placeholder = "Phone number",
  disabled,
  id,
  className,
  name,
}: {
  value: string | null | undefined
  onChange: (value: string) => void
  onBlur?: () => void
  /** Country code shown when the value has none yet (alpha-2). */
  defaultCountry?: string
  placeholder?: string
  disabled?: boolean
  id?: string
  className?: string
  name?: string
}) {
  const parsed = splitPhone(value)
  // The chosen country is kept here too: with an empty number there is no "+code" in the
  // value to read it back from, and countries sharing a code (US/Canada) can't be told apart.
  const [picked, setPicked] = React.useState(parsed.alpha2 ?? defaultCountry)
  const country = parsed.alpha2 && DIAL_CODES[picked] !== DIAL_CODES[parsed.alpha2] ? parsed.alpha2 : picked

  return (
    <div className={cn("flex gap-2", className)}>
      <div className="w-[7.5rem] shrink-0">
        <SearchableSelect
          options={OPTIONS}
          value={country}
          onChange={(c) => {
            setPicked(c)
            onChange(joinPhone(c, parsed.number))
          }}
          searchable
          disabled={disabled}
          placeholder="Country code"
          searchPlaceholder="Search country or code…"
          className="px-2.5"
        />
      </div>
      <Input
        {...INPUT_PHONE}
        id={id}
        name={name}
        disabled={disabled}
        placeholder={placeholder}
        value={parsed.number}
        onChange={(e) => {
          const v = e.target.value
          // A pasted full international number ("+44 7700…") carries its own code.
          onChange(v.trimStart().startsWith("+") ? v.trim() : joinPhone(country, v))
        }}
        onBlur={onBlur}
        // Digits, spaces and the usual separators only; the "+code" lives in the dropdown.
        pattern="[0-9 ()\-.]*"
      />
    </div>
  )
}
