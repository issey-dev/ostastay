# Master Plan v3 — Excursions Booking (sellable per-property add-on)

> **Status legend**: ✅ done · 🚧 in progress · ⬜ not started
> **Overall**: **All six phases ✅ done (2026-07-22)** — schema, `PropertyModuleAccess`
> add-on mechanism, RBAC module + permission split, Controls catalog management,
> in-house and walk-in booking, manifest/cancellation/no-show, whole-departure
> cancellation with auto-suggested replacement + one-click move, and finally automated
> test coverage + seed data. See [TODO.md](TODO.md) for the detailed per-phase writeup
> and [DECISIONS.md](DECISIONS.md) for the business-rule summary. Four real corrections
> were made mid-build, every one found by live-testing against a real dev server rather
> than by reasoning alone: catalog management ended up gated by `CONTROLS` not
> `EXCURSIONS` (Phase 1); voiding a charge needed its own `CASHIERING` check (Phase 4);
> and Phase 5 alone surfaced two bugs live-testing didn't predict in advance — the
> replacement-departure suggestion initially matched a trip whose boat had already left
> *that same day* (date-only filtering missed the time-of-day), and nothing stopped the
> same cancelled booking from being "moved" twice.
> Plan authored 2026-07-22 via a design session with the app owner (see "Decisions
> confirmed" at the bottom — every fork below was an explicit owner call, not an
> assumption).

This document is the implementation plan for **Excursions Booking** — front-office-run
scheduling and selling of hotel-run activities (Snorkelling Trip, Island Hopping, Night
Fishing) to both in-house and walk-in guests. It is the first real feature built on top
of the new **`PropertyModuleAccess`** mechanism (also introduced by this plan) — Osta
sells and enables it per property, not per enterprise, distinguishing it from every
other module in the app today.

---

## Context — why this isn't just another Allocation or Outlet Appointment

Two existing features look adjacent but don't fit:

- **`Allocation`** (`.agents/docs/ALLOCATIONS_PLAN.md`) is a per-person priced component
  that only ever attaches to a *Reservation* and posts *only at Night Audit*, on the
  reservation's own stay nights. It has no concept of a one-off calendar date chosen by
  the guest, no headcount cap, and no walk-in support — it's built for recurring
  per-stay items (breakfast, transfers), not a scheduled trip with a seat limit.
