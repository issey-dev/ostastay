# Agent Portal + Agent API — plan

> Status (2026-11-11): **PLAN ONLY. Nothing in the PMS is built.** A clickable mockup of the
> agent website exists locally in `agent-portal/` (not in git, see §12). Written against
> `origin/master` at **8.13.6**. PMS work in this plan is versioned from **9.0.1**.
> **Owner answers of 2026-11-11 are folded in** (permissions, rounding, auto-confirmation,
> overflow and Green Tax, deposits, Advance Folio); §13 lists what was answered and what is
> still open.
>
> Read with: [WEBSITE_API_PLAN.md](WEBSITE_API_PLAN.md) and
> [BOOKING_API_ADDONS_PLAN.md](BOOKING_API_ADDONS_PLAN.md) (the key, rate-limit, idempotency and
> webhook plumbing this reuses), [HUB_SETUP_PLAN.md](HUB_SETUP_PLAN.md) (where settings go),
> [TRANSPORTATION_PLAN.md](TRANSPORTATION_PLAN.md), [NOTIFICATIONS_PLAN.md](NOTIFICATIONS_PLAN.md),
> and DECISIONS.md "Negotiated Rate Plans", "Travel Agent commission" (2026-07-20) and
> "Channel manager: inventory & overbooking authority" (D-7, 2026-07-27).

## 1. Owner's brief (2026-11-11)

A customer sells mostly through travel agents and wants each agent to have their own window
onto the hotel:

1. **See availability**, including an "option forecast" (rooms held on option, not yet
   confirmed). When the hotel is full the agent can still ask for a booking "under PM"; those
   extra bookings are accommodated in a third-party guest hotel and must be identifiable.
2. **Create bookings that block rooms** in the PMS. Groups and individuals. Two commitment
   levels: **Tentative** (must be confirmed by payment or contract within a defined period,
   default one month before arrival) and **Confirmed**. Tentative bookings must be visible in
   the PMS with their own status so the property can track pickup.
3. **Fill in guest details** on confirmed bookings: guest profiles, international and local
   arrival and departure details, local transport, package name, special requests (preferred
   room, dietary needs). The agent generates a **confirmation voucher** for the customer.
   Rooms are assigned by the reservations team by hand. An agent can never delete a booking,
   can never cancel a confirmed one, and can cancel a tentative one only with a reason.
4. **Settlement.** Agent pays, or guest pays at the hotel. Sometimes the agent keeps their
   commission and remits the hotel's share; sometimes the guest pays the hotel and the hotel
   owes the agent. **Commission is calculated on the base rate, after removing service charge
   and tax** (worked example in §8). Use the Debtors module if it fits.

Also asked for:

- As little configuration and upkeep on the property side as possible.
- Rates are loaded for a year; **special agents get first access** to book their dates, then
  everyone else, always subject to availability.
- A **cutoff that releases rooms** when an agent does not meet their quota.
- Group blocks cannot send folios or statements in bulk; this may live in the Master folio
  section, together with commission handling.
