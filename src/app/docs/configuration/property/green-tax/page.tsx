import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Where } from "../../../components"

export const metadata: Metadata = { title: "Green Tax register" }

export default function GreenTax() {
  return (
    <>
      <DocTitle
        title="Green Tax register"
        lead="For Maldives properties: the numbered register of guests liable for Green Tax, checked and marked as filed each month."
      />
      <Where path="Hub › Controls › Green Tax" who="Green Tax Registrations (update to correct or file)" />
      <p>
        There is nothing to set up. The rates are on <a href="/docs/configuration/property/finance">Finance › Tax</a>, and posting is
        switched on <a href="/docs/configuration/property/night-audit">Night Audit</a>. Read this before your first month-end, and
        give the permission to whoever files with MIRA.
      </p>

      <H2>How numbers are given</H2>
      <p>
        Night audit gives each guest who stays 12 hours or more in a real room the next <strong>Reg No</strong>. Numbering restarts
        at 1 every year. The 12-hour rule uses either actual check-in times or your standard times, as chosen on Finance › Tax.
      </p>
      <Shot name="prop-green-tax" alt="The Green Tax register: year selector, needs-correction list, monthly filing and correction history." />

      <H2>Each month</H2>
      <ol className="docs-steps">
        <li>
          <strong>Needs correction</strong> lists numbers to fix, for example a guest numbered who shouldn&apos;t have been.{" "}
          <strong>Remove</strong> or <strong>Close gap</strong> with a reason; later numbers move down by one, so the register stays
          without gaps.
        </li>
        <li>
          When the month is complete (the business date has passed it) and nothing needs correcting, file it with MIRA, then choose{" "}
          <strong>Mark as filed</strong>, with an optional note. Months are filed in order.
        </li>
      </ol>
      <Callout title="Filing is final" tone="warn">
        <p>Once a month is marked as filed, its numbers are frozen and it can&apos;t be un-filed. Check it before you mark it.</p>
      </Callout>
      <Pager href="/docs/configuration/property/green-tax" />
    </>
  )
}