- **`OutletAppointment`** (`Outlet.appointmentCapPerSlot`) is the closest scheduling
  precedent — it has the walk-in/reservation XOR identity pattern this plan reuses
  directly — but its capacity check is explicitly a *soft warning that never blocks*.
  That happens to match what the app owner wants for Excursions too (see "Decisions
  confirmed" #2), but Excursions still needs its own real capacity/scheduling model
  (`ExcursionDeparture`) since `OutletAppointment` has no template/recurrence or
  capacity field of its own beyond the single outlet-wide `appointmentCapPerSlot`.

Both are still the right models to imitate structurally — property-scoped catalog +
enterprise-wide `ChargeCode` + posting through the existing `Folio`/`FolioLineItem`
machinery — just not to build on top of directly.

## Architecture decisions

- **`ExcursionType` is property-scoped** (like `RatePlan`/`Allocation`/`Outlet`, unlike
  enterprise-wide `ChargeCode`) — trips, capacities, and prices differ per property; the
  linked `ChargeCode` stays enterprise-wide, same convention as Allocations/Outlets.
- **Hybrid scheduling**: `ExcursionSchedule` is a recurring template (days of week +
  time + capacity); a "Generate departures through [date]" Controls action expands it
  into `ExcursionDeparture` rows up to a chosen horizon, skipping dates that already
  have one for that schedule. Staff can also hand-add/edit/cancel an individual
  `ExcursionDeparture` — `scheduleId` is nullable so an ad-hoc departure never needs a
  template at all, and a later regenerate run never overwrites an already-existing or
  hand-edited instance.
- **Capacity is two independent soft warnings, never a hard block**: over `capacity`
  (booking still allowed, UI shows amber/red past the line) and under `minCapacity`
  ("at risk of not running" as the date approaches). Both computed **live** by counting
  non-cancelled `ExcursionBooking` headcounts against the departure — no stored counter
  that could drift, same technique `OutletAppointment` already uses for its own warning.
- **Pricing**: per adult/child/infant (`ExcursionRate`, dated, non-overlapping ranges —
  same rule as `AllocationRate`) by default, or a flat price per booking when
  `ExcursionType.pricingMode = FLAT` (e.g. a private charter). Infant is a real third
  price tier here (unlike Allocations, where infants are always free) since the app
  owner wants it to match guest expectations precisely rather than rely on a manual
  front-desk workaround.
- **Guest identity is XOR, in-house or walk-in** — `reservationId` OR
  `walkInGuestName`/`walkInGuestContact`, validated in the API route not the DB, same
  convention as `OutletAppointment`. Walk-ins are deliberately **not** promoted to a real
  `Profile` in v1 (matches the existing `/api/folios/walk-in` precedent) — free text
  only.
- **Billing always reuses the existing Folio/FolioLineItem/Payment machinery** — nothing
  parallel. In-house: post to the guest's already-open room folio (same as POS). Walk-in:
  open a bare walk-in `Folio` first (existing pattern), then either pay immediately and
  close it, or leave it open to settle later. This is also why excursion revenue needs
  zero new reporting work — it flows into every existing charge-code-based revenue
  report automatically.
- **Cancellation**: before `ExcursionType.cutoffHours` from departure time, any booking
  can be freely cancelled — the `FolioLineItem` is voided via the existing
  reason-required void flow. If it was already paid (closed walk-in folio), the actor
  must **explicitly** post a refund `Payment` (`isRefund: true`) — never automatic,
  matching how nothing else in this app auto-refunds either. Past cutoff, cancelling
  requires the `delete` action on `EXCURSIONS` (manager override), the same
  override-by-higher-permission pattern used elsewhere.
- **Whole-departure cancellation (weather) cascades**: every `CONFIRMED` booking on a
  cancelled departure flips to `CANCELLED` and is voided the same way as an individual
  cancellation (refunds still per-booking, not automatic). The system then looks for the
  next `SCHEDULED` departure of the same `ExcursionType` with room left and offers a
  one-click "move these guests there" — each moved booking becomes a **new**
  `ExcursionBooking` row with `movedFromDepartureId` set, rather than mutating the
  cancelled one, so the manifest history stays honest about what actually happened.
- **No-show** is marked from the manifest after the trip departs (`status: NO_SHOW`) —
  leaves the charge in place with no auto-refund (typical no-show policy), but doesn't
  hard-code that; a manager can still void+refund by hand if a property's policy differs.
- **Two permission gates, not one** — corrected from an earlier draft of this plan that
  conflated them:
  - **`CONTROLS`** (existing module): create/edit `ExcursionType`/`ExcursionRate`/
    `ExcursionSchedule`, run "generate departures." Same trust level as editing a
    `RatePlan` or `Outlet` today — catalog management is a Controls tab, not part of the
    operational module.
  - **`EXCURSIONS`** (new module): view the schedule/manifest, create/cancel/reschedule
    *bookings*. This is what Front Desk actually gets granted day to day.
  Every route additionally requires **`assertPropertyModuleAccess(ctx, propertyId,
  "EXCURSIONS")`** — see below.

### `PropertyModuleAccess` — the new add-on mechanism (built as part of this plan)

The app had per-*enterprise* module gating (`EnterpriseModuleAccess`/
`TierModuleAccess`, see `computeLicensedModules()` in `src/lib/scope.ts`) but nothing
per-*property*. Excursions is sold per property, so this plan adds the missing layer,
deliberately mirroring the enterprise-level mechanism field-for-field:

- **`PropertyModuleAccess`** `{propertyId, module, enabled}`, unique on
  `(propertyId, module)`. Unlike `EnterpriseModuleAccess` (defaults `true` — an override
  that force-*disables* an otherwise-enabled module), this defaults **`false`** — a
  property-level add-on is opt-in; a missing row means "not purchased."
- **Only Osta can toggle it** — `GET`/`PATCH /api/licenses/property-modules`, a
  near-exact copy of `src/app/api/licenses/enterprise-modules/route.ts`'s shape
  (`ctx.isInternal` required, `requirePermission(ctx, "CONTROLS", ...)`, tri-state where
  meaningful, `logActivity`-logged).
- **UI**: `/osta/properties/[id]/page.tsx` — this route doesn't exist yet (today
  `/osta/properties` is list-only), filling a real gap, using a
  `PropertyModuleAccessManager` component structurally identical to the existing
  `licensing-manager.tsx`.
