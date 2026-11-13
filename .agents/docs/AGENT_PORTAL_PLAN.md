# Agent Portal + Agent API — plan

> Status (2026-11-11): **PLAN ONLY. Nothing in the PMS is built.** A clickable mockup of the
> agent website exists locally in `agent-portal/` (not in git, see §12). Written against
> `origin/master` at **8.13.6**. PMS work in this plan is versioned from **9.0.1**.
> **Three rounds of owner answers (2026-11-11) are folded in.** The second round reshaped the
> design: an agent is a **Source** profile in Client Relations, the portal works **through
> Group Blocks** (the agent requests a slot, the hotel approves it as a block, bookings are
> pickups in that block), confirmation is a **manual desk step**, and there is **no separate
> Agents module**. §1a is the workflow and the spine of the plan. §13 lists what was answered
> and what is still open.
>
> Read with: [WEBSITE_API_PLAN.md](DEV_LOG.md) and
> [BOOKING_API_ADDONS_PLAN.md](DEV_LOG.md) (the key, rate-limit, idempotency and
> webhook plumbing this reuses), [HUB_SETUP_PLAN.md](DEV_LOG.md) (where settings go),
> [TRANSPORTATION_PLAN.md](DEV_LOG.md), [NOTIFICATIONS_PLAN.md](NOTIFICATIONS_PLAN.md),
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

## 1a. The workflow (owner, 2026-11-11): the spine of this plan

1. **The hotel publishes** rates for the full year with availability, and tells its agents to
   pick the slots they can fill.
2. **The agent requests a slot**: a date period and how many rooms of which type they can
   fill.
3. **The hotel approves** the request (it may change the numbers). The slot now belongs to
   that agent, with cutoff-date rules and some elasticity. **A slot is a Group Block.**
4. **The agent enters bookings in the slot.** First a simple tentative booking with the lead
   guest only, because at that point it is mostly cold outreach.
5. **Stage by stage the bookings are confirmed.** The hotel decides, and updates the status
   in the PMS after checking.
6. **The agent completes the details later**: accompanying guests, contact details, address,
   flights, transport, requests. The agent generates the booking confirmation, which is sent
   to the agent.
7. **At the cutoff, unsold rooms go back on sale.**

What follows from it:

- **An agent is a `Source` profile in Client Relations.** The hotel creates it. There is no
  `SOURCE` profile type today (the types are `GUEST`, `COMPANY`, `TRAVEL_AGENT`, `STAFF`); it
  is added as a **new type beside Travel Agent** (owner, 2026-11-11), an entity profile that
  can do everything a Travel Agent profile can (negotiated rates, credit account). On a
  reservation **both can be chosen**: the booking form gets a Source field next to the
  existing Travel Agent field, so one booking can carry a Travel Agent and a Source.
- **Portal logins hang off the Source profile.** The hotel administrator adds a person's
  email on the profile and the system produces a simple link for them to set a password.
  Every booking records the Source and the login that made it.
- **The Source profile is where everything is linked**: its commission, its portal logins,
  its slots (blocks: period, rooms, picked up, status, cutoff), its bookings, its Tape Chart
  marker.
- **No new module.** The PMS changes are additions to Client Relations and Group Blocks, plus
  the status, sell-limit and billing fixes the brief asked for.

## 2. What the PMS has today (verified in code, 8.13.6)

| Area | Today | Gap for this brief |
|---|---|---|
| Public API | `/api/website/v1/**`, `wsk_` keys hashed at rest, scopes `ROOMS`/`EXCURSIONS`/`SPA`/`TRANSPORT`, Postgres rate limits, idempotency, signed webhooks (excursion and spa only), docs portal | Built for an anonymous guest on a brand website. No notion of *who* the caller is, no agent rates, no tentative bookings, no cancel or amend for rooms, one room per booking |
| Agent identity | `Profile` with `profileType = TRAVEL_AGENT`, `iataNumber`, `tinNumber`, `arNumber`, `creditLimit`, `isCreditAccount`, `bookingMethod` | No login for an agent. `Profile.commissionRate` is **stored and shown but never used** in any calculation |
| Agent rates | `RatePlan.isNegotiated` + `RatePlanAgentAccess` (plan ↔ agent, optional `commissionRate`) | No "sales open on" date, no early-access tier, no profile type for a booking source, nothing tying an agent to a block |
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
| Jobs | `src/lib/jobs` runner (hold sweep, webhooks, channel sync) | New jobs: option expiry, block release and checkpoints |

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
   a short-lived token bound to one `AgentUser` (a portal login) → one **Source** profile. Every data route needs
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

**A-7. The portal runs on Group Blocks** (owner, 2026-11-11). A slot is a `GroupBlock` with
`sourceProfileId` set. Nothing is built beside the group engine:

- *Request.* The agent's slot request creates a block in a new status **`REQUESTED`**. It
  holds **no inventory**: the availability functions count `TENTATIVE` and `DEFINITE` blocks
  only, so a request changes no number anywhere (owner confirmed, 2026-11-11). It appears in Group Blocks under a
  "Requests" tab with what was asked for.
- *Approve.* Staff open the request, may change dates, room types, quantities, cutoff and
  elasticity, and approve. The availability check that guards any block today runs at that
  moment. The block becomes **`TENTATIVE` first** (owner, 2026-11-11): the rooms are held and
  the agent can enter bookings. The hotel moves it to `DEFINITE` at a later stage with
  today's action, which is when the Posting Master and master folio are created. Phase 4
  must make sure pickups are allowed on a `TENTATIVE` block. The agent sees what was approved next to what they asked for.
- *Decline.* New terminal status **`DECLINED`** with a reason. An agent withdrawing their own
  pending request lands here too, with the reason "withdrawn".
