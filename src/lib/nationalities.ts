import { COUNTRIES, findCountry } from "@/lib/countries"

// Nationalities as the app offers them: the master ISO 3166-1 list (src/lib/countries.ts),
// the same for every enterprise and property with nothing to configure, plus the
// enterprise's own changes — kept as its NATIONALITY SystemCode rows (Hub > Enterprise >
// Guest Lists > Nationalities):
//   - a row whose code IS a master code renames that entry for the enterprise
//     (e.g. MV → "Maldivian (Local)");
//   - a row with any other code is an enterprise-defined nationality (e.g. XXA → "Stateless").
// An inactive row is ignored — a renamed entry goes back to its standard name, an added one
// disappears. Every nationality / country field stores the code. No server imports — the
// pickers use this too.

export type NationalityOption = {
  code: string
  /** "Maldivian" — the standard nationality, or the enterprise's name for it. */
  nationality: string
  /** "Maldives" — for a country field (address, issuing country). An added entry uses its name. */
  country: string
  alpha3: string | null
  /** A master (ISO) entry, as opposed to one the enterprise added. */
  standard: boolean
  /** The enterprise renamed this standard entry. */
  renamed: boolean
}

export type NationalityOverride = { code: string; value: string; isActive?: boolean }

export function buildNationalities(overrides: NationalityOverride[] = []): NationalityOption[] {
  const active = new Map(overrides.filter((o) => o.isActive !== false).map((o) => [o.code.trim().toUpperCase(), o.value.trim()]))
  const standard: NationalityOption[] = COUNTRIES.map((c) => {
    const rename = active.get(c.alpha2)
    return {
      code: c.alpha2,
      nationality: rename || c.nationality,
      country: c.name,
      alpha3: c.alpha3,
      standard: true,
      renamed: !!rename && rename !== c.nationality,
    }
  })
  const masterCodes = new Set(COUNTRIES.map((c) => c.alpha2))
  const added: NationalityOption[] = [...active.entries()]
    .filter(([code]) => !masterCodes.has(code))
    .map(([code, value]) => ({ code, nationality: value, country: value, alpha3: null, standard: false, renamed: false }))
  return [...standard, ...added].sort((a, b) => a.nationality.localeCompare(b.nationality))
}

/** Display name for a stored nationality code — the enterprise's name, the standard one, or the raw value. */
export function nationalityLabel(value: string | null | undefined, list: NationalityOption[]): string | null {
  if (!value) return null
  const v = value.trim().toUpperCase()
  return list.find((o) => o.code === v)?.nationality ?? findCountry(value)?.nationality ?? value
}

/** Display name for a stored country code — the country's name (an added entry: its own name). */
export function countryLabel(value: string | null | undefined, list: NationalityOption[]): string | null {
  if (!value) return null
  const v = value.trim().toUpperCase()
  return list.find((o) => o.code === v)?.country ?? findCountry(value)?.name ?? value
}
