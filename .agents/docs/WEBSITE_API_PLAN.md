# Website API — plan, decisions and status

> Status (2026-09-06): **BUILT** — schema, public API, Hub management UI/API, tests and the
> external docs (`docs/WEBSITE_API.md`, `docs/PROPERTY_WEBSITE_GUIDE.md`,
> `docs/website-api.openapi.yaml`). Open items are listed at the bottom.

## What it is

Each property may have its own brand website — a "front" with the property's information
and a simple booking page. That site talks to this PMS through a key-authenticated public
API (`/api/website/v1/**`) to read property info, live availability and prices, and to
create bookings. Keys are enterprise-level objects managed in the **Hub** and each key
grants access to one or more of the enterprise's properties.

Owner's brief (2026-09-06): "the website is a front for each property with their
information and a simple booking page; it takes minimal guest information + stay details
required to make a booking, and availability must be synced; keys are made in the Hub and
can give access to one or more properties per enterprise; the property should be able to
build their own brand website from the API document."

## Where things are

| Concern | Location |
|---|---|
| Schema | `prisma/schema.prisma` → `WebsiteApiKey`, `WebsiteApiKeyProperty`, `WebsitePropertySettings`, `WebsiteBooking`; migration `20260906100000_website_api` |
| Key generation / hashing | `src/lib/website-api/key.ts` |
| Key resolution (the auth boundary) | `src/lib/website-api/resolve-key.ts` |
| HTTP plumbing, CORS, error shape | `src/lib/website-api/http.ts` |
| Public property shape | `src/lib/website-api/property.ts` |
| Availability + calendar prices | `src/lib/website-api/availability.ts`, `src/lib/website-api/rates.ts` |
| Quote + booking + lookup | `src/lib/website-api/booking.ts` |
| Request schemas (zod) | `src/lib/website-api/schemas.ts` |
| Hub management (keys, settings) | `src/lib/website-api/keys.ts`, `src/lib/website-api/settings.ts` |
| Public routes | `src/app/api/website/v1/**` |
| Hub routes | `src/app/api/hub/website/**` |
| Hub UI | `src/app/e/[slug]/hub/website/page.tsx`, `src/components/hub/website-api-keys.tsx`, `src/components/hub/website-property-settings.tsx` |
| Shared helpers extracted for this | `src/lib/reservations/system-context.ts`, `src/lib/profiles/resolve-guest-profile.ts` (both used to live inside `channels/inbound/convert.ts`) |
| Tests | `tests/business-rules/website-api.test.ts` (21) |
| External docs | `docs/WEBSITE_API.md`, `docs/PROPERTY_WEBSITE_GUIDE.md`, `docs/website-api.openapi.yaml` |

## Decisions

**W-1 — Keys live in the Hub, gated on INTEGRATIONS.** A website is an integration; the
people who manage the channel manager manage this. No new RBAC module — reusing
INTEGRATIONS avoids the module-registry churn (D-1 in the Hub plan) and keeps the Hub at
two modules. view = list, create = mint, update = edit/rotate/settings, delete = revoke.

**W-2 — One key, one or more properties.** `WebsiteApiKeyProperty` join. A key for one
hotel cannot see a sibling hotel; an id off the key's list answers **404, never 403**, so
keys cannot be used to enumerate a group's properties. Only ACTIVE properties resolve.

**W-3 — Hash at rest, shown once.** Same construction and reasoning as the channel
webhook token and the eRegistration link. `keyPrefix` (first 12 chars) is stored only as
a display label. Rotate = same row, new hash (history and properties stay attached).
Revoke = permanent, row kept for audit. Unknown / revoked / expired all answer the same
401 so a key's state cannot be probed.

**W-4 — Availability obeys D-7 word for word.** The website is the same class of external
publication as the channel push: actual inventory, clamped to 0, group holds withheld
until cutoff (TENTATIVE + DEFINITE, as `sync.ts` does), stop-sale reported as **closed**
not merely 0. Arithmetic is `perNightTypeAvailability()` — one definition shared with the
grid and the channel push.