- **Care over the booking status flow.**
- **Advance folio** for individual and group bookings is missing.
- The Availability screen has Stop sale; add a **sell limit** so overbooking is capped.
- Bookings from agents must be **visually distinguishable, above all on the Tape Chart**:
  an icon (from the app's icon set) and a colour, configurable by the property.
- The customer uses mobile-calendar.com today; consider what it does.
- Separately: **review the permissions and roles list** and bring it up to date. (The brief
  breaks off at "I currently do not like that"; see owner question Q-1.)

Deliverables asked for now: this plan, and a presentable mockup website. PMS changes go out
as phased PRs versioned from 9.0.1. The agent website stays local, not in git.

## 2. What the PMS has today (verified in code, 8.13.6)

| Area | Today | Gap for this brief |
|---|---|---|
| Public API | `/api/website/v1/**`, `wsk_` keys hashed at rest, scopes `ROOMS`/`EXCURSIONS`/`SPA`/`TRANSPORT`, Postgres rate limits, idempotency, signed webhooks (excursion and spa only), docs portal | Built for an anonymous guest on a brand website. No notion of *who* the caller is, no agent rates, no tentative bookings, no cancel or amend for rooms, one room per booking |
| Agent identity | `Profile` with `profileType = TRAVEL_AGENT`, `iataNumber`, `tinNumber`, `arNumber`, `creditLimit`, `isCreditAccount`, `bookingMethod` | No login for an agent. `Profile.commissionRate` is **stored and shown but never used** in any calculation |
| Agent rates | `RatePlan.isNegotiated` + `RatePlanAgentAccess` (plan ↔ agent, optional `commissionRate`) | No "sales open on" date, no early-access tier, no allotments |
| Reservation status | `RESERVED`, `IN_HOUSE`, `CHECKED_OUT`, `NO_SHOW`, `CANCELLED` (free string). `INVENTORY_HOLDING_STATUSES = RESERVED, IN_HOUSE` | **No tentative reservation.** No option date. No record of where a booking came from except `externalRef` and the `websiteBooking` / `channelInboundBookings` relations |
| Group blocks | `GroupBlock` `TENTATIVE → DEFINITE → CANCELLED`, `LOST` from tentative; `cutoffDate` releases unpicked holds; per-type holds; Posting Master reservation in pseudo type `PM` whose folio is the master folio | Cutoff is one date for the whole block, set by hand. No rooming-list import. No bulk send of folios or a group statement |
| Availability | `findTypeAvailabilityConflicts`, `perNightTypeAvailability`, `outstandingBlockHolds` (booking guard counts TENTATIVE + DEFINITE blocks; the Availability grid shows DEFINITE only). Stop sale = `AvailabilityRestriction` (per type or whole property) | No sell limit. Desk overbooking (`acknowledgeOverbook`) is unlimited. Tentative holds are not shown as their own line. Last-room race is still open (TODO) |
| Pseudo rooms | `RoomType.isPseudo` exempt from availability, occupancy and licence caps | No "overflow" concept; `PM` means Posting Master specifically |
| Room assignment | `RoomAssignment.roomId` is nullable; the Tape Chart has an "Unassigned" row | Fits "reservations team assigns by hand" as is |
| Commission | `calculateFolioCommission` on room-charge lines (`FolioLineItem.amount`; `taxAmount` and `serviceChargeAmount` are separate columns) × the rate plan link's %. Posted as a **negative line on the agent's City Ledger folio at checkout** | Only fires when the folio settles to the agent's credit account. **Guest-pays-hotel earns the agent nothing in the system.** No payable ledger, no agent statement of commission |
| Advance billing | `POST /reservations/[id]/advance-bill` posts remaining nights today; **IN_HOUSE only**. Proforma exists as a print of a folio | Nothing before arrival, nothing for a group |
| Debtors | Credit accounts, debtor invoices finalised at checkout, aging, statement PDF + email | All four Debtors routes check `DEBTORS view` only, including sending a statement |
| Tape Chart | Bars coloured by status tone only (`status-tone.ts`) | No source marker, no legend of sources, no filter |
| Transport | Transportation module (add-on, per property) with `TRANSPORT` API scope; older `ReservationTransport` card | Agent booking must create transfers through the module where it is on |
| Notifications | Bell, personal and global, push | New event types needed |
| Jobs | `src/lib/jobs` runner (hold sweep, webhooks, channel sync) | New jobs: option expiry, allotment release |

**About the reference product.** mobile-calendar.com's public pages describe a small-property
PMS with a channel manager, booking engine, invoicing and staff accounts. They say groups are
handled as one unit. They do **not** describe agent logins, option versus confirmed bookings,
commissions, sell limits, or how the calendar is colour-coded. So there is no agent workflow
to copy from it; what the customer most likely misses from it is the at-a-glance coloured
calendar, which Phase 3 (booking markers) covers. Worth asking the customer for two
screenshots of how they mark agent bookings today (Q-12).

## 3. Decisions

Numbered A-1… so later sessions can cite them. Each is a recommendation until the owner
confirms; the ones that most need a ruling are repeated in §13.

**A-1. Two pieces, one contract.** The **Agent API** (`/api/agent/v1/**`) is part of the PMS
and is versioned and documented like the Booking API. The **Agent Portal** is a separate
website that only ever talks to that API. The portal holds no business rule: every price,
status and permission is the PMS's answer. A large agent can later integrate their own system
against the same API with no extra work.

**A-2. A new API surface, not more `/website/v1` routes.** The website API serves an
anonymous guest and can never overbook, never see negotiated rates, never hold an option.
The agent API has an identified commercial partner behind every call. Sharing the path would
mean every website rule grows an "unless agent" branch. Shared instead: `websiteRoute`
(CORS, error shape, `no-store`), key hashing, `rate-limit.ts`, idempotency, webhooks,
`system-actor.ts`, `db-lock.ts`, `docs-check`.

**A-3. Two layers of authentication.**
1. *Application key*: a `WebsiteApiKey` with the new scope `AGENT`, server-to-server only
   (same rule as B-10; a key with browser origins is refused the scope). It identifies the
   portal installation and the enterprise.
2. *Agent session*: an agent user signs in **through the API** (`POST /auth/login`) and gets
   a short-lived token bound to one `AgentUser` → one agent `Profile`. Every data route needs
   both. Identity, password hashing, lockout and reset live in the PMS, so the portal stores
   no credentials and a second portal or a mobile app needs nothing new.

**A-4. An agent sees only their own world.** Every query is filtered by the token's agent
profile; another agent's booking answers 404, never 403 (W-2 rule). Availability is the only
shared fact, and what is shown of it is the property's choice (A-9).

**A-5. `TENTATIVE` becomes a real reservation status.** Not a flag on `RESERVED`: the owner
asked for a status the property can track, and a flag would leave a tentative booking looking
confirmed in every list, report and export that reads `status`. A tentative reservation
**holds inventory** (it joins `INVENTORY_HOLDING_STATUSES`) until its `optionDate`. Full flow
in §5. This is the riskiest change in the plan because `status` is a free string read in many
places; §5.4 lists every place that must be visited.

**A-6. "Confirmed" is the existing `RESERVED`.** No rename in the database. The label shown
to agents is "Confirmed"; the desk keeps "Reserved". One status, two audiences.

**A-7. Group requests are group blocks.** An agent group request creates a `GroupBlock`
(`TENTATIVE`) with per-type holds, `payeeProfileId` = the agent when they hold a credit
account, and `cutoffDate` = the option date. Going `DEFINITE` already creates the Posting
Master. Names arrive later as a rooming list, each line becoming a pickup through the existing
pickup service. No second group engine.

**A-8. Overflow is its own pseudo room type, not `PM`.** "Book under PM" in the brief means
"in a pseudo room". The existing `PM` type is the Posting Master and Night Audit posts nothing
for `isPostingMaster` reservations, so reusing it would silently stop charges. Add a pseudo
type **`OVF` "Overflow"** created on demand like `PM`, plus `Reservation.isOverflow`,
`overflowHotelName` and `overflowNote`. An overflow booking is charged normally, is marked on
every list and the Tape Chart, has its own report, and is **always a request the hotel must
accept** (never automatic). It can be moved into a real room type later if a room frees up.
**Owner ruling (2026-11-11): an overflow guest gets no Green Tax and no registration number
from this property**, and is not counted in occupancy; the revenue still counts. Whether an
overflow request still needs a person at the hotel to accept it is open (Q-15).

**A-9. Agent availability obeys D-7 by default, plus two additions.** Numbers come from
`perNightTypeAvailability()`: real inventory, clamped at 0, stop sale reported as closed.
Additions: (a) the agent's own **allotment** is shown and is bookable even when general
availability is 0 (A-12); (b) the **option forecast**: per night, rooms on option
(tentative reservations + tentative block holds) next to rooms confirmed, so an agent can see
that "0 available" may loosen. Per property setting `agentAvailabilityDisplay`: `EXACT`,
`CAPPED` (shows "5+" above a threshold, default) or `STATUS_ONLY` (Available / Limited / On
request / Closed), because some hotels will not show competitors' agents their true stock.

**A-10. Sell limit is a number per night, and it caps the desk too.** New
`AvailabilitySellLimit` (property, room type or whole house, date, `extraRooms`). The desk's
`acknowledgeOverbook` keeps working up to the limit; past the limit it is refused unless the
user holds `AVAILABILITY delete` (the manager's override, see §10). **Channels and the brand
website never sell into the limit** (D-7 stands, word for word). Whether the Agent API may
sell into it is a per-property switch, default **off** (Q-3): with it off, a full night is an
overflow request; with it on, an agent booking inside the limit is accepted and flagged
"Oversold" for the desk.

**A-11. Sales windows give special agents first access.** `RatePlan.agentSalesOpenAt` (when
the plan's new season opens to all linked agents) and `AgentContract.earlyAccessDays` (how
many days earlier this agent may book). Outside the window the dates are visible, priced "on
request", not bookable. One date on the plan and one number on the agent is all the property
maintains each year.

**A-12. Allotments release themselves.** `AgentAllotment` (agent, property, room type, date
range, rooms per night, `releaseDays`). Unsold allotment for a night returns to general sale
`releaseDays` before that night, with no staff action. Optional **quota checkpoint**
(`quotaPercent` by `quotaReviewDate`): if the agent has picked up less than the quota by that
date, the remaining allotment for the period is released (or cut to what was picked up plus a
margin, Q-6) and both sides are notified. Arithmetic reuses the shape of
`outstandingBlockHolds`: an allotment is an outstanding hold that availability subtracts and
that the owning agent's bookings draw from.

**A-13. Confirmation is automatic, by rule; staff approval is not part of the flow** (owner,
2026-11-11). A request inside availability is never queued for a person. The system decides at
once whether it is **Confirmed** or **Tentative**, from rules the portal's administrator sets
(`AgentConfirmationRule`, per property, overridable per agent contract):

- *By rate*: the booking's rate plan is marked "confirms automatically" (typically a contract
  rate for an agent with a live credit account, inside the credit limit).
- *By payment*: a payment covering the required deposit (a percentage or the first night, set
  in the rule) has been received against the booking.
- *Otherwise*: Tentative, with an option date (A-14).

A tentative booking confirms itself the moment a rule becomes true: the agent switches to a
confirming rate, or the payment is recorded. When a booking confirms, the **confirmation
letter is sent automatically** to the agent (to the guest as well only if the agent asks, Q-20), and
the voucher becomes available. Staff can still confirm, extend or release any option by hand.

How a payment counts as "received" decides whether this is fully automatic. With an online
payment link whose provider tells the system the money arrived, it is. With a bank transfer
the agent only *reports*, a person must still see the money; in that case the booking stays
Tentative with the option clock paused until the receipt is recorded, which is the one place
a human remains in the loop (Q-17). Who "the administrator" is needs confirming (Q-16).

**A-14. Option period rules.** `optionDate = arrival − optionDaysBeforeArrival` (default 30,
per property, overridable per agent contract and per booking by staff). A booking made *inside*
that period gets `shortOptionHours` (default 48) or, if the property turns short options off,
must be made as Confirmed. Reminders at 7, 3 and 1 days. On expiry the booking becomes
`CANCELLED` with the system reason `OPTION_EXPIRED`, kept distinct in reports from an agent's
own cancellation. Expiry is processed by a job and also enforced lazily on read, so a stopped
job never leaves expired options holding rooms.

**A-15. What an agent may undo.** Nothing is ever deleted through the API (there is no DELETE
route). Tentative or requested: the agent may cancel with a reason from a property-defined
list plus free text. Confirmed: the agent may only raise an **amendment or cancellation
request**, which the hotel accepts or declines; fee rules (`cancellationFeeRuleId`) apply as
at the desk. In-house and later: read-only.

**A-16. Guest details never block a confirmation but have a deadline.** A confirmed booking
can be made with a lead name only. Full guest details (names, nationality, passport, dates of
birth, flights) are due `guestDetailsDueDays` before arrival (default 7); the portal and the
desk both show "Details missing". Guests are created through
`resolve-guest-profile.ts` so a returning guest is matched, not duplicated.

**A-17. The voucher is produced by the PMS.** A PDF from the stationery engine
(`stationery-pdf.ts`), with the property's branding and the agent's name and reference, so
the document the guest carries matches what the desk sees. Only for confirmed bookings. A
tentative booking can produce an "Option confirmation" that is visibly not a voucher. The
voucher shows no rates unless the agent ticks "show price" (agents often resell at their own
price).

**A-18. Settlement mode is recorded per booking.** `Reservation.settlementMode`, defaulted
from the agent contract:

| Mode | Who pays the hotel | Commission |
|---|---|---|
| `AGENT_NET` | Agent, net of commission | Credited on the agent's invoice (today's behaviour) |
| `AGENT_GROSS` | Agent, full amount | Accrued as **payable** to the agent |
| `GUEST_DIRECT` | Guest, at the hotel | Accrued as **payable** to the agent |