- **Enforcement**: `assertPropertyModuleAccess(ctx, propertyId, module)` in
  `src/lib/scope.ts` — calls `assertPropertyAccess()` first, then checks the
  `PropertyModuleAccess` row. Called by every Excursions route in addition to (not
  instead of) `requirePermission()`.
- **Sidebar**: `app-sidebar.tsx`'s filter needs the current property's enabled add-ons
  added alongside the existing enterprise-level `licensedModules` check, so the nav item
  only appears for a property that actually has the add-on.

This mechanism is generic — any future per-property add-on reuses it without further
schema work, using `EXCURSIONS` as the first real (non-hypothetical) consumer.

## Schema (new models)

```prisma
model PropertyModuleAccess {
  id         String   @id @default(uuid())
  propertyId String
  property   Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  module     String
  // Defaults false (opt-in add-on), unlike EnterpriseModuleAccess's true — see the
  // "PropertyModuleAccess" section above.
  enabled    Boolean  @default(false)
  updatedAt  DateTime @updatedAt

  @@unique([propertyId, module])
}

model ExcursionType {
  id           String   @id @default(uuid())
  propertyId   String
  property     Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  code         String   // SNORK, ISLE, NFISH...
  name         String   // "Snorkelling Trip"
  description  String?
  chargeCodeId String
  chargeCode   ChargeCode @relation(fields: [chargeCodeId], references: [id])
  // PER_PERSON: headcount x the active ExcursionRate. FLAT: ExcursionRate.flatPrice
  // regardless of headcount (e.g. a private charter).
  pricingMode  String   @default("PER_PERSON")
  // Hours before a departure's start time a booking can still be freely cancelled —
  // see the cancellation policy above. Past this window, cancelling requires the
  // "delete" action on EXCURSIONS (manager override).
  cutoffHours  Int      @default(24)
  isActive     Boolean  @default(true)

  rates      ExcursionRate[]
  schedules  ExcursionSchedule[]
  departures ExcursionDeparture[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([propertyId, code])
}

model ExcursionRate {
  id              String        @id @default(uuid())
  excursionTypeId String
  excursionType   ExcursionType @relation(fields: [excursionTypeId], references: [id], onDelete: Cascade)
  adultPrice      Float         @default(0)
  childPrice      Float         @default(0)
  infantPrice     Float         @default(0)
  // Only meaningful under pricingMode = FLAT; null under PER_PERSON.
  flatPrice       Float?
  effectiveFrom   DateTime
  effectiveTo     DateTime?  // null = open-ended; ranges must not overlap (API-validated, same rule as AllocationRate)
}

model ExcursionSchedule {
  id              String        @id @default(uuid())
  excursionTypeId String
  excursionType   ExcursionType @relation(fields: [excursionTypeId], references: [id], onDelete: Cascade)
  daysOfWeek      String   // comma-separated day codes, e.g. "MON,WED,FRI"
  departureTime   String   // "09:00" — when the trip actually leaves
  meetingTime     String?  // "08:45" — when guests must be ready, distinct from departureTime
  meetingPoint    String?  // "Main Jetty"
  capacity        Int
  // Soft "at risk of not running" flag only — see ExcursionDeparture below. Never
  // blocks or auto-cancels anything.
  minCapacity     Int?
  isActive        Boolean  @default(true)

  departures ExcursionDeparture[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model ExcursionDeparture {
  id              String        @id @default(uuid())
  excursionTypeId String
  excursionType   ExcursionType @relation(fields: [excursionTypeId], references: [id], onDelete: Cascade)
  // Null when hand-added rather than generated from a template (the "manual" half of
  // the hybrid scheduling model). A schedule regenerate never overwrites an existing
  // or hand-edited instance, generated or not.
  scheduleId String?
  schedule   ExcursionSchedule? @relation(fields: [scheduleId], references: [id])

  departureDate DateTime // date only; time kept separate below
  departureTime String
  meetingTime   String?
  meetingPoint  String?
  capacity      Int
  minCapacity   Int?

  status String  @default("SCHEDULED") // SCHEDULED | CANCELLED | COMPLETED
  notes  String?

  bookings          ExcursionBooking[] @relation("DepartureBookings")
  // Bookings that exist because THIS departure was cancelled and they were moved to a
  // replacement — see ExcursionBooking.movedFromDepartureId.
  movedBookingsAway ExcursionBooking[] @relation("MovedFromDeparture")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([excursionTypeId, departureDate, departureTime])
}

model ExcursionBooking {
  id          String             @id @default(uuid())
  departureId String
  departure   ExcursionDeparture @relation("DepartureBookings", fields: [departureId], references: [id])
  // Denormalized from departure -> excursionType -> property so every route can scope
  // by propertyId directly (assertPropertyAccess) without a multi-hop join — same
  // reasoning as Folio.propertyId.
  propertyId String
  property   Property @relation(fields: [propertyId], references: [id])

  // XOR guest identity, validated in the API route not the DB — same convention as
  // OutletAppointment.
  reservationId      String?
  reservation        Reservation? @relation(fields: [reservationId], references: [id])
  walkInGuestName    String?
  walkInGuestContact String?

  adultCount  Int   @default(1)
  childCount  Int   @default(0)
  infantCount Int   @default(0)
  // Snapshotted at booking time from the active ExcursionRate x headcount (or
  // flatPrice) — never recomputed later even if the rate changes afterward.
  totalAmount Float

  status String @default("CONFIRMED") // CONFIRMED | CANCELLED | COMPLETED | NO_SHOW

  // Billing always flows through the existing Folio/FolioLineItem/Payment machinery —
  // see "Billing" above. folioId is always set (either the guest's existing room folio,
  // or a fresh walk-in folio created for this booking).
  folioId         String
  folio           Folio          @relation(fields: [folioId], references: [id])
  folioLineItemId String?        @unique
  folioLineItem   FolioLineItem? @relation(fields: [folioLineItemId], references: [id])
  // Set only if cancelling this booking triggers an explicit refund Payment — never
  // automatic.
  refundPaymentId String?
  refundPayment   Payment? @relation(fields: [refundPaymentId], references: [id])

  notes              String?
  bookedByUserId     String
  cancelledAt        DateTime?
  cancellationReason String?
  // Set when this booking exists because its original departure was weather-cancelled
  // and the guest was moved to a replacement — points at the ORIGINAL departure, not
  // the current one, so history stays honest. See the departure-cancellation cascade.
  movedFromDepartureId String?
  movedFromDeparture   ExcursionDeparture? @relation("MovedFromDeparture", fields: [movedFromDepartureId], references: [id])
  // Set on the OLD booking once IT has been moved — the reverse pointer, added in
  // Phase 5 after live-testing showed nothing stopped the same cancelled booking
  // from being moved twice (duplicate bookings for the same guest). Plain id, no
  // relation, same convention as bookedByUserId.
  movedToBookingId String? @unique

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([departureId])
}
```

