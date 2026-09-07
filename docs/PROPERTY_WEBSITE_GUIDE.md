# Building a property website on Uppsolut Stay

A guide for whoever builds a property's own brand website: what the site is, how to get
it connected to the PMS, what pages to build, and how bookings and availability stay in
sync. The endpoint-by-endpoint reference is [`WEBSITE_API.md`](WEBSITE_API.md).

---

## 1. What you are building

A property website is a **front** for one property (or, for a group with one portal,
several):

1. **Property pages** — name, description, photos, location, contact details, check-in
   and check-out times, facilities, room types with their features.
2. **A booking page** — pick dates and guests, see which room types are free and what
   the stay costs, enter minimal guest details, confirm.
3. Optionally, **a "my booking" page** — confirmation number + email shows the stay.

Everything the site shows comes from the PMS through the Website API, so the property
maintains one set of facts: rates and stop-sales set at the desk are what the site sells;
a booking made on the site appears at the desk instantly as a normal reservation.

You bring the design, hosting, domain and any payment handling. The PMS provides content,
availability, prices and the booking itself.

---

## 2. Getting connected — the Hub

All configuration happens in the enterprise **Hub** (`/e/<enterprise>/hub`), the
enterprise-wide administration area. Property-level staff cannot reach it; an enterprise
administrator with the **Integrations** permission does this part.

### Step 1 — Set up the property for online sale

**Hub → Website API → Properties → Edit** for the property:

