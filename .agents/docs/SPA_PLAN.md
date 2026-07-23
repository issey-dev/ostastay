# Spa Booking Add-on — Review & Implementation Plan

> **Status legend**: ✅ done · 🚧 in progress · ⬜ not started
> **Overall**: **🚧 Phase 3 done, Phase 4 next (2026-07-23).** Phase 3 (walk-in
> booking) extends `POST /api/spa/appointments` to accept `folioId` (an already-open
> walk-in folio, opened via the existing `POST /api/folios/walk-in`) as the billing
> anchor's alternative to `reservationId`, exactly like Excursions' own Phase 3 —
> plus, since companions on a couple/group treatment are never billed separately,
> they can be a plain `walkInGuestName` with no folio at all. `GET
> /api/spa/appointments?openWalkIns=true` lists still-open walk-in-billed
> appointments (the "pay later" retrieval, same reasoning as Excursions'). The
> front-office page gained the Guest/Walk-in mode toggle and `WalkInFolioPanel`
> integration, reused with zero new payment UI. 5 new tests (14 total in
> `spa-booking.test.ts`) cover the walk-in booking itself, the closed-folio-folio-
> smuggling guard, a closed-folio rejection, a walk-in-primary + plain-name-companion
> couple booking, and the open-walk-ins listing. Phase 0 (module
> registration + schema) and Phase 1 (Controls catalog: treatments, therapists, rooms,
> settings) are complete. Phase 2 (availability engine + in-house booking) is
> complete: `src/lib/spa-availability.ts` (candidate rooms/therapists, deterministic
> auto-assignment, prep/cleanup-buffer-aware overlap blocking — a real gap was found
> and fixed mid-phase, see below), `src/lib/spa-resource-lock.ts` (the in-process
> mutex from §7), `POST/GET /api/spa/appointments` (+ `[id]`, + `availability`), and
> the front-office booking page at `/e/[slug]/dashboard/spa`. Covered by
> `tests/business-rules/spa-booking.test.ts` (9 tests: happy path with real folio
> posting, therapist double-book rejection, room double-book rejection, couple
> treatment distinct-therapist assignment, and — the one the request called out as
> most critical — a genuine concurrent-request race test asserting exactly one of two
> simultaneous bookings for the same only-available therapist succeeds). The
> tape-chart UI and the rest of the appointment lifecycle
> (check-in/complete/cancel/no-show) are still ahead — see §16.
>
> **Two real bugs found and fixed during Phase 2 build** (both by re-reading the
> plan against the actual committed schema/code, not by live-testing — worth noting
> since the project's own convention is that live-testing usually catches these):
> 1. `getAvailableRooms`'s "roomType fallback" referenced `SpaTreatment.roomType`,
>    a field that was never added to the schema (only `SpaRoom.roomType` exists,
>    a room-side display label). Fixed by dropping that fallback tier — no
>    compatibility configured now falls straight through to every bookable room at
>    the property, one tier simpler than §7's original text described.
> 2. The availability engine only extended the blocked window's *end* (cleanup
>    buffer) via `blockedUntilTime`, never its *start* (preparation buffer) — meaning
>    `preparationBufferMinutes` was captured on the schema but never actually blocked
>    anything, contradicting the request's explicit "the buffer should block the
>    resource even if it is not shown as guest treatment time." Fixed by deriving an
>    effective `blockedFromTime` (`startTime` minus the treatment's own prep buffer)
>    for every overlap check, on both the requested slot and every existing
>    appointment being checked against (using that appointment's own snapshotted
>    prep buffer).
>
> This document is the output of a
> codebase review + design pass (2026-07-22), following the same shape as
> [`EXCURSIONS_PLAN.md`](EXCURSIONS_PLAN.md) (context → architecture decisions → schema
> → phases → confirmed decisions). The concurrency strategy in §7 was corrected
> mid-review after an unverified assumption ("SQLite serializes everything") was
> checked against the actual `schema.prisma`/`src/lib/db.ts` config and found
> unsubstantiated — replaced with a concrete in-process mutex.
>
> **Owner decisions confirmed 2026-07-23** (§22, superseding the plan's own
> recommendation where noted):
> 1. Catalog/setup permissions gated under `CONTROLS` (matches the plan's
>    recommendation).
> 2. Couple/group treatments: **Option A — full multi-resource support in v1**,
>    *not* the plan's original Option B recommendation. This changed the
>    `SpaAppointment` schema materially — see §3 row 7 and §4, both rewritten
>    2026-07-23 to a parent/child `SpaAppointment` + `SpaAppointmentParticipant`
>    design (multiple guests, each with their own therapist, sharing one room and one
>    folio charge) rather than the originally-planned `linkedAppointmentId` pairing
>    workaround.
> 3. In-house guest identity: live-join via `reservationId` (matches the plan's
>    recommendation) — now stored per-participant, see §4.
>
> Remaining three open items (charge-timing scope, Phase 6 priority, therapist-schedule
> permission gating) are unchanged from §22 — proceeding with the plan's own
> recommendation on each, revisit later without schema rework.

## Context

Osta wants to sell a Spa Booking module as a new per-property paid add-on, the same
commercial shape as the just-completed Excursions module: small hotel spas need to
schedule a therapist + a treatment room against a treatment catalog, for both in-house
guests and walk-ins, billed through the existing folio system. The instruction was to
review the codebase (especially Excursions, the only precedent for a property-level
paid add-on) before writing any code, and produce a plan that reuses — rather than
reinvents — the platform's module-access, RBAC, financial, audit, and tenant-isolation
mechanisms. This document is that review + plan.

---

## 1. Codebase findings (what's actually there, verified by reading the code)

**1. Excursions' property add-on mechanism** — `PropertyModuleAccess {id, propertyId,
module: String, enabled: Boolean @default(false)}` (`prisma/schema.prisma:1655-1668`),
unique on `(propertyId, module)`. `module` is validated in code against the `MODULES`
tuple in `src/lib/modules.ts`, not a DB enum. Missing row = not purchased. This table is
already generic/reusable — no migration needed to add Spa, just add `"SPA"` to the
`MODULES` array.

**2. How module access is checked** — `assertPropertyModuleAccess(ctx, propertyId,
module)` in `src/lib/scope.ts:393-401`. It calls `assertPropertyAccess()` first (so a
wrong-enterprise property 403s as "not found," never leaking whether the add-on exists),
then checks the `PropertyModuleAccess` row. Every Excursions route calls this **in
addition to**, never instead of, `requirePermission(ctx, module, action)`. Toggling the
row is Osta-only: `src/app/api/licenses/property-modules/route.ts` checks
`ctx.isInternal` (true only for the one INTERNAL-type enterprise, resolved dynamically,
not hardcoded) **before** `requirePermission(ctx, "CONTROLS", "update")` — enterprise
admins, even with full CONTROLS access, cannot self-serve enable it. Confirmed by
`tests/tenant-isolation/excursions.test.ts:254`.

**3. In-house guest search** — two existing endpoints: `GET /api/pos/search` (room
number / name, returns first open folio id) and the richer `GET /api/reservations?search=`
(full reservation + primaryGuest + assignments + folios), the latter already used by
`OutletAppointmentsPanel`'s guest picker. Spa's booking UI should call the reservations
endpoint (richer data: stay dates, status, folio).

**4. Walk-in folios** — no separate `WalkInCustomer`/`WalkInFolio` model. A walk-in is
just a `Folio` with `reservationId: null` + free-text `walkInGuestName`/
`walkInGuestContact`. Created via `POST /api/folios/walk-in`, settled via the existing
`WalkInFolioPanel` component (take payment / close bill), which Excursions reuses
directly with zero new payment UI.

**5. Charge codes / tax / service charge / FolioLineItems** — `ChargeCode` (enterprise-
wide) → `resolveChargeTax()` (`src/lib/tax-calc.ts`) computes `{baseAmount, taxAmount,
serviceChargeAmount}` from the enterprise's default two-step engine or a custom
`TaxProfile`, snapshotted onto an immutable `FolioLineItem` row at posting time — never
recomputed later. `POST /api/pos/charge` is the canonical posting route; Excursions'
booking route inlines the identical resolve→snapshot→create pattern in one
`prisma.$transaction` with the booking row itself.

**6. Permission structure** — there are no fine-grained permission keys; it's a
module × {view,create,update,delete} matrix per role (`prisma/rbac-seed-data.ts`).
Excursions splits **catalog/setup** under the existing `CONTROLS` module,
**day-to-day booking** under its own new `EXCURSIONS` module, **manager override**
(past-cutoff cancel, whole-departure cancel) as the `delete` action on `EXCURSIONS`,
and **cashiering** (voiding a posted charge) as an independently-checked
`CASHIERING update` that degrades gracefully rather than blocking the whole action.

**7. Audit logs** — one model, `UserActivityLog` (`enterpriseId, userId, userEmail`
snapshot, `module, action, entityType, entityId, description, metadata JSON,
createdAt`), written via `logActivity()` (`src/lib/activity-log.ts`), which swallows its
own failures so a logging bug never blocks the action it describes, but is always
`await`ed. Called after every mutating action, never on views.

**8. `OutletAppointment`-style features** — `Outlet` (has an `outletType` enum
including `"SPA"` as a label already, plus `appointmentCapPerSlot`) and
`OutletAppointment` (`startTime/endTime`, XOR reservation/walk-in identity,
`status: SCHEDULED|COMPLETED|CANCELLED|NO_SHOW`). **Important gap**:
`OutletAppointment` has **no `folioId`/`FolioLineItem` link at all** — booking and
billing are two disconnected manual steps — and its only "conflict" check is a soft,
non-blocking headcount-vs-`appointmentCapPerSlot` warning. There is no per-resource
(therapist/room) conflict model anywhere in the codebase today.

**9. Existing calendar/scheduler component** — none is generic/reusable.
`tape-chart-grid.tsx` is day-granularity and hard-wired to `Room`/`RoomAssignment`/
`Reservation`. `outlet-appointments-panel.tsx` is a flat list, not a time-grid. A Spa
tape chart is new UI work; nothing to adapt in place.

**10. Timezone / business date** — **there is no property-timezone field anywhere in
the schema.** `src/lib/business-date.ts` only handles the day-granularity "business
date" (`Property.businessDate`, advanced by Night Audit) via UTC-midnight
normalization; actual clock-time combining uses `Date.setHours` in
**server-local time** (`combineDepartureDateTime()` in `src/lib/excursions.ts:142-147`).
This exact gap caused a real, documented bug during Excursions' Phase 5
(`.agents/docs/EXCURSIONS_PLAN.md:432-440`): a replacement-departure query filtered by
date only and picked a trip whose boat had *already left that same day*, fixed by
comparing full combined date+time against `now`. **This is a real inconsistency
against the original request's assumption that property timezone handling already
exists — it does not.** Addressed in §3.

**11. Closed folios / voids / refunds** — void = `isVoid: true` flag (never delete),
gated `CASHIERING update`, explicitly refused on a closed folio ("a closed folio is a
finalized document"). Refunds are just `Payment` rows with `isRefund: true`, posted
via the normal payments route (also closed-folio-blocked, except debtor accounts) —
**there is no automatic refund anywhere in the app**; it's always a manual, separate
cashiering action, surfaced to the user via a `chargeNote` when the system can't touch
the money itself. Excursions' cancel route is the exact template to copy.

**12. Tenant isolation testing** — `tests/tenant-isolation/excursions.test.ts` is a
direct precedent: real SQLite fixtures (two enterprises, a second property within one
enterprise), an `asUser()` session-mock helper, assertions for cross-enterprise 403,
cross-property-same-enterprise 403, add-on-off-by-default 403, and Osta-only-toggle
403. Spa's tests should mirror this file structure exactly.

---

## 2. Reuse strategy

**Reused as-is, no changes needed beyond registering the new module name:**
`PropertyModuleAccess` + `assertPropertyModuleAccess()`, `requireSession()` /
`requirePermission()` / `assertPropertyAccess()` guards in `src/lib/scope.ts`,
`UserActivityLog` + `logActivity()`, `ChargeCode` / `TaxProfile` /
`resolveChargeTax()`, `Folio` / `FolioLineItem` / `Payment`, `POST /api/folios/walk-in`
+ `WalkInFolioPanel`, `GET /api/reservations` guest search, `resolveBusinessDate()`,
`generateTablePdf` (manifest/confirmation PDFs), UI primitives (`SearchableSelect`,
`DatePicker`, `Sheet`, `Dialog`, `StatusBadge`, `EmptyState`, `Skeleton`), the
`tests/tenant-isolation` harness (`asUser`, cookie-jar mock), RHF+Zod form standard.

**Not reused, and why:**
- **`OutletAppointment`/`Outlet`** — no folio linkage, no resource-conflict model, no
  skills/rooms/schedules. Spa needs a real resource-scheduling engine Outlet doesn't
  have. Building Spa as its own parallel module (exactly the same call Excursions made
  about both `Allocation` and `OutletAppointment` — see
  `EXCURSIONS_PLAN.md:30-49`) is more consistent with precedent than retrofitting
  Outlet. The existing `Outlet` row with `outletType: "SPA"` (if any property has one)
  is left untouched — it remains the free/basic appointment logger for properties that
  never buy this add-on; the two coexist without conflict.
- **`tape-chart-grid.tsx`** — day-granularity, reservation-specific, not adaptable to a
  time-slot × resource grid. New component, but styled consistently (same shadcn
  primitives, same drawer/dialog conventions).

---

## 3. Architecture decisions (flagging every place this plan deviates from the original request's draft spec, with reasoning)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| 1 | Module name | `"SPA"` added to `src/lib/modules.ts` MODULES/MODULE_LABELS, `prisma/rbac-seed-data.ts`'s own duplicate MODULES array, and `ADD_ON_MODULES` filter in `src/components/osta/property-module-access-manager.tsx` | Exact mechanical steps Excursions took |
| 2 | **Catalog permission grouping** | Catalog/setup (treatments, rates, therapists, rooms, schedules) gated by the existing **`CONTROLS`** module, *not* a new `SPA_CONTROLS` module | Matches Excursions exactly ("same trust level as editing a RatePlan or Outlet today"). The original request's draft used `SPA_CONTROLS` as a placeholder name — deviating from the existing convention here would make Spa the only add-on with a different catalog-permission shape. **Flagging for explicit sign-off since the request named `SPA_CONTROLS` directly.** |
| 3 | Operational + manager-override permission | One `"SPA"` module; `view/create/update` = day-to-day (book, check-in, reschedule, cancel-before-cutoff); `delete` = manager override (late cancel, working-hour override, reopen completed, price override) | Identical to Excursions' `EXCURSIONS delete` pattern |
| 4 | Cashiering | Independent `CASHIERING update`/`create` check for voids/refunds, degrading gracefully (cancel succeeds, charge flagged unresolved) rather than blocking | Copies Excursions' Phase-4 correction exactly |
| 5 | **Therapist/room double-booking** | **Hard block**, not the soft-warning-only model Excursions uses for seat capacity | The original request explicitly requires this, and it's the right call architecturally too: an excursion seat is a soft capacity limit, but a therapist or room is a single physical resource — two guests literally cannot occupy it at once. This is an intentional, justified deviation from Excursions' philosophy, not an inconsistency. |
| 6 | **Property timezone** | **Do not invent a property-timezone system for v1.** Mirror the app's existing (imperfect) server-local-time convention, add a `combineAppointmentDateTime()` helper mirroring `combineDepartureDateTime()`, and add explicit regression tests for same-day/past-time comparisons | The original request assumes timezone handling already exists; it does not, anywhere in this app. Building a real property-timezone system is a cross-cutting change far beyond Spa's scope and would make Spa inconsistent with every other date/time computation in the codebase (business date, Excursions, reservations). Flagged as a real platform gap worth a separate initiative, not something Spa should solve alone. |
| 7 | **Couple/group treatments** | **Option A, confirmed by the app owner 2026-07-23** — full multi-resource support in v1. One `SpaAppointment` (shared room, shared time window, one folio charge) has N `SpaAppointmentParticipant` child rows, each with its own guest identity (XOR reservation/walk-in) and its own assigned therapist. `SpaTreatment.maxParticipants` (default 1) caps how many guests a given treatment allows sharing one appointment. **Billing stays single-folio**: the participant with `participantIndex: 1` is the billing anchor whose reservation/walk-in identity resolves the folio — the same "one purchase, one folio, covers multiple people" precedent `ExcursionBooking` already established with its `adultCount/childCount/infantCount` on one booking, just generalized to independent per-guest therapist assignment. No split-billing across participants in v1 (nothing else in this app splits one purchase across multiple folios either). | No multi-resource booking pattern exists anywhere in this codebase to build on (Excursions/OutletAppointment are both single-resource) — this is genuinely new ground for the app, not an adaptation of an existing pattern. Scoped deliberately to keep it buildable: one shared room/time-window per appointment (no mixed-duration group sessions), one folio charge (no split billing), each participant's *therapist* assignment is independent (the actual "multi-resource" part) — this is the smallest schema that's honestly "Option A" rather than a relabeled Option B. |
| 7b | **In-house guest identity: snapshot vs. live join** — confirmed 2026-07-23: live-join | **Live-join via `reservationId` on each `SpaAppointmentParticipant`, no `guestNameSnapshot`/`roomNumberSnapshot` fields** — matches `ExcursionBooking` exactly | The original request's draft schema listed snapshot fields for guest name/room number; `ExcursionBooking` deliberately has neither and instead live-joins the reservation, so the tape chart always reflects the guest's *current* room (useful after a room move). Trade-off, accepted: if a reservation is later deleted, the historical appointment loses its friendly guest label. |
| 8 | Charge timing | v1 supports **both** `AT_BOOKING` (default) and `AT_COMPLETION`, controlled by `SpaSettings.chargeTiming` | This is called out as a confirmed operational preference in the original request, not a nice-to-have — but it's the single biggest complexity add in this plan (see §21 Risks). `AT_BOOKING` mirrors Excursions exactly (appointment + FolioLineItem created together in one transaction); `AT_COMPLETION` creates the appointment with `folioId: null`/`paymentStatus: NOT_POSTED` and posts the charge as part of the "Complete" transition. |
| 9 | Packages / memberships / notifications | **Deferred**, schema left extensible (see §16, §14) | Explicitly optional/future in the original request; no existing notification-channel abstraction was found in this codebase during review (only a PDF-generation utility, `generateTablePdf`), so v1 ships a printable confirmation only, same as Excursions' manifest-pdf. |
| 10 | Resource compatibility | Direct `SpaTreatmentRoom` join (treatment ↔ specific room, `preferred` flag), plus an optional `roomType` string on `SpaRoom` for coarser filtering | Matches the original request's suggestion; avoids inventing a full RoomType taxonomy for spa (unlike the hotel's own `RoomType`, which is unrelated) |

**A nuance worth naming rather than silently deciding**: therapist working-hour
schedules and same-day availability exceptions ("Therapist X is out sick today") are,
by nature, touched far more often and by more junior staff than treatment/rate/room
catalog edits. Folding them into `CONTROLS` (decision #2's recommendation, for
consistency with Excursions) means front-desk/spa-reception staff can't record "the
2pm therapist called in sick" without also holding broad Controls access to the rest
of the PMS. There's no existing precedent to resolve this cleanly either way —
Excursions has no analogous "same-day exception to a recurring template" concept.
Recommendation: keep it under `CONTROLS` for v1 (simplicity, one fewer permission
seam to test), but this is a genuine judgment call, not a settled one — see §22.

---

## 4. Database schema (new models — SQLite via Prisma, `String` status fields not DB enums, matching every existing convention)

```prisma
model SpaTreatmentCategory {
  id           String   @id @default(uuid())
  propertyId   String
  property     Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  name         String
  description  String?
  displayOrder Int      @default(0)
  isActive     Boolean  @default(true)
  treatments   SpaTreatment[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([propertyId, name])
}

model SpaTreatment {
  id                        String   @id @default(uuid())
  propertyId                String
  property                  Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  categoryId                String
  category                  SpaTreatmentCategory @relation(fields: [categoryId], references: [id])
  name                      String
  shortName                 String?
  description               String?
  defaultDurationMinutes    Int
  preparationBufferMinutes  Int      @default(0)
  cleanupBufferMinutes      Int      @default(0)
  chargeCodeId              String
  chargeCode                ChargeCode @relation(fields: [chargeCodeId], references: [id])
  // Every v1 treatment requires exactly one therapist per participant + one shared
  // room — the confirmed business rule. No requiresTherapist/requiresRoom flags:
  // they'd be unused branching for a hypothetical treatment type that doesn't exist
  // yet — adding them back later is a one-line migration if a real need shows up.
  // How many guests can share one SpaAppointment (§3 row 7, Option A, confirmed
  // 2026-07-23) — 1 = standard individual treatment (unchanged default), >1 = the
  // treatment can be booked as a couple/group session, each participant getting
  // their own therapist within one shared room + time window.
  maxParticipants           Int      @default(1)
  // PER_PERSON: rate.price x SpaAppointment.partySize. FLAT: rate.price regardless
  // of partySize (a genuine package price for e.g. "Couple Massage"). Same shape as
  // ExcursionType.pricingMode.
  pricingMode               String   @default("PER_PERSON")
  allowWalkIn               Boolean  @default(true)
  allowInHouseGuest         Boolean  @default(true)
  displayOrder              Int      @default(0)
  isActive                  Boolean  @default(true)
  rates                     SpaTreatmentRate[]
  therapistSkills           SpaTherapistTreatment[]
  compatibleRooms           SpaTreatmentRoom[]
  appointments              SpaAppointment[]
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt
}

model SpaTreatmentRate {
  id            String       @id @default(uuid())
  treatmentId   String
  treatment     SpaTreatment @relation(fields: [treatmentId], references: [id], onDelete: Cascade)
  price         Float        // property's single default currency, implicit — no per-rate currency field, matching ExcursionRate/AllocationRate (nothing in this app tracks currency per rate row; multi-currency-per-property isn't a real pattern here)
  effectiveFrom DateTime
  effectiveTo   DateTime?    // null = open-ended; ranges validated non-overlapping in-app, same rule as ExcursionRate/AllocationRate
  isActive      Boolean      @default(true)
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
}

model SpaTherapist {
  id            String   @id @default(uuid())
  propertyId    String
  property      Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  employeeId    String?  // optional link to an existing employee/user record; plain id, no FK requirement to a login
  displayName   String
  gender        String?
  phone         String?
  email         String?
  isActive      Boolean  @default(true)
  bookable      Boolean  @default(true)
  displayOrder  Int      @default(0)
  skills        SpaTherapistTreatment[]
  schedules     SpaTherapistSchedule[]
  exceptions    SpaTherapistAvailabilityException[]
  // Note: no direct appointments[] back-relation — a therapist is assigned per
  // participant now (see SpaAppointmentParticipant.therapistId), not per appointment.
  participantAssignments SpaAppointmentParticipant[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model SpaTherapistTreatment {
  id                    String       @id @default(uuid())
  therapistId           String
  therapist             SpaTherapist @relation(fields: [therapistId], references: [id], onDelete: Cascade)
  treatmentId           String
  treatment             SpaTreatment @relation(fields: [treatmentId], references: [id], onDelete: Cascade)
  qualified             Boolean      @default(true)
  preferred             Boolean      @default(false)
  customDurationMinutes Int?
  notes                 String?
  @@unique([therapistId, treatmentId])
}

model SpaRoom {
  id            String   @id @default(uuid())
  propertyId    String
  property      Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  name          String
  code          String?
  description   String?
  capacity      Int      @default(1) // must be >= the appointment's partySize to be a candidate room
  roomType      String?  // free-text coarse filter, e.g. "MASSAGE" | "SALON" | "OUTDOOR"
  isActive      Boolean  @default(true)
  bookable      Boolean  @default(true)
  displayOrder  Int      @default(0)
  compatibleTreatments SpaTreatmentRoom[]
  exceptions    SpaRoomAvailabilityException[]
  appointments  SpaAppointment[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model SpaTreatmentRoom {
  id          String       @id @default(uuid())
  treatmentId String
  treatment   SpaTreatment @relation(fields: [treatmentId], references: [id], onDelete: Cascade)
  roomId      String
  room        SpaRoom      @relation(fields: [roomId], references: [id], onDelete: Cascade)
  preferred   Boolean      @default(false)
  @@unique([treatmentId, roomId])
}

model SpaTherapistSchedule {
  id            String       @id @default(uuid())
  therapistId   String
  therapist     SpaTherapist @relation(fields: [therapistId], references: [id], onDelete: Cascade)
  dayOfWeek     Int          // 0-6
  startTime     String       // "HH:MM", same string convention as ExcursionSchedule.departureTime
  endTime       String
  effectiveFrom DateTime
  effectiveTo   DateTime?
  isActive      Boolean      @default(true)
}

model SpaTherapistAvailabilityException {
  id            String       @id @default(uuid())
  therapistId   String
  therapist     SpaTherapist @relation(fields: [therapistId], references: [id], onDelete: Cascade)
  date          DateTime
  startTime     String?      // null + exceptionType UNAVAILABLE = whole day off
  endTime       String?
  exceptionType String       // DAY_OFF | LEAVE | TRAINING | SICK | EXTENDED_HOURS | UNAVAILABLE
  reason        String?
  createdAt     DateTime     @default(now())
}

model SpaRoomAvailabilityException {
  id            String  @id @default(uuid())
  roomId        String
  room          SpaRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  date          DateTime
  startTime     String?
  endTime       String?
  exceptionType String  // MAINTENANCE | CLEANING | RENOVATION | PRIVATE_EVENT | UNAVAILABLE
  reason        String?
  createdAt     DateTime @default(now())
}

model SpaSettings {
  propertyId                    String   @id
  property                      Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  defaultOpeningTime            String   @default("09:00")
  defaultClosingTime            String   @default("18:00")
  slotIntervalMinutes           Int      @default(15)
  defaultPreparationBufferMinutes Int    @default(0)
  defaultCleanupBufferMinutes   Int      @default(15)
  allowTentativeAppointments    Boolean  @default(true)
  tentativeHoldMinutes          Int      @default(20)
  requireTherapistAtBooking     Boolean  @default(true)
  requireRoomAtBooking          Boolean  @default(true)
  allowAutoAssignment           Boolean  @default(true)
  chargeTiming                  String   @default("AT_BOOKING") // AT_BOOKING | AT_COMPLETION
  cancellationCutoffHours       Int      @default(4)
  lateCancellationChargeType    String   @default("NONE")       // NONE | FULL | PERCENTAGE | FIXED
  lateCancellationChargeValue   Float?
  noShowChargeType              String   @default("NONE")
  noShowChargeValue             Float?
  noShowGraceMinutes             Int     @default(15)
  requireCancellationReason      Boolean @default(true)
  requireRescheduleReason         Boolean @default(false)
  updatedAt                     DateTime @updatedAt
}

// The parent booking record — one shared room, one shared time window, one folio
// charge. Multi-guest support (§3 row 7, Option A) lives one level down, in
// SpaAppointmentParticipant: each guest gets their own therapist, but there is
// exactly one SpaAppointment per booked session, not one per guest. No
// appointmentNumber field, matching ExcursionBooking exactly (identified by id;
// nothing else in this app's add-on modules mints a human-readable booking number).
model SpaAppointment {
  id                    String   @id @default(uuid())
  propertyId            String   // denormalized, same reasoning as ExcursionBooking.propertyId
  property              Property @relation(fields: [propertyId], references: [id])
  treatmentId           String
  treatment             SpaTreatment @relation(fields: [treatmentId], references: [id])
  treatmentNameSnapshot String
  durationMinutesSnapshot Int
  preparationBufferMinutesSnapshot Int
  cleanupBufferMinutesSnapshot     Int
  // Number of guests sharing this appointment, 1..treatment.maxParticipants at
  // booking time — must equal participants.length.
  partySize             Int      @default(1)
  // Total price for the WHOLE appointment (all participants), computed and locked
  // at booking time, ALWAYS — regardless of chargeTiming. A later rate/tax-profile
  // edit, or a deferred AT_COMPLETION posting, must never recompute this;
  // chargeTiming only controls WHEN the FolioLineItem is created, never WHEN the
  // price is determined. No split-billing across participants in v1 — see §3 row 7.
  priceSnapshot         Float
  currencySnapshot      String

  appointmentDate       DateTime  // date-only component
  startTime             String    // "HH:MM"
  treatmentEndTime      String    // startTime + durationMinutesSnapshot
  blockedUntilTime      String    // treatmentEndTime + cleanupBufferMinutesSnapshot — the real resource-hold end

  // The one shared room for the whole party (capacity must be >= partySize).
  // Nullable so a booking can be saved before room assignment when
  // SpaSettings.requireRoomAtBooking is false.
  roomId                String?
  room                  SpaRoom? @relation(fields: [roomId], references: [id])

  appointmentStatus     String   @default("TENTATIVE") // TENTATIVE|CONFIRMED|CHECKED_IN|IN_TREATMENT|COMPLETED|NO_SHOW|CANCELLED
  paymentStatus         String   @default("NOT_POSTED") // NOT_POSTED|POSTED_TO_FOLIO|PARTIALLY_PAID|PAID|VOID_PENDING|VOIDED|REFUND_REQUIRED|REFUNDED
  source                String   @default("FRONT_DESK")

  // Billing is single-folio (§3 row 7) — resolved from the participantIndex: 1
  // participant's guest identity, regardless of partySize.
  folioId               String?
  folio                 Folio? @relation(fields: [folioId], references: [id])
  folioLineItemId       String? @unique
  folioLineItem         FolioLineItem? @relation(fields: [folioLineItemId], references: [id])
  refundPaymentId       String?
  refundPayment         Payment? @relation(fields: [refundPaymentId], references: [id])

  participants           SpaAppointmentParticipant[]

  notes                 String?
  internalNotes          String? // operational notes only — no medical-record storage in v1, see §21
  cancellationReasonCode String?
  cancellationNotes      String?

  bookedByUserId         String
  cancelledByUserId      String?
  completedByUserId      String?
  checkedInAt           DateTime?
  treatmentStartedAt    DateTime?
  completedAt           DateTime?
  cancelledAt           DateTime?
  noShowAt              DateTime?

  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([propertyId, appointmentDate])
  @@index([roomId, appointmentDate])
}

// One row per guest within a SpaAppointment. This is where the actual "multi-
// resource" part of Option A lives: each participant is independently qualified,
// independently checked for availability, and independently assigned a therapist —
// two participants on the same appointment can never end up with the same
// therapist (they're needed in the same room at the same time). participantIndex 1
// is always the billing anchor (see SpaAppointment.folioId above); participantIndex
// has no other ordering meaning beyond "1 is primary."
model SpaAppointmentParticipant {
  id              String         @id @default(uuid())
  appointmentId   String
  appointment     SpaAppointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  participantIndex Int           @default(1)

  // XOR guest identity, validated in-route — same convention as
  // ExcursionBooking/OutletAppointment. guestType (IN_HOUSE|WALK_IN) is derived from
  // which of these is set, not stored separately — one source of truth.
  reservationId      String?
  reservation        Reservation? @relation(fields: [reservationId], references: [id])
  walkInGuestName    String?
  walkInGuestContact String?

  // Nullable so a booking can be saved before therapist assignment when
  // SpaSettings.requireTherapistAtBooking is false.
  therapistId     String?
  therapist       SpaTherapist?  @relation(fields: [therapistId], references: [id])

  // Per-participant operational notes (pressure preference, etc.) — same restricted-
  // notes-only caveat as SpaAppointment.internalNotes, see §21.
  notes           String?

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([therapistId])
  @@index([appointmentId])
}
```

Existing models gain only back-relation lists (`Property.spaTreatmentCategories` /
`.spaAppointments` / etc., `ChargeCode.spaTreatments`, `Folio.spaAppointments`,
`FolioLineItem.spaAppointment`, `Reservation.spaAppointmentParticipations`,
`Payment.refundedSpaAppointments`) — same mechanical pattern as Excursions' additions.

**Overlap queries** used for hard-blocking (§7), run inside the booking transaction:
- **Room**: `existing.roomId = requested.roomId AND existing.startTime <
  requested.blockedUntilTime AND existing.blockedUntilTime > requested.startTime`,
  restricted to `SpaAppointment.appointmentStatus IN (CONFIRMED, CHECKED_IN,
  IN_TREATMENT)` plus `TENTATIVE` rows younger than `tentativeHoldMinutes`.
- **Therapist**: same time-window predicate, but joined through
  `SpaAppointmentParticipant.therapistId = requested.therapistId` up to its parent
  `SpaAppointment` for the date/time/status filter — checked independently per
  participant being assigned, so two participants on the same new appointment can
  never be assigned the same therapist even before either is persisted.

---

## 5. Property module access & RBAC matrix

| Module | Action | Who (default roles) | Gates |
|---|---|---|---|
| `CONTROLS` | create/update/delete | Admin, Manager | Treatment categories, treatments, rates, rooms, therapists, skills, schedules/exceptions, cancellation policy, `SpaSettings` |
| `SPA` | view | Front Desk, Admin, Manager | View schedule/tape chart, appointment details |
| `SPA` | create | Front Desk, Admin, Manager | Book, reschedule (within cutoff), check-in, start treatment, complete |
| `SPA` | update | Front Desk, Admin, Manager | Edit notes, cancel before cutoff, mark no-show (if allowed by settings) |
| `SPA` | delete | Admin, Manager only | Manager override: late cancellation, working-hour/qualification/room-compatibility override, price override, reopen completed appointment, reassign after therapist absence |
| `CASHIERING` | update | Cashier, Admin, Manager | Void a posted charge (as part of cancel) |
| `CASHIERING` | create | Cashier, Admin, Manager | Post payment / refund payment on a walk-in folio |
| Osta `ctx.isInternal` + `CONTROLS update` | — | Osta staff only | Enable/disable `PropertyModuleAccess` for `"SPA"` |

Every route: `requireSession()` → `requirePermission(ctx, "SPA"|"CONTROLS", action)` →
`assertPropertyModuleAccess(ctx, propertyId, "SPA")` → business logic → `logActivity()`
→ `toErrorResponse()` catch — the identical skeleton every Excursions route uses.

---

## 6. Appointment lifecycle

```
TENTATIVE → CONFIRMED → CHECKED_IN → IN_TREATMENT → COMPLETED
     ↘           ↘            ↘             ↘
      CANCELLED  CANCELLED   CANCELLED*   (no further transition)
                              NO_SHOW (only before CHECKED_IN, after scheduled start + grace)
```
`*` cancelling after `IN_TREATMENT` requires manager override (`SPA delete`) — matches
the original request's "cancellation after treatment started" requirement.

`paymentStatus` is tracked independently and never inferred from `appointmentStatus`.
`COMPLETED` does not auto-release the resource before `blockedUntilTime` unless staff
explicitly shortens the appointment — prevents accidental double-booking while
cleanup is still nominally underway.

---

## 7. Therapist/room availability & concurrency

**Availability calculation** (server-computed at slot-picker time, and **re-validated
identically** at save time — never trust a client-cached slot list). Room and therapist
availability are computed separately, since a room is shared by the whole party but
each participant needs their own therapist:

*Room candidates* (one per appointment, regardless of `partySize`):
1. `SpaTreatmentRoom` compatible rooms (or `roomType` match if no explicit mapping
   rows exist for that treatment), filtered to `capacity >= partySize`.
2. Subtract rooms with a `SpaRoomAvailabilityException` covering the slot.
3. Subtract rooms with an overlapping blocking `SpaAppointment` (§4's room overlap
   query).

*Therapist candidates* (computed independently per participant slot, 1..`partySize`):
1. `SpaTherapistTreatment.qualified = true` for the treatment.
2. Subtract therapists with a `SpaTherapistAvailabilityException` covering the slot.
3. Restrict to therapist working hours (`SpaTherapistSchedule` for that day-of-week,
   respecting `effectiveFrom/To`).
4. Subtract any therapist with an overlapping blocking `SpaAppointment` via
   `SpaAppointmentParticipant` (§4's therapist overlap query) — **and** subtract
   whichever therapists have already been picked for an earlier participant slot
   *within this same booking attempt*, so two participants on one new appointment can
   never land on the same therapist.

**Auto-assignment rule** (deterministic, not random): for the room — available for the
full `blockedUntilTime` window → prefers a `SpaTreatmentRoom.preferred = true` match →
stable tie-break by `room.id`. For each participant's therapist, assigned in
`participantIndex` order (1 first) so each later pick already excludes earlier picks:
qualified → available for the full `blockedUntilTime` window → prefers
`SpaTherapistTreatment.preferred = true` → lowest appointment-participant count that
day (workload balancing) → stable tie-break by `therapist.id`.

**Concurrency strategy — corrected during review.** An earlier draft of this plan
asserted "SQLite serializes writes, so a `$transaction` alone is race-safe" as if it
were a given. Checked: `prisma/schema.prisma`'s datasource block has no
`connection_limit`/WAL/`busy_timeout` configured, and `src/lib/db.ts` doesn't set any
either — so that claim was an assumption about Prisma's default SQLite connection
behavior, not a verified guarantee, and this is precisely the one requirement
explicitly called out as too important to leave to an unverified assumption.
Corrected approach, in order of preference:
1. **Verify first**: before relying on anything, check the actual `connection_limit`
   Prisma is using for this SQLite datasource (settable via the `DATABASE_URL` query
   string) — if it's genuinely 1, the original claim holds and step 2 becomes a
   defence-in-depth belt-and-braces rather than the only line of defence.
2. **Real safeguard regardless of what step 1 finds**: since this app runs as a single
   Node.js process (no evidence anywhere in this codebase of horizontal scaling or a
   multi-instance deployment), add a small in-process keyed async mutex (e.g. a
   `Map<string, Promise>` keyed by `` `${propertyId}:therapist:${therapistId}` `` /
   `` `${propertyId}:room:${roomId}` ``) that the booking/reschedule route acquires —
   for a multi-participant booking, **all** locks (one room key + one key per
   assigned therapist) are acquired together before the `$transaction` opens and
   released together after it settles, so a partial lock set is never held — and
   releases after it commits. This makes the overlap-check → insert sequence provably
   atomic at the JS level regardless of what the SQLite connection pool does
   underneath, costs nothing at this app's scale, and doesn't require a new external
   dependency (a ~20-line utility).
3. **This is explicitly a single-process answer.** If the app ever runs multiple
   instances against a shared database, an in-process mutex stops being sufficient and
   this needs revisiting with real row-level locking or a unique-constraint-based
   scheme — flagged so it isn't forgotten (room inventory checks have the same latent
   gap today, per the codebase review — this plan doesn't fix that pre-existing gap,
   only avoids repeating it for Spa).

**Stale `TENTATIVE` appointments**: a hold that ages past `tentativeHoldMinutes` stops
*blocking* other bookings (query-time `createdAt` comparison, no cron needed) but the
row itself doesn't automatically become `CANCELLED` — it would otherwise sit forever
looking "tentative" in the UI. Resolve this with lazy expiry: any read path (tape
chart, appointment list) that encounters a `TENTATIVE` row past its hold window flips
it to `CANCELLED` with `cancellationReasonCode: "HOLD_EXPIRED"` before returning it.
No new background job needed, consistent with how this app avoids cron-driven state
changes elsewhere (Night Audit is the one exception, and it's explicitly
operator-triggered, not scheduled).

**Blocking rule**: `CONFIRMED`/`CHECKED_IN`/`IN_TREATMENT` always block. `TENTATIVE`
blocks only within `tentativeHoldMinutes` of creation. `CANCELLED`/`COMPLETED`/
`NO_SHOW` never block.

---

## 8. Pricing & folio integration

Mirrors Excursions' `resolveChargeTax()` → snapshot → `FolioLineItem` pattern exactly,
with one deliberate improvement: stamp `FolioLineItem.date` via `resolveBusinessDate()`
(the convention `/api/pos/charge` uses) rather than Excursions' own `new Date()`
inconsistency — worth doing correctly from the start rather than copying a known wart.

- **Price/tax is always resolved and snapshotted at booking time**, in both timing
  modes — `chargeTiming` only controls *when the FolioLineItem is created*, never when
  the price is determined (see the `priceSnapshot` comment in §4). This is a direct
  fix from an earlier draft of this plan, which wrongly had `AT_COMPLETION`
  re-resolving the rate at completion — that would silently let a rate/tax-profile
  edit made between booking and completion change what the guest is charged,
  contradicting the "never silently alter a posted financial amount" requirement.
- `AT_BOOKING` (default): appointment + `FolioLineItem` created together in one
  `$transaction`, exactly like `ExcursionBooking`. For an in-house guest this needs an
  already-open folio (existing reservation); for a walk-in, `POST /api/folios/walk-in`
  opens the bare folio first, exactly like Excursions.
- `AT_COMPLETION`: appointment created with `folioId: null`, `folioLineItemId: null`,
  `paymentStatus: NOT_POSTED`, but `priceSnapshot`/`currencySnapshot` already fixed.
  **Walk-in identity gap, and how it's resolved**: Excursions always reads walk-in
  identity off the folio (`Folio.walkInGuestName`) because it always creates the
  folio at booking time. `AT_COMPLETION` cannot assume a folio exists yet at booking,
  so `SpaAppointmentParticipant.walkInGuestName`/`walkInGuestContact` (on the
  `participantIndex: 1` row — the billing anchor, see §4) are captured directly at
  booking time instead. The "Complete" action then either finds that guest's
  already-open folio (in-house) or opens a new walk-in folio using the captured
  identity (walk-in), and posts the `FolioLineItem` using the already-locked
  snapshot, in the same transaction as the `COMPLETED` status flip.
- Walk-in pay-now/pay-later: identical to Excursions once a folio exists —
  `WalkInFolioPanel` handles it with zero new payment UI.
- In-house: posts to the reservation's existing open folio, respecting the same
  closed-folio and posting-restriction checks `/api/pos/charge` already enforces.

---

## 9. Cancellation, no-show, void, refund

Direct copy of Excursions' Phase 4 pattern (`.agents/docs/EXCURSIONS_PLAN.md:373-413`),
which was itself corrected mid-build by live-testing — reuse it rather than
re-discovering the same lessons:
- Cutoff window (`SpaSettings.cancellationCutoffHours`): within it, `SPA update`
  cancels freely; past it, requires `SPA delete` (manager override).
- Voiding the posted charge requires an **independent** `CASHIERING update` check; if
  missing, the appointment still cancels, the charge is left in place, and the
  response carries a clear "needs cashiering" note — never silently hidden in free text.
- A closed folio blocks voiding outright ("finalized document") — cancellation still
  succeeds operationally, refund becomes an explicit manual `Payment(isRefund: true)`
  by cashiering staff, never automatic.
- Structured cancellation reasons stored as `cancellationReasonCode` (string
  constants, matching the app's "string not DB enum" convention) + `cancellationNotes`
  (required when code = `OTHER`, enforced in the route).
- No-show: only markable once `combineAppointmentDateTime(appointmentDate, startTime)
  + noShowGraceMinutes <= now` — same guard as Excursions' departure-passed check.
  Applies the configured `noShowChargeType`/`Value`; a manager can waive it with
  `SPA delete` + mandatory reason.
- **Implementation note for Phase 5**: it's not yet confirmed from this review whether
  Excursions' cancel route calls a shared, extractable void helper or just inlines
  `isVoid: true` + the `ReservationTrace` write directly in its own route. Before
  writing Spa's cancel route, check which — if it's inlined, extract a shared
  `voidFolioLineItem()` helper into `src/lib` at that point rather than copying the
  same isVoid/trace logic a third time (Spa would be the second consumer after
  Excursions, exactly when it's worth extracting).

---

## 10. Tape-chart / calendar UI

New component (no reusable scheduler exists — see §1.9), `src/components/front-office/spa-tape-chart.tsx`:
- Rows = therapists or rooms (toggle), columns = time slots (`slotIntervalMinutes`).
- Appointment blocks: start/end, guest name, room-number-or-"Walk-in", treatment,
  status badge (`StatusBadge`, reused), payment indicator, warning icon for
  unassigned/conflicted appointments.
- Click empty slot → new-appointment drawer (`Sheet`, same pattern as
  `WalkInFolioPanel`/`ExcursionManifestPanel`). Click block → appointment detail drawer
  (guest, treatment, therapist, room, schedule, price, folio, notes, audit timeline,
  cancel/reschedule actions).
- Drag-to-reschedule / drag-between-therapist-or-room: client emits an intent, but the
  server re-runs the **full** availability/overlap/qualification/permission check
  before committing — a drag can never bypass validation.
- Reuses `SearchableSelect` (guest/therapist/room pickers), `DatePicker` (date nav),
  `EmptyState`/`Skeleton` (loading), horizontal-scroll + sticky-first-column layout for
  tablet use.

---

## 11. Setup pages

A new "Spa" tab inside the existing Controls dashboard (`controls-dashboard.tsx`),
mirroring `excursions-manager.tsx`'s RHF+Zod dialog/table pattern:
Treatment Categories → Treatments (+ nested Rates dialog, `useFieldArray`) →
Therapists (+ nested Skills matrix, + Schedule/Exceptions manager) → Rooms (+
Treatment-compatibility matrix, + Availability Exceptions) → Cancellation Policy →
Spa Settings. All gated by `CONTROLS`, all using `SearchableSelect` for the charge-code
picker per the app's own component standard.

---

## 12. Reporting plan

All property-scoped, all derived from `SpaAppointment` (operational fields) joined to
actual `FolioLineItem`/`Payment` rows for revenue figures — **no duplicated financial
totals stored on Spa tables**: daily appointment list, by-treatment/therapist/room,
therapist/room utilization, revenue by therapist/category, in-house-vs-walk-in split,
cancellation rate + reasons, no-show rate, average treatment value,
discounts/complimentary log, pending-cashier-action queue, unpaid walk-in folios,
occupancy-by-time-of-day, most-requested treatments, rescheduled count. Deferred to
Phase 7 (functional but not the initial booking-flow priority). **Caveat**: the
existing Reports module's actual data-fetching/UI pattern wasn't deeply reviewed in
this pass — re-check its conventions specifically before starting Phase 7 rather than
assuming this section's shape is final.

---

## 13. Audit plan

Reuses `logActivity()`/`UserActivityLog` exactly, with `module: "CONTROLS"` for catalog
mutations and `module: "SPA"` for operational ones (same split as the permission
model). Logged actions: module enable/disable, settings change, every catalog
create/edit, appointment create/reschedule/cancel/no-show/check-in/start/complete,
therapist/room reassignment (absence/closure handling), price override,
complimentary-treatment approval, charge posted/voided, refund required/completed —
all following the existing `{ctx, module, action, entityType, entityId, description,
metadata}` shape.

---

## 14. Notifications readiness

No existing notification/messaging-channel abstraction was found anywhere in this
codebase during review (only `generateTablePdf`, used for Excursions' manifest and
reused here for a printable appointment confirmation). V1 ships the printable
confirmation only; email/SMS/WhatsApp channels are explicitly out of scope until a
shared notification abstraction exists elsewhere in the app.

---

## 15. Edge cases — how each is actually prevented, mapped to the mechanisms above

Concurrent therapist/room double-book (§7 hard block + transaction), duration crossing
closing time (slot generation excludes slots whose `blockedUntilTime` exceeds
`defaultClosingTime`, `SPA delete` override to allow it deliberately), midnight-crossing
appointments (out of scope for v1 — spa operating hours assumed same-day; flagged as a
known v1 limitation), therapist shift ending mid-treatment (excluded from valid slots
by the working-hours check in §7 step 4), room/therapist closure added after
appointments exist (exception queue — surfaces affected future appointments, no silent
auto-cancel), guest checkout/room-change before appointment (guest-stay-date warning at
booking + a nightly reconciliation query flagging appointments now outside stay dates
into the exception queue), closed folio before treatment (booking still proceeds if
unposted; `AT_BOOKING` mode would have already posted, so cancellation-refund rules in
§9 apply), walk-in pay-then-cancel (refund is manual `Payment(isRefund:true)`, same as
Excursions), rate/tax change after booking (never affects an existing appointment
either way — price/tax is snapshotted at booking time regardless of `chargeTiming`, see
§8), reschedule to a different rate day (kept at the original snapshot unless staff
explicitly repriced — never silently alter a posted financial amount), unqualified
therapist / incompatible room (excluded from candidates in §7, overridable only via
`SPA delete`), moved twice (a `rescheduledToAppointmentId`-style guard mirroring
Excursions' `movedToBookingId` double-move fix — checked before allowing a second
reschedule of the same origin), duplicate same-guest/same-time booking (soft warning at
booking time, not a hard block — a guest legitimately might want two treatments back to
back; only resource conflicts are hard-blocked), no-show marked early (blocked by the
grace-period guard in §9), completed-appointment reopen (requires `SPA delete`,
logged), module disabled with future appointments (below), appointment outside stay
dates (warning + manager override, not a hard block), booking on behalf of another
guest (out of scope for v1 — same identity model as Excursions/OutletAppointment, no
delegated-booking concept exists anywhere in this app to extend), room-posting blocked
on reservation (respected the same way `/api/pos/charge` already respects it — reused,
not reimplemented), age-restricted treatment (deferred — no age/minor concept exists on
`Reservation`/`Profile` today to key off; flagged as needing a platform-level answer,
not a Spa-only one), zero/negative discount (a complimentary/discount action requires
`SPA delete` + reason + snapshot of original price, never a free-typed amount),
folio-succeeds-appointment-fails or vice versa (impossible by construction — both
created in one `$transaction`, matching Excursions' exact "a booking never exists
without its charge" guarantee).

**Module disable behaviour**: disabling `PropertyModuleAccess` for `"SPA"` blocks
new-appointment creation and general access immediately, never deletes history, and
the Osta toggle UI is extended (Phase 0, small addition beyond what Excursions needed)
to show a pre-disable summary: future appointment count, open walk-in folios, pending
refund/cashiering-queue items — requiring explicit confirmation before disabling if any
of those are non-zero.

---

## 16. Phased implementation sequence (files listed are new unless marked "edit")

**Phase 0 — Module registration + schema**
- Edit `src/lib/modules.ts` (add `"SPA"`, label), `prisma/rbac-seed-data.ts` (add
  `"SPA"` to its own MODULES copy + default role matrices), `src/components/osta/property-module-access-manager.tsx`
  (extend `ADD_ON_MODULES` filter + pre-disable summary UI).
- `prisma/schema.prisma` — all models in §4. One migration via `prisma migrate diff
  --script` + `migrate deploy` (never `migrate dev`, per `MASTER_PLAN.md`'s tooling
  note).
- No new lib/route code yet. *Required for v1.*

**Phase 1 — Controls catalog**
- `src/lib/spa.ts` (pure helpers mirroring `excursions.ts`: rate lookup, overlap
  validation, `computeTreatmentPrice`, `combineAppointmentDateTime`).
- `src/app/api/spa/treatment-categories/route.ts` (+`[id]`), `.../treatments/route.ts`
  (+`[id]`, nested rates), `.../therapists/route.ts` (+`[id]`, skills, schedules,
  exceptions), `.../rooms/route.ts` (+`[id]`, compatibility, exceptions),
  `.../settings/route.ts`.
- `src/components/controls/spa-treatments-manager.tsx`,
  `spa-therapists-manager.tsx`, `spa-rooms-manager.tsx`, `spa-settings-form.tsx`, tab
  entry in `controls-dashboard.tsx`.
- *Required for v1.*

**Phase 2 — Availability engine + in-house booking**
- `src/lib/spa-availability.ts` (candidate computation, auto-assign rule, overlap
  check — the algorithm in §7).
- `src/lib/spa-resource-lock.ts` (the in-process keyed mutex from §7's corrected
  concurrency strategy — a small, standalone utility, not entangled with the
  availability logic itself).
- `src/app/api/spa/appointments/route.ts` (GET list / POST create, `$transaction`
  with folio posting per `AT_BOOKING`), `.../appointments/[id]/route.ts` (GET detail).
- `src/app/e/[slug]/dashboard/spa/page.tsx` (in-house flow first, modeled on
  `excursions/page.tsx`'s search UI).
- *Required for v1.*

**Phase 3 — Walk-in flow**
- Extend `POST /api/spa/appointments` to accept `folioId` as the walk-in alternative
  to `reservationId` (same XOR pattern), wire in `WalkInFolioPanel`.
- *Required for v1.*

**Phase 4 — Tape chart / calendar UI**
- `src/components/front-office/spa-tape-chart.tsx`, drag-and-drop reschedule wired to
  a `PATCH /api/spa/appointments/[id]/reschedule` route that fully revalidates
  server-side.
- *Required for v1 — this is the primary operational surface requested.*

**Phase 5 — Lifecycle: check-in, treatment, completion, cancellation, no-show**
- `.../appointments/[id]/check-in`, `/start-treatment`, `/complete`, `/cancel`,
  `/no-show` routes, each following the exact permission/cashiering-degradation
  pattern in §9.
- `AT_COMPLETION` charge-timing branch.
- *Required for v1.*

**Phase 6 — Therapist absence & room closure reassignment + exception queue**
- Affected-appointments lookup when an exception/closure is added, reassignment UI,
  the operational task/exception queue.
- *Recommended for v1 given a small spa's real operational needs, but safely
  deferrable to a fast-follow if timeline is tight — flagging as the one phase that
  could slip without blocking a usable v1.*

**Phase 7 — Reports**
- *Deferrable to fast-follow; revenue already flows into existing charge-code reports
  automatically (§12), so this is additive, not a blocker.*

**Phase 8 — Tests, seed data, docs**
- *Required before calling v1 done* — see §18/§19.

**Explicitly deferred beyond v1** (schema-compatible, not built now): full
multi-participant couple/group treatments (§3.7), `SpaPackage`/`GuestSpaPackage`
prepaid-session model, membership/loyalty entitlements, email/SMS notifications.

---

## 17. Exact files expected to be created or modified

**New:**
`src/lib/spa.ts`, `src/lib/spa-availability.ts`, `src/lib/spa-resource-lock.ts`,
`src/app/api/spa/treatment-categories/route.ts` (+`[id]/route.ts`),
`src/app/api/spa/treatments/route.ts` (+`[id]/route.ts`),
`src/app/api/spa/therapists/route.ts` (+`[id]/route.ts`, `[id]/skills/route.ts`,
`[id]/schedule/route.ts`, `[id]/exceptions/route.ts`),
`src/app/api/spa/rooms/route.ts` (+`[id]/route.ts`, `[id]/exceptions/route.ts`),
`src/app/api/spa/settings/route.ts`,
`src/app/api/spa/appointments/route.ts` (+`[id]/route.ts`,
`[id]/check-in/route.ts`, `[id]/start-treatment/route.ts`, `[id]/complete/route.ts`,
`[id]/cancel/route.ts`, `[id]/no-show/route.ts`, `[id]/reschedule/route.ts`,
`[id]/confirmation-pdf/route.ts`),
`src/components/controls/spa-treatments-manager.tsx`,
`src/components/controls/spa-therapists-manager.tsx`,
`src/components/controls/spa-rooms-manager.tsx`,
`src/components/controls/spa-settings-form.tsx`,
`src/components/front-office/spa-tape-chart.tsx`,
`src/components/front-office/spa-appointment-drawer.tsx`,
`src/app/e/[slug]/dashboard/spa/page.tsx`,
`src/app/osta/properties/[id]/page.tsx` (if not already created by Excursions — reuse
if it exists),
`tests/tenant-isolation/spa.test.ts`, `tests/business-rules/spa.test.ts`.

**Edit:**
`prisma/schema.prisma`, `src/lib/modules.ts`, `prisma/rbac-seed-data.ts`,
`src/components/osta/property-module-access-manager.tsx`,
`src/components/controls/controls-dashboard.tsx` (new tab),
`src/components/app-sidebar.tsx` (nav item gated by `SPA` + current property's
`PropertyModuleAccess`), `scripts/seed/seed-veyo.ts`, `.agents/docs/TODO.md`,
`.agents/docs/DECISIONS.md`.

**Not touched:** `src/lib/scope.ts`, `src/lib/tax-calc.ts`, `src/lib/activity-log.ts`,
`src/lib/business-date.ts`, any `Folio`/`Payment`/`ChargeCode` route — all reused as-is.

---

## 18. Seed data plan

Extend `scripts/seed/seed-veyo.ts` (idempotent, run-twice-safe, matching Excursions'
convention): enable `PropertyModuleAccess` for Veyo's property; 3 therapists with
different skill sets; 3 rooms (2 standard + 1 couple-capable); 6 treatments across
3-4 categories (Swedish Massage 60min, Deep Tissue Massage 60min, Balinese Massage
90min, Foot Massage 30min, Facial Treatment 45min, Couple Massage 60min) each with a
charge code and a standard rate; realistic buffers (10min prep, 15min cleanup); a
spread of sample appointments covering in-house/walk-in, every status (confirmed,
completed, cancelled, no-show), across different therapists/rooms/days, plus at least
one deliberate resource-conflict scenario for manual QA.

---

## 19. Automated test plan

`tests/tenant-isolation/spa.test.ts` — mirrors `excursions.test.ts` exactly:
cross-enterprise 403 on every route (catalog, therapists, rooms, appointments),
PROPERTY-scoped guard, add-on-off-by-default 403, Osta-only-toggle 403, IDs from one
property never resolving against another.

`tests/business-rules/spa.test.ts` — unit tests for `spa.ts`/`spa-availability.ts`
helpers (`combineAppointmentDateTime`, `computeTreatmentPrice`, overlap detection,
auto-assign ordering) plus route-level integration tests: therapist qualification
enforcement, hard double-book rejection (therapist and room, separately), buffer-time
overlap, working-hours enforcement, room compatibility, cancellation cutoff
(non-manager blocked past cutoff, manager allowed), no-show grace-period gate, rate/
tax snapshot immutability, in-house folio posting, walk-in billing (`WalkInFolioPanel`
flow), closed-folio cancellation (charge left in place, `chargeNote` present), reopen-
completed requiring manager permission, `AT_BOOKING` vs `AT_COMPLETION` charge timing,
concurrent-booking race (two near-simultaneous requests for the same therapist+slot —
assert exactly one succeeds), module-disabled 403, double-reschedule guard.

---

## 20. Live-testing checklist (before calling any phase done)

Enable the add-on as Osta → verify a non-Osta admin cannot → create categories/
treatments/rates/therapists/skills/rooms/compatibility/schedules → book an in-house
appointment (search by room number) with auto-assignment → book one with manual
therapist/room selection → attempt to double-book the same therapist at an
overlapping time from a second session and confirm it's rejected → book a walk-in,
verify `WalkInFolioPanel` payment/close flow → verify tax/service-charge split on the
posted `FolioLineItem` matches `resolveChargeTax`'s math → check-in → start
treatment → complete → confirm folio state and `paymentStatus` → cancel one within
cutoff (voids charge) and one past cutoff as non-manager (403) then as manager
(succeeds, requires reason) → mark a no-show before start time (rejected) and after
(accepted) → cancel a closed-folio appointment (charge left in place, note shown) →
reschedule via drag on the tape chart, confirm server-side re-validation actually
blocks an invalid drop target → add a therapist absence exception and confirm existing
future appointments surface in the exception queue → add a room closure and confirm
the same → print a confirmation PDF → view the tape chart on a narrow/tablet viewport
→ disable the module and confirm the pre-disable summary + confirmation prompt, then
confirm the module blocks new bookings while preserving history.

---

## 21. Risks & trade-offs

- **No property-timezone concept anywhere in the app** (§3.6) — a real, pre-existing
  platform gap, not something introduced by this plan. Spa inherits the same latent
  same-day/past-time bug class Excursions already hit once; mitigated by
  `combineAppointmentDateTime()` + explicit regression tests, but not eliminated.
- **Concurrency safeguard is an in-process mutex, not a database guarantee** (§7,
  corrected during review from an earlier, unverified "SQLite serializes everything"
  assumption) — correct and sufficient for this app's actual single-process
  deployment shape, but explicitly stops being sufficient if the app ever runs
  multiple instances against a shared database; flagged so it isn't forgotten, and
  worth a quick check of the real `connection_limit` in use before Phase 2 starts.
- **No existing generic scheduler/calendar component** (§1.9) — the tape-chart UI
  (Phase 4) is genuinely new, nontrivial UI work, the single biggest build effort in
  this plan; not a reuse opportunity like almost everything else.
- **`AT_COMPLETION` charge timing** (§3.8) roughly doubles the payment-state surface
  area (posted-at-booking vs. deferred-until-completion, with different rate/tax-drift
  behavior) — kept in v1 because it's an explicitly confirmed requirement, but it's the
  single largest scope/complexity add in this plan and the first thing to cut if the
  timeline is tight (fall back to `AT_BOOKING`-only, ship `AT_COMPLETION` as a fast
  follow).
- **Couple/group treatments are genuinely Option A now** (§3 row 7, confirmed
  2026-07-23) — `SpaAppointmentParticipant` is new ground for this codebase (no
  existing multi-resource booking pattern to lean on), so it carries more
  implementation and testing risk than the rest of this plan, which is largely
  "do what Excursions already did." Scoped narrowly (one room, one time window, one
  folio charge, independent per-participant therapists only) specifically to keep
  that risk bounded — a request for split billing or mixed-duration group sessions
  would need real rework, not a field addition.
- **Catalog permission grouping under `CONTROLS`** (§3.2) was confirmed matching
  Excursions' convention rather than the original request's `SPA_CONTROLS` wording.
- **Sensitive guest notes** (allergies, medical, pregnancy) use only the existing
  restricted operational-notes field (`internalNotes`) — no new permission tier or
  data-retention policy was found in this codebase to build a real sensitive-profile
  framework on top of, so this plan deliberately does not invent one; flagged as a
  privacy question worth a real answer before storing anything beyond free-text notes.

---

## 22. Open decisions

**Resolved 2026-07-23** (see the status header at the top of this doc):
1. ✅ Catalog permission under `CONTROLS` — confirmed, matches Excursions.
2. ✅ Couple/group treatments — **Option A, full multi-resource in v1** (overrides
   this plan's own Option B recommendation) — `SpaAppointment` +
   `SpaAppointmentParticipant`, see §3 row 7 and §4.
6. ✅ In-house guest identity — confirmed live-join via `reservationId`, now stored
   per-participant (§4).

**Still open, proceeding with the plan's recommendation, revisit without schema
rework if needed:**
3. `AT_COMPLETION` charge timing is in v1 scope per the confirmed operational
   preference — first thing to cut under time pressure if needed (fall back to
   `AT_BOOKING`-only).
4. Phase 6 (therapist absence/room closure reassignment + exception queue) is
   treated as required-for-v1 — safely deferrable to a fast-follow if timeline is
   tight.
5. Therapist schedules/availability exceptions gated under `CONTROLS` for v1 (§3's
   nuance note) — could move to `SPA update` later without a schema change, just a
   permission-check line in the route.