- *Bookings.* Every agent booking is a **pickup in one of that Source's blocks**, through the
  existing pickup service. Master folio, routing, bill-to-master, group eRegistration and
  group transport therefore work unchanged.
- *There is no agent booking without a block.* A booking that goes past the slot's rooms or
  dates is possible only through **that block's elasticity** (A-12; owner, 2026-11-11). With
  elasticity off or used up, the agent requests another slot.
- Staff can create a block for a Source directly, on today's Group Blocks screen with the new
  Source field. An agent's block and a desk-made block are the same thing.

State machine after this plan: `REQUESTED → TENTATIVE | DECLINED` (staff creating a block by
hand may still start it `DEFINITE`), then as today
(`TENTATIVE → DEFINITE | LOST | CANCELLED`, `DEFINITE → CANCELLED`).

**A-8. Overflow is its own pseudo room type, not `PM`.** "Book under PM" in the brief means
"in a pseudo room". The existing `PM` type is the Posting Master and Night Audit posts nothing
for `isPostingMaster` reservations, so reusing it would silently stop charges. Add a pseudo
type **`OVF` "Overflow"** created on demand like `PM`, plus `Reservation.isOverflow`,
`overflowHotelName` and `overflowNote`. An overflow booking is charged normally, is marked on
every list and the Tape Chart, has its own report, and is **always a request the hotel must
accept** (never automatic). It can be moved into a real room type later if a room frees up.
**Owner ruling (2026-11-11): an overflow guest gets no Green Tax and no registration number
from this property**, and is not counted in occupancy; the revenue still counts. Overflow is
the one kind of slot request a person must always accept, because someone has to secure the
partner hotel's rooms (owner confirmed, 2026-11-11).

**A-9. What an agent sees of availability** (owner, 2026-11-11). Two views:

- *Their own slots, exactly*: rooms approved, booked tentative, booked confirmed, still free,
  and the date unsold rooms release. No rounding; it is their quota.
- *The house, capped*: per room type per night, the number free up to a threshold and "N+"
  above it (default 5, set per property), from `perNightTypeAvailability()`: real inventory,
  clamped at 0, stop sale shown as closed (D-7). This is what an agent uses to choose a slot
  to request. Next to it, the **option forecast**: rooms on option (tentative bookings and
  unsold rooms in other approved slots) beside rooms confirmed, so "0 free" can be read as
  "may loosen".