**A-19. Commission gets a ledger.** New `AgentCommission` rows (one per reservation and rate
plan): base, %, amount, mode, status `ACCRUED → APPROVED → PAID` or `NETTED` (offset against
what the agent owes) or `REVERSED`. `AGENT_NET` keeps posting the negative folio line and
writes a `NETTED` row so every commission is in one place. The other two modes write
`ACCRUED` at checkout and post nothing to the guest's folio. Debtors gains a **Commissions**
tab (approve, pay out, offset) and the agent statement lists invoices, payments and
commissions. This answers the open modelling question recorded in DECISIONS (2026-07-20) for
the non-city-ledger case.

**A-20. Commission base is the net room rate.** The room-charge line's `amount`, which is
stored without `serviceChargeAmount` and `taxAmount`. Rate from, in order: the booking's
contract override, `RatePlanAgentAccess.commissionRate`, `AgentContract.commissionRate`,
then `Profile.commissionRate` (finally given a job). **Rounded normally (half-up) to two
decimals** (owner, 2026-11-11), once per folio, not per night. See §8 for the worked example.

**A-21. Every booking carries its source.** `Reservation.source`: `DESK`, `WEBSITE`,
`CHANNEL`, `AGENT_PORTAL`, `AGENT_API`, `GROUP_PICKUP`. Backfilled from the existing
relations. Markers, reports and filters read this one column.

**A-22. Booking markers are rules, not hard-coded colours.** A property defines an ordered
list of `BookingMarker` rules: *when* (source, a specific agent, tentative, overflow, group,
VIP level, oversold) → *show* (icon from a curated set of the app's icons, colour from a
fixed palette of twelve tokens that work in light and dark). First match wins. Defaults are
seeded so it works with zero setup. Status keeps the bar's fill; the marker is an icon chip
and a coloured edge, so status and source never fight for the same channel. Tentative bars
are additionally hatched.

**A-23. Two different things, both wanted** (owner, 2026-11-11).

*Advance deposit: money in, no revenue.* An advance payment can be collected at any time
before or during the stay **without posting revenue**. It is recorded as a deposit on the
reservation's folio (or the group's master folio), with a receipt, and can be requested with a
numbered deposit request built by the quote engine. Night Audit posts the nights as usual and
the deposit is consumed against them. Works for `TENTATIVE` and `RESERVED` bookings and for
groups; it is also what the "by payment" confirmation rule (A-13) looks at.

*Advance Folio: the whole stay posted on one date.* The owner's definition: a guest staying
three nights checks in, and generating the Advance Folio posts **all three nights' charges,
in full, dated the same day, including every allocation charge**. This is revenue posting,
and it is what the existing **Advance Bill** already does for one in-house reservation
(`POST /reservations/[id]/advance-bill`: rate, extra occupancy, allocations, Green Tax and
unposted transfers, dated the business date; `advanceBilledThrough` stops Night Audit posting
those nights again). What is missing, and what Phase 8 builds:
- **Groups**: one action on the block that advance-posts every in-house pickup, each to the
  folio its routing names (master or own), with a per-pickup result list.
- The name. Staff look for "Advance Folio"; the action is labelled "Advance Bill". Rename to
  **Advance Folio** everywhere (button, dialog, docs, release notes).
- A printed document of its own (today the Interim Bill doubles as it).
- A way to reverse an advance folio made by mistake on the same business date.
- Whether it should also be allowed **before** check-in is open (Q-18); today it is in-house
  only, which keeps revenue from being posted for a guest who never arrives.

**A-24. Minimal configuration is a requirement, not a hope.** One switch per property turns
agents on with working defaults. Per agent, the only required act is **Invite** on the
profile. Everything else (contract terms, allotments, markers, sell limits) is optional and
defaults sensibly. No second copy of rates, room types, extras or policies anywhere: the API
reads what Revenue and the Hub already hold.

**A-25. Settings placement** (HUB_SETUP_PLAN rule). Property area
`/hub/p/{propertyId}/agents`: the switch, defaults, markers, reasons list; gated with
`requirePropertySetup()`. Enterprise area: the `AGENT` scope on API keys. Day-to-day work
(the request inbox, contracts, allotments, commissions) is operational and lives in the
dashboard under a new module (§10).

## 4. Data model (all additive)

