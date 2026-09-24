"use client"

import { useEffect, useMemo, useState } from "react"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { CountryFlag } from "@/components/ui/country-flag"
import { alpha2For } from "@/lib/countries"
import { buildNationalities, countryLabel, nationalityLabel, type NationalityOption, type NationalityOverride } from "@/lib/nationalities"

// The one picker for every nationality and country field — the master ISO 3166-1 list with
// flags (src/lib/countries.ts), plus the enterprise's own renames and additions
// (src/lib/nationalities.ts). Stores the code; searches the nationality, the country name
// and both ISO codes, so "MDV", "Maldives" and "Maldivian" all find the same entry.

// The enterprise's changes, fetched once per page and shared by every picker on it.
let overridesCache: { data: NationalityOverride[]; ts: number } | null = null
let inflight: Promise<NationalityOverride[]> | null = null
const CACHE_TTL = 60_000

function loadOverrides(): Promise<NationalityOverride[]> {
  if (overridesCache && Date.now() - overridesCache.ts < CACHE_TTL) return Promise.resolve(overridesCache.data)
  inflight ??= fetch("/api/settings/system-codes?category=NATIONALITY")
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: NationalityOverride[]) => {
      const data = Array.isArray(rows) ? rows : []
      overridesCache = { data, ts: Date.now() }
      return data
    })
    .catch(() => [])
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Call after the enterprise's nationality list changes, so the next picker re-reads it. */
export function invalidateNationalities() {
  overridesCache = null
}

/**
 * The effective nationality list, and label helpers for stored codes. `standardOnly` skips
 * the enterprise's changes (no request) — for pages with no signed-in user, such as the
 * guest's own eRegistration form.
 */
export function useNationalities({ standardOnly = false }: { standardOnly?: boolean } = {}) {
  const [overrides, setOverrides] = useState<NationalityOverride[]>(overridesCache?.data ?? [])
  useEffect(() => {
    if (standardOnly) return
    let cancelled = false
    void loadOverrides().then((rows) => !cancelled && setOverrides(rows))
    return () => {
      cancelled = true
    }
  }, [standardOnly])
  const list = useMemo(() => buildNationalities(standardOnly ? [] : overrides), [overrides, standardOnly])
  return {
    list,
    nationality: (code: string | null | undefined) => nationalityLabel(code, list),
    country: (code: string | null | undefined) => countryLabel(code, list),
  }
}

export function NationalitySelect({
  value,
  onValueChange,
  mode = "nationality",
  placeholder,
  disabled,
  standardOnly,
}: {
  value: string
  onValueChange: (code: string) => void
  /** "nationality" lists "Maldivian"; "country" lists "Maldives" (address, issuing country). */
  mode?: "nationality" | "country"
  placeholder?: string
  disabled?: boolean
  standardOnly?: boolean
}) {
  const { list } = useNationalities({ standardOnly })
  const options = useMemo(() => {
    const byLabel = (o: NationalityOption) => (mode === "country" ? o.country : o.nationality)
    return [...list]
      .sort((a, b) => byLabel(a).localeCompare(byLabel(b)))
      .map((o) => ({
        value: o.code,
        label: byLabel(o),
        icon: <FlagSlot code={o.code} />,
        keywords: [o.nationality, o.country, o.code, o.alpha3].filter(Boolean).join(" "),
      }))
  }, [list, mode])

  // A value saved before the master list (free text such as "British", an old country
  // name such as "Turkey", a passport's alpha-3) is converted to its code, as the list's
  // rule says it is stored; one that matches nothing is still shown rather than an empty
  // field that isn't empty.
  const known = !value || options.some((o) => o.value === value)
  const resolved = known ? undefined : alpha2For(value)
  useEffect(() => {
    if (resolved && resolved !== value && options.some((o) => o.value === resolved)) onValueChange(resolved)
  }, [resolved, value, options, onValueChange])
  const shown =
    known || resolved ? options : [...options, { value, label: `${value} (not on the list)`, icon: <FlagSlot code="" />, keywords: value }]

  return (
    <SearchableSelect
      value={value}
      onChange={(v) => onValueChange(v ?? "")}
      options={shown}
      searchable
      disabled={disabled}
      placeholder={placeholder ?? (mode === "country" ? "Select country" : "Select nationality")}
      searchPlaceholder={mode === "country" ? "Search country or code…" : "Search nationality, country or code…"}
    />
  )
}

// Keeps labels aligned: a fixed-width slot whether or not the entry has a flag (an
// enterprise-added nationality such as "Stateless" has none).
function FlagSlot({ code }: { code: string }) {
  return (
    <span className="inline-flex w-5 shrink-0 justify-center">
      <CountryFlag value={code} />
    </span>
  )
}
