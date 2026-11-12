# Dev log

One file for everything that is **finished**. Each section is a plan, audit or log that used to
be its own file, cut down to what a contributor still needs: what it was, what shipped, the
rules that still bind, where the code is.

**How this file works**

- A plan lives in its own file while it is being planned or built (see `AGENTS.md` for the
  list). **When its work is released, the plan becomes a section here and the file is deleted,
  in the same PR as the release.**
- Newest section first. The heading carries the date and time the source file was last changed.
- Each section says `Was:` the old file name. Code comments across `src/` still cite those
  names (for example `WEBSITE_API_PLAN.md W-5` or `HUB_SETUP_PLAN.md Phase 4`); they now mean
  the section of that name in this file. Decision ids (W-n, B-n, T-n, D-7) are kept for that
  reason.
- The full original text of every file is in git history: the last commit that had them all is
  `cbd3d53` (`git show cbd3d53:.agents/docs/SPA_PLAN.md`).
- Open work does not live here. It is in [TODO.md](TODO.md). Business rules are in
  [DECISIONS.md](DECISIONS.md).

**Contents**

| Section | Released | Was |
|---|---|---|
| [Mobile polish](#mobile-polish--20261109-0945) | 8.2.0, phone pass 8.13.x | `MOBILE_PLAN.md` |
| [Hub level and Channel Manager](#hub-level-and-channel-manager-beds24--20261014-1204) | 2026-07-28, own account 8.8.4 | `HUB_CHANNEL_MANAGER_PLAN.md` |
| [Hub setup: Enterprise and Property](#hub-setup-enterprise-and-property--20261014-1204) | 7.0.0, 8.4.2 | `HUB_SETUP_PLAN.md` |
| [Daily Reports rework](#daily-reports-rework--20261011-0810) | 8.7.0, 8.7.1 | `REPORTS_REWORK_PLAN.md` |
| [Transportation module](#transportation-module--20261005-0932) | 8.5.0 | `TRANSPORTATION_PLAN.md` |
| [Desktop polish](#desktop-polish--20260925-2323) | 8.3.x | `DESKTOP_PLAN.md` |
| [Booking API: Excursions and Spa](#booking-api-excursions-and-spa--20260924-1627) | 7.x | `BOOKING_API_ADDONS_PLAN.md` |
| [Website API](#website-api--20260924-1018) | 2026-09-06 | `WEBSITE_API_PLAN.md` |
| [Spa booking add-on](#spa-booking-add-on--20260923-1627) | 2026-07 to 2026-09 | `SPA_PLAN.md` |
| [Design log](#design-log--20260808-2101) | to 5.9.0 | `DESIGN_LOG.md` |
| [User management, roles and sessions](#user-management-roles-and-sessions--20260805-0002) | 2026-08-04 | `USER_MANAGEMENT_PLAN.md` |
| [Security audit v5.7.0](#security-audit-v570--20260804-0104) | 2026-08-04 | `security-audit/FINDINGS.md` |
| [Charge code hierarchy and posting service](#charge-code-hierarchy-and-posting-service--20260727-2239) | 2026-07-27 | `CHARGE_CODE_PLAN.md` |
| [Release-readiness audit](#release-readiness-audit--20260726-1537) | 2026-07-25 | `AUDIT_REPORT.md` |
| [Excursions booking add-on](#excursions-booking-add-on--20260722-2127) | 2026-07-22 | `EXCURSIONS_PLAN.md` |
| [Alpha v4 hardening](#alpha-v4-hardening--20260721-2109) | 2026-07-21 | `ALPHA_V4_PLAN.md` |
| [Profiles redesign](#profiles-redesign--20260720-2339) | 2026-07-20 | `PROFILES_REDESIGN_PLAN.md` |
| [Allocations](#allocations--20260719-2204) | 2026-07-19 | `ALLOCATIONS_PLAN.md` |
| [Multi-tenancy and RBAC retrofit](#multi-tenancy-and-rbac-retrofit--20260719-1239) | 2026-07-18 | `MASTER_PLAN.md` |

---

## Mobile polish — 2026/11/09 09:45

Was: `MOBILE_PLAN.md`. All five phases done 2026-09-25 (8.2.0); a phone consistency pass
followed on 2026-11-09 (PR #101).

**Overview.** An audit of every route at 390px, all 126 dialogs and 74 table files, then a
phased fix. Desktop is the source of truth: every phone change sits behind a breakpoint or a
mobile variant of a shared component, so desktop markup and behaviour did not change.

**Rules that still bind**

- Phone changes live behind `max-sm:` / `max-md:` / `md:hidden` or `pointer-coarse:`. Never
  change desktop to fix a phone.
- **No sideways scroll on a phone.** A table becomes cards (`MobileCard` / `MobileCardList`).
- Dialogs are bottom sheets on phones: `DialogContent mobile="sheet" | "fullscreen" | "none"`.
- Use the shared pieces: `@/components/ui/mobile` (`MobileActions`, `MobileActionBar`,
  `DesktopOnlyNotice`), `NumberStepper`, `ContactLink`, `@/lib/input-presets` (keyboards and
  autofill), `PageHeader`.
- Tap targets 44px; the one next step is a sticky footer button.
- Screens that are honestly desktop-only say so with `DesktopOnlyNotice` instead of breaking.
- Check a change with `npm run mobile:audit` (captures at phone, tablet and desktop widths and
  diffs against a baseline; desktop must not change).

**What shipped.** Foundations (shell, sheets, input presets), the high-usage screens (Front
Desk, Reservations, Housekeeping with one-tap status actions, Cashiering), guest eRegistration
on the guest's own phone (ID scan first, right keyboards), the second tier (Spa, Excursions,
Hub), desktop-only notices for the rest.

---

## Hub level and Channel Manager (Beds24) — 2026/10/14 12:04

Was: `HUB_CHANNEL_MANAGER_PLAN.md`. Hub built 2026-07-27, sync engine 2026-07-28, one connection
per property 2026-09-23 (7.0.0), enterprises connect their own Beds24 account 2026-10-14 (8.8.4).

**Overview.** Two things: the **Hub**, a shell separate from the property dashboard for
configuration, and the **channel manager** integration with Beds24 (availability, rates and
restrictions out; bookings in).

**Rules that still bind**

- **The Hub contains zero PMS functionality.** No front desk, reservations, housekeeping or
  folio. If a screen needs a property to make sense as an *operation*, it is not a Hub screen.
  No `PropertyProvider` in the Hub layout.
- **D-7, inventory and overbooking authority (owner, 2026-07-27).** Push actual free inventory,
  never an overbooking allowance; a negative count is pushed as 0. Overbooking is a manual desk
  act only. Group-block rooms are withheld until the block's `cutoffDate`, then released (no
  cutoff means hold, never release). An inbound OTA booking that no longer fits is **accepted
  and flagged** as a channel overbook, never refused and never folded in silently. A stop sale
  **closes** the room type at the channel, it is not just availability 0. The brand website and
  every other outside sales path follow the same rule.
- One connection per **property** (`ChannelConnection.propertyId`, unique). An enterprise can
  connect, re-authorize and disconnect its own Beds24 account from the property's Channel
  Manager page; the Osta console path (Uppsolut's own account) stays for properties that use it.
- Inbound is idempotent on the Beds24 booking id; webhooks plus a polling fallback; every
  attempt writes a `ChannelSyncLog` / `ChannelInboundBooking` row. The webhook token is hashed
  at rest.
- Outbound pushes are debounced per room type and date range, retried with backoff, and a
  persistent failure shows as a degraded connection in the Hub.

**Where.** `src/lib/channels/**` (adapter, `sync.ts`, `rates.ts`, `inbound/`), Hub pages under
`/hub/p/{propertyId}/channel-manager`, `/api/hub/connections*`.

---

## Hub setup: Enterprise and Property — 2026/10/14 12:04

Was: `HUB_SETUP_PLAN.md`. Phases 0 to 6 built 2026-09-23 (7.0.0); Phase 5b (Allocations, Spa and
Excursion catalogues) 2026-09-26 (8.4.2).

**Overview.** All setup moved out of the property dashboard into the Hub and was split in two
areas, because it was not clear which property a change landed on.

**The rule**

> **Enterprise** = shared by every property: users, roles and permissions, sessions, Booking API
> keys, Email/SFTP, support access, the property list, guest-profile lists.
> **Property** = everything else, including tax, charge codes, payment methods, dropdowns and
> stationery. A property page shows only that property's data. There is **no live sharing**
> between properties; onboarding is eased by **copying** settings from another property.

**Rules that still bind**

- Routes: `/e/{slug}/hub/enterprise/…` and `/e/{slug}/hub/p/{propertyId}/…`. **The property is
  always in the URL**, never ambient. Property pages get `propertyId` from the route and pass it
  on explicitly; no `useProperty()` in the Hub.
- Every property page shows a band in the property's own banner colour with a switcher that
  keeps the current section.
- Gate every setup API with `requireEnterpriseHub(ctx)` or
  `requirePropertySetup(ctx, propertyId, module, action)` from `src/lib/scope.ts`. Setup
  sections use `CONTROLS`; channel manager and online booking use `INTEGRATIONS`; Green Tax uses
  `GREEN_TAX`; `USERS` is enterprise only.
- A PROPERTY-scope user never sees the enterprise area and reaches only their own property.
  Single-property admins cannot manage users.
- A Booking API key covers one property or ALL (including properties added later), never a
  subset.
- Before adding any setting, decide which area it belongs to.

**Property area sections.** general, inventory, reservations, revenue, finance, cashiering,
outlets, spa, excursions, transportation, stationery, sequences, channel-manager,
online-booking, green-tax. **Enterprise area:** properties, people, permissions, sessions,
email, booking-api, support-access, lists.

---

## Daily Reports rework — 2026/10/11 08:10

Was: `REPORTS_REWORK_PLAN.md`. Built in 8.7.0, additions in 8.7.1.

**Overview.** Client feedback said Daily Reports felt old. The page was rebuilt with KPI tiles
and charts per report, a native-feeling preview, and one **Download as** dialog (PDF, Excel,
delimited text, CSV) in place of a row of format buttons.

**What a contributor needs**

- A report is a `ReportDef` in `src/lib/reports/defs/*.ts`. It may carry an `insights` spec;
  `src/lib/reports/insights.ts` resolves KPIs and charts from the report's own rows.
- Files: `render/{flatten,delimited,csv,xlsx}.ts`, `export-options.ts` (Zod, shared by the
  dialog and `/api/reports/generate`).
- Screen: `src/components/reports/*`; state is in the URL (`?report=&q=`).
- Paper: `report-document.tsx` + `report-visuals-print.tsx` (Chrome PDF carries KPIs and
  charts). The `pdf-lib` fallback draws no charts.
- CSV is data-only by default; "As printed" keeps titles and subtotals. Excel gets a Summary
  sheet. Download needs only `REPORTS view`.

---

## Transportation module — 2026/10/05 09:32

Was: `TRANSPORTATION_PLAN.md`. Released as 8.5.0 (2026-10-05).

**Overview.** Per-property guest transfers in the Maldivian shape: the airport leg, the onward
leg (speedboat, seaplane, domestic flight, ferry, land) and local transfers. Every transfer is a
PICKUP or a DROP_OFF. Shared departures (manifests) are the core operational object. Strictly
property-scoped.

**Decisions (T-n)**

- **T-1** An Osta add-on (`EnterpriseAddonAccess` `TRANSPORTATION`) **and** a per-property
  switch (`TransportSettings.enabled`); `isTransportActive` needs both. With the add-on but
  switched off, configuration stays editable.
- **T-2** Module `TRANSPORTATION`: view = board and report; create = bookings; update =
  manifests; delete = billing (manual post or waive, custom amount, price override).
  Configuration is `CONTROLS`. Voiding a posted charge also needs `CASHIERING update`.
- **T-3** Instants are UTC; the board's day is the property-local day. Callers send and receive
  local `yyyy-MM-dd` / `HH:MM`.
- **T-4** A booking's price is a snapshot, re-priced only while the charge is open and the price
  was not set by hand. Most specific rate wins. No rate = complimentary.
- **T-5** Tax per rate uses the Outlet override model through `postCharge`; no second tax engine.
- **T-6** Night Audit posts one line per booking. PICKUP: the audit of the service date, only
  once the reservation is in house. DROP_OFF: the audit of the **last night**, stamped with the
  departure date. Standalone traveller: the service date, on a walk-in folio. Missed days catch
  up, never back-dated. DRAFT, NO_SHOW and CANCELLED never auto-post. Advance Bill posts open
  transfers too.
- **T-7** Corrections never delete; a void goes through `voidPostedCharge`.
- **T-8** Attention flags (tight connection, flight changed, flight missing) are computed, never
  stored, and never block.
- **T-9** Attaching a booking to a manifest moves it to the manifest's day; over-capacity is a
  warning; direction must match.
- **T-10** Standalone travellers reuse the walk-in folio.
- **T-11** The reservation's simple Transport section keeps only flight number, transport number
  and flight time per leg. Where the module is on, that section is read-only and filled from the
  module (`409 MANAGED_BY_TRANSPORTATION` on write).
- **T-12** Booking API scope `TRANSPORT` is for operations and integrations, server-to-server
  only; it may post or waive, never void.
- **T-13** Bookings copy `groupBlockId` from the reservation.
- **T-14** The report is a `ReportDef` (`transport-daily`).

**Where.** `src/lib/transport/**`, the Night Audit transport pass, `/api/transport/**`,
`/api/reservations/[id]/transport`. Out of scope by design: guest-facing transfer booking, a
driver app, flight-status feeds, supplier payables.

---

## Desktop polish — 2026/09/25 23:23

Was: `DESKTOP_PLAN.md`. All five phases done 2026-09-25; the owner approved every
recommendation, with one standing rule: **clean over convenient, secondary things go behind a
click.**

**Overview.** An audit at 1440px found four root causes: blocking success modals, no next step
after an action, tabs and filters not in the URL, and no page-shell standard. The fix was a set
of shared components, then adoption screen by screen.

**Standards that still bind**

- **Feedback is a toast** (`lib/toast.ts`), top right. A modal only for an error that needs a
  decision, and then it offers the action ("Open folio"). One `apiError(res)` helper.
- **`PageHeader`** on every page: the only `<h1>`, description, one primary action, secondary
  actions and a More menu.
- **`ActionBar`**: one primary, at most two secondary, the rest under More; destructive last,
  red, confirmed.
- **Tabs and filters live in the URL**: `useUrlState` / `useUrlTab`.
- **`ListTable`** for lists (sticky header, sortable, result count, whole-row link, CSV,
  empty/error/skeleton built in) with a `FilterBar`. The phone view stays `MobileCardList`.
- `StatTile` is the only KPI card. `EmptyState`, `InlineLoading`, `loading.tsx` and `error.tsx`
  boundaries.
- `DialogContent size="sm|md|lg|xl"`, scrolling body, fixed footer; every dialog with inputs is
  a `<form>` with a `SubmitButton`.
- `useConfirm` with a `reason` field for every delete and void (no `window.prompt`);
  `useUnsavedGuard(isDirty)`.
- Command palette on Ctrl+K (`shell/command-palette.tsx`, `GET /api/search`), filtered by
  permission. `SummaryRail` on detail pages. `HubSectionNav` on long Hub pages.
- Settled look: square corners, Inter only, one per-property accent, icons from
  `@/components/icons`, sentence case.

---

## Booking API: Excursions and Spa — 2026/09/24 16:27

Was: `BOOKING_API_ADDONS_PLAN.md`. Phases 0 to 6 done 2026-09-23.

**Overview.** Extended the Website API so a property's own website can sell Excursions and Spa
treatments with the same `wsk_` key. Also turned the docs into the public portal at `/docs`.

**Decisions (B-n)**

- **B-1** One key, scoped: `WebsiteApiKey.scopes` (`ROOMS`, `EXCURSIONS`, `SPA`, later
  `TRANSPORT`). Every request checks the scope, the enterprise add-on and the property's own
  switch, live.
- **B-2** Same base path `/api/website/v1`; changes are additive only.
- **B-3** Instant confirmation only: CONFIRMED or refused. No pending state, no staff queue.
- **B-4** Hold, pay, confirm: an optional short hold (default 10 minutes) keeps the seats or the
  slot while the site takes payment; an expired hold frees itself.
- **B-5** Server-side pricing only. The site sends `expectedTotal`; a difference answers
  `409 PRICE_CHANGED`.
- **B-6** A paid booking settles its folio: a walk-in folio, the charge through `postCharge`,
  and a payment on the property's "Online prepaid" code.
- **B-7** Guest self-cancel before the cutoff voids the charge; a paid booking answers
  `refundRequired: true`.
- **B-8** Status changes go out by signed webhook; lookup also works.
- **B-9** Spa never exposes therapist identity.
- **B-10** A key with browser origins may not book Excursions or Spa (read only for those).
- **B-11** Public references are random and unguessable (`EXC-7K3QX9`); lookup and cancel need
  the reference **and** the booking email.

**Where.** `src/lib/excursion-booking.ts`, `spa-booking.ts`, `spa-lifecycle.ts`, `db-lock.ts`,
`src/lib/website-api/**`, `src/app/api/website/v1/**`. Docs: portal `src/app/docs`, OpenAPI
`public/docs/booking-api.openapi.yaml`, `npm run docs:pdf`, `npm run docs:check` (published docs
carry no secret, real customer or internal detail).

---

## Website API — 2026/09/24 10:18

Was: `WEBSITE_API_PLAN.md`. Built 2026-09-06; W-12 and W-13 on 2026-09-07.

**Overview.** A property's own brand website reads property information, live availability and
prices, and creates bookings, through a key-authenticated public API (`/api/website/v1/**`).
Keys are minted in the Hub.

**Decisions (W-n)**

- **W-1** Keys live in the Hub, gated on `INTEGRATIONS`.
- **W-2** One key covers ONE property or ALL, never a subset. An id outside the key's coverage
  answers **404, never 403**.
- **W-3** Keys are hashed at rest and shown once. Unknown, revoked and expired all answer the
  same 401.
- **W-4** Availability obeys D-7 word for word, through `perNightTypeAvailability()`.
- **W-5** The website can **never** overbook: a stay that no longer fits is `SOLD_OUT`.
  `createReservation` is the single service; the website path adds pre-checks, never a second
  copy of the rules.
- **W-6** Nothing is guessed about the rate plan: no plan configured means booking is off.
  Negotiated plans are refused. An unpriced night is `NO_RATE`, never a booking at 0.
- **W-7** The quote is authoritative (`computeReservationQuote`); the calendar price is the room
  rate only.
- **W-8** Marketing content lives in `WebsitePropertySettings`, not on `Property`.
- **W-9** Every attempt is recorded in `WebsiteBooking`; `(keyId, idempotencyKey)` guards
  retries; the reservation carries `externalRef = WEB-xxxxxxxx`.
- **W-10** Server-to-server is the recommended topology; CORS is opt-in per key
  (`allowedOrigins`). `websiteRoute` is the one wrapper, so headers land on every response.
- **W-11** No payment in v1.
- **W-12** Meal plans and paid extras are guest-selectable, opt-in per property, both off by
  default. A choice the property did not open is **refused, not ignored**. Extras are the
  property's `sellSeparate` allocations; they carry no price in the catalogue, the quote is the
  price.
- **W-13** `Allocation.publishToApi` decides which extras go out (website and channel alike),
  edited in the Hub under `INTEGRATIONS`, default on.

**Where.** `src/lib/website-api/**`, `src/app/api/website/v1/**`, Hub routes
`src/app/api/hub/website/**`, tests `tests/business-rules/website-api.test.ts`.

---

## Spa booking add-on — 2026/09/23 16:27

Was: `SPA_PLAN.md`. Built in phases from 2026-07-23; the appointment lifecycle and online
booking were finished with the Booking API work on 2026-09-23.

**Overview.** A sellable add-on for small hotel spas, the same commercial shape as Excursions:
treatments, rates, therapists, rooms and schedules; in-house and walk-in booking; a schedule
view; check-in, start, complete, cancel and no-show.

**Decisions that still bind**

- Catalogue and setup are gated by `CONTROLS`; day-to-day work by module `SPA` (view, create,
  update); `SPA delete` is the manager override (late cancel, working-hour override, reopen,
  price override). Voids and refunds need their own `CASHIERING` check and degrade gracefully.
- **A therapist or a room double-booking is a hard block** (a single physical resource), unlike
  an excursion seat, which is a soft warning.
- Couple and group treatments: one `SpaAppointment` (shared room, time and folio charge) with N
  `SpaAppointmentParticipant` rows, each with its own guest and therapist. In-house guests are a
  live join on `reservationId`, no name snapshots.
- Charge timing is `AT_BOOKING` (default) or `AT_COMPLETION`, set in `SpaSettings`.
- Walk-ins bill to an open walk-in folio; companions are never billed separately.
- Availability is computed in `src/lib/spa-availability.ts`; extended hours widen the bookable
  window for that day.
- Deferred: packages, memberships, a therapist's own "My appointments" view.

**Where.** `src/lib/spa-availability.ts`, `spa-booking.ts`, `spa-lifecycle.ts`,
`/api/spa/**`, `src/components/front-office/spa-*`.

---

## Design log — 2026/08/08 21:01

Was: `DESIGN_LOG.md`, a dated list of individual UI fixes made on top of
[DESIGN_PLAN.md](DESIGN_PLAN.md) between 2026-07-18 and 2026-08-08. `DESIGN_PLAN.md` stays the
source of truth for the design system; this is what the log taught.

- **2026-07-18 / 07-19.** Token clean-up: radius, status dots and pill badges; hand-rolled
  status colours replaced by `StatusBadge` (`src/components/ui/status-badge.tsx`) and
  `statusTone()`.
- **2026-07-22.** Tabs: Base UI's panel exit lifecycle never completes without a CSS transition,
  so hidden panels were kept mounted. Do not rely on that lifecycle.
- **2026-07-31.** `DESIGN_PLAN.md` became the single source of truth for the design system.
- **2026-08-01 (5.7.0).** Z-index: toasts were drawn behind open dialogs. All portaled layers
  now share `--z-portal: 50` and `--z-toast` is `60`. **Portaled siblings must share one level**
  so mount order decides; giving dropdowns and modals different numbers puts a `Select` list
  behind its own `Dialog`.
- **2026-08-08.** App-wide responsive pass (PR #23): card stacking on every list page, mobile
  agenda views for tape chart, availability, spa and excursions. Superseded in detail by the
  Mobile polish section above.

---

## User management, roles and sessions — 2026/08/05 00:02

Was: `USER_MANAGEMENT_PLAN.md`. All phases shipped 2026-08-04.

**Overview.** Moved user management to the Hub, made roles many-to-many, added a real session
table with an idle timeout, replaced role-name matching with a job function, and added a
printable permission matrix.

**Decisions that still bind**

1. User management is in the **Hub**, for ENTERPRISE-scope users only. A single-property manager
   cannot add users.
2. A **`Session` table**; the JWT carries a `jti`. `lastSeenAt` is stamped at most once a
   minute. Sessions can be listed and ended remotely.
3. The timeout is an **idle** timeout, per property, enforced in `requireSession` and warned in
   the browser.
4. Roles are a **`UserRole` join table**; there is no `User.roleId`. Permissions are the OR of
   every assigned role.
5. Job function is one per user. (Since 2026-09-25 the list is fixed, see DECISIONS.)
6. Work location stays one property per user.
7. The permission matrix prints as stationery.
8. `RoomAttendant` is gone; `HousekeepingTask.assignedToId` points at `User`.
9. The **onboarding user is protected**: cannot be deleted or deactivated, always full access,
   always ENTERPRISE scope, so a tenant can never lock itself out of its own Hub.

`MODULES` has one definition, `src/lib/modules.ts` (deduplicated 2026-08-05).

---

## Security audit v5.7.0 — 2026/08/04 01:04

Was: `security-audit/FINDINGS.md`.

**Overview.** A full security review of 225 route handlers, the proxy, the data layer, the
deploy configuration and git history. **The authorization architecture was sound and produced no
finding**: every handler reaches `requireSession()` or is deliberately public and independently
guarded; tenant scoping is enforced at the data layer; no IDOR. The findings were at the edges.

**Fixed.** Security headers and a CSP (FND-001), Next.js upgraded past a proxy
authorization-bypass advisory (FND-002), `shadcn` moved to dev dependencies (FND-003), the
unused `/_next/image` endpoint closed (FND-004), an allow-list on add-on module names
(FND-005), a wrong comment about where the slug boundary is enforced (FND-010).

**Left for an owner decision** (tracked in TODO.md): secrets encryption fails open when
`SECRETS_ENCRYPTION_KEY` is unset (FND-006); the CSP still allows inline scripts (FND-009);
replaced eRegistration photos are not deleted and the public write endpoints have no rate limit
(FND-007, FND-008); the login throttle is per instance (FND-012); three `GET` handlers write to
the database (FND-013).

---

## Charge code hierarchy and posting service — 2026/07/27 22:39

Was: `CHARGE_CODE_PLAN.md` (root). Implemented 2026-07-27.

**Overview.** An audit of everything that posts a folio line, then a redesign modelled on Opera
transaction codes: the flat `category` string became **Group → Subgroup → Code** with real
relations, and every posting goes through one service.

**Rules that still bind**

- **Rule #1 (owner): a posting always posts its generates.** No route builds a `FolioLineItem`
  by hand. This must stay empty:
  `grep -rn "folioLineItem.create" src --include=*.ts | grep -v "lib/posting/post-charge"`
- `postCharge` (`src/lib/posting/post-charge.ts`) is the only way to post a charge;
  `voidPostedCharge` the only way to undo one. Generates (cascading tax buckets) are run by the
  service, not the caller.
- A deposit is an advance **payment**, not a folio charge, by design. The `9200` / `9210` codes
  exist only for manual adjustments.
- `ChargeCode.category` is still written as a mirror of the subgroup's bucket; dropping the
  column is the one deferred step (TODO.md).
- Since 2026-09-24 charge codes belong to the property (DECISIONS).

---

## Release-readiness audit — 2026/07/26 15:37

Was: `AUDIT_REPORT.md` (root).

**Overview.** A full project audit on 2026-07-25 across business logic, security, redundant
actions and design consistency. Verdict at the time: **not safe to ship**, because of
financial-integrity defects sharing one root cause, a guard that was not atomic.

**Ship blockers, all fixed in the remediation that followed.** Night Audit could double-post and
double-roll the date (A1); Advance Bill could double-bill (A2); currency exchange broke drawer
balancing and trusted client amounts (A3, A4); excursion departures had no capacity limit (A5);
a cross-tenant write through move-bookings (S1).

**The lesson that still binds.** A money-moving action claims its work with one conditional
update before it posts (the `EodRun` pattern), and gets a concurrency test.

**Deferred from it** (TODO.md): a shared CRUD-manager refactor, typing the remaining `any`s,
Float to Int money storage.

---

## Excursions booking add-on — 2026/07/22 21:27

Was: `EXCURSIONS_PLAN.md`. All seven phases done 2026-07-22.

**Overview.** A sellable add-on: an excursion catalogue, recurring and hand-made departures,
in-house and walk-in booking, a manifest, cancellation and no-show, whole-departure cancellation
with a suggested replacement, and a calendar view.

**Decisions that still bind**

1. Scheduling is hybrid: a recurring template generates departures, and staff can add, edit or
   cancel single ones.
2. Over-capacity is a soft warning, never a block. (The Booking API does refuse when sold out.)
3. A walk-in is free text, not a profile, and can pay now or later.
4. Pricing is per adult, child and infant.
5. Cancellation has an enforced cutoff window.
6. Cancelling a whole departure cascades and suggests a replacement.
7. A minimum-passenger threshold is a soft "at risk" warning.
8. The add-on is switched on by Osta only. Since 2026-08-02 add-ons are enterprise-level
   (`EnterpriseAddonAccess`).
9. Catalogue management is gated by `CONTROLS`; operations by module `EXCURSIONS`; voiding a
   charge needs its own `CASHIERING` check.

---

## Alpha v4 hardening — 2026/07/21 21:09

Was: `ALPHA_V4_PLAN.md`. Done 2026-07-21.

**Overview.** A three-way audit of the modules staff live in all day (Front Desk, Reservations,
Housekeeping and Maintenance), then four phases: broken-workflow fixes, Front Desk completion
(check-in, walk-in, deposit, out of order), reservations robustness, and the housekeeping and
maintenance task lifecycle. Server-side validation of status, priority and task type came with
it.

**Still open from it** (TODO.md): attendant task sheets; the carried-over items from the
earlier audit (financial audit-trail table, optimistic concurrency).

---

## Profiles redesign — 2026/07/20 23:39

Was: `PROFILES_REDESIGN_PLAN.md`. Phases A to F done 2026-07-20.

**Overview.** Client Relations was reorganised field by field from the owner's spec.

**What it left in place**

- `ProfileContact` is gone, replaced by `ProfileCommunication` (EMAIL, MOBILE, SOCIAL) and
  `ProfileAddress` (HOME, BUSINESS, BILLING), each multi-row with one primary.
- Identification documents, notes (`ProfileNote`, pinnable) and attachments are real per-row
  records. **Attachments are a list of links, not file uploads.**
- VIP Level and Preferences are dropdown-driven (`SystemCode`); dietary requirements are
  multi-select. Nationality is its own profile field.
- Profile types are `GUEST`, `COMPANY`, `TRAVEL_AGENT`, `STAFF`. GUEST and STAFF are
  "individual" profiles (personal information and identification); COMPANY and TRAVEL_AGENT are
  "entity" profiles (one name, no identification). **STAFF has no relation to `User`.**
- Profiles are enterprise-wide. "Visits to this property" is counted live; `originPropertyId`
  records where a profile was first created and never changes.
- A read-only profile page with Stay History (future and past stays, revenue per stay from
  folio lines).
- `contextMode="debtor"` on the profile form forces a credit account and returns to Debtors.

---

## Allocations — 2026/07/19 22:04

Was: `ALLOCATIONS_PLAN.md` ("Master Plan v2"). Phases A to E done 2026-07-19.

**Overview.** Per-person priced components (breakfast, transfers, and so on) that can be linked
to rate plans and meal plans or attached to a reservation by hand, and are posted at Night
Audit. Read this before touching Revenue, Meal Plans or Night Audit posting.

**Rules that still bind**

- An `Allocation` is property-scoped. Prices are dated rows (`AllocationRate`) that **must not
  overlap**; adult and child prices only, **infants are never charged**. Room type and meal plan
  never change an allocation's price.
- `mode` is `INCLUDE_IN_RATE` (carved out of the room rate: folio total unchanged, revenue moves
  to the allocation's charge code) or `ADD_TO_RATE` (its own line on top). **`sellSeparate` is
  an independent switch, not a third mode.**
- `postingRhythm`: `EVERY_NIGHT`, `ARRIVAL_NIGHT`, `DEPARTURE_NIGHT` (the last night).
- Links: `RatePlanAllocation`, `MealPlanAllocation`. A derived rate plan inherits its parent's
  links unless it has its own.
- `ReservationAllocation` (`source` RATE_PLAN, MEAL_PLAN, MANUAL) is the **materialised set per
  reservation**, written at create and edit. Night Audit reads only this table, so changing a
  plan's links later never re-prices a stay already booked.
- Posting happens **only at Night Audit** (and Advance Bill), through the charge code's own tax.
  An included allocation can never make the room line negative: it clamps at zero and the audit
  notes it.
- `Property.allocationCalculationMode`: under `MEAL_PLAN` the meal plan's allocations price per
  person per night; under `RATE_PLAN` the meal plan is a label.
- Configuration is under `REVENUE`; attaching to a reservation under `RESERVATIONS`.

**Where.** `src/lib/allocations.ts`, the Night Audit run, Hub › property › Revenue.

---

## Multi-tenancy and RBAC retrofit — 2026/07/19 12:39

Was: `MASTER_PLAN.md` ("Master Plan v1"). Phases 0 to 6 done by 2026-07-18.

**Overview.** The app began single-tenant. This retrofit introduced Enterprise, Property and
Support levels and role-based permissions across every route.

**Architecture that still binds**

- `Tenant` became **`Enterprise`** (`slug` for `/e/{slug}/login`, `type` STANDARD or INTERNAL).
  Exactly one INTERNAL enterprise, "Osta", holds Uppsolut's support users.
- **Roles and permissions.** `Role` belongs to an enterprise; system roles are owned by Osta and
  visible to everyone. `RolePermission` is per module with view, create, update, delete. The
  module list is `src/lib/modules.ts`. A user can never assign a role more privileged than
  their own. A new module is granted to existing system roles by the self-healing backfill.
- **User scope.** `ENTERPRISE` or `PROPERTY`; a PROPERTY-scope user has exactly one property.
- **The JWT carries no authorization.** Authorization always re-reads the live `User` row, so
  the token holds only an id (and since 2026-08-04 a session `jti`).
- **`requireSession()` / `requireEnterpriseId()` are the single choke point.** Every route calls
  them; property data is checked with `assertPropertyAccess()`.
- **Support access.** An Osta user asks for a `SupportAccessGrant`; the customer approves it;
  a separate short-lived `support_session` cookie lets the Osta user act as that enterprise. The
  grant is re-checked from the database on every request, and a revoked or expired grant fails
  with 403 instead of falling back.
- **Licensing.** Reworked on 2026-07-31 into the SaaS licensing model (DECISIONS).
- **Schema changes** use `prisma migrate diff … --script` and `prisma migrate deploy`, never
  `migrate dev`. Stop the dev server before `npx prisma generate` on Windows.
