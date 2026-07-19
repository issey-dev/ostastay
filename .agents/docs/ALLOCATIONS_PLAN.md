# Master Plan v2 — Allocations (Revenue Model Extension)

> **Status legend**: ✅ done · 🚧 in progress · ⬜ not started
> **Overall**: ✅ Phases A–E all done (2026-07-19), pending app-owner UI review.
> Plan authored 2026-07-19; all "Decisions assumed" were
> confirmed by the app owner same day with two refinements folded in below:
> **(a)** allocation prices are **adult/child only** — infants are never charged, so
> there is no `infantPrice` anywhere; **(b)** `AllocationRate` rows are **date ranges
> that must not overlap** (validated at save, like rate pricing), and room type / meal
> plan never affect an allocation's price.
>
> **Post-build correction (2026-07-19, owner feedback on the UI):** "Sell Separate" is
> **NOT a third value of `mode`** — it is an **independent boolean** (`sellSeparate`)
> alongside the Include-in-Rate / Add-to-Rate choice. Every allocation has a `mode`
> (INCLUDE_IN_RATE | ADD_TO_RATE) governing how it posts when part of a rate, AND a
> separate `sellSeparate` flag that, when on, additionally exposes it as a manual add-on
> in the reservation form — regardless of `mode`. All allocations are now linkable to
> rate/meal plans (the old "SELL_SEPARATE can't be linked" rule is gone). The 3-way
> radio became a 2-way radio + a switch. Migration `20260719140000_allocation_sell_separate`
> backfilled any old `mode='SELL_SEPARATE'` rows to `mode='ADD_TO_RATE', sellSeparate=true`.
> Also: the Rate Plan dialog was redesigned into a **two-column layout** (rate fields |
> chip-style allocation picker grouped by type, selected = highlighted).

This document is the implementation plan for **Allocations** — per-person, date-effective
priced components (Breakfast, Lunch, Dinner, Transfers, Spa, Excursions…) that attach to
Rate Plans (packages), Meal Plans, and Reservations, and post to folios at Night Audit.
It extends — does not replace — the existing revenue model (Rate Plans, Derived Rate
Plans, Price Calendar, Meal Plans).

---

## Context — what exists today and why it isn't enough

- **Rate Plans + Price Calendar** price the *room* per night, per room type, per date
  (`PriceCalendar`), with occupancy surcharges (`extraAdultPrice`/`extraChildPrice`).
- **Meal Plans** (`MealPlan`) are purely an informational LOV on the reservation
  (`Reservation.mealPlan` stores the code). Pricing a meal plan is currently done by
  creating a **Derived Rate Plan** (e.g. `BAR-BB` = `BAR` + $20 flat / +10%) — a
  *flat-or-percent room-rate adjustment* that **cannot express per-adult/child/infant
  pricing** ("BF: adult $10, child $5, infant $0"), can't post to its own F&B charge
  code (everything lands on `ROOM`), and can't vary by posting rhythm.
- **Night Audit** (`src/app/api/night-audit/run/route.ts`) is the posting engine: it
  posts the nightly room charge, extra-occupancy surcharge, and Green Tax per IN_HOUSE
  reservation. Meal plans deliberately post nothing today (see the comment at the meal
  plan section of that route).

The app owner now wants a first-class **Allocations** section under Revenue:

> "BF – Breakfast: adult $10, child $5, infant $0, effective-from date. Type: F&B.
> Charge Code: related charge code for internal purposes. Posting Rhythm: on arrival
> night / departure night / every night. Radio: **Include in Rate** (allocation price is
> inside the package rate) / **Add to Rate** (allocation price adds on top of the rate) /
> **Sell Separate** (attachable to a reservation without being attached to any rate).
> Examples: BF, LN, DN, Transfers (speed boat, taxi), Spa, Excursions. Needs a simple
> configuration + linking with rate codes for easy onboarding, and must be properly
> linked into the reservation process (dependent on dates / pax / meal plan / room type)."

---

## Architecture decisions

- **`Allocation` is Property-scoped** (like `RatePlan` and `MealPlan`, unlike
  enterprise-wide `ChargeCode`) — pricing and operational offerings differ per property;
  the linked `ChargeCode` stays enterprise-wide exactly as it does for Outlets.
