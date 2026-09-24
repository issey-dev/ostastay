import type { Metadata } from "next"
import { Callout, DocTitle, H2, Pager, Shot, Table, Where } from "../../../components"

export const metadata: Metadata = { title: "7. Reservations & numbering" }

export default function Reservations() {
  return (
    <>
      <DocTitle
        title="Step 7 — Reservations & numbering"
        lead="How booking numbers look, where document numbering starts, and the lists the desk picks from on a reservation."
      />

      <H2>Booking Number Format</H2>
      <Where path="Hub › Controls › Reservations" who="Property Setup" />
      <Shot name="prop-reservations" alt="The Booking Number Format card with a prefix, number of digits and a preview." />
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Prefix", "Up to 12 letters, numbers, - _ or /, uppercased. Leave empty to use the property code and a dash (CBR-)."],
          ["Number of digits", "3–12, default 6. The running number is padded with zeros to this length."],
        ]}
      />
      <p>
        With prefix <code>CB</code> and 6 digits, bookings are numbered <code>CB000001</code>, <code>CB000002</code>… Choose{" "}
        <strong>Save format</strong>. Existing bookings keep their numbers. Every booking uses this format, whether made at the desk,
        from a group, through the channel manager or on your website.
      </p>

      <H2>Reservation &amp; Housekeeping Lists</H2>
      <p>The drop-downs on a reservation and on housekeeping tasks. They start empty:</p>
      <Table
        head={["Tab", "Examples"]}
        rows={[
          ["Special Requests", "Early check-in, Late check-out, Baby cot, Honeymoon set-up."],
          ["Transport Type (Pickup / Dropoff)", "Speedboat, Seaplane, Domestic flight, Car."],
          ["Housekeeping Requests", "Turndown service, Extra towels, Extra bed."],
        ]}
      />
      <p>
        Add each with a <strong>Code (Internal)</strong> and a <strong>Display Value</strong>. The arrows set the order in the
        drop-down. The code can&apos;t be changed and a deleted code can&apos;t be added again, so choose codes carefully. Use{" "}
        <strong>Copy from…</strong> to take another property&apos;s lists.
      </p>
      <Callout title="Where are cancellation and deposit policies?">
        <p>
          Deposit, cancellation and no-show fees are on <a href="/docs/configuration/property/finance">Finance › Deposit &amp; Fee Rules</a>.
          When a no-show is marked is on <a href="/docs/configuration/property/night-audit">Night Audit</a>. eRegistration is on{" "}
          <a href="/docs/configuration/property/stationery">Stationery › Reg. Card</a>. Travel agents and companies, and their
          negotiated rates, are profiles, created by the front office rather than in the Hub.
        </p>
      </Callout>

      <H2>Sequences</H2>
      <Where path="Hub › Controls › Sequences" who="Property Setup" />
      <p>The running numbers behind your documents. Each shows the <strong>last number issued</strong>; the next document gets the one after.</p>
      <Shot name="prop-sequences" alt="The Sequence Manager: reservation, proforma folio, tax invoice, receipt and guest registration numbers." />
      <Table
        head={["Sequence", "Numbers"]}
        rows={[
          ["Reservation No (confirmation)", "Booking numbers, in the format above."],
          ["Proforma Folio", "Proforma invoices."],
          ["Tax Invoice", "Final tax invoices."],
          ["Receipt No", "Payment receipts."],
          ["Guest Registration No (Green Tax)", "The Green Tax register number. It restarts at 1 every year."],
        ]}
      />
      <p>
        A new property shows 0 everywhere, so numbering starts at 1. <strong>Only change these before go-live</strong>, and only to
        carry on from your previous system, for example so your first invoice is 10501 after 10500. Choose{" "}
        <strong>Start from new sequence</strong>, enter the last number your old system used, and <strong>Save</strong>.
      </p>
      <Callout title="Never lower a sequence after go-live" tone="warn">
        <p>
          Numbers are not checked for duplicates. Setting a counter back would issue invoice and receipt numbers that already exist,
          and break the Green Tax register. Tax invoice numbers must be continuous for your auditors.
        </p>
      </Callout>
      <Pager href="/docs/configuration/property/reservations" />
    </>
  )
}