**W-5 — The website can NEVER overbook.** Unlike channel conversion (which sets
`acknowledgeOverbook` because the OTA already confirmed the stay), the website is our own
storefront and has confirmed nothing, so a stay that no longer fits is refused with
`SOLD_OUT`. Same for `allowPastArrival`: not set. `createReservation` is still the single
service used — the website path adds pre-checks for specific error codes, never a second
copy of the rules.

**W-6 — Nothing is guessed about the rate plan.** `WebsitePropertySettings.ratePlanId` is
THE plan the site sells (mirrors `ChannelBookingDefaults`). No plan configured → the
property is listed with `booking.enabled: false` and a reason; it is never silently sold
on Base. Negotiated plans are refused. A stay with any unpriced night is refused
(`NO_RATE`) rather than confirmed at 0 — and so is an enterprise with no accommodation
charge code, which `computeReservationQuote` reports only as a warning.

**W-7 — Quote is authoritative; calendar price is the room rate only.** The availability
endpoint's nightly `price` mirrors `channels/rates.ts` resolution (own row → derived
parent + adjustment → Base). The amount a guest pays comes from
`computeReservationQuote` (taxes, service charge, Green Tax, allocations) via the quote
endpoint. Docs say so in several places.

**W-8 — Property marketing content lives beside the property, not on it.**
`Property` has no description/gallery (it was built for the desk); `WebsitePropertySettings`
carries headline, description, imageUrls, policies, plus the booking configuration. Hub
edits it (configuration, not operation — the Hub rule holds).

**W-9 — Every attempt is recorded.** `WebsiteBooking` mirrors `ChannelInboundBooking`:
one row per attempt, CONFIRMED or FAILED, what the guest typed, which key, quoted total.
`(keyId, idempotencyKey)` is the retry guard — same key replays the same booking. The
reservation carries `externalRef = WEB-xxxxxxxx` (first 8 of the audit row id) and a
"Booked via website" remark plus the Hub's desk note.

**W-10 — Server-to-server is the recommended topology; CORS is opt-in per key.**
`allowedOrigins` on the key. Preflight cannot see the key (browsers omit Authorization on
OPTIONS) so `websitePreflight` answers for an origin listed on ANY active key — that is
not authorization, the real request still needs a valid key. The one wrapper in the
codebase (`websiteRoute`) exists because CORS headers must land on every response
including thrown errors; session routes have no such need and keep their imperative
style.

**W-11 — No payment in v1.** Policies and the desk note carry the property's terms; the
guide lists three payment patterns the site can adopt on its own.

## Open items / follow-ups

- **Rate limiting** — none. A misbehaving site can hammer availability. A per-key token
  bucket in `resolveWebsiteApiKey` is the natural place.
- **Concurrency on the last room** — `createReservation`'s availability check is not
  transactional (same as the desk); two simultaneous website bookings can both pass.
  Low probability for a single property; a `SELECT … FOR UPDATE` on the room type or an
  advisory lock keyed on (propertyId, roomTypeId) would close it for every caller.
- **Guest email on website bookings** — the PMS does not email the guest; the site does
  (documented). Reuse of the confirmation-letter mail (`send-confirmation`) through the
  mail-sender is a small follow-up if properties want it.
- **Hub: website bookings list** — `WebsiteBooking` rows are only visible via the key's
  booking count. A read-only list (like Inbound Bookings) would let the Hub see FAILED
  attempts and their reasons.
- **Cancellation / modification endpoints** — deliberately not in v1; policies say to
  contact the property.
- **Multi-room bookings** — one room type per booking. A site wanting two rooms makes two
  bookings.
- **Image hosting** — URLs only; no upload. Fine for a site with a CDN; a future
  eRegistration-style upload could land here.