- **Pricing lives in a dated child table (`AllocationRate`)** — date-range rows
  (`effectiveFrom`/`effectiveTo`, null `effectiveTo` = open-ended) with **no
  overlapping ranges allowed** (validated in the API at save, owner-confirmed —
  "similar to how rate pricing works"). The row covering the audit date wins; no row =
  the allocation posts nothing that night. Per-person split: `adultPrice` /
  `childPrice` only — **infants are never charged** (owner-confirmed; consistent with
  the Green Tax infant exemption).
- **One `mode` radio on the Allocation itself** (matches the owner's described UI):
  - `INCLUDE_IN_RATE` — when linked to a rate plan, the allocation's value is *carved
    out of* the room rate at posting: room line = rate − allocation total, allocation
    line = allocation total against its own charge code. Folio total unchanged;
    revenue attribution moves from ROOM to the allocation's charge code.
  - `ADD_TO_RATE` — when linked to a rate plan, the allocation posts *on top of* the
    room rate as its own line.
  - `SELL_SEPARATE` — never linked to rate plans; only attachable manually per
    reservation. (Manual attachment is additionally allowed for *any* active
    allocation regardless of mode — covering "attach despite not been attached to
    rate or not". A per-link mode override is a deliberate non-goal for v1; revisit
    only if a property needs the same allocation included in one package but additive
    in another.)
- **`postingRhythm`** plain-string enum (schema convention: no Prisma enums):
  `EVERY_NIGHT | ARRIVAL_NIGHT | DEPARTURE_NIGHT`. Extensible later (e.g.
  `EVERY_NIGHT_EXCEPT_ARRIVAL`) without migration since it's a string.
- **`type`** plain-string grouping for filtering/reporting only:
  `FNB | TRANSFER | SPA | EXCURSION | OTHER` — same convention as
  `ChargeCode.category` / `Outlet.outletType`.
- **Two link tables, one resolution path**:
  - `RatePlanAllocation` (ratePlanId ↔ allocationId) — "this package includes/adds
    these allocations". Explicit join model with its own id, matching
    `OutletChargeCode` convention.
  - `MealPlanAllocation` (mealPlanId ↔ allocationId) — "choosing meal plan BB on a
    reservation brings in BF". **This supersedes the 2026-07-19 decision that meal-plan
    pricing is done via Derived Rate Plans** — derived plans remain for room-rate-level
    adjustments, but per-person meal pricing now goes through allocations (a derived
    plan mathematically cannot price per pax). Record in DECISIONS.md when built.
  - `ReservationAllocation` (reservationId ↔ allocationId, `source: RATE_PLAN |
    MEAL_PLAN | MANUAL`) — the **materialized per-reservation attachment set**, written
    at reservation create/edit. Night Audit reads *only* this table (single source of
    truth at posting time; changing a rate plan's links later does not silently
    reprice in-house stays — same "assigned once" philosophy as folio document numbers).
    Optional per-attachment price overrides (`overrideAdultPrice` etc., nullable) for
    negotiated cases.
- **Resolution recipe** (shared lib, `src/lib/allocations.ts`): given a reservation's
  rate plan(s), meal plan, dates, pax → produce the attachment set + per-night amounts.
  Derived rate plans inherit their **parent's** allocation links (consistent with "a
  derived plan is parent + adjustment"); if the derived plan has its own links, they
  replace the parent's (checked first, single hop, mirroring `derived-rate.ts`).
- **Posting happens only at Night Audit**, alongside the existing room/extra-occupancy/
  Green Tax loop — allocations never post at booking time. Rhythm gate per audit night:
  - `ARRIVAL_NIGHT`: post only when audit date = check-in date.
  - `DEPARTURE_NIGHT`: post only on the *last night* of the stay (audit date =
    check-out date − 1 night).
  - `EVERY_NIGHT`: post each audited night of the stay.
- **Amount math per posting**: `adults × adultPrice + children × childPrice` (infants
  never charged), using the `AllocationRate` row covering the audit date, then through
  `resolveChargeTax` with the allocation's own charge code (so F&B GST/service-charge
  handling and any custom tax profile on the charge code Just Work). `INCLUDE_IN_RATE`
  additionally subtracts the allocation's *gross input* from the room-charge input
  before the room line is tax-resolved (clamped at zero — an allocation can never make
  the room line negative; if clamping occurs, post the room line at 0 and flag in the
  audit log notes rather than failing the audit).
- **Permissions**: configuration under the existing `REVENUE` module (view/create/
  update/delete); attaching to a reservation under `RESERVATIONS`. No new module —
  keeps the RBAC matrix stable.
