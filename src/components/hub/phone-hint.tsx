import type { ReactNode } from "react"
import { InfoHint } from "@/components/ui/info-hint"

// Phones only (`sm:hidden`): the ⓘ that stands in for a setting's long explanation, which
// is hidden below `sm` (`max-sm:hidden` on the paragraph) so the switch isn't squeezed by
// four lines of text. Padded to a 44px-tall tap target; the negative margin keeps the row
// height unchanged. Desktop never renders it, so desktop keeps the explanation inline.
export function PhoneHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <InfoHint label={label} className="-my-3.5 px-2 py-3.5 sm:hidden">
      {children}
    </InfoHint>
  )
}
