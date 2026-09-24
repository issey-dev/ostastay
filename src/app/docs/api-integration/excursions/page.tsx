import type { Metadata } from "next"
import { Callout, CodeBlock, DocTitle, Endpoint, H2, H3, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Excursions" }

export default function Excursions() {
  return (
    <>
      <DocTitle
        title="Excursions"
        lead="Sell the property's excursions — boat trips, snorkelling, island hopping — with live seats, and book them instantly. Needs the EXCURSIONS scope."
      />

      <H2>The flow</H2>
      <ol className="docs-steps">
        <li><strong>Catalogue</strong> — what is sold online, today&apos;s prices, the rules (hold time, how far ahead booking closes, largest party).</li>
        <li><strong>Departures</strong> — the scheduled trips in a date range, with seats left.</li>
        <li><strong>Quote</strong> — the total for the party, taxes included.</li>
        <li><strong>Hold</strong> (optional, recommended if you take payment first) — keeps the seats for a few minutes.</li>
        <li><strong>Book</strong> — instant: confirmed if the seats are there, refused otherwise.</li>
      </ol>

      <H2>Catalogue</H2>
      <Endpoint method="GET" path="/properties/{propertyId}/excursions" />
      <CodeBlock
        lang="json"
        code={`
{
  "propertyId": "8f1c…", "currency": "USD", "pricesIncludeTaxes": true,
  "booking": {
    "enabled": true, "code": null, "reason": null,
    "holdMinutes": 10, "leadHours": 2, "maxPartySize": 10,
    "paidOnlineAccepted": true,
    "policies": "Free cancellation up to 24 hours before departure. Bring a towel and sun cream."
  },
  "excursions": [
    {
      "id": "e71b…", "code": "DOLPH", "name": "Sunset Dolphin Cruise",
      "description": "Two hours along the reef at sunset…",
      "inclusions": "Soft drinks\\nLife jackets",
      "imageUrls": ["https://cdn.example.com/dolphins.jpg"],
      "pricingMode": "PER_PERSON",
      "prices": { "adult": 85, "child": 45, "infant": 0 },
      "freeCancellationHours": 12
    },
    {
      "id": "a90c…", "code": "CHART", "name": "Private Fishing Charter",
      "pricingMode": "FLAT", "prices": { "flat": 650 }, "freeCancellationHours": 48, "…": "…"
    }
  ]
}
`}
      />
      <ul>
        <li>Only excursions the property has published appear. The list can change at any time — read it, don&apos;t hard-code ids.</li>
        <li><code>pricingMode</code>: <code>PER_PERSON</code> prices each adult, child and infant; <code>FLAT</code> is one price for the whole party (a private charter).</li>
        <li><code>prices</code> are today&apos;s rate card before tax handling. A departure on a date with a different rate shows its own; the quote is the figure to charge.</li>
        <li><code>booking.enabled: false</code> means the property isn&apos;t taking online bookings right now (<code>reason</code> says why). You may still show the catalogue.</li>
        <li><code>paidOnlineAccepted: false</code> means the property can&apos;t yet receive bookings you&apos;ve taken payment for — send them as <code>UNPAID</code>.</li>
      </ul>

      <H2>Departures</H2>
      <Endpoint method="GET" path="/properties/{propertyId}/excursions/departures?from=2026-10-01&to=2026-10-14[&excursionId=…]" />
      <p>Scheduled departures in <code>[from, to]</code>, both inclusive, at most 62 days per call. Departures that have left, are cancelled, or belong to unpublished excursions are left out.</p>
      <CodeBlock
        lang="json"
        code={`
{
  "propertyId": "8f1c…", "from": "2026-10-01", "to": "2026-10-14", "currency": "USD", "bookingEnabled": true,
  "departures": [
    {
      "id": "d4f2…", "excursionId": "e71b…", "date": "2026-10-03", "time": "17:00",
      "meetingTime": "16:45", "meetingPoint": "Sunset Jetty",
      "capacity": 20, "seatsLeft": 7, "minGuests": 6, "guaranteed": true,
      "bookingClosesAt": "2026-10-03T13:00:00.000Z",
      "prices": { "adult": 85, "child": 45, "infant": 0 },
      "bookable": true
    }
  ]
}
`}
      />
      <ul>
        <li><code>seatsLeft</code> is live: confirmed bookings and other websites&apos; holds are already taken off. Infants take a seat too.</li>
        <li><code>guaranteed: false</code> — the departure has fewer guests than its minimum and the property may still call it off. Say so on your page.</li>
        <li><code>bookingClosesAt</code> — online booking closes this long before departure (the property&apos;s &quot;book at least … hours ahead&quot;).</li>
        <li><code>bookable</code> — seats left, still open, priced, and the property is taking online bookings.</li>
        <li>
          Departures run on the clock: ask from today in the property&apos;s time zone, not from <code>businessDate</code>, which can lag
          until the desk closes the day. See <a href="/docs/api-integration/authentication#conventions">Conventions</a>.
        </li>
      </ul>

      <H2>Quote</H2>
      <Endpoint method="POST" path="/properties/{propertyId}/excursions/quote" />
      <CodeBlock lang="json" code={`{ "departureId": "d4f2…", "adults": 2, "children": 1, "infants": 0 }`} />
      <CodeBlock
        lang="json"
        code={`
{
  "quote": {
    "departureId": "d4f2…", "excursionId": "e71b…",
    "adults": 2, "children": 1, "infants": 0,
    "currency": "USD", "pricesIncludeTaxes": true,
    "totals": { "base": 184.13, "serviceCharge": 18.41, "taxes": 12.46, "levies": 0, "grandTotal": 215 },
    "lines": [
      { "description": "Sunset Dolphin Cruise — 2 adults, 1 child (2026-10-03 17:00)", "amount": 215 }
    ],
    "available": true, "seatsLeft": 7
  }
}
`}
      />
      <p>
        The quote is computed by the same code that posts the charge to the guest&apos;s bill, so the booking posts exactly{" "}
        <code>totals.grandTotal</code>. It writes nothing. <code>available: false</code> means it can&apos;t be booked right now
        (not enough seats, closed, or cut off) — show the price if you like, but disable the button.
      </p>

      <H2>Hold</H2>
      <Endpoint method="POST" path="/properties/{propertyId}/excursions/holds" note="server-only key" />
      <CodeBlock lang="json" code={`{ "departureId": "d4f2…", "adults": 2, "children": 1 }`} />
      <CodeBlock
        lang="json"
        code={`
{
  "hold": {
    "holdId": "0b7e…",
    "expiresAt": "2026-10-01T09:12:00.000Z",
    "quote": { "…": "same as the quote endpoint" }
  }
}
`}
      />
      <p>
        The seats are yours until <code>expiresAt</code> (the property&apos;s hold time, typically 10 minutes) — nobody else, desk or
        website, can take them. Take payment, then book with the <code>holdId</code>. An unused hold simply expires; there is nothing
        to release. Refusals: <code>SOLD_OUT</code>, <code>DEPARTURE_CLOSED</code>, <code>BOOKING_CUTOFF</code>, <code>PARTY_TOO_LARGE</code>,{" "}
        <code>TOO_MANY_HOLDS</code>.
      </p>

      <H2>Book</H2>
      <Endpoint method="POST" path="/properties/{propertyId}/excursions/bookings" note="server-only key · Idempotency-Key required" />
      <H3>From a hold</H3>
      <CodeBlock
        lang="json"
        code={`
{
  "holdId": "0b7e…",
  "guest": { "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com", "phone": "+000 000 0000" },
  "payment": { "status": "PAID", "provider": "YourProvider", "reference": "pay_123", "amount": 215, "currency": "USD" },
  "expectedTotal": 215,
  "remarks": "One guest is a nervous swimmer"
}
`}
      />
      <H3>Directly</H3>
      <CodeBlock
        lang="json"
        code={`
{
  "departureId": "d4f2…", "adults": 2, "children": 1, "infants": 0,
  "guest": { "firstName": "Ada", "email": "ada@example.com" },
  "payment": { "status": "UNPAID" }
}
`}
      />
      <Table
        head={["Field", "Notes"]}
        rows={[
          [<code key="1">guest</code>, "firstName and email are required. The email is how the guest finds the booking again."],
          [<code key="2">payment.status</code>, <span key="2b"><code>PAID</code> — you took payment; the booking is settled on the bill with the property&apos;s online payment method. <code>UNPAID</code> — the guest pays at the property.</span>],
          [<code key="3">payment.reference</code>, "Your payment reference. Shown to the desk; use it for refunds."],
          [<code key="4">payment.amount</code>, "What you charged. If it differs from the total the booking still goes through and the desk is told to check."],
          [<code key="5">expectedTotal</code>, <span key="5b">The <code>grandTotal</code> you showed. If the price moved since, the booking is refused with <code>PRICE_CHANGED</code> and nothing is created.</span>],
          [<code key="6">remarks</code>, "Anything the guest wants the property to know. Up to 1000 characters."],
        ]}
      />
      <p>Response <code>201 Created</code> — or <code>200</code> with <code>replayed: true</code> when you retried with the same Idempotency-Key:</p>
      <CodeBlock
        lang="json"
        code={`
{
  "booking": {
    "reference": "EXC-7K3QX9MD",
    "module": "EXCURSIONS",
    "status": "CONFIRMED",
    "replayed": false,
    "property": { "id": "8f1c…", "name": "Coral Bay Resort" },
    "guest": { "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com" },
    "payment": { "status": "PAID", "reference": "pay_123" },
    "total": { "grandTotal": 215, "currency": "USD" },
    "moved": false,
    "excursion": { "id": "e71b…", "name": "Sunset Dolphin Cruise" },
    "departure": { "id": "d4f2…", "date": "2026-10-03", "time": "17:00", "meetingTime": "16:45", "meetingPoint": "Sunset Jetty" },
    "adults": 2, "children": 1, "infants": 0,
    "cancellation": { "allowed": true, "freeUntil": "2026-10-03T05:00:00.000Z", "cancelledAt": null, "refundRequired": false }
  }
}
`}
      />
      <p>Show the <code>reference</code> on your confirmation page and in your email to the guest, with the date, time and meeting point.</p>

      <H3>Refusals</H3>
      <Table
        head={["Code", "What to do"]}
        rows={[
          [<code key="a">SOLD_OUT</code>, "Not enough seats left (details.seatsLeft). Send the guest back to choose another departure."],
          [<code key="b">HOLD_EXPIRED</code>, "The hold ran out. Check the departure again and hold/book afresh."],
          [<code key="c">HOLD_USED</code>, "This hold was already booked — look the booking up instead of booking twice."],
          [<code key="d">PRICE_CHANGED</code>, "Re-quote, show the new total, confirm with the guest. Refund any difference you took."],
          [<code key="e">BOOKING_CUTOFF</code>, "Online booking for this departure has closed. The guest can contact the property."],
          [<code key="f">DEPARTURE_CLOSED</code>, "Cancelled or already left."],
          [<code key="g">PAYMENT_NOT_CONFIGURED</code>, "The property can't receive paid bookings yet — send UNPAID or ask them to set it up."],
          [<code key="h">PARTY_TOO_LARGE</code>, "More guests than the property allows per online booking."],
          [<code key="i">MODULE_NOT_ENABLED</code>, "The property isn't selling excursions online right now."],
        ]}
      />
      <Callout title="If you took payment and the booking is refused">
        <p>
          Refund the guest through your provider. Holding first makes this rare: a hold guarantees the seats while the guest pays.
        </p>
      </Callout>

      <H2>What happens at the property</H2>
      <p>
        The booking appears on the departure&apos;s manifest immediately, marked <em>Online</em> with its reference, on a bill in the
        guest&apos;s name. If the property later cancels the departure (weather), moves the guest to another departure, or marks a
        no-show, the lookup shows it and — if you registered one — a <a href="/docs/api-integration/webhooks">webhook</a> tells you.
      </p>
      <Pager href="/docs/api-integration/excursions" />
    </>
  )
}