| Model / column | Purpose |
|---|---|
| `Reservation.source String @default("DESK")` | A-21 |
| `Reservation.optionDate DateTime?`, `confirmationSubmittedAt?`, `confirmedAt?`, `confirmedVia String?` (`RATE`/`PAYMENT`/`DESK`) | A-13, A-14 |
| `Reservation.settlementMode String?` | A-18 |
| `Reservation.isOverflow Boolean`, `overflowHotelName?`, `overflowNote?` | A-8 |
| `Reservation.packageName String?`, `agentReference String?` | Package name and the agent's own file number |
| `Reservation.cancellationReasonCode String?` | Structured reason beside the existing free text |
| `AgentContract` (enterprise, property, agent `upid`, `status`, `commissionRate?`, `settlementMode`, `optionDaysBeforeArrival?`, `earlyAccessDays`, `mayRequestOverflow`, `mayBookGroups`, `autoAccept`, `validFrom/To`, `notes`) `@@unique([propertyId, upid])` | Everything commercial about one agent at one property. Absent row = property defaults |
| `AgentUser` (enterprise, agent `upid`, `email @unique per enterprise`, `passwordHash`, `name`, `role` `ADMIN`/`BOOKER`/`FINANCE`/`VIEWER`, `status`, `lastLoginAt`, invite token hash + expiry, failed-login counters) | A-3. Deliberately **not** `User`: an agent must never be reachable by `requireSession()` |
| `AgentSession` (token hash, `agentUserId`, `keyId`, expiry, last seen, IP) | Revocable, listed in the Hub |
| `AgentAllotment` (property, agent `upid`, room type, `startDate`, `endDate`, `roomsPerNight`, `releaseDays`, `quotaPercent?`, `quotaReviewDate?`, `status`) | A-12 |
| `AgentBookingRequest` (property, agent, `agentUserId`, `keyId`, `idempotencyKey`, `kind` `INDIVIDUAL`/`GROUP`, `commitment` `TENTATIVE`/`CONFIRMED`, `isOverflow`, payload JSON, `status` `PENDING`/`ACCEPTED`/`DECLINED`/`WITHDRAWN`/`FAILED`, `decisionBy`, `decisionReason`, `reservationId?`, `groupBlockId?`, quoted total) `@@unique([keyId, idempotencyKey])` | One row per attempt (W-9 pattern): the audit trail, the hotel's inbox, and the retry guard |
| `AgentChangeRequest` (reservation or block, `type` `AMEND`/`CANCEL`, payload, status, decision) | A-15 |
| `AgentCommission` (property, agent, reservation, folio?, rate plan, `baseAmount`, `rate`, `amount`, `mode`, `status`, `payoutId?`, business date) | A-19 |
| `AgentCommissionPayout` (agent, property, total, method, reference, date, by) | Paying or offsetting a batch |
| `AvailabilitySellLimit` (property, `roomTypeId?`, `date`, `extraRooms`) `@@unique` | A-10 |
| `RatePlan.agentSalesOpenAt DateTime?` | A-11 |
| `BookingMarker` (property, `sortOrder`, `label`, match fields, `icon`, `colorToken`, `isActive`) | A-22 |
| `AgentPortalSettings` (per property: `enabled`, option defaults, `shortOptionHours`, `guestDetailsDueDays`, `agentAvailabilityDisplay`, `agentsMaySellIntoLimit`, `maxOverflowPerNight`, `requireApprovalFor` set, voucher text) | A-24 |
| `AgentConfirmationRule` (property, `agentUpid?`, `ratePlanId?`, `trigger` `RATE`/`PAYMENT`, `depositPercent?`, `depositNights?`, `requiresCreditAccount`, `isActive`, `sortOrder`) | A-13 |
| `RoleCapability` (`roleId`, `capability`) `@@unique` | §10, fine-grained permissions |
| `SystemCode` category `AGENT_CANCEL_REASON` | Reason list, edited in the existing Dropdowns manager |
| `WebsiteApiKey.scopes` gains `AGENT` | A-3 |

Money columns follow the repo's existing `Float` + `toCents` convention. Every model with a
`propertyId` is included in the tenant-isolation tests.

## 5. Booking status flow

### 5.1 Individual booking

```
 agent submits ──▶ PENDING request ── hotel accepts ──┐      DECLINED (request only,
   (overflow only, see Q-15)  └── hotel declines ─────┼────▶  no reservation exists)
                                                      ▼
 agent submits ──▶ accepted at once ──▶ TENTATIVE ──────────▶ RESERVED ("Confirmed")
   (inside availability    │             │  ▲   a rule becomes  │   letter sent
    or own allotment)      │             │  │   true: rate or   ├─▶ IN_HOUSE ─▶ CHECKED_OUT
                           │             │  │   payment (A-13)  │
                           │             │  └─ hotel extends    ├─▶ NO_SHOW
                           │             │     the option       │
                           │   agent cancels (reason) ──┐       └─▶ CANCELLED (hotel only;
                           │   option expires (job) ────┤           agent may only REQUEST)
                           │   hotel cancels ───────────┤
                           │                            ▼
                           │                        CANCELLED (reason code tells which)
                           └─ a rule is already true at booking: straight to RESERVED
```

Rules that keep it honest:

- A request row always exists first. A reservation exists only once accepted, so a declined
  request never consumes a confirmation number or inventory.
- `TENTATIVE → RESERVED` is one conditional update (`where status = 'TENTATIVE'`), the same
  claim pattern check-out uses, so a confirmation and an expiry racing each other cannot both
  win.
- `RESERVED` never goes back to `TENTATIVE`.
- Reinstating a cancelled tentative booking re-runs the availability check and gets a fresh
  option date; it is a desk action only.
- A `TENTATIVE` reservation cannot be checked in, advance-billed, or given an eRegistration
  link. It can have a room assigned (the reservations team may want to pencil it in).
- Night Audit: a tentative booking whose arrival date is reached without confirmation is not
  a no-show. The expiry job will already have cancelled it; Night Audit lists any survivor
  under "Needs attention" rather than posting a no-show fee.

### 5.2 Group

```
 agent group request ─▶ PENDING ─▶ accepted ─▶ GroupBlock TENTATIVE ─▶ DEFINITE ─▶ pickups ─▶ …
                                                 │   (cutoff = option date)   (rooming list,
                                                 ├─▶ LOST (agent withdrew / option expired)   each line a
                                                 └─▶ CANCELLED (hotel)                        RESERVED pickup)
```

- Option expiry on a block sets `LOST` with a reason, which the state machine already allows
  from `TENTATIVE` only.
- After `DEFINITE` the agent can reduce rooms only by request; unpicked rooms still release
  at the rooming-list deadline (the block's `cutoffDate`, moved to that deadline when the
  block goes definite).
- The existing rule stands: a block cannot be cancelled while it has live pickups.

### 5.3 What each side calls it

| PMS `status` | Extra facts | Desk label | Agent label |
|---|---|---|---|
| (request `PENDING`) | | New agent request | Awaiting hotel |
| `TENTATIVE` | `confirmationSubmittedAt` null | Tentative, option until D | On option until D |
| `TENTATIVE` | `confirmationSubmittedAt` set | Tentative, payment to verify | Confirmation sent, being verified |
| `RESERVED` | guest details incomplete | Reserved, details missing | Confirmed, guest details due D |
| `RESERVED` | | Reserved | Confirmed |
| `RESERVED` | `isOverflow` | Reserved, Overflow (hotel name) | Confirmed, accommodated at partner hotel |
| `IN_HOUSE` / `CHECKED_OUT` / `NO_SHOW` | | as today | In house / Completed / No-show |
| `CANCELLED` | reason `OPTION_EXPIRED` | Cancelled, option expired | Released (option expired) |
| `CANCELLED` | other | Cancelled | Cancelled |

### 5.4 Where `TENTATIVE` must be handled (checklist for Phase 1)

`availability.ts` (`INVENTORY_HOLDING_STATUSES`), `website-api/availability.ts` and
`channels/sync.ts` (tentative **reduces** what is published: under-selling is the safe side,
same reasoning as tentative blocks), `status-tone.ts`, `reservation-state.ts` (derived state,
reinstate rules), `palette-actions.ts`, Front Desk lists and counts (not an arrival),
Reservations list filters and badges, Tape Chart, booking form (status control for staff),
check-in guard, advance-bill guard, eRegistration link guard, Night Audit (`run.ts`: no room
posting, no no-show), `held-nights.ts`, dashboard `overview.ts` (on-the-books forecast shows
tentative separately), every report in `src/lib/reports/defs` that filters on status
(arrivals, forecast, occupancy, cancellations), Green Tax basis, licence usage counts,
`hard-delete-gate.ts`, confirmation letter (says "Option" not "Confirmation"), global
search, notifications producers, CSV exports, the Booking API lookup. A grep for
`"RESERVED"` at the start of Phase 1 is the authoritative list; each hit is ticked in the PR
description.

