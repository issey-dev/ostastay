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

      <H2>Booking number format</H2>
      <Where path="Hub › Controls › Reservations" who="Property Setup" />
      <Shot name="prop-reservations" alt="The Booking number format card with a prefix, number of digits and a preview." />
      <Table
        head={["Field", "Notes"]}
        rows={[
          ["Prefix", "Up to 12 letters, numbers, - _ or /, uppercased. Leave empty to use the property code and a dash (CBR-)."],
          ["Number of digits", "3–12, default 6. The running number is padded with zeros to this length."],
        ]}
      />
      <p>
        With prefix <code>CB</code> and 6 digits, bookings are numbered <code>CB000001</code>, <code>CB000002</code>… The preview
        shows your real next booking number. Choose{" "}
        <strong>Save format</strong>. Existing bookings keep their numbers. Every booking uses this format, whether made at the desk,
        from a group, through the channel manager or on your website.
      </p>

      <H2>Reservation &amp; housekeeping lists</H2>
      <p>The drop-downs on a reservation and on housekeeping tasks. They start empty:</p>
      <Table
        head={["Tab", "Examples"]}
        rows={[
          ["Special requests", "Early check-in, Late check-out, Baby cot, Honeymoon set-up."],
          ["Transport type (pickup / dropoff)", "Speedboat, Seaplane, Domestic flight, Car."],
          ["Housekeeping requests", "Turndown service, Extra towels, Extra bed."],
        ]}
      />
      <p>
        Add each with a <strong>Code (internal)</strong> and a <strong>Display value</strong>. The arrows set the order in the
        drop-down. The code can&apos;t be changed; a deleted entry comes back with <strong>Show deleted</strong> and{" "}
        <strong>Restore</strong>. Use <strong>Copy from…</strong> to take another property&apos;s lists.
      </p>
      <Callout title="Where are cancellation and deposit policies?">
        <p>
          Deposit, cancellation and no-show fees are on <a href="/docs/configuration/property/finance">Finance › Deposit &amp; fee rules</a>.
          When a no-show is marked is on <a href="/docs/configuration/property/night-audit">Night Audit</a>. eRegistration is on{" "}
          <a href="/docs/configuration/property/stationery">Stationery › Reg. card</a>. Travel agents and companies, and their
          negotiated rates, are profiles, created by the front office rather than in the Hub.
        </p>
      </Callout>

      <H2>Sequences</H2>
      <Where path="Hub › Controls › Sequences" who="Property Setup" />
      <p>The running numbers behind your documents. Each shows the <strong>last number issued</strong>; the next document gets the one after.</p>
      <Shot name="prop-sequences" alt="The Sequence manager: reservation, proforma folio, tax invoice, receipt and guest registration numbers." />
      <Table
        head={["Sequence", "Numbers"]}
        rows={[
          ["Reservation No (confirmation)", "Booking numbers, in the format above."],
          ["Proforma Folio", "Proforma invoices."],
          ["Tax Invoice", "Final tax invoices."],
          ["Receipt No", "Payment receipts."],
          ["Check number", "Folio postings. A charge and its Service Charge, GST and Green Tax share one number, as does each Night Audit night's room charge and packages."],
          ["Guest Registration No (Green Tax)", "The Green Tax register number. It restarts at 1 every year."],
        ]}
      />
      <p>
        A new property shows 0 everywhere, so numbering starts at 1. <strong>Only change these before go-live</strong>, and only to
        carry on from your previous system, for example so your first invoice is 10501 after 10500. Choose{" "}
        <strong>Start from new sequence</strong>, enter the last number your old system used, and <strong>Save</strong>.
      </p>
      <Callout title="Numbers already issued are protected" tone="warn">
        <p>
          A counter can&apos;t be set below the highest number already issued; each row shows it. Guest Registration No is locked
          once this year&apos;s Green Tax register has numbers: correct it in the{" "}
          <a href="/docs/configuration/property/green-tax">Green Tax register</a> instead. Tax invoice numbers must be continuous for
          your auditors, so change counters only before go-live.
        </p>
      </Callout>
      <Pager href="/docs/configuration/property/reservations" />
    </>
  )
}
