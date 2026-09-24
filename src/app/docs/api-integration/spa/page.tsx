import type { Metadata } from "next"
import { Callout, CodeBlock, DocTitle, Endpoint, H2, H3, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Spa" }

export default function Spa() {
  return (
    <>
      <DocTitle
        title="Spa"
        lead="Sell the property's spa treatments with live free times — for one guest or a couple — and book them instantly. Needs the SPA scope."
      />

      <H2>The flow</H2>
      <ol className="docs-steps">
        <li><strong>Treatments</strong> — what is sold online, by category, with duration and price.</li>
        <li><strong>Free times</strong> — for a treatment and party size: which days have any time free, and the start times on a day.</li>
        <li><strong>Quote</strong> — the total, taxes included.</li>
        <li><strong>Hold</strong> (optional, recommended if you take payment first) — keeps a therapist per guest and a room.</li>
        <li><strong>Book</strong> — instant: confirmed if the time is still free, refused otherwise.</li>
      </ol>
      <Callout title="Therapists and rooms are assigned for you">
        <p>
          The property&apos;s own scheduling engine picks a qualified, free therapist for each guest and a suitable free room, exactly
          as it does at the spa desk. Therapists and rooms are never named in the API. Where the property allows it, a guest may ask
          for a female or male therapist.
        </p>
      </Callout>

      <H2>Treatments</H2>
      <Endpoint method="GET" path="/properties/{propertyId}/spa/treatments" />
      <CodeBlock
        lang="json"
        code={`
{
  "propertyId": "8f1c…", "currency": "USD", "pricesIncludeTaxes": true,
  "booking": {
    "enabled": true, "code": null, "reason": null,
    "holdMinutes": 10, "leadHours": 2,
    "genderPreferenceOffered": true,
    "freeCancellationHours": 4,
    "paidOnlineAccepted": true,
    "policies": "Please arrive 15 minutes early…"
  },
  "categories": [
    {
      "name": "Massage",
      "treatments": [
        {
          "id": "t19a…", "name": "Aromatherapy Massage",
          "description": "A slow, relaxing full-body massage…",
          "inclusions": "Herbal tea", "imageUrls": ["https://cdn.example.com/aroma.jpg"],
          "durationMinutes": 60, "maxGuests": 1, "pricingMode": "PER_PERSON", "price": 130
        }
      ]
    },
    {
      "name": "Couples",
      "treatments": [
        { "id": "t77c…", "name": "Couples Sunset Ritual", "durationMinutes": 90, "maxGuests": 2, "pricingMode": "FLAT", "price": 340, "…": "…" }
      ]
    }
  ]
}
`}
      />
      <ul>
        <li><code>pricingMode</code>: <code>PER_PERSON</code> — <code>price</code> is per guest; <code>FLAT</code> — one price for the whole party.</li>
        <li><code>maxGuests</code> — how many guests one booking of this treatment can carry (2 for a couples treatment).</li>
        <li><code>freeCancellationHours</code> — guests may cancel online until this long before the start.</li>
      </ul>

      <H2>Free times</H2>
      <H3>Start times on a day</H3>
      <Endpoint method="GET" path="/properties/{propertyId}/spa/availability?treatmentId=t19a…&date=2026-10-03&partySize=1[&gender=FEMALE]" />
      <CodeBlock
        lang="json"
        code={`
{
  "treatmentId": "t19a…", "date": "2026-10-03", "partySize": 1, "durationMinutes": 60,
  "slots": [
    { "startTime": "09:00", "endTime": "10:00", "available": false },
    { "startTime": "09:30", "endTime": "10:30", "available": true },
    { "startTime": "10:00", "endTime": "11:00", "available": true }
  ]
}
`}
      />
      <H3>Which days have any time</H3>
      <Endpoint method="GET" path="/properties/{propertyId}/spa/availability?treatmentId=t19a…&from=2026-10-01&to=2026-10-31&partySize=2" />
      <CodeBlock lang="json" code={`{ "treatmentId": "t19a…", "partySize": 2, "days": [{ "date": "2026-10-01", "available": true }, { "date": "2026-10-02", "available": false }] }`} />
      <ul>
        <li>At most 31 days per range call. Use the range to grey out full days in a date picker, then the day call for times.</li>
        <li>
          Start the picker at today in the property&apos;s time zone, not at <code>businessDate</code> — free times run on the clock, and{" "}
          <code>businessDate</code> can lag until the desk closes the day. See{" "}
          <a href="/docs/api-integration/authentication#conventions">Conventions</a>.
        </li>
        <li>A slot is available when there is a free therapist for <strong>every</strong> guest and a free room for the party, and it is not inside the property&apos;s &quot;book at least … hours ahead&quot; window.</li>
        <li><code>gender</code> (<code>MALE</code> or <code>FEMALE</code>) filters to therapists of that gender for every guest. Only when <code>genderPreferenceOffered</code> is true; otherwise it is refused.</li>
        <li>Holds by other websites are taken into account — a held time shows as not available.</li>
      </ul>

      <H2>Quote</H2>
      <Endpoint method="POST" path="/properties/{propertyId}/spa/quote" />
      <CodeBlock lang="json" code={`{ "treatmentId": "t19a…", "date": "2026-10-03", "partySize": 1 }`} />
      <CodeBlock
        lang="json"
        code={`
{
  "quote": {
    "treatmentId": "t19a…", "date": "2026-10-03", "partySize": 1,
    "currency": "USD", "pricesIncludeTaxes": true,
    "totals": { "base": 111.36, "serviceCharge": 11.14, "taxes": 7.5, "levies": 0, "grandTotal": 130 },
    "lines": [{ "description": "Aromatherapy Massage", "amount": 130 }]
  }
}
`}
      />

      <H2>Hold</H2>
      <Endpoint method="POST" path="/properties/{propertyId}/spa/holds" note="server-only key" />
      <CodeBlock lang="json" code={`{ "treatmentId": "t19a…", "date": "2026-10-03", "startTime": "09:30", "partySize": 1, "gender": "FEMALE" }`} />
      <CodeBlock
        lang="json"
        code={`
{
  "hold": {
    "holdId": "h3d1…", "expiresAt": "2026-10-01T09:12:00.000Z", "startTime": "09:30",
    "quote": { "…": "same as the quote endpoint" }
  }
}
`}
      />
      <p>
        A therapist per guest and a room are reserved until <code>expiresAt</code>; the spa desk sees the time as &quot;held online&quot;.
        Then book with the <code>holdId</code>. An unused hold expires on its own. Refusals: <code>SLOT_UNAVAILABLE</code>,{" "}
        <code>BOOKING_CUTOFF</code>, <code>PARTY_TOO_LARGE</code>, <code>TOO_MANY_HOLDS</code>.
      </p>

      <H2>Book</H2>
      <Endpoint method="POST" path="/properties/{propertyId}/spa/bookings" note="server-only key · Idempotency-Key required" />
      <H3>From a hold</H3>
      <CodeBlock
        lang="json"
        code={`
{
  "holdId": "h3d1…",
  "guest": { "firstName": "Grace", "lastName": "Hopper", "email": "grace@example.com" },
  "payment": { "status": "PAID", "provider": "YourProvider", "reference": "pay_456", "amount": 130 },
  "expectedTotal": 130
}
`}
      />
      <H3>Directly, for a couple</H3>
      <CodeBlock
        lang="json"
        code={`
{
  "treatmentId": "t77c…", "date": "2026-10-03", "startTime": "16:00", "partySize": 2,
  "guest": { "firstName": "Grace", "lastName": "Hopper", "email": "grace@example.com" },
  "companions": ["Alan Turing"],
  "payment": { "status": "UNPAID" }
}
`}
      />
      <Table
        head={["Field", "Notes"]}
        rows={[
          [<code key="1">guest</code>, "The booking guest (the first participant). firstName and email are required."],
          [<code key="2">companions</code>, "Names of the other guests, in order. Optional — unnamed guests appear as Guest 2, Guest 3."],
          [<code key="3">gender</code>, "Optional therapist gender for every guest, where offered. Ignored when booking from a hold (the hold already has its therapists)."],
          [<code key="4">payment</code>, <span key="4b">Same as excursions: <code>PAID</code> settles the bill with the property&apos;s online payment method; <code>UNPAID</code> is paid at the spa.</span>],
          [<code key="5">expectedTotal</code>, <span key="5b">Checked against what is actually charged. A mismatch refuses the booking with <code>PRICE_CHANGED</code> and nothing is created.</span>],
        ]}
      />
      <p>Response <code>201</code> (or <code>200</code> with <code>replayed: true</code>):</p>
      <CodeBlock
        lang="json"
        code={`
{
  "booking": {
    "reference": "SPA-M2P8RD4K", "module": "SPA", "status": "CONFIRMED", "replayed": false,
    "property": { "id": "8f1c…", "name": "Coral Bay Resort" },
    "guest": { "firstName": "Grace", "lastName": "Hopper", "email": "grace@example.com" },
    "payment": { "status": "UNPAID", "reference": null },
    "total": { "grandTotal": 340, "currency": "USD" },
    "treatment": { "id": "t77c…", "name": "Couples Sunset Ritual" },
    "date": "2026-10-03", "startTime": "16:00", "endTime": "17:30",
    "partySize": 2, "guests": ["Grace Hopper", "Alan Turing"],
    "cancellation": { "allowed": true, "freeUntil": "2026-10-03T08:00:00.000Z", "cancelledAt": null, "refundRequired": false }
  }
}
`}
      />
      <H3>Refusals</H3>
      <Table
        head={["Code", "What to do"]}
        rows={[
          [<code key="a">SLOT_UNAVAILABLE</code>, "The time was taken meanwhile. Show the day's free times again."],
          [<code key="b">HOLD_EXPIRED</code>, "The hold ran out. Check free times and hold/book afresh."],
          [<code key="c">HOLD_USED</code>, "Already booked — look it up rather than booking twice."],
          [<code key="d">PRICE_CHANGED</code>, "Re-quote and confirm the new total with the guest."],
          [<code key="e">BOOKING_CUTOFF</code>, "Too close to the start to book online."],
          [<code key="f">PARTY_TOO_LARGE</code>, "More guests than the treatment allows."],
          [<code key="g">PAYMENT_NOT_CONFIGURED</code>, "Send UNPAID, or ask the property to set up paid online bookings."],
        ]}
      />
      <Pager href="/docs/api-integration/spa" />
    </>
  )
}
