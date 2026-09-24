# Booking API: Excursions & Spa — plan

> Status (2026-09-23): **ALL PHASES (0–6) DONE** on branch `feat/booking-api-addons` — see the
> "as built" sections below, which record every deviation from the original plan further
> down. Open follow-ups are listed at the end of "Phases 2–6 as built". This extends the Website API
> (`WEBSITE_API_PLAN.md`) so a property's own website can sell Excursions and Spa
> treatments, using the same `wsk_` key.

## Owner's brief (2026-09-23)

- Excursion and Spa are paid add-ons, enabled per enterprise (`EnterpriseAddonAccess`).
  Customers who have them want guests to book excursions and spa treatments on the
  property's own website.
- The same API key must work for Website (rooms), Excursions and Spa, as long as the add-on
  is enabled for that enterprise.
- Anyone can book. A booking is **never linked** to a room reservation, not even for a
  staying guest.
- Payment is the customer's business. Their site takes payment through its own gateway,
  then sends us the booking. We do not integrate a payment provider.
- **There is no approval step.** A booking is accepted immediately whenever capacity
  allows, and refused otherwise. The app has no pending state and staff never confirm.
- Guests may cancel their own booking up to a cutoff.
- Expose as much of the app's model through the API as possible. **Expose nothing that the
  app itself does not support.** The API is a window onto the app, not a second
  booking engine.
- Add a public docs portal at `/docs/api`
  (`https://stay.uppsolut.com/docs/...`; locally `http://localhost:3000/docs/...`).
  The portal must contain no secrets and nothing sensitive.

## Decisions

| # | Decision |
|---|---|
| B-1 | **One key, scoped.** Add `WebsiteApiKey.scopes String[]` with values `ROOMS`, `EXCURSIONS`, `SPA`. The migration gives every existing key `["ROOMS"]`. Every request checks three things live: the key has the scope, the enterprise add-on is enabled right now, and the property has the module switched on for online sale. Turning an add-on off in `/osta` therefore stops the API immediately. |
| B-2 | **Same base path, `/api/website/v1`.** The changes are additive only, which the v1 contract already allows. The docs present the whole thing as the "Uppsolut Stay Booking API", with Rooms, Excursions and Spa sections. |
| B-3 | **Instant confirmation only.** A booking is CONFIRMED or refused (`SOLD_OUT` / `SLOT_UNAVAILABLE` / …). There is no PENDING state and no staff queue. |
| B-4 | **Hold → pay → confirm.** An optional short hold (default 10 min, set per property) reserves the seats or the slot while the site takes payment. It keeps "charged, then sold out" to a minimum. A hold that expires frees the capacity with no staff action. |
| B-5 | **Server-side pricing only.** The site sends IDs and headcounts. It sends back `expectedTotal`, and if the server price differs the booking is refused with `409 PRICE_CHANGED`. |
| B-6 | **Paid bookings settle the folio.** A standalone walk-in folio is created with the charge posted through `postCharge`. When `payment.status = PAID`, a payment is posted to the property's "Online prepaid" payment charge code, set in the Hub, so the folio is 0 and revenue reports are right. When `payment.status = UNPAID` (pay at venue), the folio stays open with a balance and the desk note says so. If the paid amount does not match the total, the booking is still accepted and flagged for the desk. |
| B-7 | **Guest self-cancel before the cutoff.** Excursions use `ExcursionType.cutoffHours`; Spa uses `SpaSettings.cancellationCutoffHours`. Cancelling voids the charge. If the booking was paid, the response says `refundRequired: true`, because the refund happens in the customer's own gateway. |
| B-8 | **Status changes are delivered by webhook, and lookup also works.** A booking can change at the desk after it is made: a departure cancelled for weather, bookings moved, a no-show, completion. Sites can poll the lookup endpoint. They can also register a signed webhook (see §6). The platform never emails the guest for API bookings; the site does, the same as for rooms. |
| B-9 | **Spa never exposes therapist identity.** Only the preferences the app models are exposed: gender preference and party size. Room and therapist assignment is automatic (`allowAutoAssignment`). |
| B-10 | **Browser-origin keys may not book Excursions or Spa.** A key embedded in page source could post "PAID" bookings for free. Keys with `allowedOrigins` get read-only catalogue and availability scopes for these modules. Writes must go server-to-server. The Hub enforces this. |
| B-11 | **Public, unguessable references**, such as `EXC-7K3QX9` / `SPA-M2P8RD` (random base32, never sequential). Lookup and cancel need the reference **and** the booking email. |

