# Uppsolut Stay — Website API v1

The Website API lets a property's own brand website read live property information,
availability and prices from Uppsolut Stay, and create bookings straight into the PMS.
It is the "front" for a property: a marketing site with a simple booking page.

If you are building the website, read this together with
[`PROPERTY_WEBSITE_GUIDE.md`](PROPERTY_WEBSITE_GUIDE.md), which walks through the
whole flow (getting a key from the Hub, the pages to build, keeping availability in
sync). The machine-readable spec is [`website-api.openapi.yaml`](website-api.openapi.yaml).

- **Base URL:** `https://<your-uppsolut-host>/api/website/v1`
- **Format:** JSON in, JSON out. UTF-8. Dates are `YYYY-MM-DD` (calendar days, no time
  zone). Money is a plain number in the property's currency, two decimals.
- **Auth:** API key (see below). No cookies, no sessions.
- **Versioning:** the `v1` path segment. Fields may be added to responses at any time
  without a version bump; nothing is removed or renamed within `v1`.

---

## 1. Authentication

Every request carries an API key created in the **Hub → Website API → API Keys** page of
the enterprise that owns the property. A key:

- belongs to one **enterprise** and grants access to **one or more of its properties**;
- is shown **once**, when it is created or rotated — only a hash is stored;
- can be **rotated** (same key record, new secret; the old secret stops working
  immediately) or **revoked** (permanent);
- may carry an **expiry date** and an optional list of **browser origins**.

Send it in the `Authorization` header (preferred):

```http
Authorization: Bearer wsk_3f9c…
```

or, if your HTTP client makes that awkward:

```http
X-Api-Key: wsk_3f9c…
```

Never put the key in a URL.

### Where the key lives (read this)

The key can **create reservations** in the property's PMS. Treat it like a database
password:

- **Recommended: server-to-server.** Your website's backend (a Next.js route, a PHP
  controller, a serverless function) calls the Website API and your pages call your
  backend. The key never reaches a visitor's browser. Leave "Browser origins" empty in
  the Hub.
- **Browser-direct (only for static sites with no backend).** Add your site's origin(s)
  (`https://www.hotel.com`) to the key in the Hub. The API then answers CORS preflight
  for those origins and echoes `Access-Control-Allow-Origin` on responses. Understand
  that anyone who views your page source can read the key and create bookings with it;
  rotate it if it leaks.

### Auth errors

| Status | `code` | Meaning |
|---|---|---|
| 401 | `MISSING_API_KEY` | No `Authorization` / `X-Api-Key` header. |
| 401 | `INVALID_API_KEY` | Unknown, revoked or expired key. Deliberately the same response for all three. |

---

## 2. Conventions

### Errors

Every error is JSON with a stable `code` you can switch on and an `error` message for
humans. Validation errors add `details` keyed by field path.

```json
{ "error": "Invalid request.", "code": "VALIDATION", "details": { "guest.email": "A valid email is required" } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION` | Body or query failed validation. See `details`. |
| 400 | `INVALID_DATES` | Dates not `YYYY-MM-DD`, or check-out not after check-in. |
| 400 | `ARRIVAL_IN_PAST` | Check-in is before the property's business date (its operational "today"). |
| 400 | `TOO_FAR_AHEAD` | Check-out is beyond the booking window set in the Hub. |
| 400 | `MIN_STAY` | Fewer nights than the property's minimum. |
| 400 | `STAY_TOO_LONG` | More than 62 nights requested. |
| 400 | `INVALID_OCCUPANCY` | Adults < 1, or adults + children over the room type's maximum. |
| 404 | `PROPERTY_NOT_FOUND` | Unknown id, **or a property the key does not cover** — never a 403, so keys cannot be used to enumerate properties. |
| 404 | `ROOM_TYPE_NOT_FOUND` | Not a sellable room type of this property. |
| 404 | `BOOKING_NOT_FOUND` | Lookup: no match for confirmation number + email under this key. |
| 409 | `BOOKING_DISABLED` | The Hub has switched online booking off, or no rate plan is configured. |
| 409 | `NO_RATE` | One or more nights have no price. The stay cannot be booked online. |
| 409 | `STOP_SALE` | The property has closed one or more of the dates. |
| 409 | `SOLD_OUT` | No room of that type is free for every night of the stay. |
| 409 | `MEAL_PLAN_NOT_OFFERED` | You sent a `mealPlanCode` but the property does not let guests choose one. |
| 400 | `MEAL_PLAN_NOT_FOUND` | Not an active meal plan of this property. |
| 409 | `ADD_ONS_NOT_OFFERED` | You sent `addOnIds` but the property does not sell extras online. |
| 400 | `ADD_ON_NOT_FOUND` | An id is not an extra this property sells separately. |
| 409 | `IDEMPOTENCY_CONFLICT` | The `Idempotency-Key` was already used for a different property. |
| 500 | `INTERNAL_ERROR` | Something went wrong on our side. Safe to retry a GET; for a booking, retry **with the same `Idempotency-Key`**. |

