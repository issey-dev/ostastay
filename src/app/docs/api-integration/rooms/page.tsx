import type { Metadata } from "next"
import { Callout, CodeBlock, DocTitle, Endpoint, H2, Pager } from "../../components"

export const metadata: Metadata = { title: "Rooms" }

export default function Rooms() {
  return (
    <>
      <DocTitle title="Rooms" lead="Property pages, the availability calendar, stay quotes and room bookings. Needs the ROOMS scope, except for the two property endpoints." />

      <H2>List properties</H2>
      <Endpoint method="GET" path="/properties" note="any scope" />
      <p>Every active property this key may act on.</p>
      <CodeBlock
        lang="json"
        code={`
{
  "properties": [
    {
      "id": "8f1c…", "code": "CBR", "name": "Coral Bay Resort",
      "headline": "Barefoot luxury on a quiet lagoon",
      "currency": "USD", "timeZone": "Indian/Maldives", "starRating": 5,
      "imageUrl": "https://cdn.example.com/hero.jpg",
      "bookingEnabled": true
    }
  ]
}
`}
      />

      <H2>Property details</H2>
      <Endpoint method="GET" path="/properties/{propertyId}" note="any scope" />
      <p>Everything a property page needs. A property not on your key answers <code>404 PROPERTY_NOT_FOUND</code> — never 403, so a key cannot be used to discover other properties.</p>
      <CodeBlock
        lang="json"
        code={`
{
  "property": {
    "id": "8f1c…", "code": "CBR", "name": "Coral Bay Resort", "legalName": "Coral Bay Hospitality Ltd",
    "headline": "Barefoot luxury on a quiet lagoon",
    "description": "Long-form copy set by the property…",
    "imageUrls": ["https://cdn.example.com/hero.jpg", "https://cdn.example.com/pool.jpg"],
    "logoUrl": "https://cdn.example.com/logo.png", "brandColor": "#0E6F7A", "starRating": 5,
    "address": "1 Lagoon Road",
    "location": { "latitude": 4.17, "longitude": 73.51 },
    "contact": { "phone": "+000 000 0000", "email": "stay@example.com" },
    "checkInTime": "14:00", "checkOutTime": "11:00",
    "currency": "USD", "timeZone": "Indian/Maldives", "pricesIncludeTaxes": true,
    "businessDate": "2026-10-01",
    "policies": "Free cancellation up to 7 days before arrival…",
    "facilities": [{ "name": "Infinity pool", "description": null }],
    "roomTypes": [
      {
        "id": "c2a1…", "code": "BVL", "name": "Beach Villa", "description": "…",
        "baseOccupancy": 2, "maxOccupancy": 3, "totalRooms": 12,
        "features": [
          { "category": "BED_TYPE", "code": "KING", "label": "King bed" },
          { "category": "ROOM_VIEW", "code": "OCEAN", "label": "Ocean view" }
        ]
      }
    ],
    "booking": {
      "enabled": true, "reason": null,
      "ratePlan": { "id": "…", "code": "BAR", "name": "Best Available Rate" },
      "mealPlanCode": "BB", "mealPlanSelectable": true, "mealPlanAffectsPrice": true,
      "mealPlans": [
        { "code": "RO", "name": "Room Only", "isDefault": false },
        { "code": "BB", "name": "Bed & Breakfast", "isDefault": true }
      ],
      "addOns": [
        { "id": "9a2f…", "code": "TRF-SB", "name": "Speedboat Transfer", "type": "TRANSFER", "postingRhythm": "ARRIVAL_NIGHT" }
      ],
      "minNights": 1, "maxNightsAhead": 365
    },
    "modules": {
      "rooms":      { "enabled": true, "code": null, "reason": null },
      "excursions": { "enabled": true, "code": null, "reason": null },
      "spa":        { "enabled": false, "code": "SCOPE_NOT_GRANTED", "reason": "This API key is not enabled for this module." }
    }
  }
}
`}
      />
      <ul>
        <li><code>modules</code> — which modules this key can book here right now. <code>code</code> is one of <code>SCOPE_NOT_GRANTED</code> (ask the property to add it to your key), <code>ADDON_NOT_ENABLED</code>, <code>NOT_SOLD_ONLINE</code>, <code>NO_OUTLET</code>, <code>NOTHING_PUBLISHED</code> (the property is still setting it up) or, for rooms, <code>BOOKING_DISABLED</code>.</li>
        <li><code>roomTypes</code> lists only sellable types. <code>totalRooms</code> is informational — use the availability endpoint for what is free.</li>
        <li><code>booking.enabled</code> is false when the property has not chosen a rate plan or has switched online booking off; <code>booking.reason</code> says which. Show the property, hide the booking form.</li>
        <li><code>pricesIncludeTaxes</code> tells you how to label prices. The quote returns the tax breakdown either way.</li>
        <li><strong>Meal plans and extras</strong> are switched on per property, so both lists are often empty. <code>addOns</code> carry no price on purpose — what one costs depends on the party and the stay — send their ids to the quote and show the line it returns. Read the catalogue rather than hard-coding ids: a withdrawn extra is refused as <code>ADD_ON_NOT_FOUND</code>.</li>
      </ul>

      <H2>Availability calendar</H2>
      <Endpoint method="GET" path="/properties/{propertyId}/availability?from=2026-10-10&to=2026-10-15" note="ROOMS" />
      <p>Per room type, per night in <code>[from, to)</code> — at most 62 nights per call.</p>
      <CodeBlock
        lang="json"
        code={`
{
  "propertyId": "8f1c…", "from": "2026-10-10", "to": "2026-10-15", "nights": 5,
  "currency": "USD", "pricesIncludeTaxes": true,
  "ratePlan": { "id": "…", "code": "BAR", "name": "Best Available Rate" },
  "bookingEnabled": true,
  "roomTypes": [
    {
      "id": "c2a1…", "code": "BVL", "name": "Beach Villa", "baseOccupancy": 2, "maxOccupancy": 3,
      "nights": [
        { "date": "2026-10-10", "available": 4, "closed": false, "price": 450, "extraAdultPrice": 90, "extraChildPrice": 40 },
        { "date": "2026-10-11", "available": 0, "closed": true,  "price": 450, "extraAdultPrice": 90, "extraChildPrice": 40 },
        { "date": "2026-10-12", "available": 2, "closed": false, "price": null, "extraAdultPrice": null, "extraChildPrice": null }
      ],
      "minAvailable": 0, "bookable": false, "roomRateTotal": null
    }
  ]
}
`}
      />
      <ul>
        <li><code>available</code> — rooms of that type free that night. Real inventory: out-of-order rooms and group holds already excluded; never below 0.</li>
        <li><code>closed</code> — a stop-sale applies. Treat the night as unbookable.</li>
        <li><code>price</code> — the room rate for that night on the property&apos;s online rate plan, before tax handling. <code>null</code> means unpriced: the stay cannot be booked online.</li>
        <li><code>minAvailable</code>, <code>bookable</code>, <code>roomRateTotal</code> summarise the window.</li>
      </ul>
      <Callout tone="warn" title="Don't add nightly prices up">
        <p>For the total a guest pays, call the quote. It adds taxes, service charge, levies and package components.</p>
      </Callout>

      <H2>Quote a stay</H2>
      <Endpoint method="POST" path="/properties/{propertyId}/quote" note="ROOMS" />
      <CodeBlock
        lang="json"
        code={`
{ "checkIn": "2026-10-10", "checkOut": "2026-10-12", "roomTypeId": "c2a1…",
  "adults": 2, "children": 1, "mealPlanCode": "BB", "addOnIds": ["9a2f…"] }
`}
      />
      <p>The authoritative price, computed by the code the property bills with. Writes nothing.</p>
      <CodeBlock
        lang="json"
        code={`
{
  "quote": {
    "propertyId": "8f1c…",
    "roomType": { "id": "c2a1…", "code": "BVL", "name": "Beach Villa" },
    "ratePlan": { "id": "…", "code": "BAR", "name": "Best Available Rate" },
    "mealPlanCode": "BB", "checkIn": "2026-10-10", "checkOut": "2026-10-12", "nights": 2,
    "adults": 2, "children": 1, "currency": "USD", "pricesIncludeTaxes": true,
    "available": true, "roomsAvailable": 4,
    "totals": { "roomBase": 900, "extraOccupancy": 80, "packageAllocations": 0, "taxes": 156.8, "greenTax": 18, "grandTotal": 1154.8 },
    "allocations": [
      { "id": "…", "code": "BF", "name": "Breakfast", "source": "MEAL_PLAN", "mode": "ADD_TO_RATE", "amount": 96 }
    ],
    "taxLines": [{ "name": "TGST", "ratePercent": 16, "amount": 156.8 }],
    "nightly": [
      { "date": "2026-10-10", "rate": 450, "roomCharge": 490, "taxes": 87.4, "total": 577.4 }
    ],
    "warnings": []
  }
}
`}
      />
      <ul>
        <li><code>available: false</code> — the stay cannot be booked right now (sold out, closed or unpriced). Show the price if you like, disable the button.</li>
        <li><code>totals.grandTotal</code> is the price to display.</li>
        <li><code>allocations</code> itemises the stay. <code>source</code> <code>RATE_PLAN</code>/<code>MEAL_PLAN</code> = included with the choice; <code>MANUAL</code> = an extra the guest ticked. <code>INCLUDE_IN_RATE</code> amounts are already inside <code>roomBase</code>.</li>
        <li><code>warnings</code> are for your logs, not for guests.</li>
      </ul>

      <H2>Create a booking</H2>
      <Endpoint method="POST" path="/properties/{propertyId}/bookings" note="ROOMS · Idempotency-Key" />
      <CodeBlock
        lang="json"
        code={`
{
  "checkIn": "2026-10-10", "checkOut": "2026-10-12", "roomTypeId": "c2a1…",
  "adults": 2, "children": 1, "mealPlanCode": "BB", "addOnIds": ["9a2f…"],
  "guest": { "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com", "phone": "+000 000 0000" },
  "remarks": "Arriving on the late seaplane"
}
`}
      />
      <p>
        Creates a real reservation (status <code>RESERVED</code>) with a confirmation number from the property&apos;s own sequence —
        exactly what the front desk would create. The guest is matched to an existing profile by email, or a new one is created.
        Response <code>201</code>, or <code>200</code> with <code>replayed: true</code> for a retry with the same key.
      </p>
      <CodeBlock
        lang="json"
        code={`
{
  "booking": {
    "bookingId": "4c1e…", "confirmationNo": "CBR-000482", "reservationId": "…",
    "status": "RESERVED", "replayed": false,
    "property": { "id": "8f1c…", "name": "Coral Bay Resort", "checkInTime": "14:00", "checkOutTime": "11:00" },
    "guest": { "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com" },
    "quote": { "…": "the confirmed figures, same shape as the quote" }
  }
}
`}
      />
      <p>Refusals (all 409): <code>SOLD_OUT</code>, <code>STOP_SALE</code>, <code>NO_RATE</code>, <code>BOOKING_DISABLED</code>. The site cannot overbook — send the guest back to the dates step. Room bookings take no payment; record any payment you take in <code>remarks</code>.</p>

      <H2>Look up a booking</H2>
      <Endpoint method="GET" path="/bookings/{confirmationNo}?email=ada@example.com" note="ROOMS" />
      <p>
        Only bookings made with this key, and only with the email they were made with. Returns the booking with its live status:{" "}
        <code>RESERVED</code>, <code>IN_HOUSE</code>, <code>CHECKED_OUT</code>, <code>NO_SHOW</code> or <code>CANCELLED</code>. Room
        cancellations go through the property.
      </p>
      <Pager href="/docs/api-integration/rooms" />
    </>
  )
}
