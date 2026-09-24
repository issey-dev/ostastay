import type { Metadata } from "next"
import { DocTitle, H2, Pager } from "../../components"

export const metadata: Metadata = { title: "Go-live checklist" }

export default function GoLive() {
  return (
    <>
      <DocTitle title="Go-live checklist" lead="Work through this together — the property's administrator and the web developer — before the booking pages go public." />

      <H2>The property</H2>
      <ul>
        <li>The key covers the site&apos;s property — or all of the group&apos;s properties, for a group portal — and is ticked for exactly the modules the site sells.</li>
        <li>The key has no browser origins (server-to-server), unless the site is static and books rooms only.</li>
        <li>Rooms: a rate plan chosen, meal plan, minimum stay, booking window and desk note set; the price calendar is filled across the booking window.</li>
        <li>Excursions: selling online switched on; the excursions to sell published with a description and photos; departures scheduled; prices set for the dates.</li>
        <li>Spa: selling online switched on; treatments published; therapists&apos; working hours and treatment rooms set up; prices set.</li>
        <li>If the site takes payment: a payment method chosen for paid online bookings, per module.</li>
        <li>Policies written the way the desk will honour them.</li>
        <li>Someone owns key rotation and knows where to revoke.</li>
      </ul>

      <H2>The website</H2>
      <ul>
        <li>The key (and any webhook secret) is stored as a server secret — not in any browser bundle or repository.</li>
        <li>Sections render from <code>modules</code>; nothing is hard-coded that the property can switch off.</li>
        <li>Date pickers start at <code>businessDate</code>.</li>
        <li>The price shown is always a quote&apos;s <code>grandTotal</code>, labelled according to <code>pricesIncludeTaxes</code>.</li>
        <li>If you take payment: hold → pay → book with the <code>holdId</code>, and send <code>expectedTotal</code>.</li>
        <li>Every booking call sends a fresh <code>Idempotency-Key</code>, and a retry after a timeout reuses it.</li>
        <li><code>SOLD_OUT</code>, <code>SLOT_UNAVAILABLE</code>, <code>HOLD_EXPIRED</code>, <code>PRICE_CHANGED</code> and <code>BOOKING_CUTOFF</code> all have a guest-friendly message and a way back.</li>
        <li>The confirmation page and email show the reference, date, time (and meeting point), total, and the policies.</li>
        <li>&quot;My booking&quot; uses reference + email, and offers cancel only while <code>cancellation.allowed</code>.</li>
        <li>Refunds happen in your payment provider when <code>refundRequired</code> is true.</li>
        <li>If you use webhooks: signatures are verified on the raw body, and repeats are ignored by <code>id</code>.</li>
      </ul>

      <H2>Test together</H2>
      <ul>
        <li>A test room booking is found at the front desk with the &quot;Booked via website&quot; remark.</li>
        <li>A test excursion booking is on the departure&apos;s manifest marked Online, with its reference; a paid one shows a settled bill.</li>
        <li>A test spa booking is on the spa schedule marked Online; a hold shows as &quot;Held online&quot; until it expires or is booked.</li>
        <li>Cancel one at the desk: the lookup shows it cancelled, and the webhook arrives.</li>
        <li>Cancel one from the site: the charge comes off the bill.</li>
        <li>Fill a departure: the site shows it full and refuses a booking.</li>
        <li>The Online bookings list in the property&apos;s administration area shows all of the above, including any refused attempts.</li>
      </ul>
      <Pager href="/docs/api-integration/go-live" />
    </>
  )
}