## Phase 0 as built (2026-09-23)

| Item | Where | Notes vs the plan below |
|---|---|---|
| Booking services | `src/lib/excursion-booking.ts`, `src/lib/spa-booking.ts`, `src/lib/booking-error.ts` | Flat file names (the repo's `spa-*.ts` convention), not `excursions/booking.ts`. Routes are thin; `BookingError.code` is the future public code. |
| DB locks | `src/lib/db-lock.ts` | Also applied to whole-departure cancel and move-bookings, which had the same race. |
| Spa lifecycle | `src/lib/spa-lifecycle.ts`, `api/spa/appointments/[id]/{check-in,start,complete,cancel,no-show}` | `SpaAuthority` passes override/void rights explicitly, so the API's system actor can use it. No UI yet (Phase 4). |
| Void helper | `src/lib/posting/void-charge.ts` | **Found and fixed:** voids now reverse the generated service/GST lines too. |
| System actor | `src/lib/system-actor.ts`, `User.isSystem` | Its cashier shift is the normal per-(user, property) shift, closed by End-of-Day like any other. |
| Rate limits | `src/lib/website-api/rate-limit.ts`, `ApiRateLimitCounter`, Caddy `bookingapi` zone | **Postgres-backed, not in-memory**: production runs several app replicas (`deploy/proxy/Caddyfile`), so a per-process counter would multiply every limit. |
| Tests | `tests/business-rules/booking-api-foundations.test.ts` | Last-seat race, void cascade, lifecycle and fees, system actor, rate limits. |

## Phase 1 as built (2026-09-23)

| Item | Where | Notes vs the plan below |
|---|---|---|
| Schema | migration `20260923120000_booking_api_scopes_and_activity_settings` | `WebsiteApiKey.scopes` (existing keys → `["ROOMS"]`). **One** `ActivityOnlineSettings` model keyed `(propertyId, module)` instead of two near-identical models. The prepaid "charge code" became `onlinePaymentMethodId` — payments settle through a PaymentMethod (`resolvePaymentChargeCodeId`), not a bare charge code. |
| Scopes | `src/lib/website-api/scopes.ts` | `requireScope` → `403 SCOPE_NOT_GRANTED` (via `websiteRoute`). Rooms availability/quote/bookings/lookup need `ROOMS`; `/properties` and `/properties/{id}` answer any scope. Add-on scopes are granted only while the add-on is enabled; a key keeps one whose add-on was later switched off (refused live instead). |
| Discovery | `GET /properties/{id}` → `modules: { rooms, excursions, spa }` | `{ enabled, code, reason }`. Excursions/Spa check, in order: scope, add-on, `ActivityOnlineSettings.enabled`, hub-wide outlet linked, something published. Public reasons stay generic (no commercial detail). |
| Online settings | `src/lib/website-api/activity-settings.ts`, `api/hub/website/activities[/propertyId]`, `api/hub/website/activity-items/[id]` | **Per-item publishing lives in the Hub, not the Controls editors** (deviation from the plan): same precedent as `Allocation.publishToApi` — distribution is the Hub's job under INTEGRATIONS; what an item IS stays in Controls. A spa treatment closed to walk-ins can't be published (online guests are walk-ins, B-8 answer). |
| Hub UI | `src/components/hub/website-api-keys.tsx` ("May use" checkboxes, scope badges), `src/components/hub/website-activity-settings.tsx` (new "Excursions & Spa" tab, shown only with an add-on) | Nav renamed "Website API" → "Booking API". B-10 (browser keys can't book activities) is warned about in the key dialog; enforced in the Phase 2/3 write routes. |
| Tests | `tests/business-rules/booking-api-scopes.test.ts` (10) | |
| Docs | Written into the portal in Phase 6; OpenAPI also had 3 pre-existing YAML errors fixed | |

## Phases 2–6 as built (2026-09-23)

| Phase | Where | Notes vs the plan below |
|---|---|---|
| 2 Excursions API | `src/lib/website-api/excursions.ts`, `activity-common.ts`, `activity-bookings.ts`; routes under `api/website/v1/properties/[propertyId]/excursions/**` and `api/website/v1/activity-bookings/**` | **Holds live in `ApiActivityBooking` (status HELD), not as HELD `ExcursionBooking` rows** — the manifest only ever shows real bookings and `ExcursionBooking.folioId` stays required. Held seats count against capacity for desk and web alike (`occupiedSeats`). Quotes run the real `postCharge` in a rolled-back transaction (`src/lib/posting/preview-charge.ts`), so quote == posting. Online guests are `NEW_WALK_IN` guests whose bill is opened inside the booking transaction. Cancellation moved into `cancelExcursionBooking`. |
| 3 Spa API | `src/lib/website-api/spa.ts`; `createSpaAppointment` gains `newWalkIn`, `hold`, `forceChargeAtBooking`, `onCreated`; `confirmSpaHold`, `quoteSpaTreatment`, `expireStaleSpaHolds` | A spa hold is a real TENTATIVE `SpaAppointment` (therapist + room assigned) blocking until `SpaAppointment.holdExpiresAt`. **Online bookings always post at booking**, even under `chargeTiming = AT_COMPLETION`. `expectedTotal` is checked against the actual posting inside the transaction. Slot listing moved into `spa-availability.ts`. |
| 4 Operations UI | `src/components/front-office/spa-appointment-sheet.tsx` (lifecycle actions), Online markers in `spa-schedule.tsx` and `excursion-manifest-panel.tsx`, Hub "Online bookings" tab (`src/lib/website-api/online-bookings.ts`) | The Spa lifecycle UI (check-in / start / complete / no-show / cancel) closes the Phase 0 gap. The list merges `WebsiteBooking` and `ApiActivityBooking`, failed and expired included. |
| 5 Webhooks | `src/lib/website-api/webhooks.ts`, `src/lib/booking-events.ts`, `ApiWebhookEndpoint` / `ApiWebhookDelivery`, jobs `booking-api-webhooks` and `booking-api-hold-sweep` | Endpoints per key (max 5), secret encrypted at rest (`secret-crypto.ts`), HMAC `v1=` over `timestamp.body`, lease-claimed attempts, backoff ~1 day, SSRF guard at save and send. Emitted after commit from the shared services and desk routes; loaded lazily to avoid an import cycle. **Excursion and Spa only** — room bookings don't emit webhooks yet. |
| 6 Docs portal | `src/app/docs/**` (15 pages), `public/docs/booking-api.openapi.yaml` (moved from `docs/website-api.openapi.yaml`), `scripts/docs-pdf.ts` → `public/docs/uppsolut-stay-booking-api-guide.pdf`, `src/lib/docs-check.ts` + `npm run docs:check` + `tests/business-rules/docs-check.test.ts` | **No MDX dependency**: pages are server components on a small docs kit (`src/app/docs/components.tsx`); no interactive OpenAPI viewer (the spec is downloadable). The old hand-made PDF used a real customer as its example and was removed; the examples use "Coral Bay Resort" and example.com. `docs/WEBSITE_API.md` / `PROPERTY_WEBSITE_GUIDE.md` are now pointers to the portal. |

**Tests added across phases:** `booking-api-foundations` (14), `booking-api-scopes` (10),
`booking-api-excursions` (12), `booking-api-spa` (9), `booking-api-webhooks` (5),
`docs-check` (3).

**Open follow-ups**
- Room bookings: no webhooks, no guest self-cancel, and the last-room race is still
  unguarded (the advisory-lock pattern in `db-lock.ts` would close it).
- Login rate limiter (`src/lib/login-rate-limit.ts`) is still in-memory across replicas.
- A hold can't be released early by the website (it simply expires) — a
  `POST /activity-holds/{id}/release` would free seats faster when a payment fails.
- Webhook deliveries are pruned by nobody yet; add retention to the hold-sweep job if the
  table grows.
- Interactive API reference (Scalar/Redoc) on the portal, if wanted.

## Prerequisites (Phase 0) — gaps found in the current code

1. **Spa lifecycle is missing.** Only create and read exist. Build a shared
   `src/lib/spa/lifecycle.ts` with cancel (voiding the charge, honouring the late-cancel fee
   settings), check-in, complete (posting `AT_COMPLETION`) and no-show. Both the desk and
   the API use it.
2. **Booking logic lives in route handlers.** Extract `createExcursionBooking` from
   `api/excursions/bookings/route.ts` and `createSpaAppointment` from
   `api/spa/appointments/route.ts` into `src/lib/excursions/booking.ts` and
   `src/lib/spa/booking.ts`. Desk and API then share one code path, as `createReservation`
   does for rooms.
3. **Concurrency guards are single-process only.** The excursion capacity check is
   count-then-write, and `spa-resource-lock.ts` is an in-memory mutex. Replace both with
   Postgres `pg_advisory_xact_lock(hashtext(key))` inside the booking transaction, and
   recheck inside the lock. This also makes the desk safe on more than one instance.
4. **No actor for system bookings.** `bookedByUserId` and `ensureOpenShift` need a user.
   Add one non-login system user per enterprise ("Online Bookings") and a per-property
   system cashier shift, so reports and the activity log attribute API revenue cleanly.
5. **No rate limiting.** Add a per-key and per-IP limiter covering all `/api/website/v1`
   routes, rooms included (an open TODO), using `login-rate-limit.ts` as the pattern.
   Suggested limits: 120 reads/min and 20 writes/min per key, plus a cap on active holds per
   key and per guest email. Over the limit, return `429 RATE_LIMITED` with `Retry-After`.

## Data model

| Change | Purpose |
|---|---|
| `WebsiteApiKey.scopes String[] @default(["ROOMS"])` | B-1 |
| `ApiActivityBooking`: `enterpriseId`, `propertyId`, `keyId`, `module` (EXCURSION\|SPA), `publicRef @unique`, `idempotencyKey`, guest first/last/email/phone, `paymentStatus`, `paymentProvider`, `paymentReference`, `paymentAmount`, `paymentCurrency`, `amountMismatch`, `status` (HELD\|CONFIRMED\|FAILED\|CANCELLED\|EXPIRED), `holdExpiresAt`, `excursionBookingId?`, `spaAppointmentId?`, `requestIp`, timestamps; `@@unique([keyId, idempotencyKey])` | Audit, idempotency, holds, lookup (mirrors `WebsiteBooking`) |
| `ExcursionOnlineSettings` / `SpaOnlineSettings` (per property): `enabled`, `holdMinutes`, `leadHours`, `maxPartySize`, `prepaidPaymentChargeCodeId`, `deskRemark`, `policies` | Hub → Properties |
| `ExcursionType` + `SpaTreatment`: `publishOnline`, `publicDescription`, `imageUrls[]`, `inclusions?` | Per-item control |
| `ExcursionBooking`: status `HELD`, `holdExpiresAt`, `folioId` nullable while HELD, `source` (DESK\|API) | Holds count against capacity until they expire |
| `SpaAppointment`: `holdExpiresAt`; `source = "WEBSITE_API"`; blocking logic uses `holdExpiresAt` instead of `createdAt + tentativeHoldMinutes` | Holds |
| `ApiWebhookEndpoint` (per key): `url`, `secretHash` + encrypted secret, `events[]`, `status`; `ApiWebhookDelivery` log | B-8 |

## API surface (all under `/api/website/v1`, all scoped to the key's properties)

**Discovery**
- `GET /properties/{id}` gains `modules: { rooms, excursions, spa }`, each with
  `{ enabled, reason, policies, holdMinutes, cancelCutoffHours }`. The site renders only the
  sections that are actually live, which is what keeps the API dynamic.

**Excursions**
- `GET /properties/{id}/excursions`: published types. Returns `pricingMode`
  (PER_PERSON\|FLAT), current adult/child/infant or flat price, description, images and
  inclusions.
- `GET /properties/{id}/excursions/departures?from&to[&typeId]`: date, time, meeting time and
  point, `seatsLeft`, `capacity`, `minCapacity` (as `guaranteed: bookedHeadcount >= minCapacity`),
  `bookable`, `bookingClosesAt`. The window is capped (62 days).
- `POST /properties/{id}/excursions/quote` `{departureId, adults, children, infants}` → total, tax
  lines, service charge. Uses the same tax engine as `postCharge`.
- `POST /properties/{id}/excursions/holds` → `{holdId, publicRef, expiresAt, quote}`
- `POST /properties/{id}/excursions/bookings`

**Spa**
- `GET /properties/{id}/spa/treatments`: categories with their treatments. Each has
  duration, price, `pricingMode`, `maxParticipants`, and `genderPreferenceOffered`. Only
  treatments with `allowWalkIn` and `publishOnline` are included.
- `GET /properties/{id}/spa/availability?treatmentId&date[&to]&partySize[&gender]`: free
  start times from `isSlotFeasible`. Never returns rooms or therapists.
- `POST /properties/{id}/spa/quote`, `POST /properties/{id}/spa/holds`,
  `POST /properties/{id}/spa/bookings`

**Shared**
- The bookings body is `{holdId? | slot fields, guest{firstName, lastName?, email, phone?},
  payment{status: PAID|UNPAID, provider?, reference?, amount?, currency?}, expectedTotal,
  remarks?}`. The `Idempotency-Key` header is required. The response is `201` CONFIRMED,
  or `200 replayed: true` on a retry.
- `GET /activity-bookings/{publicRef}?email=`: live status (CONFIRMED\|CANCELLED\|COMPLETED\|
  NO_SHOW). A moved excursion booking resolves to its new departure.
- `POST /activity-bookings/{publicRef}/cancel` `{email, reason?}`: allowed only before the
  cutoff.

**New error codes**
- `SCOPE_NOT_GRANTED` (403)
- `MODULE_NOT_ENABLED` (409)
- `EXCURSION_NOT_FOUND` / `DEPARTURE_NOT_FOUND` / `TREATMENT_NOT_FOUND` (404)
- `DEPARTURE_CLOSED`, `SOLD_OUT`, `SLOT_UNAVAILABLE`, `BOOKING_CUTOFF`, `HOLD_EXPIRED`,
  `PRICE_CHANGED`, `CANCEL_CUTOFF_PASSED`, `ALREADY_CANCELLED` (409)
- `PARTY_TOO_LARGE` (400)
- `RATE_LIMITED` (429)

## Booking pipeline

```
discover modules → catalogue → availability → quote → hold (optional, recommended when prepaying)
  → [site takes payment in its own gateway]
  → POST booking (holdId, payment, expectedTotal, Idempotency-Key)
      in ONE transaction, under advisory lock(s):
        recheck scope + add-on + module + item published
        recheck capacity / slot feasibility (holds count)   → SOLD_OUT / SLOT_UNAVAILABLE
        re-price, compare expectedTotal                      → PRICE_CHANGED
        walk-in folio (system user) → postCharge → payment if PAID
        ExcursionBooking / SpaAppointment (CONFIRMED, source API)
        ApiActivityBooking CONFIRMED + activity log
  → site shows publicRef and emails the guest
  → later: guest cancel (before cutoff) | desk changes → webhook + lookup
```

## Security checklist

- Reuse the key model. Only the hash is stored; a missing, unknown, revoked or expired key
  always gets the same 401; a property the key does not cover gets 404, never 403; keys are
  never accepted in URLs.
- Scopes plus live add-on and module checks on every request (B-1). Browser keys are
  read-only for these modules (B-10).
- Rate limits and a hold cap (Phase 0 §5). Holds expire on their own, so nobody can lock up
  a spa day.
- Database advisory locks (Phase 0 §3). Idempotency is scoped per key.
- Server-computed prices, `expectedTotal`, and payment-mismatch flagging (B-5, B-6).
- Lookup and cancel need the reference and the email. References are unguessable (B-11).
- All responses are `Cache-Control: no-store`. Personal data is never logged. Bodies are
  validated with zod and have length limits.
- Webhooks:
  - The secret (`whsec_`) is shown once.
  - Signature is `HMAC-SHA256` over `timestamp.body`. The request carries
    `X-Uppsolut-Signature` and `X-Uppsolut-Timestamp`, and receivers reject anything more
    than 5 minutes old.
  - HTTPS only. The URL is refused if it resolves to a private or loopback address
    (SSRF guard).
  - Retries back off exponentially. Every delivery is logged in the Hub.
- The activity log covers every key, scope, settings and webhook change.

## Hub / Controls / Front desk

- **Hub → "Booking API"** (renamed from "Website API"):
  - The key dialog gets scope checkboxes. A scope is disabled, with a reason, when its
    add-on is off or the key is browser-origin.
  - The Properties tab gets Excursions and Spa online sections.
  - A new **Online bookings** tab lists every API booking across rooms, excursions and spa,
    including FAILED and EXPIRED. This also closes the Website API TODO.
  - A new **Webhooks** section.
- **Controls:** the excursion-type and treatment editors get `publishOnline`, public
  description, images and inclusions.
- **Front desk:** an "Online" badge on the excursion calendar, manifest and spa schedule;
  the payment reference and any mismatch flag appear on the booking.

## Docs portal (`/docs`)

- **Public routes.** Add `/docs` to the public paths in `src/proxy.ts`.
  - `/docs` is the landing page.
  - `/docs/api` has `getting-started`, `authentication`, `rooms`,
    `excursions`, `spa`, `webhooks`, `errors`, `rate-limits`, `changelog` and `go-live`.
  - Admin guides now live under `/docs/configuration`, staff guides under `/docs/operations` (2026-09-24; old `/docs/guides/*` redirects).
- **Source.** MDX pages in the repo (`@next/mdx`), themed like the `/info` marketing site.
  They have sidebar navigation, a copy button on code blocks and a page table of contents.
- **One OpenAPI file**, `docs/booking-api.openapi.yaml`, with tags Rooms, Excursions, Spa
  and Webhooks. It is rendered as an interactive reference and can be downloaded.
  `website-api.openapi.yaml` stays as an alias.
- **PDFs** are generated from the same pages with Playwright (`npm run docs:pdf`). Today's PDF
  is built outside the repo and can drift from the code.
- **Sensitive-content rules**, enforced by a `docs:check` script that fails the build:
  - Examples use a fictional property ("Coral Bay Resort", `example.com` domains,
    `+960 000 0000`). **The current guide uses a real customer's name (Veyo) and must be
    replaced.**
  - Keys and secrets appear only as placeholders (`wsk_…`, `whsec_…`). The scanner rejects
    `wsk_[0-9a-f]{64}`, `whsec_\w{20,}`, real hostnames other than
    `stay.uppsolut.com`/`localhost`, internal file paths, `.agents/` content, env var values
    and staff emails.
  - The docs describe the public contract only. No stack details, internal model names,
    infrastructure or internal error messages.

## Build order

| Phase | Scope |
|---|---|
| 0 | Foundations: extract services, spa lifecycle, advisory locks, system actor and shift, rate limiter |
| 1 | Schema migration, key scopes, Hub scope UI, per-property and per-item online settings |
| 2 | Excursions API (catalogue, departures, quote, hold, book, lookup, cancel) |
| 3 | Spa API (same set, on `spa-availability.ts`) |
| 4 | Operations UI: Online badges, Hub Online bookings tab |
| 5 | Webhooks (endpoints, signing, delivery and retry, Hub log) |
| 6 | Docs portal, merged OpenAPI, generated PDFs, `docs:check`, replace the Veyo examples |

## Tests (extend `tests/business-rules/`)

- Scopes, and an add-on switched off mid-life. The browser key write ban.
- Parallel requests for the last seat or the last therapist slot: exactly one wins.
- Hold expiry frees capacity. Idempotent replay. `PRICE_CHANGED`.
- Self-cancel before and after the cutoff. `refundRequired` when the booking was paid.
- An API booking and a desk booking produce identical folio lines. A PAID booking settles
  the folio to 0.
- A departure cancelled at the desk sends a webhook, and lookup shows CANCELLED.
- Webhook signatures verify. A private-IP webhook URL is refused.
- `docs:check` fails on a planted key.