## 6. Agent API surface (`/api/agent/v1`)

All routes need the `AGENT`-scoped key. All except `/auth/*` need an agent token. Writes need
`Idempotency-Key`. Errors use the Booking API shape and codes where they exist.

**Auth:** `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`,
`POST /auth/accept-invite`, `POST /auth/forgot-password`, `POST /auth/reset-password`,
`GET /me` (agent, user role, properties, contract summary per property).

**Catalogue:** `GET /properties`, `GET /properties/{id}` (room types, meal plans, extras
marked `publishToApi`, policies, option and release rules, cancel reasons, whether transfers
are bookable).

**Availability and price:**
- `GET /properties/{id}/availability?from&to` → per room type per night: `status`
  (`AVAILABLE`/`LIMITED`/`ON_REQUEST`/`CLOSED`/`NOT_ON_SALE`), `available` (per display mode),
  `onOption`, `myAllotmentLeft`, `releaseDate`, nightly net rate for the agent's plan.
- `POST /properties/{id}/quote` → authoritative total from `computeReservationQuote`, the
  commission estimate, the option date this booking would get, and what would happen if
  submitted (`ACCEPTED_INSTANTLY` / `NEEDS_APPROVAL` / `OVERFLOW_ONLY` / `REFUSED` + reason).

**Bookings:**
- `POST /properties/{id}/bookings` (individual; one or more rooms; `commitment`;
  `expectedTotal` → `409 PRICE_CHANGED`).
- `POST /properties/{id}/group-requests`.
- `GET /bookings?status&from&to&q&page`, `GET /bookings/{ref}`.
- `POST /bookings/{ref}/confirm` (`CONTRACT` or `PAYMENT` with reference and proof upload id).
- `PUT /bookings/{ref}/guests`, `PUT /bookings/{ref}/travel` (flights, transfers),
  `PUT /bookings/{ref}/requests` (package name, special requests).
- `POST /bookings/{ref}/cancel` (tentative only, reason required),
  `POST /bookings/{ref}/change-requests`, `GET /bookings/{ref}/change-requests`.
- `GET /bookings/{ref}/voucher.pdf`, `POST /bookings/{ref}/voucher/email`.
- Groups: `GET /groups/{code}`, `PUT /groups/{code}/rooming-list` (JSON or CSV, validated as a
  whole, applied line by line with a per-line result), `POST /groups/{code}/confirm`.

**Finance:** `GET /statement?from&to` (invoices, payments, commissions, balance),
`GET /commissions`, `GET /invoices/{id}.pdf`.

**Allotments:** `GET /allotments` (held, picked up, releasing soon, quota progress).

**Webhooks** (for agents with their own systems; the portal uses them too): `booking.accepted`,
`booking.declined`, `booking.confirmed`, `booking.option_expiring`, `booking.released`,
`booking.cancelled`, `booking.changed`, `change_request.decided`, `allotment.released`,
`statement.ready`.

**New error codes:** `AGENT_NOT_ACTIVE`, `NOT_ON_SALE_YET`, `OPTION_NOT_ALLOWED`,
`CREDIT_LIMIT_EXCEEDED`, `OVERFLOW_NOT_ALLOWED`, `OVERFLOW_FULL`, `ALLOTMENT_EXHAUSTED`,
`BOOKING_LOCKED`, `REASON_REQUIRED`, `GUEST_DETAILS_INCOMPLETE`, `ROOMING_LIST_CLOSED`.

**Never exposed:** other agents' data, room numbers before check-in unless the property opts
in, staff names, internal remarks, cost or other agents' rates, the housekeeping state.

## 7. PMS screens that change

| Screen | Change |
|---|---|
| **Agent requests** (new, dashboard) | Not an approval queue (A-13). A worklist of what genuinely needs a person: reported payments to match, overflow requests (Q-15), change and cancellation requests on confirmed bookings, rooming lists received. Keyboard-first like Front Desk |
| **Agents** (new, dashboard) | Per agent: contract, users (invite, suspend, reset), allotments with pickup and release dates, bookings, commission, statement. Opens from the agent profile too |
| Reservations list, Front Desk, search | Tentative status and filter, option date column, source marker, Overflow and Details-missing badges |
| Booking form | Staff can create a tentative booking with an option date, pick settlement mode, mark overflow, set package name |
| Reservation page | Option panel (confirm, extend, release, verify payment), agent request history, deposit request and receipt, Advance Folio (renamed from Advance Bill), voucher |
| Tape Chart | Markers, hatched tentative bars, legend, filter by source / agent / status, Overflow row beside Unassigned |
| Availability | Sell limit row and editor next to Stop sale; "On option" and "Allotted" lines under each room type; oversold nights flagged |
| Group Blocks | Source and agent on the block; rooming-list import; **Send documents** in the Master folio section (master folio, every pickup folio, group statement, as one PDF or a zip, by email); deposit request; **Advance Folio for the whole group**; commission summary |
| Debtors | Commissions tab; statement includes commissions; proper create/update permission checks |
| Night Audit | Tentative survivors and unreleased allotments under "Needs attention"; commission accrual at checkout |
| Hub, property area | **Agents** page (switch, defaults, reasons, markers). API keys gain the `AGENT` scope |
| Notifications | New request, payment to verify, option expiring (both sides), option expired, overflow request, rooming list received, allotment released, quota missed |
| Reports | Agent production (room nights, revenue, commission, by agent), Options and expiries, Pickup versus allotment, Overflow bookings, Commission payable |

## 8. Settlement and the commission example

The brief's example: a room sold at 75.00 **including** 10% service charge and 17% tax.

```
base            = 75.00 / 1.10 / 1.17      = 58.2751…  → 58.28
service charge  = base × 10%               = 5.83
tax             = (base + service) × 17%   = 10.90
commission 10%  = base × 10%               = 5.8275…   → 5.83
```

Normal rounding to two decimals (owner, 2026-11-11; the 58.27 and 5.82 in the brief were a
slip). The three parts above sum to 75.01, so the tax engine's existing back-calculation,
which must make base + service + tax equal exactly 75.00, decides which line absorbs the
cent. Commission is computed from the room-charge amounts actually posted, summed across the
stay, and rounded once.

Per mode, for a 3-night stay at that rate (base 174.83 for the stay, total 225.00):

| Mode | Guest folio | Agent's city ledger | Commission ledger |
|---|---|---|---|
| `AGENT_NET` | Room charges route to the agent's folio | Invoice 225.00, commission line −17.48, agent owes **207.52** | `NETTED` 17.48 |
| `AGENT_GROSS` | Same | Invoice 225.00, agent owes 225.00 | `ACCRUED` 17.48, hotel owes agent |
| `GUEST_DIRECT` | Guest pays 225.00 at the desk | Nothing | `ACCRUED` 17.48, hotel owes agent |

Payables are settled from Debtors → Commissions: approve a period, then either record a
payout or offset against the agent's open invoices (creates a payment on those invoices with a
"Commission offset" method, so aging stays right).

Rules:

- Commissionable: nightly room charge and extra-occupancy charge. Not commissionable by
  default: Green Tax, service charge, taxes, transfers, extras, cancellation and no-show
  fees. A package whose meal component is carved out of the rate (`INCLUDE_IN_RATE`) is
  commissionable on the room part only unless the contract says "commission on package"
  (Q-8).
- Voids, rebates and a reversed check-out reverse the commission row (the reversal route
  already removes the folio line; it must also mark the ledger row `REVERSED`).