### Caching

All responses are `Cache-Control: no-store`. Availability and prices are live; cache on
your side for at most a minute if you must.

### Dates and "today"

A property has a **business date** — its operational "today", which only moves forward
when the desk runs End-of-Day. `GET /properties/{id}` returns it as `businessDate`. It is
the earliest check-in the API accepts, and it can lag the calendar date by a day; build
your date picker off `businessDate`, not the visitor's clock.

Check-out is exclusive: a stay `2026-03-10 → 2026-03-12` is two nights.

---

## 3. Endpoints

### 3.1 List properties

```http
GET /properties
```

Every active property this key may act on.

```json
{
  "properties": [
    {
      "id": "8f1c…",
      "code": "VILLA",
      "name": "Veyo Island Villas",
      "headline": "Barefoot luxury on a private island",
      "currency": "USD",
      "timeZone": "Indian/Maldives",
      "starRating": 5,
      "imageUrl": "https://cdn.hotel.com/hero.jpg",
      "bookingEnabled": true
    }
  ]
}
```

### 3.2 Property details

```http
GET /properties/{propertyId}
```

Everything a property page needs.

```json
{
  "property": {
    "id": "8f1c…",
    "code": "VILLA",
    "name": "Veyo Island Villas",
    "legalName": "Veyo Hospitality Pvt Ltd",
    "headline": "Barefoot luxury on a private island",
    "description": "Long-form marketing copy set in the Hub…",
    "imageUrls": ["https://cdn.hotel.com/hero.jpg", "https://cdn.hotel.com/pool.jpg"],
    "logoUrl": "https://cdn.hotel.com/logo.png",
    "brandColor": "#0E6F7A",
    "starRating": 5,
    "address": "Veyo Island, Baa Atoll",
    "location": { "latitude": 5.21, "longitude": 73.05 },
    "contact": { "phone": "+960 660 0000", "email": "stay@veyo.example" },
    "checkInTime": "14:00",
    "checkOutTime": "11:00",
    "currency": "USD",
    "timeZone": "Indian/Maldives",
    "pricesIncludeTaxes": true,
    "businessDate": "2026-03-04",
    "policies": "Free cancellation up to 7 days before arrival…",
    "facilities": [{ "name": "Infinity pool", "description": null }],
    "roomTypes": [
      {
        "id": "c2a1…",
        "code": "BVL",
        "name": "Beach Villa",
        "description": "…",
        "baseOccupancy": 2,
        "maxOccupancy": 3,
        "totalRooms": 12,
        "features": [
          { "category": "BED_TYPE", "code": "KING", "label": "King bed" },
          { "category": "ROOM_VIEW", "code": "OCEAN", "label": "Ocean view" },
          { "category": "ROOM_AMENITY", "code": "POOL", "label": "Private pool" }
        ]
      }
    ],
    "booking": {
      "enabled": true,
      "reason": null,
      "ratePlan": { "id": "…", "code": "BAR", "name": "Best Available Rate" },
      "mealPlanCode": "BB",
      "mealPlanSelectable": true,
      "mealPlanAffectsPrice": true,
      "mealPlans": [
        { "code": "RO", "name": "Room Only", "isDefault": false },
        { "code": "BB", "name": "Bed & Breakfast", "isDefault": true }
      ],
      "addOns": [
        { "id": "9a2f…", "code": "TRF-SB", "name": "Speedboat Transfer",
          "type": "TRANSFER", "postingRhythm": "ARRIVAL_NIGHT" }
      ],
      "minNights": 1,
      "maxNightsAhead": 365
    }
  }
}
```

