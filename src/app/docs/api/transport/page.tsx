import type { Metadata } from "next"
import { Callout, CodeBlock, DocTitle, Endpoint, H2, H3, Pager, Table } from "../../components"

export const metadata: Metadata = { title: "Transportation" }

const c = (s: string) => <code key={s}>{s}</code>

export default function Transport() {
  return (
    <>
      <DocTitle
        title="Transportation"
        lead="Run a property's guest transfers from your own system — the transport set-up, transfer bookings, shared departures, the daily board and report, and charging transfers to the guest's bill. Needs the TRANSPORT scope and a server-only key."
      />

      <Callout title="Not for a public booking page">
        This module is for the property&apos;s operations — an operator&apos;s dispatch system, the property&apos;s own tools, a
        reporting job. It carries guest names, flights and contacts and can post charges, so a key with the <code>TRANSPORT</code>{" "}
        scope must be used from a server: keys with browser origins can&apos;t be given the scope, and are refused with{" "}
        <code>403 SERVER_KEY_REQUIRED</code>. Guests booking a transfer on a website is not part of this API.
      </Callout>

      <H2>Before you start</H2>
      <ul>
        <li>The property ticks <strong>Transportation</strong> on your key in the Hub (Booking API keys). No browser origins on that key.</li>
        <li>The property switches Transportation on (Hub → the property → Transportation). Until then the configuration endpoints work, the rest answer <code>409 MODULE_NOT_ENABLED</code>.</li>
        <li>Everything lives under <code>/properties/&#123;propertyId&#125;/transport</code>. A property your key doesn&apos;t cover is <code>404 PROPERTY_NOT_FOUND</code>.</li>
      </ul>

      <H2 id="conventions">Times, dates and money</H2>
      <ul>
        <li><strong>Local times</strong> you send and read (<code>departureTime</code>, <code>flightTime</code>) are <code>HH:MM</code>, 24-hour, in the property&apos;s time zone (<code>timeZone</code> below — <code>Indian/Maldives</code> for Maldivian properties).</li>
        <li><strong>Days</strong> (<code>serviceDate</code>, <code>flightDate</code>, <code>from</code>, <code>to</code>) are <code>YYYY-MM-DD</code>, the property&apos;s local day.</li>
        <li><strong>Instants</strong> in responses (<code>flightAt</code>, <code>departureAt</code>) are UTC ISO 8601; each comes with a <code>…Local</code> twin (<code>&#123; dateKey, time &#125;</code>) so you never convert.</li>
        <li><strong>Amounts</strong> are in the property&apos;s currency and entered the way the property enters every price — including or excluding tax per <code>pricesIncludeTaxes</code>. The posted folio total (tax included) is returned when a charge posts.</li>
      </ul>
      <Endpoint method="GET" path="/properties/{propertyId}/transport" />
      <CodeBlock
        lang="json"
        code={`
{ "propertyId": "8f1c…", "enabled": true, "timeZone": "Indian/Maldives", "currency": "USD",
  "pricesIncludeTaxes": true, "attentionToleranceMinutes": 60, "requireProvider": false }
`}
      />

      <H2>Configuration</H2>
      <p>The same catalogue the property edits in the Hub, with the same rules. Six collections:</p>
      <Table
        head={["Collection", "What it is", "Key fields"]}
        rows={[
          [c("types"), "Speedboat, seaplane, domestic flight, ferry, land", "code, name, mode, requiresFlightDetails"],
          [c("locations"), "Airports, jetties, seaplane platforms, islands, resorts, guesthouses", "code, name, type, notes"],
          [c("routes"), "From → to, by a transport type, with default departure times", "code, name, originId, destinationId, transportTypeId, category, direction, durationMinutes, departureSlots"],
          [c("providers"), "The property's own fleet or a third-party operator", "name, kind (OWN | THIRD_PARTY), contactName, phone, email"],
          [c("vessels"), "Boats, seaplanes, vehicles, with seats", "providerId, name, transportTypeId, capacity, registration"],
          [c("rates"), "Prices per route", "routeId, direction, pricingBasis, price | adultPrice/childPrice/infantPrice, childMinAge, childMaxAge, validFrom, validTo, chargeCodeId, taxMode, taxProfileId, isBillable"],
        ]}
      />
      <Endpoint method="GET" path="/properties/{propertyId}/transport/config/{collection}[?active=1]" />
      <Endpoint method="POST" path="/properties/{propertyId}/transport/config/{collection}" />
      <Endpoint method="GET" path="/properties/{propertyId}/transport/config/{collection}/{id}" />
      <Endpoint method="PATCH" path="/properties/{propertyId}/transport/config/{collection}/{id}" note="partial; { isActive: false } deactivates" />
      <Endpoint method="DELETE" path="/properties/{propertyId}/transport/config/{collection}/{id}" note="only while nothing uses it" />
      <ul>
        <li>Every row has <code>isActive</code>. Anything already used by a booking, rate or departure can&apos;t be deleted (<code>409 IN_USE</code>) — deactivate it.</li>
        <li>Codes are unique per property (<code>409 DUPLICATE</code>); ids you reference must be this property&apos;s own (<code>400 INVALID_REFERENCE</code>).</li>
        <li>A route used for <code>BOTH</code> directions is entered the arrival way round (airport → property); a drop-off travels it in reverse — bookings return the real <code>route.from</code> and <code>route.to</code>.</li>
        <li><code>pricingBasis</code>: <code>PER_PERSON</code> (adult/child/infant prices), <code>PER_VEHICLE</code> (<code>price</code> × vehicles), <code>PER_TRIP</code> (<code>price</code> per booking). <code>taxMode</code>: <code>CHARGE_CODE</code>, <code>DEFAULT</code> (Service Charge + GST) or <code>CUSTOM</code> (with <code>taxProfileId</code>). A route without a rate is complimentary.</li>
      </ul>

      <H2>Bookings</H2>
      <p>One guest party, one direction: a <code>PICKUP</code> (arrival) or a <code>DROP_OFF</code> (departure). Linked to a reservation, or a traveller with no stay (billed on a walk-in bill).</p>
      <Endpoint method="POST" path="/properties/{propertyId}/transport/bookings" />
      <CodeBlock
        lang="json"
        code={`
{
  "reservationId": "c3d9…",          // or, with no stay: "guestName": "…", "guestContact": "…"
  "direction": "PICKUP",
  "serviceDate": "2026-12-20",       // defaults to the reservation's arrival / departure day
  "adults": 2, "children": 1, "infants": 0,   // default to the reservation's party
  "routeId": "r81a…", "departureTime": "14:00",
  "airline": "Emirates", "flightNo": "EK652", "flightTime": "12:15", "terminal": "International",
  "airportRepUserId": null, "meetingNotes": "Counter 12, 4 bags",
  "providerId": null, "vesselId": null, "driverName": null, "driverContact": null, "seatNote": null,
  "notes": null,
  "status": "CONFIRMED"              // or "DRAFT"
}
`}
      />
      <p>The price comes from the route&apos;s most specific enabled rate. Send <code>&quot;priceOverride&quot;: &#123; &quot;amount&quot;: 80, &quot;reason&quot;: &quot;…&quot; &#125;</code> to set it by hand.</p>
      <CodeBlock
        lang="json"
        code={`
{
  "id": "b40355…", "reference": "TR-B40355", "status": "CONFIRMED", "direction": "PICKUP",
  "serviceDate": "2026-12-20", "adults": 2, "children": 1, "infants": 0, "pax": 3,
  "guestName": "Aisha Rasheed", "reservation": { "id": "c3d9…", "confirmationNo": "VL4201", "roomNumber": "L13", "…": "…" },
  "groupBlock": { "id": "…", "code": "WED24", "name": "Wedding party" },
  "flightNo": "EK652", "flightAt": "2026-12-20T07:15:00.000Z", "flightLocal": { "dateKey": "2026-12-20", "time": "12:15" },
  "route": { "id": "r81a…", "code": "MLE-SPB", "name": "Airport – resort by speedboat",
             "from": { "code": "MLE", "…": "…" }, "to": { "code": "HOME", "…": "…" }, "…": "…" },
  "effectiveDepartureAt": "2026-12-20T09:00:00.000Z", "departureLocal": { "dateKey": "2026-12-20", "time": "14:00" },
  "manifest": null, "provider": null, "vessel": null, "isOwn": null,
  "pricing": { "rateId": "…", "amount": 300, "priceOverridden": false, "chargeCodeId": "…", "taxMode": "CHARGE_CODE" },
  "billing": { "status": "NOT_BILLED", "folioLineItemId": null, "postedGross": null, "note": null },
  "attention": [{ "code": "TOO_SOON_AFTER_LANDING", "message": "Departs 105 min after landing — allow at least 120 min" }]
}
`}
      />
      <Endpoint method="GET" path="/properties/{propertyId}/transport/bookings?from=&to=&direction=&status=&reservationId=&manifestId=&q=&unassigned=1&attention=1&limit=&cursor=" />
      <p>
        Paginated: <code>&#123; &quot;data&quot;: [...], &quot;nextCursor&quot;: &quot;…&quot; | null &#125;</code>. <code>limit</code> is 1–200 (default 100); pass{" "}
        <code>nextCursor</code> back as <code>cursor</code> for the next page. Cancelled bookings are left out unless asked for by status.
      </p>
      <Endpoint method="GET" path="/properties/{propertyId}/transport/bookings/{bookingId}" />
      <Endpoint method="PATCH" path="/properties/{propertyId}/transport/bookings/{bookingId}" note="any field above; re-prices an unposted transfer" />
      <Endpoint method="POST" path="/properties/{propertyId}/transport/bookings/{bookingId}/status" note='{ "status": "NO_SHOW", "reason": "…" }' />
      <p>
        Statuses: <code>DRAFT</code> → <code>CONFIRMED</code> → <code>ASSIGNED</code> (on a departure or with a provider) → <code>COMPLETED</code>; or{" "}
        <code>NO_SHOW</code> / <code>CANCELLED</code>. A cancelled booking leaves its departure. The response carries a <code>note</code> when a charge
        needs a person&apos;s attention.
      </p>
      <Endpoint method="POST" path="/properties/{propertyId}/transport/quote" note="the rate and folio total for a booking you are about to make" />

      <H3 id="attention">Needs attention</H3>
      <p>
        Worked out live, never stored, and never a reason a save is refused: {c("TOO_SOON_AFTER_LANDING")}, {c("TOO_CLOSE_TO_FLIGHT")} (the route&apos;s
        duration counts), {c("FLIGHT_CHANGED")} (since the booking joined its departure — clear it with <code>KEEP</code> below) and{" "}
        {c("FLIGHT_MISSING")}, and {c("RESERVATION_CLOSED")} (the stay was cancelled or never arrived — Night Audit won&apos;t charge
        the transfer; cancel it or mark it a no-show). The allowance is the property&apos;s <code>attentionToleranceMinutes</code>.
      </p>

      <H2>Departures (manifests)</H2>
      <p>One boat, seaplane or car leaving at a time; bookings from any reservations ride on it together. Seats are counted live; more passengers than the vessel&apos;s seats is reported (<code>capacityState: &quot;OVER&quot;</code>) but never refused.</p>
      <Endpoint method="GET" path="/properties/{propertyId}/transport/manifests?from=&to=&direction=&routeId=" />
      <Endpoint method="POST" path="/properties/{propertyId}/transport/manifests" note="routeId, direction, serviceDate, departureTime, providerId?, vesselId?, driverName?, bookingIds?" />
      <Endpoint method="GET" path="/properties/{propertyId}/transport/manifests/{manifestId}" />
      <Endpoint method="PATCH" path="/properties/{propertyId}/transport/manifests/{manifestId}" note="time, vessel, driver, notes, status" />
      <Endpoint method="POST" path="/properties/{propertyId}/transport/manifests/{manifestId}/bookings" note='{ "action": "ATTACH" | "DETACH" | "KEEP", "bookingIds": [...] }' />
      <Endpoint method="POST" path="/properties/{propertyId}/transport/manifests/from-slots" note="the day's departures from the routes' default times" />
      <ul>
        <li><code>ATTACH</code> also moves a booking from another departure, and puts it on the departure&apos;s day. A confirmed booking becomes <code>ASSIGNED</code>; a draft stays a draft.</li>
        <li>Status <code>COMPLETED</code> completes its passengers; <code>CANCELLED</code> takes them off, still booked, to be put on another departure.</li>
      </ul>

      <H2>Board, report and suggestions</H2>
      <Endpoint method="GET" path="/properties/{propertyId}/transport/board?date=YYYY-MM-DD[&filters]" note="the day's bookings, departures and a week of counts" />
      <Endpoint method="GET" path="/properties/{propertyId}/transport/report?from=&to=" note="the Daily Transportation Report's data, ≤ 62 days" />
      <Endpoint method="GET" path="/properties/{propertyId}/transport/suggestions?from=&to=" note="arrivals and departures with nothing booked — nothing is created" />

      <H2>Charging transfers</H2>
      <p>
        Billable transfers are posted to the guest&apos;s bill by the property&apos;s Night Audit — pickups on the arrival day, drop-offs on the
        guest&apos;s last night (dated the departure day) — once per booking, with the rate&apos;s charge code and tax. Drafts, no-shows and
        cancellations are never posted automatically. To post or waive by hand:
      </p>
      <Endpoint method="POST" path="/properties/{propertyId}/transport/bookings/{bookingId}/billing" />
      <CodeBlock
        lang="json"
        code={`
{ "action": "POST", "mode": "FULL" }
{ "action": "POST", "mode": "CUSTOM", "amount": 40, "reason": "No-show fee", "description": "Transfer no-show fee", "chargeCodeId": null }
{ "action": "WAIVE", "reason": "Included in the package" }
{ "action": "RESUME" }
`}
      />
      <p>
        <code>billing.status</code> is one of {c("NOT_BILLED")} {c("PENDING")} (Night Audit found no open folio) {c("POSTED")} {c("VOIDED")}{" "}
        {c("WAIVED")} {c("NON_BILLABLE")}. Voiding a posted charge is a folio correction made at the property — API keys are refused it (
        <code>403</code>).
      </p>

      <H2>Errors you will meet here</H2>
      <Table
        head={["Status", "Code", "Meaning"]}
        rows={[
          ["400", c("VALIDATION"), "A field is wrong; details maps fields to messages."],
          ["400", c("INVALID_REFERENCE"), "An id that isn't this property's (route, provider, charge code…)."],
          ["400", c("DIRECTION_MISMATCH"), "A drop-off on a pickup departure, or a route for the other direction."],
          ["400", c("INVALID_STATUS_CHANGE"), "That status can't follow the current one."],
          ["400", c("PROVIDER_REQUIRED"), "The property requires a provider before Assigned / Confirmed."],
          ["400", c("ALREADY_POSTED"), "The transfer is already charged."],
          ["400", c("NO_PRICE"), "Full rate asked for a complimentary transfer — post a custom amount."],
          ["403", c("SERVER_KEY_REQUIRED"), "The key has browser origins."],
          ["404", c("NOT_FOUND"), "No such booking, departure or row at this property."],
          ["409", c("IN_USE"), "Delete refused — deactivate instead."],
          ["409", c("DUPLICATE"), "That code is already used at this property."],
          ["409", c("MODULE_NOT_ENABLED"), "Transportation is off at this property."],
          ["409", c("NO_OPEN_FOLIO"), "The reservation has no open bill to post to."],
        ]}
      />
      <Pager href="/docs/api/transport" />
    </>
  )
}