- A commission already paid out and then reversed becomes a negative row in the next period.
- Complimentary and house-use plans earn nothing.
- Commission currency is the folio's currency.
- A booking moved from one agent to another before check-out pays the agent on the booking at
  check-out; after check-out the agent cannot be changed.

## 9. Edge cases

**Inventory and concurrency**
- Two agents take the last room at once → wrap the availability check and the write in
  `pg_advisory_xact_lock` keyed on (property, room type), inside `createReservation`. This
  closes the long-open last-room TODO for the desk, the website and channels as well.
- A multi-room booking is all or nothing.
- A tentative booking expires at the same moment the agent confirms → conditional update;
  the loser gets `409 BOOKING_LOCKED` and a fresh state.
- A room goes out of order after a tentative hold → the existing oversold detection flags
  it; the desk decides, the agent is not auto-cancelled.
- Stop sale set after a tentative booking exists → existing bookings are untouched (owner
  rule 2026-10-10); confirming it is still allowed.
- Sell limit lowered below what is already sold → nothing is cancelled; the night shows
  oversold and further sales are refused.
- An allotment larger than what is free when it is created → refused with the nights that
  fail, same as a group hold today.
- Allotment and a group block for the same agent overlap → the block draws from the
  allotment first, never double-held.
- Property business date versus the agent's time zone: every date in the API is a property
  date; option deadlines are a property-local end of day and are returned with an explicit
  timestamp.

**Rates**
- No price for a night → `NO_RATE`, never a booking at 0 (W-6).
- Rate changed between quote and booking → `PRICE_CHANGED`. Rate changed after a tentative
  booking: the price is **locked at booking** (`overrideRate` on the assignment) unless the
  property chooses "re-price until confirmed" (Q-9).
- Derived plans, split stays across two plans, extra adults and children: all priced by the
  quote engine, nothing re-implemented.
- Agent linked to no plan → sees availability but everything is "on request".
- Sales window not open → `NOT_ON_SALE_YET` with the date it opens.
- Minimum stay or closed-to-arrival are not modelled in the PMS; not promised here.

**Bookings**
- Booking made inside the option period, same-day arrival, past arrival (refused).
- Agent submits the same request twice (double click, retry) → idempotency key.
- Agent with an expired contract or suspended user → existing bookings stay readable, no new
  ones.
- Agent's credit limit exceeded → cannot confirm by contract, may still confirm by payment.
- Guest count exceeds room capacity → refused using `maxOccupancy`.
- Name changes after confirmation: allowed until `guestDetailsDueDays`, then by request.
- Child ages decide Green Tax and extra-child price; dates of birth are needed before arrival.
- Same guest booked twice by two agents → flagged for the desk as a possible duplicate, not
  blocked.
- The hotel changes a booking at the desk (dates, room type) → the agent sees the change, is
  notified, and the voucher is re-issued with a new version number; old versions stay
  downloadable and are marked superseded.
- The hotel cancels a confirmed booking → agent notified with the reason.
- Overflow booking later fits in a real room → "Move to room type" converts it and clears the
  overflow mark.
- Overflow requests above `maxOverflowPerNight` → `OVERFLOW_FULL`.
- Day-use and zero-night stays are not offered to agents.

**Groups**
- Rooming list with more names than rooms held, with dates outside the block, with a room
  type not held → the line is rejected with its reason, the rest apply.
- Rooming list after the deadline → `ROOMING_LIST_CLOSED`, by request only.
- Partial pickup at cutoff → unpicked rooms release, picked-up rooms stay.
- Group shrinks or grows after definite → change request; growth re-checks availability.
- A pickup paid by the guest directly inside a group billed to the agent
  (`groupBillToMaster = false`) → commission follows that pickup's own settlement mode.
- Posting Master must stay excluded from commission, occupancy and registration.

**Transport**
- Property has the Transportation module on → transfers are created as `TransportBooking`
  through the module's service; off → the older `ReservationTransport` rows.
- Flight change after a transfer is booked → the transfer is flagged for dispatch, not moved
  silently.
- International arrival plus a domestic leg: two legs, each with its own carrier, number and
  time.
- Transfer for an overflow guest goes to the partner hotel's location.

**Money**
- Deposit paid, then the booking is cancelled → the deposit stays on the folio; refund or
  forfeit is a desk decision under the fee rule.
- Payment proof is a file upload: type and size limits, virus scan hook, stored like profile
  attachments, never served without the agent token.
- Deposit request issued, then the stay changes → re-issued with a new number; the old one
  is marked superseded. A deposit already received stays on the folio.
- Advance Folio posted, then the guest leaves early → the unused nights are rebated at
  check-out (existing early-departure handling), and commission follows the net posted amount.
- Advance Folio on a group where one pickup has no open folio or is not in house → that
  pickup is skipped and reported; the others post.
- A payment that would auto-confirm arrives after the option expired → the booking is not
  silently revived; the money is held as a deposit on the cancelled booking and the desk is
  alerted to reinstate (availability re-checked) or refund.
- Statement for an agent working with several properties of one enterprise: per property
  (finance is per property since 2026-09-24), with an enterprise total.

**Security**
- Agent tokens are bound to the key that issued them and to one agent profile; a stolen token
  is useless with another key.
- Login is rate limited per account and per IP (Postgres-backed; the in-memory staff limiter
  is a known TODO and must not be copied).
- Uniform answers for unknown email and wrong password; invite and reset tokens hashed, one
  use, short lived.
- An agent user must never satisfy `requireSession()`; an agent token must never be accepted
  on a dashboard route. A test asserts both directions.
- Booking references are unguessable (B-11 pattern), never the sequential confirmation
  number alone.
- Personal data (passports) is returned only to the agent that entered it, and never logged.
- `docs:check` extended to the agent API docs.

**Operations**
- Jobs are idempotent and safe on several replicas (lease pattern from the webhook job).
- Option expiry also enforced on read (A-14).
- Turning the property switch off stops the API the same minute and leaves every existing
  booking intact.
- Deactivating an agent profile (existing feature) suspends its users and stops new bookings;
  blocked while the agent has open options unless staff choose to release them.
- Email: reminders use the property's mail settings; with none configured, in-portal notices
  and webhooks still work and the Hub says emails are not going out.

## 10. Permissions and roles review

The brief asks for the roles list to be brought up to date. Findings from the code so far
(this is the start of the audit, Phase 0 completes it):

| Finding | Evidence | Proposed fix |
|---|---|---|
| `TAPE_CHART` is never enforced on the server | `/api/tape-chart` and `/api/reservations/tape-chart` check the session and the property only | Require `TAPE_CHART view`; drag and drop moves require `TAPE_CHART update` |
| `DEBTORS` only ever checks `view` | All four Debtors routes, including sending a statement | `view` to read, `update` to send statements and record payments, `create` to open an account, `delete` to close one |
| Several routes check the session but no module | `reservations/quote`, `reservations/rate-availability`, `reservations/[id]/daily-breakdown`, `rooms/available`, `folios/[id]/invoice-data`, `folios/[id]/send-invoice`, `payments/[id]/receipt-data`, `payments/[id]/send-receipt`, `cashiering/currency-exchange/[id]/*`, `debtors/…/statement-data`, `pos/search` | Add the owning module's `view` (or `update` for send actions) |
| `FRONT_DESK` and `RESERVATIONS create` are barely used | One `FRONT_DESK view` check; one `RESERVATIONS create`; 23 `RESERVATIONS update` | Decide what each action means per module and write it down, as was done for `TRANSPORTATION` |
| Action meanings are undocumented for most modules | Only Transportation, Dashboard and Green Tax say what view/create/update/delete mean | A table in the Hub's Users & Access page and in `/docs/configuration`: one line per module per action |
| `Profile.commissionRate` exists with no effect | Stored and displayed only | Used as the fallback rate (A-20) |
| Default roles predate several modules | `prisma/rbac-seed-data.ts` | Review every default role against the final table; add **Reservations Agent** and **Accounts** defaults if missing |