- **Room-type dependency** is *not* a pricing dimension on `AllocationRate` in v1 —
  the owner's "dependent on room type" reads as the overall rate resolution (room type
  drives `PriceCalendar`), not per-room-type breakfast prices. Flagged under
  "Decisions assumed"; adding a nullable `roomTypeId` to `AllocationRate` later is a
  non-breaking migration.

## Schema (new models — no changes to existing models)

```prisma
model Allocation {
  id           String   @id @default(uuid())
  propertyId   String
  property     Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  code         String   // BF, LN, DN, TRF-SB, SPA-60...
  name         String   // "Breakfast", "Speedboat Transfer"
  type         String   @default("OTHER") // FNB | TRANSFER | SPA | EXCURSION | OTHER
  chargeCodeId String
  chargeCode   ChargeCode @relation(fields: [chargeCodeId], references: [id])
  postingRhythm String  @default("EVERY_NIGHT") // EVERY_NIGHT | ARRIVAL_NIGHT | DEPARTURE_NIGHT
  mode         String   @default("ADD_TO_RATE") // INCLUDE_IN_RATE | ADD_TO_RATE | SELL_SEPARATE
  isActive     Boolean  @default(true)

  rates                  AllocationRate[]
  ratePlanLinks          RatePlanAllocation[]
  mealPlanLinks          MealPlanAllocation[]
  reservationAllocations ReservationAllocation[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([propertyId, code])
}

model AllocationRate {
  id            String     @id @default(uuid())
  allocationId  String
  allocation    Allocation @relation(fields: [allocationId], references: [id], onDelete: Cascade)
  adultPrice    Float      @default(0)
  childPrice    Float      @default(0)
  effectiveFrom DateTime
  effectiveTo   DateTime?  // null = open-ended; ranges must not overlap (API-validated)
}

model RatePlanAllocation {
  id           String     @id @default(uuid())
  ratePlanId   String
  ratePlan     RatePlan   @relation(fields: [ratePlanId], references: [id], onDelete: Cascade)
  allocationId String
  allocation   Allocation @relation(fields: [allocationId], references: [id], onDelete: Cascade)
  createdAt    DateTime   @default(now())
  @@unique([ratePlanId, allocationId])
}

model MealPlanAllocation {
  id           String     @id @default(uuid())
  mealPlanId   String
  mealPlan     MealPlan   @relation(fields: [mealPlanId], references: [id], onDelete: Cascade)
  allocationId String
  allocation   Allocation @relation(fields: [allocationId], references: [id], onDelete: Cascade)
  createdAt    DateTime   @default(now())
  @@unique([mealPlanId, allocationId])
}

model ReservationAllocation {
  id            String      @id @default(uuid())
  reservationId String
  reservation   Reservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)
  allocationId  String
  allocation    Allocation  @relation(fields: [allocationId], references: [id])
  source        String      // RATE_PLAN | MEAL_PLAN | MANUAL
  // Nullable overrides for negotiated per-reservation pricing; null = use AllocationRate.
  overrideAdultPrice  Float?
  overrideChildPrice  Float?
  createdAt DateTime @default(now())
  @@unique([reservationId, allocationId])
}
```

(Existing models gain only the back-relation lists: `Property.allocations`,
`ChargeCode.allocations`, `RatePlan.allocationLinks`, `MealPlan.allocationLinks`,
`Reservation.allocations`.)

## Phases

### Phase A — Schema + core API ✅
- Migration for the five models above (`prisma migrate diff --script` +
  `migrate deploy`, per MASTER_PLAN tooling note — never `migrate dev` here).
- `src/app/api/allocations/route.ts` + `[id]/route.ts`: CRUD, `REVENUE` permission,
  `assertPropertyAccess`, charge-code must belong to the same enterprise; embedded
  `rates` management (create replaces/append dated rows; block deleting a rate row
  already used by a posted audit night — soft guidance, not enforced by FK).
- Link endpoints: `PUT /api/rate-plans/[id]` and `PUT /api/meal-plans/[id]` extended to
  accept `allocationIds: string[]` (validate same property; reject linking a
  `SELL_SEPARATE` allocation).
- `src/lib/allocations.ts`: `resolveReservationAllocations(...)` (attachment set from
  rate plan + meal plan + manual) and `allocationAmountForNight(...)` (rhythm gate +
  effective-dated pax math) — one shared module so reservation preview, night audit,
  and confirmation letter all agree, same pattern as `derived-rate.ts`/`tax-calc.ts`.