(Existing models gain only back-relation lists: `Property.moduleAccessOverrides`
(property-level) / `.excursionTypes` / `.excursionBookings`, `ChargeCode.excursionTypes`,
`Folio.excursionBookings`, `FolioLineItem.excursionBooking`,
`Reservation.excursionBookings`, `Payment.refundedExcursionBookings`.)

## Phases

### Phase 1 — Schema + Controls catalog management ✅
- Migration for all six models above (`prisma migrate diff --script` +
  `migrate deploy`, per `MASTER_PLAN.md`'s tooling note — never `migrate dev`).
- `src/lib/modules.ts`: add `EXCURSIONS`. `prisma/rbac-seed-data.ts`: default matrix
  entries (Admin/Manager full, Front Desk edit-no-delete, matching its access level on
  comparable modules).
- `src/lib/scope.ts`: `assertPropertyModuleAccess()`.
- `src/app/api/licenses/property-modules/route.ts` (GET/PATCH, Osta-only).
- `/osta/properties/[id]/page.tsx` + `PropertyModuleAccessManager` component.
- Controls tab: `src/app/api/excursions/types/route.ts` (+`[id]`), `.../schedules/route.ts`
  (+`[id]`, +generate-departures action), catalog manager components — gated by
  `CONTROLS`, not `EXCURSIONS`.
- No booking flow yet.

### Phase 2 — In-house booking flow ✅
- `src/app/api/excursions/departures/route.ts` (list upcoming, with live
  capacity/minCapacity counts).
- `src/app/api/excursions/bookings/route.ts` (POST) — reuses `/api/pos/search`'s exact
  query shape for the room-number guest lookup, posts a `FolioLineItem` against the
  guest's existing open folio via `resolveChargeTax` (same tax path as POS). Booking +
  its `FolioLineItem` are created in one transaction, in-house only for now (walk-in
  identity is schema-ready but its flow is Phase 3).
- Sidebar entry (`EXCURSIONS`, gated by RBAC + `PropertyModuleAccess` for the *current*
  property, resolved via `resolveCurrentPropertyId`) + the booking page
  (`src/app/e/[slug]/dashboard/excursions/page.tsx`), modeled directly on
  `src/app/e/[slug]/dashboard/pos/page.tsx`'s search UI and
  `src/components/pos/outlet-appointments-panel.tsx`'s form/capacity-warning pattern.
- Verified live end to end against a real dev server: guest search by room number,
  departure picker with live "X/Y booked" + at-risk badge, booking creation with correct
  adult/child/infant price math, correct tax split on the posted `FolioLineItem`, live
  headcount updating immediately after booking, and both Admin and Front Desk roles
  (the latter has `EXCURSIONS` but not `CONTROLS`) successfully booking.

### Phase 3 — Walk-in flow ✅
- Walk-in toggle (free-text identity), reusing `/api/folios/walk-in` to open the folio
  first, then the same `POST /api/excursions/bookings` endpoint — extended to accept
  either `reservationId` (in-house) or `folioId` (walk-in) as alternatives, never both.
  A walk-in booking's identity is read off the folio itself (`Folio.walkInGuestName`/
  `walkInGuestContact`) rather than re-entered, so there's one source of truth.