**A-10. Sell limit is a number per night, and it caps the desk too.** New
`AvailabilitySellLimit` (property, room type or whole house, date, `extraRooms`). The desk's
`acknowledgeOverbook` keeps working up to the limit; past the limit it is refused unless the
user holds `AVAILABILITY delete` (the manager's override, see §10). **Channels and the brand
website never sell into the limit** (D-7 stands, word for word). **Agents never sell into it** (owner, 2026-11-11: desk
only); for an agent a full night is an overflow request.

**A-11. Sales windows give special agents first access.** `RatePlan.agentSalesOpenAt` (when
the plan's new season opens to all linked Sources) and `Profile.earlyAccessDays` on the Source
(how many days earlier this one may request slots). Before the window the dates are visible
but cannot be requested. One date on the plan and one number on the Source is all the
property maintains each year.

**A-12. Cutoff rules and elasticity live on the block.** There is no separate allotment
model; these are additions to `GroupBlock`, usable for any group, not only an agent's.

- *Cutoff* (exists): `cutoffDate`, one date on which every unsold room in the block returns
  to general sale.
- *Rolling release* (new, optional): `releaseDays`. Each night's unsold rooms release that
  many days before that night, for long slots where one date does not fit.
- *Quota checkpoints* (new, optional): rows of "by this date, at least this share of the
  rooms must be booked" (`GroupBlockCheckpoint`). A missed checkpoint **releases the unsold
  rooms** (owner, 2026-11-11): the hold shrinks to what is booked, the block carries on with
  those bookings, and both sides are notified. Several checkpoints give the "stage by stage"
  shape.
- *Elasticity* (new; owner confirmed the meaning, 2026-11-11): how far the agent may go past
  the approved slot without a new request. It is switched on per block and has a range:
  `elasticRooms` (up to this many rooms above the hold per night) and `elasticNightsBefore` /
  `elasticNightsAfter` (a booking may start up to this many nights before the block's first
  date or end this many after its last). Always subject to the house having the room free
  that night, and never into the sell limit. An extra room grows the hold by one so the
  arithmetic stays the same; an extra night is an ordinary night outside the block. All
  default to 0, which means the slot's edges are hard.
- Releases run in a job and are also applied on read, so a stopped job never leaves released
  rooms held.
- **At the cutoff the inventory is released and the booking is kept as a record** (owner,
  2026-11-11). A booking still tentative on that date loses its room: it becomes `CANCELLED`
  with the system reason `OPTION_EXPIRED` (shown as "Released"), stays in every list, report
  and the agent's history, and can be reinstated at the desk if a room is still free. Nothing
  is deleted. Staff can extend a single booking's option before the cutoff to keep it.

**A-13. Confirmation is the hotel's manual decision** (owner, 2026-11-11, second round;
replaces the rule engine drafted after the first round). Every agent booking starts
**Tentative**. The agent can press "Request confirmation" with a note and, if they paid, a
payment reference and optionally a proof file; the booking then shows at the desk as
"confirmation requested". Staff check whatever needs checking (money received, contract) and
**change the status to confirmed in the PMS**: on the reservation, or for many at once from
the block ("Confirm selected"). There is no online payment and no automatic matching.

One optional switch on the Source profile, off by default: "bookings confirm automatically",
for a trusted contract agent whose bookings the hotel never checks. The hotel administrator
controls it; an agent cannot.

When a booking is confirmed the agent is notified, and can generate the booking confirmation
(A-17).

**A-14. Option period rules.** A tentative booking's `optionDate` defaults to its block's
cutoff date; where the block has none, `arrival − optionDaysBeforeArrival` (default 30, per
property). Staff can extend it per booking. A booking made after the cutoff, inside the
elasticity, gets `shortOptionHours` (default 48). Reminders at 7, 3 and 1 days. On expiry the
booking becomes `CANCELLED` with the system reason `OPTION_EXPIRED`, kept distinct in reports
from an agent's own cancellation. Expiry is processed by a job and also enforced lazily on
read, so a stopped job never leaves expired options holding rooms.

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

**A-17. The booking confirmation is produced by the PMS, generated by the agent, and sent to
the agent** (owner, 2026-11-11). A PDF from the stationery engine (`stationery-pdf.ts`), with
the property's branding and the Source's name and reference, so the document the guest
carries matches what the desk sees. The agent presses "Generate confirmation"; it downloads
and is emailed to the agent's own address. The hotel never writes to the agent's client.
Only for confirmed bookings; a tentative booking can produce an "Option confirmation" that is
visibly not a confirmation. It shows no rates unless the agent ticks "show price" (agents
often resell at their own price).

**A-18. Settlement mode is recorded per booking.** `Reservation.settlementMode`, defaulted
from the Source profile:

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

**A-20. Commission is on the rate as defined, and on nothing else** (owner, 2026-11-11). The
base is the rate plan's nightly rate for the booking, with service charge and tax removed
(the room-charge line's `amount`, which is stored without `serviceChargeAmount` and
`taxAmount`). Whatever the rate includes is in the base, including meals that are part of the
rate. **Extras and anything the guest spends at the hotel earn no commission.** Rate from, in
order: `RatePlanAgentAccess.commissionRate` for that plan, then `Profile.commissionRate` on
the Source (finally given a job). **Rounded normally (half-up) to two decimals**, once per
folio, not per night. See §8 for the worked example.

**A-21. Every booking carries where it came from, and who.** Three facts, named apart:
- the **Source**, a profile: new `Reservation.sourceProfileId`, with its own field on the
  booking form beside the existing Travel Agent field (`travelAgentId`). Both can be set on
  one reservation (owner, 2026-11-11). A pickup inherits the block's Source.
- the **origin**, the door it came through: `Reservation.origin` (`DESK`, `WEBSITE`,
  `CHANNEL`, `AGENT_PORTAL`, `GROUP_PICKUP`), backfilled from the existing relations.
- the **portal login** that entered it (`agentUserId`), for agent bookings.

Lists, the Tape Chart, reports and filters read these. Negotiated rate plans are offered when
either the Travel Agent or the Source on the booking is linked to the plan.

**A-21a. Search, and create if it is not there** (owner, 2026-11-11: missing in the PMS
today). The profile pickers on the reservation create and edit form (Source, Travel Agent,
Company, and the guest picker where it lacks it) get a last row "Create “typed text”" when
the search finds no match. It opens a short dialog with only the fields that type needs, saves
the profile, and selects it, without leaving the booking. Built once in `SearchableSelect`
(an optional `onCreate`) so every long picker can use it. Needs `PROFILES create`; without
it the row is not shown.

**A-22. Booking markers are rules, not hard-coded colours.** A property defines an ordered
list of `BookingMarker` rules: *when* (source, a specific agent, tentative, overflow, group,
VIP level, oversold) → *show* (icon from a curated set of the app's icons, colour from a
fixed palette of twelve tokens that work in light and dark). First match wins. Defaults are
seeded so it works with zero setup. Status keeps the bar's fill; the marker is an icon chip
and a coloured edge, so status and source never fight for the same channel. Tentative bars
are additionally hatched. **A Source profile can carry its own icon and colour**, set on the
profile; a booking from that Source shows it ahead of the general rules, so each agent is
recognisable on the Tape Chart with no rule to write.

Seeded defaults, to be tuned with the customer later (owner, 2026-11-11: "come up with
something first"):

| What | Icon | Colour | Extra |
|---|---|---|---|
| Booking from a Source | briefcase | the Source's own colour; a new Source is given the next unused of the twelve palette colours | Source name on hover and in the legend |
| Travel Agent booking with no Source | briefcase | slate | |
| Tentative | clock | amber | bar is hatched |
| Confirmation requested | clock with a dot | amber | hatched, with a solid edge |
| Overflow | building | violet | shown in the Overflow row |
| Group pickup with no Source | people | teal | |
| Brand website | globe | blue | |
| Channel | link | indigo | |
| Oversold night | warning | red | on the night, not the bar |
| Desk booking | none | none | plain status colour, as today |

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
- It stays **in-house only** (owner, 2026-11-11), so revenue is never posted for a guest who
  does not arrive.

**A-24. As few changes to the PMS as possible** (owner, 2026-11-11). No Agents module, no
agent contract table, no allotment table, no agent inbox screen. Per agent the hotel does two
things: create the Source profile, add a login. Everything else has a working default. No
second copy of rates, room types, extras or policies anywhere: the API reads what Revenue and
the Hub already hold.

**A-25. Where things live.**
- *Client Relations → the Source profile*: commission %, settlement mode, early-access days,
  the automatic-confirmation switch, marker (icon and colour), **Portal logins** (add an
  email, copy or send the link, suspend, reset), **Slots** (its blocks: period, rooms,
  booked, status, cutoff) and its bookings.
- *Group Blocks*: the Requests tab, the Source field, cutoff rules and elasticity, tentative
  and confirmed counts, "Confirm selected".
- *Hub, property area*: one "Agent portal" card (on or off, default option days, the
  availability cap, cancel reasons), gated with `requirePropertySetup()`. *Enterprise area*:
  the `AGENT` scope on API keys.
- **Not a paid add-on** (owner, 2026-11-11). A custom solution for one customer for now: the
  portal carries that customer's brand with "Powered by Uppsolut" in the footer. The API is
  still written tenant-safe like every other route, so a second customer needs configuration,
  not code.

## 4. Data model (all additive)

| Model / column | Purpose |
|---|---|
| `Profile.profileType` gains `SOURCE` | §1a. Entity profile, eligible wherever `TRAVEL_AGENT` is |
| `Profile.settlementMode String?`, `earlyAccessDays Int?`, `portalAutoConfirm Boolean`, `markerIcon String?`, `markerColor String?` (`commissionRate` exists) | Everything commercial about a Source sits on its profile (A-11, A-13, A-18, A-20, A-22) |
| `AgentUser` (enterprise, Source `upid`, `email` unique per enterprise, `passwordHash`, `name`, `status`, `lastLoginAt`, invite token hash + expiry, failed-login counters) | A portal login (A-3). Deliberately **not** `User`: an agent must never be reachable by `requireSession()` |
| `AgentSession` (token hash, `agentUserId`, `keyId`, expiry, last seen, IP) | Revocable |
| `GroupBlock.sourceProfileId String?`, `origin String @default("DESK")`, `requestedByAgentUserId?`, `requestNote?`, `decisionReason?`, `decidedBy?`, `decidedAt?` | A-7 |
| `GroupBlock.status` gains `REQUESTED`, `DECLINED` | A-7 |
| `GroupBlock.releaseDays Int?`, `elasticRooms Int @default(0)`, `elasticNightsBefore Int @default(0)`, `elasticNightsAfter Int @default(0)` | A-12 |
| `GroupBlockRoom.requestedQuantity Int?` | What the agent asked for beside what was approved |
| `GroupBlockCheckpoint` (block, `date`, `minPercent`, `processedAt?`, `releasedRooms?`) | A-12 quota checkpoints |
| `Reservation.sourceProfileId String?` (beside the existing `travelAgentId`), `origin String @default("DESK")`, `agentUserId String?` | A-21 |
| `Reservation.optionDate DateTime?`, `confirmationRequestedAt?`, `confirmationNote?`, `confirmedAt?`, `confirmedBy?` | A-13, A-14 |
| `Reservation.settlementMode String?` | A-18 |
| `Reservation.isOverflow Boolean`, `overflowHotelName?`, `overflowNote?` | A-8 |
| `Reservation.packageName String?`, `agentReference String?` | Package name and the agent's own file number |
| `Reservation.cancellationReasonCode String?` | Structured reason beside the existing free text |
| `AgentChangeRequest` (reservation, `type` `AMEND`/`CANCEL`, payload, status, decision) | A-15 |
| `AgentCommission` (property, Source, reservation, folio?, rate plan, `baseAmount`, `rate`, `amount`, `mode`, `status`, `payoutId?`, business date) | A-19 |
| `AgentCommissionPayout` (Source, property, total, method, reference, date, by) | Paying or offsetting a batch |
| `AvailabilitySellLimit` (property, `roomTypeId?`, `date`, `extraRooms`) `@@unique` | A-10 |
| `RatePlan.agentSalesOpenAt DateTime?` | A-11 |
| `BookingMarker` (property, `sortOrder`, `label`, match fields, `icon`, `colorToken`, `isActive`) | A-22 general rules (tentative, overflow, website, channel) |
| Property settings: `agentPortalEnabled`, `optionDaysBeforeArrival`, `shortOptionHours`, `guestDetailsDueDays`, `agentAvailabilityCap`, `maxOverflowPerNight` | A-25, a handful of columns, not a new model |
| `RoleCapability` (`roleId`, `capability`) `@@unique` | §10, fine-grained permissions |
| `SystemCode` category `AGENT_CANCEL_REASON` | Reason list, edited in the existing Dropdowns manager |
| `WebsiteApiKey.scopes` gains `AGENT` | A-3 |

Dropped from the first draft, on the owner's "as little change as possible": `AgentContract`,
`AgentAllotment`, `AgentBookingRequest`, `AgentConfirmationRule`, `AgentPortalSettings` and
the `AGENTS` module. Retries are guarded by the Booking API's existing idempotency plumbing.

Money columns follow the repo's existing `Float` + `toCents` convention. Every model with a
`propertyId` is included in the tenant-isolation tests.

## 5. Booking status flow

### 5.1 The slot (a Group Block)

```
 agent requests a slot ─▶ REQUESTED ── hotel approves ─▶ TENTATIVE ─▶ DEFINITE (later) ─▶ …
   (holds nothing)            │         (may change rooms,      │
                              │          dates, cutoff)         ├─ checkpoint missed / cutoff:
                              └─ hotel declines, or                unsold rooms released,
                                 agent withdraws ─▶ DECLINED       block continues with what
                                                                   is booked
                                                                └─▶ CANCELLED (hotel; not
                                                                    while it has live bookings)
```

### 5.2 A booking inside the slot

```
 agent enters booking ─▶ TENTATIVE ───── hotel confirms in the PMS ────▶ RESERVED ("Confirmed")
   (lead guest only;       │   ▲          (after checking; one or        │  agent generates
    room is held)          │   │           many at once)                 │  the confirmation
                           │   └─ hotel extends the option               ├─▶ IN_HOUSE ─▶ CHECKED_OUT
                           │                                             ├─▶ NO_SHOW
                           ├─ agent cancels (reason required) ──┐        └─▶ CANCELLED (hotel only,
                           ├─ option expires / cutoff (job) ────┤            refund as needed; the
                           └─ hotel cancels ────────────────────┤            agent may only REQUEST)
                                                                ▼
                                                           CANCELLED (reason code tells which)
```

Rules that keep it honest:

- A request holds nothing and takes no confirmation number; a declined request leaves no
  reservation behind.
- `TENTATIVE → RESERVED` is one conditional update (`where status = 'TENTATIVE'`), the same
  claim pattern check-out uses, so a confirmation and an expiry racing each other cannot both
  win.
- `RESERVED` never goes back to `TENTATIVE`.
- A cancelled tentative booking frees its room back **into the slot** while the slot is
  live, and to general sale after the cutoff.
- Reinstating a cancelled tentative booking re-runs the availability check and gets a fresh
  option date; it is a desk action only.
- A `TENTATIVE` reservation cannot be checked in, advance-billed, or given an eRegistration
  link. It can have a room assigned (the reservations team may want to pencil it in).
- Night Audit: a tentative booking whose arrival date is reached without confirmation is not
  a no-show. The expiry job will already have cancelled it; Night Audit lists any survivor
  under "Needs attention" rather than posting a no-show fee.
- The hotel may cancel a confirmed agent booking (owner, 2026-11-11). Money already received
  is refunded from the folio with the existing refund action; the agent is notified with the
  reason.
- The existing rule stands: a block cannot be cancelled while it has live pickups.
- Staff can use tentative bookings with no agent and no block involved; the status is a PMS
  feature first.

### 5.3 What each side calls it

| PMS `status` | Extra facts | Desk label | Agent label |
|---|---|---|---|
| (block `REQUESTED`) | | Slot request | Awaiting hotel |
| `TENTATIVE` | `confirmationRequestedAt` null | Tentative, option until D | On option until D |
| `TENTATIVE` | `confirmationRequestedAt` set | Tentative, confirmation requested | Confirmation requested |
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
  `onOption`, `mySlotLeft`, `releaseDate`, nightly net rate for the agent's plan.
- `POST /properties/{id}/quote` → authoritative total from `computeReservationQuote`, the
  commission estimate, the option date this booking would get, and what would happen if
  submitted (`ACCEPTED_INSTANTLY` / `NEEDS_APPROVAL` / `OVERFLOW_ONLY` / `REFUSED` + reason).

**Slots** (Group Blocks belonging to the signed-in Source):
- `POST /properties/{id}/slot-requests` (dates, rooms per room type, note, `isOverflow`).
- `GET /slots?status&from&to`, `GET /slots/{code}` (asked for, approved, booked tentative,
  booked confirmed, free, cutoff and checkpoints, elasticity left).
- `POST /slots/{code}/withdraw` (while still requested).

**Bookings** (always inside a slot):
- `POST /slots/{code}/bookings` (one or more rooms; lead guest name is enough; always
  created Tentative; `expectedTotal` → `409 PRICE_CHANGED`).
- `PUT /slots/{code}/rooming-list` (JSON or CSV, validated as a whole, applied line by line
  with a per-line result): many bookings at once.
- `GET /bookings?status&from&to&q&page`, `GET /bookings/{ref}`.
- `POST /bookings/{ref}/request-confirmation` (note, payment reference, proof upload id).
- `PUT /bookings/{ref}/guests` (accompanying guests, contact, address),
  `PUT /bookings/{ref}/travel` (flights, transfers), `PUT /bookings/{ref}/requests` (package
  name, special requests).
- `POST /bookings/{ref}/cancel` (tentative only, reason required),
  `POST /bookings/{ref}/change-requests`, `GET /bookings/{ref}/change-requests`.
- `POST /bookings/{ref}/confirmation` (generates the PDF and emails it to the agent),
  `GET /bookings/{ref}/confirmation.pdf`.

**Finance:** `GET /statement?from&to` (invoices, payments, commissions, balance),
`GET /commissions`, `GET /invoices/{id}.pdf`.

**Webhooks** (for agents with their own systems; the portal uses them too): `booking.accepted`,
`booking.declined`, `booking.confirmed`, `booking.option_expiring`, `booking.released`,
`booking.cancelled`, `booking.changed`, `change_request.decided`, `slot.approved`, `slot.declined`, `slot.released`,
`statement.ready`.

**New error codes:** `AGENT_NOT_ACTIVE`, `NOT_ON_SALE_YET`, `OPTION_NOT_ALLOWED`,
`CREDIT_LIMIT_EXCEEDED`, `OVERFLOW_NOT_ALLOWED`, `OVERFLOW_FULL`, `SLOT_FULL`, `SLOT_NOT_APPROVED`,
`BOOKING_LOCKED`, `REASON_REQUIRED`, `GUEST_DETAILS_INCOMPLETE`, `ROOMING_LIST_CLOSED`.

**Never exposed:** other agents' data, room numbers before check-in unless the property opts
in, staff names, internal remarks, cost or other agents' rates, the housekeeping state.

## 7. PMS screens that change

| Screen | Change |
|---|---|
| **Client Relations: Source profile** | New profile type. Sections: commission and settlement, **Portal logins** (add, link, suspend, reset), **Slots** (its blocks with period, rooms, booked, status, cutoff), bookings, marker icon and colour. A Travel Agent profile can be converted to a Source |
| Reservations list, Front Desk, search | Tentative status and filter, option date column, source marker, Overflow and Details-missing badges |
| Booking form | **Source field** beside Travel Agent (both can be set); **search and create new** in the profile pickers when no match exists; staff can create a tentative booking with an option date, pick settlement mode, mark overflow, set package name |
| Reservation page | Option panel (confirm, extend, release, verify payment), agent request history, deposit request and receipt, Advance Folio (renamed from Advance Bill), voucher |
| Tape Chart | Markers, hatched tentative bars, legend, filter by source / agent / status, Overflow row beside Unassigned |
| Availability | Sell limit row and editor next to Stop sale; "On option" and "Allotted" lines under each room type; oversold nights flagged |
| Group Blocks | **Requests tab** (approve with changes, decline with reason); Source on the block; cutoff rules, checkpoints and elasticity; tentative and confirmed counts; **Confirm selected** for bookings that asked for confirmation; rooming-list import; **Send documents** in the Master folio section (master folio, every pickup folio, group statement, as one PDF or a zip, by email); deposit request; **Advance Folio for the whole group**; commission summary |
| Debtors | Commissions tab; statement includes commissions; proper create/update permission checks |
| Night Audit | Tentative survivors and blocks past their cutoff with rooms still held under "Needs attention"; commission accrual at checkout |
| Hub, property area | One **Agent portal** card (switch, option defaults, availability cap, reasons) and the marker rules. API keys gain the `AGENT` scope |
| Notifications | Slot request received, confirmation requested, option expiring (both sides), option expired, overflow request, rooming list received, slot rooms released, checkpoint missed |
| Reports | Source production (room nights, revenue, commission, by Source), Options and expiries, Pickup versus slot, Overflow bookings, Commission payable |

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

- Commissionable: the rate plan's nightly rate as defined, extra-occupancy charge included,
  and whatever that rate includes (meals that are part of the rate). Not commissionable:
  Green Tax, service charge, taxes, transfers, extras, anything the guest spends at the hotel,
  cancellation and no-show fees (owner, 2026-11-11).
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
- A slot approved for more rooms than are free → refused with the nights that fail, same as
  a group hold today; staff reduce the numbers and approve again.
- Two Sources request the same dates → requests hold nothing, so the first approved gets the
  rooms and the second is checked against what is left.
- A booking uses elasticity on a night that has just sold out → refused with `SLOT_FULL`.
- A checkpoint is missed while tentative bookings exist → they count as booked; only rooms
  with no booking at all are released.
- The hotel shortens or shrinks an approved slot → never below what is already booked.
- Property business date versus the agent's time zone: every date in the API is a property
  date; option deadlines are a property-local end of day and are returned with an explicit
  timestamp.

**Rates**
- No price for a night → `NO_RATE`, never a booking at 0 (W-6).
- Rate changed between quote and booking → `PRICE_CHANGED`. Rate changed after a tentative
  booking: the price is **locked at booking** (`overrideRate` on the assignment); owner
  confirmed locked, 2026-11-11.
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
- Source over its credit limit → the desk sees the warning when confirming; the decision stays with staff.
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
- A payment arrives after the option expired → the booking is not
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
| Sources and blocks | Approve or decline a slot request; confirm an agent booking; manage portal logins; pay or offset commission | new |
| Reports | Export to file; see revenue reports | `REPORTS view` |

**Suppress rates** reaches furthest: it is not one check but a rule every money-bearing
response must honour. It is enforced on the **server** (figures are removed from the API
response, not hidden with CSS), through one shared serializer used by the reservation, folio,
quote, tape chart, group, report and export routes, and a test asserts that a suppressed role
receives no amount field from any of them. A suppressed role cannot hold a capability that
needs figures (posting charges, voiding, refunds); the screen says so. **The balance due
stays visible** to a suppressed role (owner, 2026-11-11), so the desk can still collect and
can stop a guest leaving unpaid; rates, charge lines, totals and revenue are what disappear.

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

New for this plan (no new module; owner, 2026-11-11):

- Source profiles, portal logins and the commission settings are covered by `PROFILES`
  (Client Relations), with the capability "manage portal logins".
- Slot requests and confirming bookings are covered by `GROUP_BLOCKS` and `RESERVATIONS`,
  with the capabilities "approve or decline a slot request" and "confirm, extend or release
  an option".
- Commission payouts are covered by `DEBTORS`.
- `AVAILABILITY delete` = exceed the sell limit (manager override). `AVAILABILITY update`
  keeps meaning stop sale, and now also editing sell limits.
- The Hub's Agent portal card goes through `requirePropertySetup()`.

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
| **3. Source profiles and markers** | **9.3.0** | `SOURCE` profile type with its commission, settlement and marker fields; Source field on the reservation beside Travel Agent; search-and-create in the profile pickers (A-21a); convert Travel Agent to Source; `Reservation.origin` + backfill; `BookingMarker` rules and Hub editor; Tape Chart markers, hatching, legend and filters; same markers on Reservations and Front Desk; seeded defaults | A booking shows its Source everywhere, and each Source is recognisable on the Tape Chart in light and dark, on a phone |
| **4. Blocks for Sources** | **9.4.0** | Source on the block, `REQUESTED` / `DECLINED` and the Requests tab, rolling release, quota checkpoints, elasticity (extra rooms, extra nights before and after), release job that keeps released bookings as records, tentative pickups with "Confirm selected", sales windows, Slots section on the Source profile, slot lines on Availability. Fully usable from the desk before any portal exists | Staff can give a Source a slot, see it fill, and watch unsold rooms release themselves |
| **5. Agent API, read side** | **9.5.0** | `AGENT` scope, portal logins on the Source profile (add, link, suspend, reset), auth routes, sessions, `/me`, catalogue, availability (own slots exact, house capped, option forecast), quote. Docs portal area `/docs/agent-api`, OpenAPI file. Portal mock switches to the real API for these calls | An agent signs in and sees live availability and their own slots; isolation tests pass |
| **6. Agent API, slots and bookings** | **9.6.0** | Slot requests, bookings in a slot (tentative, lead guest), rooming list, request confirmation, guest details, travel and transfers, package and requests, cancel with reason, change requests, booking confirmation PDF emailed to the agent, overflow requests, webhooks, notifications | The whole of §1a works end to end: request, approve, book, confirm, detail, confirmation |
| **7. Settlement** | **9.7.0** | Settlement modes, `AgentCommission` ledger and payouts, Debtors Commissions tab, statement with commissions, agent statement endpoint, commission reports, reversal handling | The three modes in §8 produce the figures in §8; a reversed check-out reverses the commission |
| **8. Group billing and advance** | **9.8.0** | Send documents from the Master folio (bulk folios, group statement); deposit request and advance deposit without revenue, for bookings and groups; **Advance Folio for groups**, rename from Advance Bill, own document, same-day reversal; group commission summary; rooming-list import at the desk | A group's documents go out in one action; a deposit is taken with no revenue posted; a whole group's stay can be posted in one step |
| **9. Portal go-live** | **9.9.0** | Hardening from the pilot, load and abuse tests, monitoring tiles in the platform console, Operations guide "Working with agents", go-live checklist. Portal itself is built against the real API in its own local repo | One real agent completes a tentative → confirmed → checked-out → commission-settled cycle |

Phases 0a to 3 are PMS improvements the customer feels at once and that do not depend on the
portal. Phase 1 must precede everything agent-facing. Phases 2 and 3 can swap or run in
parallel sessions (different files). Phase 7 can start once Phase 1 is merged.

**Tests per phase** (extend `tests/business-rules/`): status transitions including the
confirm-versus-expire race; availability arithmetic with tentative, slot holds, sell limit and
stop sale combined; last-room race; agent isolation (agent A never reads agent B, agent token
never opens a dashboard route); idempotent replay; price change; option expiry on read with
the job stopped; slot release, quota checkpoints and elasticity; commission per mode against §8's figures,
split-stay, void and reversal; manual and bulk confirmation, and a confirmation racing the cutoff; a slot request holds nothing until approved; Advance Folio for a group with a mixed set of pickups; a suppressed role receives no amount from any route; capability merge across roles; rooming-list partial acceptance; voucher versions; route
permission coverage.

## 12. The mockup website (local only)

Location: `agent-portal/` at the repository root, **ignored through `.git/info/exclude`**, so
it is not in git and no tracked file changed to hide it. Plain HTML, CSS and JavaScript, no
build step: open `agent-portal/index.html`, or serve the folder.

It is a mockup: data is invented in `agent-portal/assets/mock-api.js`, whose functions are
named and shaped after §6 so replacing them with real `fetch` calls is the migration path.
Changes made in the mockup (a new booking, a confirmation, a cancellation) persist in the
browser only.

Screens (reworked to §1a on 2026-11-11): sign in, dashboard (slots held, room nights free,
tentative bookings, details due, the five steps), rates and availability (the house capped at
"5+", option forecast, the agent's own slots exact), **request a slot** (dates, rooms per
type, what the hotel will see, overflow when full), **my slots**, **slot detail** (tentative
or definite, cutoff, checkpoint, elasticity, fill by room type, bookings, add one booking or
several from a list of names), bookings list, booking detail (tentative → confirmation
requested → confirmed, guests with contact and address, flights and transfers, package and
requests, cancel with reason, change request), booking confirmation (generated by the agent,
emailed to the agent), statement and commissions. "Play the hotel" buttons stand in for the
PMS so the whole flow can be shown: approve a slot, make it definite, confirm a booking.

Run it with `node agent-portal/serve.js` and open http://localhost:4173.

The fictional property is Coral Bay Resort and the fictional agencies use example.com, in
line with the docs rule that no real customer appears in anything presentable.

## 13. Owner questions

### Answered (2026-11-11, two rounds)

| # | Question | Owner's answer | Where it landed |
|---|---|---|---|
| Q-1 | What is disliked about permissions? | Bland, no advanced control. Keep per-module CRUD, add drill-down options (overbooking, stop sale, registration card and folio generation, suppress rates, more) | §10, Phase 0b |
| Q-2 | Accept at once, or wait for staff? | Superseded by the second round: bookings start Tentative and **the hotel confirms manually in the PMS** | A-13 |
| Q-3 | May agents sell into the sell limit? | Only the desk | A-10 |
| Q-4 | Overflow guests: Green Tax and registration number here? | No | A-8 |
| Q-5 | Commission rounding | Normal rounding to two decimals | A-20, §8 |
| Q-6 | Missed quota: release everything or shrink? | Release unsold | A-12 |
| Q-7 | Deposit without revenue, or revenue posted in advance? | Both exist and differ: an advance payment posts no revenue; an Advance Folio posts every night with allocations on one date | A-23 |
| Q-8 | Commission on what? | On the rate as defined. Nothing on extras or the guest's other spending | A-20, §8 |
| Q-9 | Tentative price locked or re-priced? | Locked | §9 |
| Q-10 | How much availability do agents see? | Their own quota exactly; the rest capped | A-9 |
| Q-11 | Who is the portal for? | One specific customer for now | A-25 |
| Q-13 | Paid add-on? | No. A custom solution, "Powered by Uppsolut" | A-25 |
| Q-14 | Can the hotel cancel a confirmed agent booking? | Yes, with refunds | §5.2 |
| Q-15 | Does overflow need a person? | Yes | A-8 |
| Q-16 | Who is "the agent website admin"? | The hotel administrator | A-13, A-25 |
| Q-17 | How does a payment count as received? | The hotel checks and updates the status in the PMS. Manual | A-13 |
| Q-18 | Advance Folio before check-in? | In-house only | A-23 |
| Q-19 | Suppress rates and the balance | The balance stays visible | §10 |
| Q-20 | Who gets the confirmation? | The agent generates it and it is sent to the agent | A-17 |
| Q-21 | A single booking outside a slot? | Only through that block's elasticity, if it is enabled | A-7, A-12 |
| Q-22 | Tentative bookings at the cutoff? | Inventory is released; the booking is kept as a record | A-12 |
| Q-23 | What is elasticity? | Extra rooms, and extra nights before and after the block dates, up to a range | A-12 |
| Q-24 | Source beside or instead of Travel Agent? | A new type. A reservation can carry both. Also: the pickers need search **and create new** | §1a, A-21, A-21a |
| Q-25 | Does a pending request hold rooms? | No | A-7 |
| Q-26 | Definite at once, or Tentative first? | Tentative first | A-7 |
| Q-12 | Marker defaults | "Come up with something first, we will fine tune later" | A-22 |
| — | How are agents modelled? | A **Source** profile type in Client Relations, with linked portal logins; no separate module; as few PMS changes as possible | §1a, A-24, A-25 |
| — | How does the portal connect to groups? | Through Group Blocks: request a slot, hotel approves it as a block with cutoff rules and elasticity, bookings go inside it | §1a, A-7, A-12 |

### Still open

Nothing blocks Phase 0a. To settle along the way:

| # | Question | Plan assumes |
|---|---|---|
| Q-27 | Marker defaults (A-22) are a first proposal; tune icons and colours with the customer once Phase 3 is on a test site | The table in A-22 |
| Q-28 | Who moves a slot from Tentative to Definite, and on what trigger (a signed contract, a deposit, a share of the rooms confirmed)? | Staff, by hand, with today's action |

## 14. Status

| Phase | Status |
|---|---|
| Mockup (`agent-portal/`, local) | Built 2026-11-11 |
| 0a. Permission enforcement | Built, 9.0.1 (2026-11-12). Route coverage test in `tests/business-rules/route-permission-coverage.test.ts` |
| 0b. Capabilities, Suppress rates, roles screen | Built, 9.0.2 (2026-11-12). `src/lib/capabilities.ts`, `src/lib/figures.ts`, `role-access-editor.tsx` |
| 1. Booking status flow | Built, 9.1.0 (2026-11-13). `src/lib/reservations/options.ts`, `option-expiry` job, advisory lock in `createReservation`. Not yet: tentative shown separately in the dashboard forecast and reports, confirmation letter wording ("Option") |
| 2. Sell limit, overflow, forecast | Built, 9.2.0 (2026-11-13). `src/lib/availability-sell-limit.ts`, `src/lib/reservations/overflow.ts` (OVF pseudo type), grid lines On option / Allotted / Sell limit / Overflow, reports res-overflow and res-options |
| 3. Source profiles and markers | Built, 9.3.0 (2026-11-13). `SOURCE` profile type + fields, `Reservation.sourceProfileId`, `src/lib/booking-markers.ts` (rules, palette, resolution), Hub editor, Tape Chart markers/hatching/legend/filter/Overflow row, `onCreate` on `SearchableSelect` + `QuickProfileDialog`, convert TA to Source. Front Desk shows no marker yet |
| 4. Blocks for Sources | Built, 9.4.0 (2026-11-13). `src/lib/groups/slot-requests.ts`, `pickup.ts` (shared desk/agent pickup: tentative, elasticity, per-night hold, lock), `release.ts` (checkpoints, `group-block-release` job), rolling release in `outstandingBlockHolds`, Requests tab, Source slot panel, `RatePlan.agentSalesOpenAt` |
| 5. Agent API, read side | Built, 9.5.0 (2026-11-13). `AgentUser` / `AgentSession`, `src/lib/agent-api/{auth,http,catalogue}.ts`, `/api/agent/v1/{auth/*,me,properties,properties/{id},availability,quote}`, `AGENT` key scope (server only), portal logins + Source details on the profile, Hub Agent portal card, `/docs/api/agents`. Negotiated lock-in (DECISIONS 2026-11-13). Not yet: OpenAPI file for the agent API, the local portal mock switched to the real API |
| 6. Agent API, slots and bookings | Built, 9.6.0 (2026-11-13). `src/lib/agent-api/{bookings,events,idempotency,confirmation-pdf}.ts`, `/api/agent/v1/{slot-requests,slots/*,bookings/*}`, `AgentChangeRequest`, `AgentIdempotency`, `Reservation.agentRef`; desk: change-request panel, agent notifications, webhooks on confirm/release. Not yet: transfers through the Transportation module (flights are stored on the reservation's transport card), payment-proof upload, voucher versions stored (each generation is a new version number, not a stored file), reminders at 7/3/1 days |
| 7. Settlement | Built, 9.7.0 (2026-11-13). `Reservation.settlementMode`, `AgentCommission` / `AgentCommissionPayout`, `src/lib/commission-ledger.ts` (checkout + reversal hooks), Debtors › Commissions, `/api/agent/v1/{statement,commissions}`, reports fin-commission and fin-source-production. Offset is recorded as a payout with method OFFSET; it does not yet post a payment on the agent's invoices |
| 8. Group billing | Built, 9.8.0 (2026-11-13). Advance Bill renamed Advance Folio; group pickups billed to master post to the master folio; same-day reversal (`/api/reservations/{id}/advance-bill/reverse`, `Reservation.advanceFolio*`); `/api/groups/{id}/{advance-folio,documents,rooming-list}`, `src/lib/groups/group-statement-pdf.ts`, Group billing card; deposit on tentative. Not yet: a group invoice to the city ledger in one step (the master folio's own check-out still does that) |
| 9 | Not started |