### Phase B — Revenue UI (configuration + onboarding) ✅
- New **Allocations** tab on the Revenue dashboard
  (`src/app/e/[slug]/dashboard/revenue/page.tsx`), between "Rate Plans" and "Rate
  Details": table (code, name, type badge, mode badge, rhythm, current price triplet,
  active), create/edit dialog per the owner's spec — code/name/type/charge-code select
  (SearchableSelect, standard component)/rhythm select/mode radio/dated price rows.
  Zod + React Hook Form per APP STANDARD 001.
- **Linking UX for onboarding**: on the Rate Plan dialog, a multi-select of the
  property's non-SELL_SEPARATE allocations ("Package includes"); mirrored allocation
  multi-select on the Meal Plans manager (Controls > Revenue) — so BB = {BF}, HB =
  {BF, DN} is a 30-second setup. Update the Meal Plans ControlsCard description text,
  which currently tells users to price meal plans via Derived Rate Plans only.
- Rate Plan table gains an allocations chip list so a package's contents are visible
  at a glance.

### Phase C — Reservation integration ✅
- Reservation create/edit (`src/app/e/[slug]/dashboard/reservations/page.tsx` + POST/
  PUT `/api/reservations`): materialize `ReservationAllocation` rows from the resolver
  (sources RATE_PLAN + MEAL_PLAN), and an **Add-ons picker** for manual attachments
  (any active allocation, incl. SELL_SEPARATE), with per-stay price preview computed
  from dates × rhythm × pax.
- On edit of dates/pax/rate plan/meal plan: re-materialize RATE_PLAN/MEAL_PLAN-sourced
  rows, preserve MANUAL rows and overrides.
- Reservation detail view: "Allocations" section listing attached items, source badge,
  computed stay total.

### Phase D — Night Audit posting ✅
- Extend `night-audit/run/route.ts` per-reservation loop: after the room charge and
  before Green Tax, iterate `ReservationAllocation` rows → rhythm gate → pax math →
  `resolveChargeTax` with the allocation's charge code → `FolioLineItem` (description
  e.g. "Breakfast (2 adults, 1 child)", `date: today`). `INCLUDE_IN_RATE` allocations
  reduce the room-charge input amount (clamped ≥ 0) before the room line posts.
- Idempotency note: night audit today has no double-run guard for room charges;
  allocations inherit the same behavior (do NOT build a bespoke guard only for
  allocations — flag the shared gap in TODO.md instead).
- Flash Report / revenue reporting needs no schema work — attribution falls out of
  charge-code categories (F&B revenue = FB-category charge codes, etc.).

### Phase E — Tests, seed, docs ✅
- `tests/business-rules/allocations.test.ts`: rhythm gating (arrival/departure/every
  night against multi-night stays), effective-date rate selection, pax math incl.
  infants, INCLUDE_IN_RATE room-line carve-out + clamp, ADD_TO_RATE additive posting,
  derived-plan link inheritance, meal-plan-sourced attachment.
- `tests/tenant-isolation/allocations.test.ts`: cross-enterprise/property access on
  every new route, charge-code same-enterprise validation — same harness as existing
  tenant-isolation suites.
- Seed: extend `scripts/seed/seed-veyo.ts` with BF/DN allocations, a BB meal plan
  linked to BF, and a package rate plan (e.g. `BAR-BB`) linking allocations.
- Docs: dated entry in `DECISIONS.md` (meal-plan pricing now via allocations,
  superseding derived-rate-only guidance), TODO.md updates, status flips here.

## Decisions — all confirmed by app owner 2026-07-19

1. ✅ **INCLUDE_IN_RATE = revenue carve-out** (room line reduced, folio total unchanged,
   internal attribution moves to the allocation's charge code).
2. ✅ **DEPARTURE_NIGHT posts on the last night** of the stay.
3. ✅ **Mode is one radio on the Allocation** — defined per allocation item/code. One
   allocation can be include-in-rate while another is add-to-rate, but a single
   allocation is never both.
4. ✅ **Meal-plan → allocation linking** (BB brings BF). Derived rate plans stay for
   room-rate adjustments.
5. ✅ **No per-room-type / per-meal-plan allocation pricing — ever** (owner: "prices are
   controlled by date only"). Prices defined for adults/children only; infants free.
6. ✅ **Manual attachment allowed for any active allocation**, not only SELL_SEPARATE.
7. ✅ **Attachment set is materialized at booking/edit time**, not re-resolved live at
   audit.
8. ✅ **AllocationRate date ranges must not overlap** — API-validated at save.