| Setting | What it does |
|---|---|
| Accept bookings from the website | Master switch. Off = the site can show the property but the booking form should be hidden. |
| Rate plan to sell | **Required for booking.** Every website reservation is made on this plan, priced from its Price Calendar (with the property's Base plan as the fallback for unpriced nights, the same as at the desk). Negotiated plans are not offered. |
| Meal plan | The plan every website reservation is made on, and the default when guests may choose. |
| Let guests choose their meal plan | Off: every booking uses the plan above. On: the site offers this property's active meal plans, with that one preselected. |
| Offer paid extras online | Off: the site sells rooms only. On: it may offer transfers, spa treatments and anything else marked **sell separately** in Allocations — the same list the front desk can add to a booking. |
| Minimum stay / Booking window | Website-only limits. The desk is not bound by them. |
| Note for the front desk | Added to the remarks of every website reservation — e.g. "Website booking: collect balance at check-in". |
| Headline, Description, Photo URLs, Policies | The marketing content the site displays. Photos are URLs you host (your site or a CDN). |

Until a rate plan is chosen, the API reports `booking.enabled: false` with a reason.

### Step 2 — Create an API key

**Hub → Website API → API Keys → New key**:

- **Name** — usually the website's domain (`www.hotel.com`).
- **Properties** — tick the property (or several, for one portal covering a group). The
  key can only see and book the properties ticked here.
- **Browser origins** — leave **empty** for the recommended server-to-server setup. Only
  fill it in if the site will call the API directly from the visitor's browser (see §4).
- **Expires** — optional.

Save, and **copy the key from the dialog immediately**. It is shown once. If it is lost,
use **Rotate** to issue a replacement (the old one stops working the moment you do).

Hand the key and the property id (from the API's `GET /properties`) to the website
developer through a secure channel — not email, not chat.

### Step 3 — Give the website its configuration

The site needs three values, kept as **server-side secrets/config** (environment
variables, a secrets manager), never in page source:

```
UPPSOLUT_API_BASE=https://<your-uppsolut-host>/api/website/v1
UPPSOLUT_API_KEY=wsk_…
UPPSOLUT_PROPERTY_ID=<id from GET /properties>
```

### Managing keys later

- **Edit** changes the name, properties, origins or expiry — not the key itself.
- **Rotate** issues a new secret on the same key. Do this on a schedule and whenever a
  developer leaves or a laptop is lost. Update the website's config promptly.
- **Revoke** is permanent; the site loses access immediately. Bookings it already made are
  untouched. Every create/rotate/revoke is written to the enterprise's activity log.

---

## 3. The pages, and which endpoints feed them

```
┌──────────────────┐   GET /properties/{id}          ┌──────────────────────┐
│  Property page   │ ◄───────────────────────────── │                      │
│  (home, rooms,   │                                 │                      │
│   location…)     │                                 │                      │
└──────────────────┘                                 │                      │
┌──────────────────┐   GET …/availability?from&to    │   Uppsolut Stay      │
│  Search / dates  │ ◄───────────────────────────── │   Website API        │
└──────────────────┘                                 │                      │
┌──────────────────┐   POST …/quote                  │   (server-to-server) │
│  Room + price    │ ◄───────────────────────────── │                      │
└──────────────────┘                                 │                      │
┌──────────────────┐   POST …/bookings               │                      │
│  Guest details   │ ─────────────────────────────► │  → real reservation  │
│  → confirmation  │ ◄───────────────────────────── │    at the desk       │
└──────────────────┘   { confirmationNo, quote }     └──────────────────────┘
```

### Property page(s)

`GET /properties/{id}` once per render (cache it for a few minutes). Use:

- `name`, `headline`, `description`, `imageUrls` (first one is the hero), `logoUrl`,
  `brandColor`, `starRating`;
- `address`, `location` (map pin), `contact`;
- `checkInTime`, `checkOutTime`, `policies` — put these on the booking page too;
- `facilities` — the property-level list;
- `roomTypes[]` — one card each: `name`, `description`, `maxOccupancy`, `features[]`
  (already labelled — `Ocean view`, `King bed`). Do **not** show `totalRooms` as
  availability; it is how many rooms exist, not how many are free.
- `booking.enabled` — if false, hide the booking form and show `booking.reason` or a
  "contact us" line.

### Search (dates and guests)

Build the picker off `businessDate` from the property (the earliest check-in) and
`booking.maxNightsAhead` (the latest check-out). Then:

`GET /properties/{id}/availability?from=<checkIn>&to=<checkOut>`

For each room type, `bookable` says whether it can be booked for these exact dates,
`minAvailable` how many rooms are left ("Only 2 left"), and `roomRateTotal` the sum of
nightly room rates. A night with `closed: true` is a stop-sale; a night with
`price: null` has no rate — both make the type unbookable for that search.

To grey out days in a calendar, request a whole month (max 62 nights per call) and mark
nights where every room type has `available: 0` or `closed: true`.

### Meal plans and extras (optional)

Both are off until an administrator switches them on, so `booking.mealPlans` and
`booking.addOns` are often empty. Build for that.

- If `booking.mealPlanSelectable` is true, offer `booking.mealPlans` with the default
  preselected. `booking.mealPlanAffectsPrice` tells you whether the choice changes the
  total — some properties price per person off the meal plan, others carry the price in
  the rate plan and treat it as a label. Do not imply a cost that is not there.
- `booking.addOns` are paid extras with **no price attached**, because what one costs
  depends on the party, the length of stay and whether it is charged nightly or once on
  arrival. Show them as tick boxes, send the ids to the quote, and display the lines the
  quote returns.
- Re-quote whenever the guest changes either. The quote's `allocations` array itemises
  everything, with `source: "MANUAL"` marking the extras they chose so you can render them
  as removable.

### Room and price

Before showing the price of a specific room type for the chosen dates and guests, call
`POST /properties/{id}/quote`. The `quote.totals.grandTotal` is the figure to display —
it includes taxes, service charge, Green Tax and any package components, exactly as the
desk would charge. The availability endpoint's nightly `price` is the bare room rate
and must not be presented as the total.

Show `pricesIncludeTaxes` honestly ("includes 16% TGST" vs "+ taxes"); `taxLines`
gives the breakdown.

If `quote.available` is false, the stay cannot be booked right now — disable the button.

### Guest details and confirmation

Collect the **minimum**: first name, last name, email, phone (optional), free-text
remarks (optional). Send `mealPlanCode` and `addOnIds` exactly as you quoted them — the
booking validates both the same way, so quoting one thing and booking another is refused
rather than silently repriced. Then:

`POST /properties/{id}/bookings` with an `Idempotency-Key` header (a fresh UUID per
attempt; reuse it on retry).

On `201`, show `confirmationNo`, the dates, the room type, the guest name, the
`quote.totals.grandTotal`, check-in/out times and the policies, and email the same to the
guest. On `409 SOLD_OUT` the last room went while the guest was typing — send them back
to the dates step with a friendly message. On `400 VALIDATION` map `details` onto your
form fields.

The reservation is now at the property's front desk with status **Reserved**, on the
configured rate plan and meal plan, remarks "Booked via website (ref WEB-…)", the Hub's
desk note, and the guest's remarks. The guest profile is matched by email, so a returning
guest keeps their history.

### "My booking" (optional)

`GET /bookings/{confirmationNo}?email=…` — only for bookings this key made, and only with
the matching email. Shows the live status. There is no self-service cancellation in v1;
say how to cancel in `policies`.

---

## 4. Keeping availability in sync

There is nothing to sync. Every call reads the PMS's live state:

- **Rooms held** by other reservations (from any source — desk, channel manager,
  website), rooms **out of order**, and rooms **held by group blocks until their cutoff**
  are already subtracted from `available`.
- **Stop-sales** set by the property show as `closed`.
- **Prices** come from the Price Calendar of the plan configured in the Hub.
- **Overbooking allowance is never published.** `available` is real inventory and never
  goes below zero. The desk may deliberately overbook; the website cannot.

A booking is checked again at the moment of creation, not just at quote time. Two
visitors racing for the last room: the second gets `SOLD_OUT`. Design the flow to
tolerate that (always call quote right before showing the final price, always handle
`SOLD_OUT` on booking).

What the site should **not** do:

- keep its own copy of availability or prices;
- add up nightly prices to make a total (use the quote);
- retry a failed booking with a **new** `Idempotency-Key` — that is how a guest ends up
  with two reservations.

---

## 5. Architecture options

### A. Server-to-server (recommended)

```
Browser ──► your site's backend ──► Website API
            (holds the key)
```

Any stack works: Next.js route handlers / server components, Nuxt server routes, a PHP
or Laravel controller, WordPress with a small plugin, a Cloudflare Worker, a serverless
function. The key sits in the backend's environment. Leave **Browser origins** empty in
the Hub.

### B. Browser-direct (static sites only)

```
Browser (holds the key) ──► Website API
```

Add your site's origin(s) to the key in the Hub. The API answers CORS preflight for those
origins. Accept that the key is visible to anyone who reads your page source: they can
read your availability and create reservations. Mitigate by restricting the key to the
one property, setting an expiry, and rotating regularly. If in doubt, choose A.

### Payment

The API does not take payment. Options, in increasing complexity:

1. **Pay at the property.** Write it in `policies` and the desk note. Simplest.
2. **Deposit link after booking.** Book first, then send the guest a payment link from
   your own provider; note the reference in your records.
3. **Pay before booking.** Take payment on your site, then create the booking with the
   payment reference in `remarks`. Handle the (rare) `SOLD_OUT` after payment with a
   refund flow.

Whatever you choose, the desk sees your note on every reservation, so nothing is
ambiguous at check-in.

---

## 6. Going live checklist

- [ ] Property configured in the Hub: rate plan chosen, meal plan, min stay, window,
      desk note, headline, description, photos, policies.
- [ ] Price Calendar filled for the plan across the booking window (check with the
      availability endpoint for any `price: null` nights).
- [ ] Key created for the exact properties needed; origins empty (server-to-server) or
      set to the real domains only.
- [ ] Key stored as a server secret; not present in any client bundle or repository.
- [ ] Booking flow: quote → book with `Idempotency-Key` → retry with the same key on
      timeout → `SOLD_OUT`/`STOP_SALE`/`NO_RATE`/`VALIDATION` all handled.
- [ ] Test booking made and found at the front desk under Reservations, with the
      "Booked via website" remark, then cancelled by the desk.
- [ ] Guest confirmation email sent by your site (the PMS does not email guests on a
      website booking).
- [ ] Someone owns key rotation and knows where to revoke.

---

## 7. Where things live in the PMS (for the property's own staff)

- **Hub → Website API → API Keys** — keys, last used, booking counts, rotate/revoke.
- **Hub → Website API → Properties** — what each property shows and sells online.
- **Reservations** — website bookings appear like any other, remarks start with
  "Booked via website (ref WEB-…)"; search by the confirmation number or the WEB reference.
- **Profiles** — guests created by the website are ordinary guest profiles.
- **Hub → Activity log** — every key created, rotated or revoked, and every settings
  change.
- **Controls → Revenue → Price Calendar / Availability → Stop-Sale** — what the site
  sells and when it is closed. No website-specific screens: the desk's truth is the
  site's truth.