### Capabilities: finer control than view / create / update / delete (owner, 2026-11-11)

The owner's objection to today's roles screen: it looks bland and offers no advanced control.
The four actions per module stay, because they are simple and every route already uses them.
On top, each module gains named **capabilities**: single switches for things the four
actions cannot express. A capability is checked with `requireCapability(ctx, "…")` /
`hasCapability`, merges across a user's roles by OR exactly like module permissions, and
defaults to what the role could effectively do before, so no one loses or gains anything on
upgrade.

Starting catalogue (the audit in Phase 0a completes it; the list is code, not data, so a
capability cannot exist without a check behind it):

| Group | Capability | Today's implicit rule |
|---|---|---|
| Reservations | Overbook a room type | Anyone who can book may tick the overbook prompt |
| | Exceed the sell limit | new (A-10) |
| | Override a stop sale | `AVAILABILITY update` |
| | Change or override a rate on a booking | `RESERVATIONS update` |
| | Book a past arrival date | `RESERVATIONS update` |
| | Cancel / reinstate a booking | `RESERVATIONS delete` / `update` |
| | Confirm, extend or release an option | new (A-13, A-14) |
| | Mark or clear Overflow | new (A-8) |
| Availability | Set and lift stop sale | `AVAILABILITY update` |
| | Edit sell limits | new |
| Front Desk | Check in with a balance due; undo a check-in | `RESERVATIONS update` |
| | Check out with a balance; reverse a check-out | `RESERVATIONS update` |
| | Print or send a registration card | none (signed in is enough) |
| | Send an eRegistration link | `RESERVATIONS update` |
| Billing | Generate, print or send a folio / invoice | none (signed in is enough) |
| | Generate an Advance Folio | `CASHIERING update` |
| | Void a charge; post a rebate or discount | `CASHIERING update` / `delete` |
| | Refund a payment; reopen a closed folio | `CASHIERING` |
| | Transfer charges between folios; edit routing | `CASHIERING` |
| | Post to City Ledger | `CASHIERING` |
| **Rates and figures** | **Suppress rates**: hide every financial figure (rates, totals, balances, revenue) on screens, prints and exports for this role | none; anyone who can see a booking sees its money |
| | See other users' cashier shifts | `CASHIERING view` |
| Night Audit | Run Night Audit; re-run a step; change the business date | `NIGHT_AUDIT create` / `update` |
| Profiles | See passport and ID numbers; merge profiles; deactivate a profile | `PROFILES view` / `update` |
| Debtors | Send statements; record ledger payments; change a credit limit | `DEBTORS view` |
| Agents | Match a reported payment; pay or offset commission; edit contracts and allotments | new |
| Reports | Export to file; see revenue reports | `REPORTS view` |

**Suppress rates** reaches furthest: it is not one check but a rule every money-bearing
response must honour. It is enforced on the **server** (figures are removed from the API
response, not hidden with CSS), through one shared serializer used by the reservation, folio,
quote, tape chart, group, report and export routes, and a test asserts that a suppressed role
receives no amount field from any of them. A suppressed role cannot hold a capability that
needs figures (posting, voiding, refunds); the screen says so.

**The roles screen** (Hub → Users & Access), redesigned:
- One role at a time, not one wide matrix. Modules down the left with a summary chip each
  ("Full", "View only", "Custom", "None").
- Selecting a module shows its four actions, each with a one-line meaning, then its
  capabilities as labelled switches with a sentence on what each allows.
