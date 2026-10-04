# Transportation module — plan, decisions and status

> Status (2026-10-04): **BUILT** on branch `claude/transportation-module-pms-93kxk5` —
> Phase 1 (Hub configuration), Phase 2 (operations, billing), Phase 3 (Booking API, docs,
> release notes). Proposed version **8.5.0** — release-notes entry written, `package.json`
> NOT bumped (owner confirms after testing). Open items at the bottom.

## What it is

Per-property guest transfers, Maldivian shape: the **airport leg** (flight, airport rep) and
the **onward leg** (speedboat / seaplane / domestic flight / ferry / land), plus **local**
island-to-island transfers. Every transfer is a PICKUP (arrival) or DROP_OFF (departure).
**Shared departures (manifests)** are the core operational object. Strictly property-scoped:
every table carries `propertyId`, every lookup is `{ id, propertyId }`.

## Where things are

| Concern | Location |
|---|---|
| Schema | `prisma/schema.prisma` → `TransportSettings`, `TransportType`, `TransportLocation`, `TransportRoute`, `TransportProvider`, `TransportVessel`, `TransportRate`, `TransportManifest`, `TransportBooking`; migration `20261004090000_transportation_module` |
| Lists, labels | `src/lib/transport/constants.ts` (client-safe) |
| Zod request schemas | `src/lib/transport/schemas.ts` (shared by session routes and the API) |
| Time zones | `src/lib/transport/time.ts` — UTC storage, property-local `yyyy-MM-dd` / `HH:MM` in and out |
| Pricing (pure) | `src/lib/transport/pricing.ts` — `selectRate`, `rateAmount`, `taxOverrideFor` |
| Attention (pure) | `src/lib/transport/attention.ts` |
| Configuration service | `src/lib/transport/config.ts` (6 entities, settings, `loadTransportDefaults`, `ensureTransportChargeCode`) |
| Bookings | `src/lib/transport/bookings.ts` (create/update/status, pricing, suggestions, legacy conversion) |
| Manifests | `src/lib/transport/manifests.ts` |
| Billing | `src/lib/transport/billing.ts` (Night Audit pass, Advance Bill, manual post/waive/resume/void) |
| Board, report, bulk | `board.ts`, `report.ts` (a `ReportDef`, also in Daily Reports), `bulk.ts` |
| Proforma / daily details | `src/lib/transport/projection.ts` |
| Session routes | `src/app/api/transport/**` (gates in `src/lib/transport/http.ts`) |
| Booking API | `src/app/api/website/v1/properties/[propertyId]/transport/**`, gate `src/lib/website-api/transport.ts` |
| Hub UI | `src/app/e/[slug]/hub/p/[propertyId]/transportation`, `src/components/hub/transport/*` |
| Ops UI | `src/app/e/[slug]/dashboard/transportation`, `src/components/transport/*`; reservation card `reservation-transportation.tsx`; simple section `src/components/front-office/reservation-transport.tsx` (T-11) |
| Seed | `scripts/seed/seed-transport.ts` (Veyo Lagoon; docs demo Coral Bay Resort) |
| Tests | `tests/business-rules/transport.test.ts` (22), `transport-rules.test.ts` (15), `booking-api-transport.test.ts` (7), `tests/tenant-isolation/transport.test.ts` (2), `tests/e2e/transportation.e2e.ts` |
| Docs | `/docs/api/transport`, `/docs/configuration/property/transportation`, `/docs/operations/transportation`, OpenAPI (Transportation tag), release notes 8.5.0 |

## Decisions (T-n)

**T-1 — An Osta add-on AND a per-property switch** (owner, 2026-10-04; first built as a
per-property switch only). `EnterpriseAddonAccess` module `TRANSPORTATION` (toggled in the Osta
console, like Excursions/Spa) + `TransportSettings.enabled` (Hub › property › Transportation,
CONTROLS). `isTransportActive` = both. No add-on: no Hub page or menu entry, every session route
`403 TRANSPORT_ADDON_NOT_ENABLED` (configuration included), API `409 MODULE_NOT_ENABLED`
(`details.reason ADDON_NOT_ENABLED`), the `TRANSPORT` key scope can't be granted, Night Audit
posts nothing. Add-on but switched off: configuration stays editable (set up before going
live), ops `403 TRANSPORT_NOT_ENABLED` (API reason `NOT_ENABLED`).

**T-2 — Permissions use the existing RBAC actions.** New module `TRANSPORTATION`:
view = board/views/report; create = manage bookings; update = manage manifests;
delete = billing (manual post/waive, custom amount, price override). Configuration =
`CONTROLS` (`requirePropertySetup`). Voiding a posted charge also needs `CASHIERING update`
(the folio-void rule). Front Desk system role: EDIT_NO_DELETE (no billing overrides).

**T-3 — Times.** Instants are UTC (`flightAt`, `departureAt`); the board's day is the
property-local day stored as UTC midnight (`serviceDate`). Callers send and receive local
`yyyy-MM-dd` / `HH:MM`; conversion is `localToUtc`/`utcToLocal` with the property's `timeZone`.