Notes:

- `roomTypes` contains only **sellable** types (active, physical). `totalRooms` is
  informational — use the availability endpoint for what is actually free.
- `booking.enabled` is false when the Hub has not chosen a rate plan or has switched
  booking off; `booking.reason` says which. Show the property, hide the booking form.
- `pricesIncludeTaxes` tells you how to label prices ("incl. taxes" vs "+ taxes"). The
  quote endpoint always returns the tax breakdown either way.

**Meal plans and extras.** Both are switched on per property in the Hub, so both lists are
often empty — build the page to cope with that rather than assuming they are there.

- `mealPlanSelectable` is true when the guest may choose. `mealPlans` then lists the
  property's active plans with the default flagged. When it is false the list is empty and
  a booking simply uses `mealPlanCode`.
- `mealPlanAffectsPrice` says whether choosing a different plan changes the total. Some
  properties price per person off the meal plan; others carry the price in the rate plan
  and treat the meal plan as a label. Word the page accordingly rather than implying a
  choice costs something when it does not.
- `addOns` are the paid extras the property sells online — a transfer, a spa treatment, a
  set dinner. **They carry no price**, on purpose: what one costs depends on the party and
  the length of stay, and on whether it is charged every night or once on arrival. Send the
  ids to the quote and show the line it returns.

### 3.3 Availability calendar

```http
GET /properties/{propertyId}/availability?from=2026-03-10&to=2026-03-15
```

Per room type, per **night** in `[from, to)` — at most 62 nights per call.

```json
{
  "propertyId": "8f1c…",
  "from": "2026-03-10",
  "to": "2026-03-15",
  "nights": 5,
  "currency": "USD",
  "pricesIncludeTaxes": true,
  "ratePlan": { "id": "…", "code": "BAR", "name": "Best Available Rate" },
  "bookingEnabled": true,
  "roomTypes": [
    {
      "id": "c2a1…",
      "code": "BVL",
      "name": "Beach Villa",
      "baseOccupancy": 2,
      "maxOccupancy": 3,
      "nights": [
        { "date": "2026-03-10", "available": 4, "closed": false, "price": 450, "extraAdultPrice": 90, "extraChildPrice": 40 },
        { "date": "2026-03-11", "available": 0, "closed": true,  "price": 450, "extraAdultPrice": 90, "extraChildPrice": 40 },
        { "date": "2026-03-12", "available": 2, "closed": false, "price": null, "extraAdultPrice": null, "extraChildPrice": null }
      ],
      "minAvailable": 0,
      "bookable": false,
      "roomRateTotal": null
    }
  ]
}
```

How to read it:

- `available` is the number of rooms of that type free that night. It is **real
  inventory**: rooms out of order and rooms held by group blocks are already excluded,
  and it never goes below 0.
- `closed: true` means the property has a stop-sale on that night. Treat it as
  unbookable regardless of `available` (which will be 0).
- `price` is the **room rate for that night only** on the configured rate plan, before
  any tax handling, with extra-person surcharges alongside. `null` means no price is set
  for that night — the stay cannot be booked online through it.
- `minAvailable` / `bookable` / `roomRateTotal` summarise the whole window: how many rooms
  could be booked for every night, whether the type can be booked for these exact dates,
  and the sum of nightly room rates when every night is priced.
- For the **total a guest will pay**, call the quote endpoint. It adds taxes, service
  charge, Green Tax and any package components. Do not add these up yourself.

Typical use: a date-range picker calls this once for the chosen range (or for a whole
month to grey out sold-out days), then the results page shows one card per room type
with `bookable`, `minAvailable` and `roomRateTotal`.

### 3.4 Quote a stay