- Pay-now vs pay-later turned out to need **no new payment UI at all** — after a
  walk-in booking, the page opens the existing `WalkInFolioPanel` (already used by POS
  for exactly this), which already has "take payment" and "close bill" built in. Not
  closing it *is* pay-later.
- New: `GET /api/excursions/bookings` — lists a property's still-open walk-in
  bookings, the retrieval path that makes "pay later" actually usable (nothing else in
  the app has a browsable list of open walk-in folios today — POS only keeps one in
  local component state per session; `ExcursionBooking.folioId` makes this possible
  here without a general-purpose walk-in-folio-list route).
- Verified live end to end: opened a walk-in folio, booked 2 adults ($100, tax-inclusive
  split to $77.70/$14.53/$7.77), confirmed it appeared in the open-bills list, took a
  full payment, closed the folio, confirmed it dropped off the list. Also verified the
  guard rails: providing both `reservationId` and `folioId` 400s, and passing a
  reservation's own folio as `folioId` 400s ("use reservationId instead") rather than
  silently accepting it.

### Phase 4 — Manifest, cancellation, no-show ✅
- `GET /api/excursions/departures/[id]` — manifest data (guest/room or walk-in, headcount,
  notes, status), excluding `CANCELLED` bookings.
- `GET /api/excursions/departures/[id]/manifest-pdf` — printable, via the existing
  `generateTablePdf` utility (same one arrival/departure-list reports use).