**T-4 — Pricing snapshot.** A booking's price (amount, charge code, tax mode, tax profile,
rate) is snapshotted when priced and re-priced only while the charge is open (not POSTED /
WAIVED) and the price was not set by hand. Most specific rate wins (provider > type > exact
direction > newest season). No rate = complimentary (`NON_BILLABLE`).

**T-5 — Tax per rate = the Outlet override model.** `taxMode` CHARGE_CODE | DEFAULT | CUSTOM is
passed to `postCharge` as its `outlet` tax override (`taxOverrideFor`) — no second tax engine.

**T-6 — Billing timing (Night Audit).** One posting per booking (`folioLineItemId` unique; the
pass only takes NOT_BILLED/PENDING with no line):
- PICKUP: the audit of the service date, only once the reservation is IN_HOUSE/CHECKED_OUT
  (a guest who never arrived is not charged a pickup).
- DROP_OFF (reservation in house): the audit of the **last night** (service date − 1),
  **stamped with the departure date**, so the charge is on the folio before check-out
  settlement. *Owner confirmed 2026-10-04 ("guest's last night") — the departure date's own
  audit runs after the guest has checked out and their folio is closed.*
- Standalone traveller: the service date's audit, on their walk-in folio (created on demand).
- Missed days catch up (stamped with the audit date, never back-dated). No open folio → PENDING
  (listed in the audit response, shown on the board).
- Folio target follows Night Audit's own routing: FolioRoutingRule for the code, then the
  group master folio (bill-to-master), then the first open folio.
- DRAFT, NO_SHOW, CANCELLED never auto-post. Advance Bill posts open transfers too.

**T-7 — Corrections never delete.** Manual void uses `voidPostedCharge` (CASHIERING update);
`voidPostedCharge` itself flips any transport booking on that line to VOIDED, so a void from
the folio screen is reflected. A VOIDED/WAIVED transfer can be posted again.

**T-8 — Attention is computed, never stored**, never blocks: too soon after landing / too
close to take-off (route duration counts) against `attentionToleranceMinutes` (default 60),
flight changed since attach (`flightAtOnManifest` snapshot; KEEP clears it), flight missing.

**T-9 — Manifest rules.** Attaching moves the booking to the manifest's day and sets
CONFIRMED → ASSIGNED (drafts stay drafts). COMPLETED completes passengers; CANCELLED releases
them (still booked). Over-capacity is a warning. Direction must match.

**T-10 — Standalone travellers** reuse the walk-in folio (Excursions/Fast Post precedent);
payment through the existing walk-in bill flow. No new account type.

**T-11 — The reservation's simple Transport section** (owner, 2026-10-04). `ReservationTransport`
is now ONLY flight no. (`carrierCode`), transport no. (`transportNo`) and flight time
(`carrierTime`: landing for the pickup, take-off for the drop-off, entered as `HH:MM` on the
arrival / departure day in the property's time zone) per leg — no type, remarks, transport time
or charge. Service: `src/lib/transport/simple.ts` (+ client-safe `simple-schema.ts`); route
`GET|PUT /api/reservations/[id]/transport`. Where the module is active the section is
READ-ONLY, filled from the module's bookings (flight, vessel name/registration, flight time),
and PUT answers `409 MANAGED_BY_TRANSPORTATION`; the module's own card sits under it to add
transfers. Charges entered on the older card stay: unposted ones still post via Night Audit /
Advance Bill, the section shows them read-only, and clearing the three fields keeps such a row.
Booking the same reservation+direction in the module still CONVERTS the leg (flight data
copied, an already-posted line adopted as the booking's POSTED line, the leg deleted).

**T-12 — Booking API scope `TRANSPORT`**: ops/integration use, not guest booking. Server-only
(keys with browser origins can't be given it — enforced at key create/update and per request),
acts as the enterprise's Online Bookings system user, may post/waive but never void. Added
PATCH/DELETE to the API's methods; first cursor-paginated list (`limit`, `cursor`,
`nextCursor`). Validation errors use the API's `VALIDATION` + field→message `details`.

**T-13 — Groups** already exist (`GroupBlock`); bookings denormalize `groupBlockId` from the
reservation for filtering and show the group code as a tag.

**T-14 — Report** is a `ReportDef` (`transport-daily`, module TRANSPORTATION): Daily Reports
(REPORTS permission, Chrome PDF) and the board's Export (`/api/transport/report`,
TRANSPORTATION view, ≤ 62 days, `export` rate-limit bucket 10/min per user, pdf-lib PDF).

## Open items / follow-ups

- [x] Owner confirmed T-6 drop-off timing (last-night audit, dated the departure day) — 2026-10-04.
- [ ] Version bump to 8.5.0 in `package.json` after the owner's test pass.
- [ ] Booking API idempotency keys for transport writes (not required in v1; creates are not
      idempotent — retry with care).
- [ ] Per-manifest printable passenger list (today: the daily report PDF and the Dispatch view).
- [ ] Hub Overview banner when Transportation is on but no route/rate exists.
- [ ] Copy-from-property for the transport catalogue (HUB_SETUP_PLAN Phase 5 pattern).
- [ ] Out of scope by design (keep the model open): guest-facing transfer booking, driver app,
      flight-status feeds, supplier payables, GPS, automated messaging, seat inventory.