```http
POST /properties/{propertyId}/quote
Content-Type: application/json

{ "checkIn": "2026-03-10", "checkOut": "2026-03-12", "roomTypeId": "c2a1…",
  "adults": 2, "children": 1,
  "mealPlanCode": "BB",
  "addOnIds": ["9a2f…"] }
```

The **authoritative price** for a stay, computed by exactly the code the PMS posts
charges with. Never writes anything.

```json
{
  "quote": {
    "propertyId": "8f1c…",
    "roomType": { "id": "c2a1…", "code": "BVL", "name": "Beach Villa" },
    "ratePlan": { "id": "…", "code": "BAR", "name": "Best Available Rate" },
    "mealPlanCode": "BB",
    "checkIn": "2026-03-10",
    "checkOut": "2026-03-12",
    "nights": 2,
    "adults": 2,
    "children": 1,
    "currency": "USD",
    "pricesIncludeTaxes": true,
    "available": true,
    "roomsAvailable": 4,
    "totals": {
      "roomBase": 900,
      "extraOccupancy": 80,
      "packageAllocations": 0,
      "taxes": 156.8,
      "greenTax": 18,
      "grandTotal": 1154.8
    },
    "allocations": [
      { "id": "…", "code": "BF", "name": "Breakfast", "source": "MEAL_PLAN",
        "mode": "ADD_TO_RATE", "amount": 96 },
      { "id": "9a2f…", "code": "TRF-SB", "name": "Speedboat Transfer", "source": "MANUAL",
        "mode": "ADD_TO_RATE", "amount": 174 }
    ],
    "taxLines": [
      { "name": "TGST", "ratePercent": 16, "amount": 156.8 }
    ],
    "nightly": [
      { "date": "2026-03-10", "rate": 450, "roomCharge": 490, "taxes": 87.4, "total": 577.4 },
      { "date": "2026-03-11", "rate": 450, "roomCharge": 490, "taxes": 87.4, "total": 577.4 }
    ],
    "warnings": []
  }
}
```

- `available` is false when the stay could not be booked right now (sold out, a closed
  night, or an unpriced night). Show the price if you like, but disable the button.
- `totals.grandTotal` is what to display as the price of the stay. Show `taxLines` and
  `greenTax` beneath it if the property wants a breakdown.
- `warnings` are informational strings (for example an unpriced night). Log them; do not
  show them raw to guests.
- `allocations` itemises everything on the stay. `source` says why each line is there:
  `RATE_PLAN` or `MEAL_PLAN` means it came with what the guest chose, so show it as
  included; `MANUAL` means they ticked it, so show it as an extra they can remove.
- `mode` matters for wording. `INCLUDE_IN_RATE` is carved out of the room line, so its
  amount is **already inside** `roomBase` and must not be added again. `ADD_TO_RATE` sits
  on top. `grandTotal` is correct either way, which is why it is the figure to display.

**Both fields are optional.** Omit `mealPlanCode` and the booking uses the property's
default; omit `addOnIds` and no extras are added. Send either one to a property that does
not offer it and the request is refused rather than silently ignored, so a quote can never
disagree with the booking that follows it.

The stay is validated the same way a booking is — `MIN_STAY`, `TOO_FAR_AHEAD`,
`INVALID_OCCUPANCY` and friends apply.

### 3.5 Create a booking

```http
POST /properties/{propertyId}/bookings
Content-Type: application/json
Idempotency-Key: 6d0b2f9e-1c3a-4e5f-9a7b-…

{
  "checkIn": "2026-03-10",
  "checkOut": "2026-03-12",
  "roomTypeId": "c2a1…",
  "adults": 2,
  "children": 1,
  "mealPlanCode": "BB",
  "addOnIds": ["9a2f…"],
  "guest": {
    "firstName": "Ada",
    "lastName": "Lovelace",
    "email": "ada@example.com",
    "phone": "+44 7700 900000"
  },
  "remarks": "Arriving on the late seaplane"
}
```

Creates a real reservation in the PMS with status `RESERVED`, a confirmation number from
the property's own sequence, and a master folio — exactly what the front desk would
create. The guest is matched to an existing profile by email (case-insensitive) or a new
profile is created.