- Search across modules and capabilities ("overbook", "refund").
- "Compare with…" another role, differences highlighted; "Duplicate role".
- A plain-language summary of the role at the top ("Can book and check in; cannot see rates;
  cannot void"), generated from the switches.
- A "who has this" list per capability, so an owner can answer "who can overbook?".
- Presets for common posts (Reservations Agent, Night Auditor, Accounts, Housekeeping
  Supervisor) as starting points.
- Works on a phone as a list, per MOBILE_PLAN.

This makes Phase 0 larger than a tidy-up; §11 splits it in two.

New for this plan:

- Module **`AGENTS`** (dashboard): `view` inbox and agent pages; `create` accept or decline
  requests, invite agent users; `update` contracts, allotments, option extensions, payment
  verification; `delete` commission payouts and offsets.
- `AVAILABILITY delete` = exceed the sell limit (manager override). `AVAILABILITY update`
  keeps meaning stop sale, and now also editing sell limits.
- Property setup for agents goes through `requirePropertySetup()`.

The audit ships a test that walks every `route.ts` under `src/app/api` and fails when a
handler has neither a permission check nor an entry in an explicit allow-list with a reason,
so the gap cannot reopen.

## 11. Phases, PRs and versions

Rules for every phase (from the release workflow): one PR **against `master`**, never
stacked; squash merge deploys; before numbering, list open PRs and `origin/release/*` and
take a number above all of them (the numbers below are the plan, not a reservation);
additive migrations only; `tsc` and the full suite green; release notes entry; the
Configuration or Operations guide for every changed screen, re-shot screenshots,
`npm run docs:pdf`, `npm run docs:check`; `npm run mobile:audit` for changed screens; TODO.md
and this file's status table updated in the same PR. Each phase is useful on its own and
safe to stop after.

| Phase | Version | Scope | Done when |
|---|---|---|---|
| **0a. Permission enforcement** | **9.0.1** | §10 audit and fixes, action-meaning table, default-role review, route coverage test. No new feature | Every API route is gated or allow-listed with a reason |
| **0b. Capabilities and the new roles screen** | **9.0.2** | `RoleCapability`, capability registry and `requireCapability`, the starting catalogue wired to its checks, **Suppress rates** enforced server-side, redesigned Users & Access screen, presets, Configuration guide | An owner can switch off overbooking or hide all figures for a role, and can see who holds any capability |
| **1. Booking status flow** | **9.1.0** | `TENTATIVE` status, option date, confirm / extend / release at the desk, option-expiry job, `Reservation.source` + backfill, structured cancel reasons, last-room advisory lock, §5.4 checklist. Staff can use tentative bookings with no agent involved | A tentative booking holds a room, shows everywhere with its own status, expires by itself; parallel last-room test passes |
| **2. Sell limit, overflow, forecast** | **9.2.0** | `AvailabilitySellLimit` + editor on Availability, desk overbook capped, `OVF` pseudo type and overflow fields, "On option" line on the grid, oversold flags, Overflow report | A night can be capped at +N; an overflow booking is recognisable on every list |
| **3. Booking markers** | **9.3.0** | `BookingMarker` rules, Hub editor (icon + colour pickers), Tape Chart markers, hatching, legend and filters, same markers on Reservations and Front Desk, seeded defaults | A property can tell agent, website, channel and desk bookings apart at a glance, in light and dark, on a phone |
| **4. Agents in the PMS** | **9.4.0** | `AGENTS` module, `AgentContract`, `AgentUser` (invite / suspend), `AgentAllotment` + release and quota job, sales windows, Hub Agents page, Agents dashboard pages, allotment lines on Availability | An agent can be set up in under two minutes; an unsold allotment releases itself |
| **5. Agent API, read side** | **9.5.0** | `AGENT` scope, auth routes, sessions, `/me`, catalogue, availability with forecast and allotment, quote. Docs portal area `/docs/agent-api`, OpenAPI file. Portal mock switches to the real API for these calls | An agent signs in and sees live availability and their own rates; isolation tests pass |
| **6. Agent API, bookings** | **9.6.0** | Requests (individual, multi-room, group), automatic confirmation rules (rate, payment) and the automatic confirmation letter, guests, travel and transfers, package and requests, rooming list, cancel with reason, change requests, voucher PDF, webhooks, Agent requests inbox, notifications | A booking made by an agent appears in the PMS, blocks the room, and can be confirmed, detailed and vouchered end to end |
| **7. Settlement** | **9.7.0** | Settlement modes, `AgentCommission` ledger and payouts, Debtors Commissions tab, statement with commissions, agent statement endpoint, commission reports, reversal handling | The three modes in §8 produce the figures in §8; a reversed check-out reverses the commission |
| **8. Group billing and advance** | **9.8.0** | Send documents from the Master folio (bulk folios, group statement); deposit request and advance deposit without revenue, for bookings and groups; **Advance Folio for groups**, rename from Advance Bill, own document, same-day reversal; group commission summary; rooming-list import at the desk | A group's documents go out in one action; a deposit is taken with no revenue posted; a whole group's stay can be posted in one step |
| **9. Portal go-live** | **9.9.0** | Hardening from the pilot, load and abuse tests, monitoring tiles in the platform console, Operations guide "Working with agents", go-live checklist. Portal itself is built against the real API in its own local repo | One real agent completes a tentative → confirmed → checked-out → commission-settled cycle |

Phases 0a to 3 are PMS improvements the customer feels at once and that do not depend on the
portal. Phase 1 must precede everything agent-facing. Phases 2 and 3 can swap or run in
parallel sessions (different files). Phase 7 can start once Phase 1 is merged.

**Tests per phase** (extend `tests/business-rules/`): status transitions including the
confirm-versus-expire race; availability arithmetic with tentative, allotment, sell limit and
stop sale combined; last-room race; agent isolation (agent A never reads agent B, agent token
never opens a dashboard route); idempotent replay; price change; option expiry on read with
the job stopped; allotment release and quota; commission per mode against §8's figures,
split-stay, void and reversal; confirmation rules (rate true at booking, payment arriving later, payment after expiry); Advance Folio for a group with a mixed set of pickups; a suppressed role receives no amount from any route; capability merge across roles; rooming-list partial acceptance; voucher versions; route
permission coverage.

## 12. The mockup website (local only)

Location: `agent-portal/` at the repository root, **ignored through `.git/info/exclude`**, so
it is not in git and no tracked file changed to hide it. Plain HTML, CSS and JavaScript, no
build step: open `agent-portal/index.html`, or serve the folder.

It is a mockup: data is invented in `agent-portal/assets/mock-api.js`, whose functions are
named and shaped after §6 so replacing them with real `fetch` calls is the migration path.
Changes made in the mockup (a new booking, a confirmation, a cancellation) persist in the
browser only.

Screens: sign in, dashboard (options expiring, details due, allotment pickup), availability
with option forecast and allotment, new booking request (individual or group, tentative or
confirmed, overflow request when full, quote with commission), bookings list with the status
flow, booking detail (option panel, guests, flights and transfers, package and requests,
voucher, cancel with reason, change request), group detail with rooming list, allotments and
release dates, statement and commissions.

The fictional property is Coral Bay Resort and the fictional agencies use example.com, in
line with the docs rule that no real customer appears in anything presentable.

## 13. Owner questions

### Answered (2026-11-11)

| # | Question | Owner's answer | Where it landed |
|---|---|---|---|
| Q-1 | What is disliked about permissions? | The screen looks bland and has no advanced control. Keep the simple per-module CRUD, add drill-down options: allow overbooking, stop sale, registration card and folio generation, suppress rates (hide financial figures), and more | §10 Capabilities, Phase 0b |
| Q-2 | Accept at once, or wait for staff? | No staff approval. Confirmed automatically by rule (rate or payment), with the confirmation letter sent; otherwise Tentative. The administrator sets the rules | A-13 |
| Q-4 | Overflow guests: Green Tax and registration number here? | No | A-8 |
| Q-5 | Commission rounding | Normal rounding to two decimals; the 5.82 was a slip | A-20, §8 |
| Q-7 | Deposit without revenue, or revenue posted in advance? | Both exist and are different. An advance payment is collected without posting revenue. An Advance Folio posts every night of the stay, with allocations, on one date | A-23 |

### Still open

| # | Question | Plan assumes |
|---|---|---|
| Q-3 | May agents sell into the sell limit (controlled overbooking), or only the desk? | Desk only; agents get the overflow request instead |
| Q-6 | When an agent misses the quota: release everything unsold, or shrink the allotment to pickup plus a margin? | Release everything unsold from the review date onward |
| Q-8 | Is commission paid on the room part only, or on the whole package rate (room plus included meals)? | Room part only, with a per-contract switch |
| Q-9 | Is a tentative booking's price locked when it is made, or re-priced until confirmed? | Locked |
| Q-10 | How much availability do agents see: exact numbers, capped, or status words only? | Capped ("5+") |
| Q-11 | Who hosts the portal: Uppsolut as one shared site for all customers, or one site per customer under their brand? | One shared site, themed per property from data the API returns |
| Q-12 | Can the customer share how they mark agent bookings today in mobile-calendar (two screenshots)? | Seeded defaults in Phase 3 are a guess until then |
| Q-13 | Is the Agent Portal a paid add-on (switched by Osta like Excursions) or part of the base product? | Add-on key `AGENTS`, toggled in the platform console |
| Q-14 | Should the hotel be able to cancel a confirmed agent booking with a fee, and who is charged: the agent's ledger or the guest? | The existing fee rule, charged to whoever the settlement mode names |
| Q-15 | Overflow (hotel full, guest goes to a partner hotel): does this also go through with no staff step, or is it the one request a person must accept, since someone has to secure the partner room? | A person accepts it; everything else is automatic |
| Q-16 | "Give control to the agent website admin": is that the hotel's administrator of the portal (sets the rules for all agents), or each agency's own admin user (decides what their bookers may do)? | The hotel's administrator sets confirmation rules; an agency admin only manages their own users |
| Q-17 | For "confirmed by payment": will agents pay through an online payment link (confirmation is then fully automatic), or by bank transfer they report (someone at the hotel must match the money first)? And how much must be paid to confirm: full amount, a percentage, the first night? | Both supported; a percentage set per rule, default 100% |
| Q-18 | Advance Folio already exists for one in-house reservation, as "Advance Bill" on the reservation page. Is the gap that it is missing for groups and hard to find under that name, or should it also be allowed before check-in? | Groups and the rename; in-house only |
| Q-19 | Suppress rates: should a suppressed user still see that a balance *exists* (a "balance due" flag with no amount), so the desk can stop a guest leaving unpaid? | Yes: a flag, never a figure |
| Q-20 | Automatic confirmation letter: to the agent only, or also to the guest when the agent has entered the guest's email? Agents often do not want the hotel writing to their client | Agent only, unless the agent ticks "also send to guest" |

## 14. Status

| Phase | Status |
|---|---|
| Mockup (`agent-portal/`, local) | Built 2026-11-11 |
| 0a, 0b, 1 – 9 | Not started |