- `POST /api/excursions/bookings/[id]/cancel` — a real correction mid-build here:
  voiding a charge turned out to require its own `CASHIERING` permission check (the
  existing `/api/folios/[id]/line-items/[id]/void` route is gated by `CASHIERING`, not
  by whichever module posted the charge — found by reading that route rather than
  assuming `EXCURSIONS` permission alone would cover it). So cancellation ended up as
  two independent, gracefully-degrading gates: cutoff window
  (`EXCURSIONS update` within it, `EXCURSIONS delete` — manager override — past it), and
  voiding (`CASHIERING update`, falling back to "charge left in place, needs cashiering
  staff" rather than blocking the cancellation outright if missing). Also discovered:
  the void route explicitly refuses to touch a **closed** folio ("closed folio is a
  finalized document... corrections are a refund conversation, not a silent void"), and
  the payments route has the same closed-folio block (debtor-invoice folios excepted,
  which doesn't apply here) — so a paid-and-closed walk-in booking's cancellation
  correctly cancels the *booking record* but explicitly cannot touch the money at all;
  the original plan's "post an explicit refund Payment" idea doesn't actually work
  against a closed folio in this app and was dropped in favor of an honest "handle this
  refund manually" message.
- `POST /api/excursions/bookings/[id]/no-show` — only allowed once the departure's
  date+time has actually passed; leaves the charge untouched (no auto-void/refund).
- `src/components/front-office/excursion-manifest-panel.tsx` — a Sheet (same pattern as
  `WalkInFolioPanel`) triggered from either departure list on the booking page; lists
  bookings with cancel/no-show actions and a "Print Manifest" button.
- Verified live end to end against a real dev server, every branch: manifest data
  correct; cancelling a booking on an open folio voids the charge (confirmed
  `isVoid: true` on the actual `FolioLineItem`); cancelling one on an already-closed
  folio cancels the record but leaves the charge with the "handle manually" message;
  re-cancelling an already-cancelled booking 400s; marking no-show before the departure
  has left 400s, after it succeeds; the manifest correctly excludes cancelled bookings
  and includes no-shows; a real PDF is generated (valid PDF 1.7, 1486 bytes for a
  2-row manifest); and the cutoff override chain specifically — Front Desk (has
  `EXCURSIONS update`, not `delete`) is correctly blocked with 403 on a past-cutoff
  booking, and Admin (has `delete`) succeeds on the identical booking. Not live-tested:
  the "actor has `EXCURSIONS` but lacks `CASHIERING`" partial-void branch — no seeded
  role isolates that exact combination (every role with `EXCURSIONS` today also has at
  least `CASHIERING` update) — the branch itself was verified by code review, not by an
  actual mismatched-permission request.

### Phase 5 — Departure-level cancellation cascade ✅
- `POST /api/excursions/departures/[id]/cancel` — manager-only (`EXCURSIONS delete`),
  no cutoff check (an operator decision, not the per-guest cutoff rule). Cascades to
  every `CONFIRMED` booking on the departure using the same `CASHIERING`-gated void
  logic as a single-booking cancel, checked ONCE for the whole batch. Then looks for
  the next `SCHEDULED` departure of the same `ExcursionType` with room left.
- `POST /api/excursions/departures/[id]/move-bookings` — moves a batch of the
  now-cancelled bookings onto a replacement departure. Creates a **new**
  `ExcursionBooking` + fresh `FolioLineItem` (priced for the replacement's date) per
  guest rather than mutating the cancelled one, and re-derives movability itself
  (never trusts the client's list) — a booking whose charge was never voided (closed
  folio, or the actor lacked cashiering access at cancel time) is refused with "would
  double-charge the guest" rather than silently moved.
- Manifest panel: a "Cancel Departure" action (only shown while `SCHEDULED`) opens a
  reason dialog; the result renders a summary card (cancelled/voided counts, any
  bookings needing manual handling, and — if a replacement was found — a one-click
  "Move All" button).
- **Two real bugs found by live-testing this phase, neither predictable from the code
  alone:**
  1. The replacement-suggestion query filtered candidates by date only
     (`departureDate >= today`). Live-testing on this specific dev environment's
     timezone (Asia/Karachi, UTC+5) exposed that a departure's stored UTC date can
     represent a *local* calendar day that already has an earlier session — the query
     picked a "replacement" whose own 9am boat had already left hours earlier that same
     day. Fixed by additionally checking the *real combined date+time*
     (`combineDepartureDateTime`, new shared helper) against `now`, not just the date.
  2. Nothing stopped the same already-moved booking from being submitted to
     `move-bookings` a second time, which would silently create a second duplicate
     booking (and a second charge) for the same guest. Fixed with a new
     `ExcursionBooking.movedToBookingId` field (migration
     `20260722094214_excursion_booking_moved_to`), set on the original booking in the
     same transaction that creates its replacement, and checked before allowing a move.
  Both were caught only because the verification step actually drove the real
  endpoints end to end against live data rather than stopping at `tsc`/build success —
  worth remembering for Phase 6's test coverage.
- Verified live end to end: cancelling a departure with a reservation-backed and a
  walk-in booking cascaded both to `CANCELLED` and voided both charges; the (buggy,
  then fixed) replacement suggestion; a full cancel→move cycle producing a correctly
  `movedFromDepartureId`-tagged new booking; and the double-move guard rejecting a
  repeat `move-bookings` call on the same booking with a clear reason.

### Phase 6 — Tests, seed, docs ✅
- `tests/tenant-isolation/excursions.test.ts` (10 tests) — cross-enterprise/property
  access on every route (types, departures, bookings), the `PROPERTY`-scoped guard, the
  add-on-defaults-off 403, and that only Osta staff can toggle `PropertyModuleAccess` —
  same harness (`asUser`, the in-memory cookie-jar mock) as every existing
  tenant-isolation suite.
- `tests/business-rules/excursions.test.ts` (14 tests) — 4 pure-function unit tests for
  `src/lib/excursions.ts` (`expandScheduleDates`, `combineDepartureDateTime`,
  `computeBookingTotal`, `rateForDate`) plus 10 route-level integration tests covering
  every branch this plan actually depends on: PER_PERSON and FLAT pricing math, the
  reservationId/folioId XOR (neither, both, and a smuggled reservation-folio all 400),
  the cutoff-vs-manager-override split (using a purpose-built no-delete role, since no
  seeded system role isolates it), the `CASHIERING`-gated void leaving an unvoided
  charge with a note, a closed folio never being voidable, no-show's before/after-
  departure gate, the full cascade→suggest→move cycle (asserting the suggested
  replacement is the genuinely-future departure and never the already-departed one —
  regression-testing the Phase 5 timezone bug directly), the double-move guard, the
  closed-folio-blocks-move guard, and generate-departures idempotency.
- Full suite run after adding these: **324/324 passing** (38 test files) — the 24 new
  Excursions tests plus all 300 pre-existing tests, confirming nothing else regressed.
- `scripts/seed/seed-veyo.ts` extended: enables the add-on for Veyo's property,
  seeds three real excursion types (Snorkelling Trip, Island Hopping, Night Fishing —
  the exact three named at the very start of this feature's design conversation) each
  with its own charge code, dated rates, one recurring schedule, and departures
  generated ~60 days out via the same `expandScheduleDates` helper the app itself uses.
  Verified idempotent by running it twice against the dev database with no errors, and
  confirmed live via the API that all three types and a realistic departure count each
  (24/17/18, matching their different weekly frequencies) exist.
- `DECISIONS.md` dated entry summarizing the business rules; `TODO.md` and this file's
  status flipped throughout as each phase actually finished, not batched at the end.

## Decisions confirmed (app owner, 2026-07-22 design session)

1. ✅ Scheduling is **hybrid** — recurring template generates instances, staff can also
   hand-add/edit/cancel individual departures.
2. ✅ Over-capacity is a **soft warning only**, never a hard block.
3. ✅ Walk-in identity is **free text**, not a real Profile.
4. ✅ Walk-ins can **pay now or pay later** (both, not just immediate payment).
5. ✅ Pricing is **per adult/child/infant** (infant is a real third tier here, unlike
   Allocations).
6. ✅ Cancellation has an **enforced cutoff window**, not just a void-anytime policy.
7. ✅ A per-departure **manifest/passenger-list report is essential for v1**, not
   deferred.
8. ✅ Whole-departure cancellation **cascades and auto-suggests a replacement**
   departure, not just a bare cascade-cancel.
9. ✅ A **minimum-passenger threshold** is wanted, as a soft "at risk" warning — not
   enforced/blocking.
10. ✅ The add-on is **Osta-toggled only** — enterprise admins cannot self-serve enable
    it for their own properties.
11. ✅ Excursions gets its **own RBAC module**, separate from `FRONT_DESK`.
