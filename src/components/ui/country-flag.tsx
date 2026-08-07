import type { SVGProps } from "react"
import * as Flags from "country-flag-icons/react/3x2"
import { alpha2For, countryNameFor } from "@/lib/countries"

type FlagComponent = (props: SVGProps<SVGSVGElement>) => ReturnType<typeof Flags.US>
const FLAGS = Flags as unknown as Record<string, FlagComponent>

// A flag for any of the ways a "country" value shows up in this app — an alpha-2
// SystemCode (NATIONALITY category), an alpha-3 code (OCR'd from a passport MRZ), or a
// resolved country name. Renders nothing (not a placeholder box) when the value doesn't
// resolve to a recognized country, e.g. a guest-typed demonym like "British".
export function CountryFlag({ value, className }: { value: string | null | undefined; className?: string }) {
  const code = alpha2For(value)
  const Flag = code ? FLAGS[code] : undefined
  if (!Flag) return null
  return (
    <span title={countryNameFor(value) ?? undefined} className="inline-flex shrink-0">
      <Flag className={className ?? "h-3.5 w-5 rounded-[2px] object-cover"} />
    </span>
  )
}

// Flag + display name together — `name` overrides the label (e.g. an already-resolved
// SystemCode value) when the raw stored value is just a code with no label of its own.
export function CountryLabel({
  value,
  name,
  className,
}: {
  value: string | null | undefined
  name?: string | null
  className?: string
}) {
  const label = name ?? countryNameFor(value)
  if (!label) return null
  return (
    <span className={className ?? "inline-flex items-center gap-1.5"}>
      <CountryFlag value={value} />
      {label}
    </span>
  )
}
