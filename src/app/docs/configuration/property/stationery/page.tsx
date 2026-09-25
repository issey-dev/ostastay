import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "9. Stationery" }

export default function Stationery() {
  return (
    <>
      <DocTitle
        title="Step 9 — Stationery"
        lead="The wording on everything you print or email: invoices, receipts, confirmation letters, the registration card and statements. Plus eRegistration."
      />
      <Where path="Hub › Controls › Stationery" who="Property Setup" />
      <p>
        The logo, name, address, tax ID, contact details, colour and font come from{" "}
        <a href="/docs/configuration/property/general">General</a>. This page adds the wording. Each tab shows a live preview as you
        type. Choose <strong>Save</strong> at the bottom when done; <strong>Reset</strong> discards unsaved changes.
      </p>
      <Shot name="prop-stationery" alt="The Stationery page: tabs for invoices, receipts, letter, registration card and statement, with the invoice settings and a live preview." />

      <H2>Invoices</H2>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Header text", "A line at the top of the invoice, e.g. 'Thank you for staying with us.'"],
          ["Default folio style", "How lines are shown: Detailed, Detailed with taxes merged, Summary by charge code, Summary by date, or Summary by check. Staff can pick another when printing."],
          ["Payment information", "Account name, Account number, IBAN, Bank info. Printed so companies know where to pay. Until one is filled in, the Hub Overview warns."],
          ["Terms & conditions / footer text", "Payment terms and a closing line."],
        ]}
      />
      <p>Use the <strong>Proforma / Tax</strong> switch on the preview to see both invoice types.</p>

      <H2>Receipts, Letter, Statement</H2>
      <ul>
        <li><strong>Receipts</strong>: footer and terms, shared by payment and currency-exchange receipts.</li>
        <li><strong>Letter</strong>: the policy text on reservation confirmation letters: check-in and check-out times, cancellation terms, what to bring.</li>
        <li><strong>Statement</strong>: footer and terms on company and debtor statements.</li>
      </ul>

      <H2>Registration card and eRegistration</H2>
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Registration card step", "On: check-in includes the registration card. Off: it is skipped."],
          ["Welcome / intro message", "Shown at the top of the card."],
          ["Terms & conditions", "What the guest signs to."],
          ["Allow eRegistration links", "On: staff can send guests a link to fill in their registration before arrival. The desk still checks it at check-in."],
          ["Link validity (hours)", "1–720, default 72."],
          ["Guest email message", "The text of the email that carries the link."],
        ]}
      />
      <Callout>
        <p>
          Sending eRegistration links and confirmation letters by email needs the enterprise&apos;s{" "}
          <a href="/docs/configuration/enterprise/email">outgoing email</a> to be set up.
        </p>
      </Callout>
      <p>
        Setting up another property? <strong>Copy from…</strong> at the top copies all this wording from a property you have
        already configured.
      </p>
      <Pager href="/docs/configuration/property/stationery" />
    </>
  )
}