`mealPlanCode` and `addOnIds` are validated the same way the quote validates them, and the
extras are attached to the reservation itself — the front desk sees them on the booking and
Night Audit posts them, with no knowledge that the booking came from a website. Send the
same values you quoted with, or the guest agrees to one total and is billed another.

**Idempotency.** Generate a fresh UUID per booking attempt and send it as
`Idempotency-Key` (or as `idempotencyKey` in the body). If your request times out or you
get a 5xx, retry with the **same** key: you get the same booking back (`replayed: true`,
status 200) instead of a second reservation. Keys are scoped to your API key.

Response `201 Created` (or `200 OK` on a replay):

```json
{
  "booking": {
    "bookingId": "4c1e…",
    "confirmationNo": "VILLA-000482",
    "reservationId": "…",
    "status": "RESERVED",
    "replayed": false,
    "property": { "id": "8f1c…", "name": "Veyo Island Villas", "checkInTime": "14:00", "checkOutTime": "11:00" },
    "guest": { "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com" },
    "quote": { "…": "same shape as 3.4, the confirmed figures" }
  }
}
```

Show `confirmationNo` on the confirmation page and in your email to the guest. The desk
can find the reservation by that number or by the `WEB-xxxxxxxx` reference in its remarks.

Refusals (all 409): `SOLD_OUT`, `STOP_SALE`, `NO_RATE`, `BOOKING_DISABLED`. The website
**cannot overbook**: if the last room went between the quote and the booking, you get
`SOLD_OUT` and should send the guest back to the dates step.

**Payment.** The API does not take payment. What the property does about deposits and
balances is written in `policies` and in the "note for the front desk" the Hub sets on
every website reservation. If you collect payment on your site, record it in your own
system and put a reference in `remarks`.

### 3.6 Look up a booking

```http
GET /bookings/{confirmationNo}?email=ada@example.com
```

A "manage my booking" lookup. Only bookings made through **this key** are visible, and
the email must match the one used to book. Returns the same `booking` object as 3.5 with
the live reservation `status` (`RESERVED`, `IN_HOUSE`, `CHECKED_OUT`, `NO_SHOW`,
`CANCELLED`).

There is no cancel endpoint in v1 — cancellations go through the property, which is what
`policies` should say.

---

## 4. Rate limits and good behaviour

There is no hard rate limit today. Please:

- call `availability` once per search, not once per day of a calendar;
- cache the property details for a few minutes — they change rarely;
- always send `Idempotency-Key` on bookings and retry with it, never without it;
- never call the API from a browser unless the key is restricted to your origins and you
  accept that it is public.

---

## 5. Quick start (Node)

```js
const BASE = process.env.UPPSOLUT_API_BASE;   // https://stay.example.com/api/website/v1
const KEY  = process.env.UPPSOLUT_API_KEY;    // wsk_…

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error), { code: body.code, status: res.status, details: body.details });
  return body;
}

// Property page
const { property } = await api(`/properties/${PROPERTY_ID}`);

// Search
const availability = await api(`/properties/${PROPERTY_ID}/availability?from=2026-03-10&to=2026-03-12`);
const options = availability.roomTypes.filter((rt) => rt.bookable);

// Price
const { quote } = await api(`/properties/${PROPERTY_ID}/quote`, {
  method: "POST",
  body: JSON.stringify({ checkIn: "2026-03-10", checkOut: "2026-03-12", roomTypeId: options[0].id, adults: 2, children: 0 }),
});

// Book
const { booking } = await api(`/properties/${PROPERTY_ID}/bookings`, {
  method: "POST",
  headers: { "Idempotency-Key": crypto.randomUUID() },
  body: JSON.stringify({
    checkIn: "2026-03-10", checkOut: "2026-03-12", roomTypeId: options[0].id, adults: 2, children: 0,
    guest: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+44 7700 900000" },
  }),
});
console.log(booking.confirmationNo);
```

---

## 6. Changelog

- **v1 (2026-09-06)** — initial release: properties, property details, availability,
  quote, bookings, booking lookup.
