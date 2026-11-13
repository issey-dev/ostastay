# Decisions and business rules

> Business rules and design decisions the app owner has given, with the date each was given.
> **Check here before assuming a business rule.** When the owner gives you a rule that is not
> obvious from the code, add it with the date so the next session does not rediscover or
> reverse it.
>
> **Rules only** (rewritten 2026/11/12). Each section states what holds today. A rule that is
> replaced is rewritten in place, not left beside its successor. How something was built, tested
> or verified is not kept here: finished plans are in [DEV_LOG.md](DEV_LOG.md), open work in
> [TODO.md](TODO.md), and the full earlier text of this file is in git history at `a95c934`.
> Sections are in the order the rules were given, oldest first.

## Contents

- Room Types (2026-07-18)
- Rooms (2026-07-18)
- Sequence Manager (2026-07-18)
- Tax (2026-07-18)
- Green Tax (2026-07-18)
- Charge code hierarchy, generates and the Cashiering panel (2026-07-27)
- Folio printing (2026-07-18)
- Outlets (2026-07-18)
- Theming and design system
- Engineering conventions for this repository
- Confirmation letter (2026-07-19)
- Invoices, receipts and currency exchange (2026-07-19)
- Debtors (Accounts Receivable) (2026-07-19)
- Roles: a new module reaches existing roles by itself (2026-07-19)
- Occupancy pricing, derived rate plans and meal plans (2026-07-19)
- Allocations (2026-07-19)
- Base rate plan (2026-07-19)
- Payment methods and the room-charge posting code (2026-07-19)
- Profiles (2026-07-20)
- Negotiated rate plans (2026-07-20)
- Travel agent commission (2026-07-20)
- Price calendar (2026-07-20)
- Rate plan: Complimentary and House Use (2026-07-20)
- Allocation calculation mode (2026-07-20)
- Reservation booking: Look to Book (2026-07-21)
- Booking form pages and the quote (2026-07-21)
- Reservation dates and occupancy (2026-07-21)
- Split stays, room moves, accompanying guests, guest picker (2026-07-21)
- Osta platform console (2026-07-21)
- Front Desk, housekeeping and maintenance rulings (2026-07-21)
- Business date and folios (2026-07-22)
- Deposit, cancellation and no-show fees (2026-07-22)
- End of Day (Night Audit) (2026-07-22)
- Reports engine (2026-07-22)
- Excursions (2026-07-22)
- Billing rules (2026-07-24)
- Check-out settlement (2026-07-24)
- Reservation states and fee rules (2026-07-24)
- Check-in wizard and registration card (2026-07-24)
- Fast Post (2026-07-25)
- Availability and stop sale (2026-07-26)
- Stationery (2026-07-27)
- Channel manager: inventory and overbooking authority, rule D-7 (2026-07-27)
- End of Day sign-out follows the location (2026-07-28)
- Transaction-code numbering (2026-07-30)
- Spa and Excursions post through one outlet each (2026-07-30)
- Licensing (2026-07-31)
- Add-ons are sold to the enterprise (2026-08-02)
- PostgreSQL (2026-08-02)
- Foreign keys are indexed (2026-08-03)
- Closed reservations (2026-08-03)
- Reservation delete is internal only (2026-08-03)
- Folio: before arrival, documents and settlement (2026-08-03)
- Uppsolut brand (2026-08-08)
- Email: two senders (2026-08-08, 2026-08-10)
- Operations dashboard (2026-09-06)
- Brand website and Booking API (2026-09-06)
- Revenue: Rate Seasons (2026-09-07)
- Dates, dropdowns and scrollbars (2026-09-23)
- Green Tax report and registration numbers (2026-09-23)
- Tax-inclusive rounding (2026-09-23)
- Setup lives in the Hub, split by Enterprise and Property (2026-09-23)
- Night Audit settings and the business date (2026-09-23)
- Charge codes belong to the property; held nights; audit window (2026-09-24)
- Nationalities and job functions (2026-09-25)
- Documentation portal (2026-09-24)
- Property logo (2026-09-24)
- Phones: the defaults taken (2026-09-25, additions 2026-10-11)
- Split stays price per segment (2026-10-11)
- Profiles: delete only when unused, otherwise deactivate (2026-10-11)
- Group block Posting Master (2026-10-11)
- Group block profiles and Bill to (2026-11-13)
- Front Desk and list views (2026-10-11)
- Green Tax per guest; every guest gets a registration number (2026-09-25)
- Reservations list: business on the books (2026-09-25)
- Desktop standards (2026-09-25)
- Interface text: sentence case (2026-09-25)
- GST report (2026-09-25)
- Folio check numbers (2026-09-26)
- Transportation (2026-10-04)
- Revenue calendar and stop-sale override (2026-10-10)
- Cashiering (2026-10-12)
- Each enterprise can connect its own Beds24 account (2026-10-14)
- Front Desk and Tape Chart polish (2026-11-07)
- Keyboard shortcuts (2026-11-07)
- Osta console: what Osta may see (2026-11-07, 2026-11-08)
- Phones: nothing scrolls sideways (2026-11-08, 2026-11-09)

---

## Room Types (2026-07-18)

- **Pseudo room type** (`RoomType.isPseudo`): a non-physical room. Its rooms have no building,
  no floor and no features; the Rooms screen hides those fields. Pseudo types are exempt from
  availability, occupancy and licence caps.
- **Housekeeping toggle** (`RoomType.housekeepingEnabled`): when off, rooms of the type are not
  on the housekeeping board and cannot get a housekeeping task or a maintenance ticket. It
  applies to new activity only; changing a room's status by hand still works.
- **Inactive room type** (`RoomType.isActive`): blocks any new assignment to the type (create,
  edit when the room or type is changing, room move, reassign, group pickup, new room) and sets
  every one of its rooms to Out of Service. Nothing is deleted. Re-activating brings back only
  the rooms the deactivation itself took out (`Room.statusBeforeTypeDeactivation`), as **Dirty**,
  never Clean; a room that was Out of Order returns to Out of Order.
- **Room features** are one multi-select system, not separate bed/view/amenity fields:
  `RoomTypeFeature` on the type, `RoomFeature` on the room, in three groups (`BED_TYPE`,
  `ROOM_VIEW`, `ROOM_AMENITY`), picked with the two-panel `RoomFeaturePicker`.
- There is no base price on the room type: see "Base Rate Plan" (2026-07-19).

## Rooms (2026-07-18)

- The screen is called "Rooms", not "Physical Rooms".
- Building is chosen first and drives the Floor list.
- A room inherits its type's features (shown read-only) and can add its own on top.

## Sequence Manager (2026-07-18)

- Sequences are **plain sequential numbers only**, no prefix or format: Registration No,
  Proforma Folio, Tax Invoice, Receipt No. One `PropertySequence` row per property and type;
  the value must be a non-negative integer.

## Tax (2026-07-18)

- **Charge codes and tax are separate things.** The two tax options are "Maldives Tax" (the
  default engine) and "Custom Tax" (a profile).
- **Maldives Tax order:** service charge is a percentage of the base; GST is calculated on
  **base + service charge**, never on the base alone. Example: base 100, service charge 10% =
  10, GST 17% of 110 = 18.70.
- **Custom Tax profiles hold several named lines.** Each line is calculated either on the
  subtotal or compounding on the running total (subtotal plus every prior line).
- A charge code uses the default engine or one Custom Tax profile (`useDefaultTax`,
  `taxProfileId`).
- **`src/lib/tax-calc.ts` is the single tax authority** (`resolveChargeTax`). No route
  calculates tax on its own.
- **Prices include taxes** is a per-property setting (`Property.pricesIncludeTaxes`). A
  per-transaction override is deferred by the owner: do not build it without a new decision.

## Green Tax (2026-07-18)

- 12 per adult per night and 6 per child per night by default (set in Finance › Tax). It is a
  flat government levy: not service-charged, not GST'd, and unaffected by "prices include
  taxes".
- **Infants are a third occupancy bucket** (`Reservation.infants`): fully exempt and not counted
  toward room occupancy. The exemption is which bucket a guest is counted in, not an age check.
- Posted by Night Audit, once per in-house reservation per night. Required only when Green Tax
  is switched on for the property.
- Since 2026-09-25 Green Tax is per guest: see that entry.

## Charge code hierarchy, generates and the Cashiering panel (2026-07-27)

- **Three levels:** `ChargeGroup` → `ChargeSubgroup` → `ChargeCode`. The group carries
  `reportBucket` (`ROOM | FOOD_BEVERAGE | TRANSPORT | OTHER | TAX | NON_REVENUE | SYSTEM`), the
  one classification every report rolls up into. System groups can be renamed and added to, but
  their code and bucket cannot change.
- **Posting type on the code:** `CHARGE | TAX | CREDIT | NON_REVENUE`. A `TAX` code is a levy:
  posted at face value, never taxed itself, excluded from the GST base on every report.
- **Nothing resolves a charge code by name.** Billing resolves by role (`ACCOMMODATION`,
  `GREEN_TAX`, `COMMISSION`) through Cashiering › Posting Defaults.
- **RULE #1 (owner): a posting always posts its generates.** No route builds a `FolioLineItem`
  by hand; everything goes through `postCharge`.
- **Posting a charge posts its taxes** as their own folio lines; the parent line keeps its net.
  Totals and tax reports are unchanged by this: the money moved, it was not added.
- **Tax codes are single** (2026-07-30): one Service Charge code (7000), one GST (8000), one
  Green Tax (8500). The origin of every tax line is its parent line
  (`generatedFromLineItemId`), and reports attribute it to the parent's bucket.
- **Only a CHARGE is a taxable event. VAT/GST never generates on a payment, under any
  circumstances** (owner): not on a payment, refund, paid-out, deposit, commission or system
  adjustment. Enforced in the generates API, in `postCharge` and in the editor;
  `canGenerateTax()` is the single predicate.
- **Cancellation and no-show fees carry GST but no service charge** (no service was rendered);
  changeable per property. The fee amount is gross or net per "prices include taxes".
- **Tax rates stay where they are configured.** Generates only decide where an amount lands;
  Finance › Tax is the one place rates and the Green Tax switch are edited.
- **Green Tax is a rule about accommodation:** any code in the `ROOM` bucket levies it. A
  generate row stored on a code always wins, so deleting one sticks.
- A new property is seeded with the charge groups and the system codes only (see "Charge codes
  belong to the property", 2026-09-24). Deposit, cancellation and no-show fee rules are created
  linked to their codes but **inactive at zero**: a fee that charges real money is the owner's
  decision.
- **Charge-code pickers are filtered and grouped** through `src/lib/charge-code-options.ts`.
  Tax and system codes are never hand-picked.
- **An outlet's codes are picked at group, subgroup or code level.**
- **Folio presentation styles:** Detailed, Detailed with taxes merged (the usual guest folio),
  Summary by charge code, by date, by check. Every style totals the same. The property sets a
  default; front office can override for one document (`src/lib/folio-presentation.ts`).
- **Where it lives:** Cashiering holds charge groups, codes, generates and posting defaults.
  Tax and payment methods stay in Finance.

## Folio printing (2026-07-18)

- One print route: `/e/[slug]/dashboard/folios/[id]/print`.

## Outlets (2026-07-18)

- An outlet is a revenue point of sale in one property (spa, restaurant, bar, retail,
  transport, recreation, other).
- **An outlet never owns charge codes.** It exposes a pool of the property's existing codes
  (`OutletChargeCode`); the same code can be offered by several outlets.
- **Walk-in billing uses `Folio` itself:** `reservationId` is nullable and the folio carries
  `walkInGuestName` / `walkInGuestContact` and its own `propertyId`.
- **Outlet tax override is optional** (`taxOverrideMode` NONE, DEFAULT_ENGINE, CUSTOM). When
  set it overrides every code's own tax setting for charges posted through that outlet.
- Outlet setup is configuration (`CONTROLS`); posting through an outlet is `POS`.
- **Never lose history:** an outlet with any posting cannot be deleted, only deactivated.
- Outlet appointments were removed on 2026-07-25 (see "Fast Post").

## Theming and design system

- The design system is in [`DESIGN_PLAN.md`](DESIGN_PLAN.md), the single source of truth.
- **The accent is per property:** `Property.bannerColor`. `--primary` stays a fixed neutral for
  every property.

## Engineering conventions for this repository

- Tests that need the INTERNAL Osta enterprise must upsert it with the slug **`"test-osta"`**;
  `getOstaEnterpriseId()` caches the first INTERNAL enterprise for the whole Vitest process.
- Windows: stop the dev server before `npx prisma generate` and restart it after.
- The UI kit is Base UI, **not Radix**: `Checkbox` and `Switch` render as
  `<span role="checkbox">`.
- **`Folio.reservationId` is nullable.** Read `folio.propertyId`, never
  `folio.reservation.propertyId`, and null-guard reservation fields. Every
  `prisma.folio.create` needs an explicit `propertyId`.
- A compile error in one browser tab's console can be stale. Check a fresh tab and
  `tsc --noEmit` before believing it.

## Confirmation letter (2026-07-19)

- Sent once a stay is confirmed (entry to the Maldives requires a hotel confirmation). It can be
  printed or emailed.
- **Content:** guest names including accompanying guests, stay period, nights, room category,
  reservation remarks, generic hotel information and policy text, on one page.
- `Reservation.remarks` is free text on the reservation, separate from traces (which are an
  operational task log).
- Email goes through `src/lib/mailer.ts`.

## Invoices, receipts and currency exchange (2026-07-19)

- **Tax Invoice and Proforma Invoice are the same data.** They differ in the title, a "This is
  not a tax invoice" line on the proforma, and which number field is stamped.
- **A document number is allocated exactly once**, when the field is still empty
  (`allocateSequenceNumber`, `src/lib/document-sequence.ts`). Reprinting reuses the number.
  Formats: `INV-00001`, `PRO-00001`, `RCT-00001`. Payment receipts and exchange receipts share
  the receipt sequence.
- Invoice lines show Date, Description, Reference, Amount (no quantity or rate columns). Tax is
  in the totals block.
- **No QR code.** Payment information is a text block; the app never moves money.
- **A currency exchange is a recorded transaction** (`CurrencyExchange`), posted in Cashiering
  against the user's own open shift. Never trust a shift id sent by the client.
- A payment receipt is one per `Payment` row.

## Debtors (Accounts Receivable) (2026-07-19)

- **Credit accounts are `Profile` rows** (company or travel agent) with `isCreditAccount`;
  there is no separate account model.
- **Debtors only works once the guest has checked out** (owner). No in-house reservation ever
  appears in Debtors.
- **A debtor invoice is the reservation's own folio.** `isDebtorAccount` flips to true only at
  check-out, only for a folio settled to City Ledger with a valid credit account attached. What
  makes a folio City Ledger is a City Ledger payment (see "Folio: before arrival, documents and
  settlement", 2026-08-03).
- **Night Audit ignores settlement:** it always posts to the reservation's own folio.
- **Check-out is the trigger.** A `DIRECT` folio must balance to zero or check-out is blocked. A
  `CITY_LEDGER` folio is exempt, but only when its travel agent or company is a valid credit
  account; if not, check-out is blocked (see "Check-out settlement", 2026-07-24).
- **There is no "Bill to Account".** To split billing: add a second folio on the reservation,
  move the charge to it, and settle that folio with a City Ledger payment. It becomes its own
  invoice at check-out.
- **Credit limit warns, never blocks.**
- **Aging is per invoice**, by the age of its check-out date: Current, 1-30, 31-60, 61-90, 90+.
  "Open" means a balance above zero, not `Folio.isClosed` (check-out closes every folio).
- **A payment can be recorded on a closed folio only when it is a debtor invoice.**
- The statement shows one line per invoice with the guest name and totals, plus an aging summary
  of open invoices. The statement and the receipt are separate documents.
- `DEBTORS` is its own module, granted to Cashier beyond Admin and Manager; Front Desk and
  Reservations were deliberately not given it.

## Roles: a new module reaches existing roles by itself (2026-07-19)

- `requireSession()` back-fills any module missing from a role the first time it is used.
  System and support roles get their defined value; custom roles get no access.
- **System roles cannot be edited by a customer.** They are shared across every enterprise.

## Occupancy pricing, derived rate plans and meal plans (2026-07-19)

- **`RoomType.baseOccupancy`** (default 2): adults beyond it pay the extra-adult price per
  night; every child pays the extra-child price. Both extra prices are per day on the price
  calendar; unset means no surcharge.
- A booking over `maxOccupancy` gets a warning, not a block.
- **Derived rate plans are resolved live, never stored.** A derived plan has a parent and a
  percent or flat adjustment (negative is a discount) and no prices of its own. Every lookup
  takes the parent's price for the date and applies the adjustment, so it can never drift.
  **Chaining is not allowed** (one hop only). Prices cannot be pushed to a derived plan.
- **Meal plans are separate from rate plans.** `MealPlan` is a property list (code, name,
  active). There is no per-room-type meal surcharge table. Per-person meal pricing goes through
  Allocations.

## Allocations (2026-07-19)

The working rules are in the Allocations section of [DEV_LOG.md](DEV_LOG.md). The owner's
rulings:

- Prices are **adult and child only; infants are never charged.**
- Price is controlled **by date only**; ranges must not overlap. Room type and meal plan never
  change an allocation's price.
- `mode` is **Include in Rate** or **Add to Rate**, per allocation. Include in Rate carves the
  amount out of the room line (never below zero); the folio total does not change.
- **Sell Separately is an independent switch**, not a mode. It additionally offers the
  allocation as a manual add-on on the reservation. Every allocation can be linked to rate plans
  and meal plans.
- The departure-night rhythm posts on the stay's **last night**.
- Attachments are fixed on the reservation at booking and edit (`ReservationAllocation`); Night
  Audit reads only those, so a later change to a plan never re-prices a stay.
- Derived rate plans and allocations combine: a booking on "BAR-BB" gets the adjusted room price
  and the BB meal plan's breakfast allocation.

## Base rate plan (2026-07-19)

- **There is no base price on a room type.** Every property has exactly one locked rate plan,
  code `BASE`, created at onboarding. It cannot be deleted and its identity fields cannot be
  edited; its **prices and its package allocations can**.
- **Night Audit price order:** (1) the reservation's override rate; (2) the assigned plan's
  price for tonight, or its parent's if derived; (3) the Base plan's price for the same room
  type and date; (4) zero. A derived plan's adjustment applies on top of whichever price is
  found.
- The Base plan covers only the dates it has been priced for. An unpriced future date posts
  zero, so price it far ahead.

## Payment methods and the room-charge posting code (2026-07-19)

- **Payment is not a charge-code category.** Payment types are Payment Methods: Cash, Card,
  Transfer, Cheque, Voucher, City Ledger.
- **A rate plan can name its accommodation charge code** (`RatePlan.chargeCodeId`), editable
  even on the locked Base plan. Night Audit resolves the room charge code as: the rate plan's
  own code, then the property's default accommodation code.
- **The City Ledger folio is the debtor invoice itself** (one folio, not two). Since 2026-08-03
  the desk settles it with a City Ledger payment, which counts on the guest's bill and is
  ignored on the account's invoice.

## Profiles (2026-07-20)

Structure is in the Profiles redesign section of [DEV_LOG.md](DEV_LOG.md). Rules:

- **VIP Level** replaces loyalty tier and comes from a dropdown list.
- Communications, addresses and identification documents are multi-row. **At most one primary
  per profile per kind**, enforced on the server.
- Email and mobile values are validated by type.
- **Attachments are links, not uploaded files.**
- **STAFF is a profile type with no relation to a login.**
- Company and Travel Agent profiles have one Name field and no personal information or
  identification.
- "Visits to this property" and "visits to the chain" are counted live, never stored.
- `originPropertyId` is set once at creation and never changes; profiles stay enterprise-wide.
- Stay History: `RESERVED` and `IN_HOUSE` are Future, `CHECKED_OUT` is History, with revenue
  per stay from non-void folio lines.

## Negotiated rate plans (2026-07-20)

- A negotiated plan (`RatePlan.isNegotiated`) is linked to specific Company or Travel Agent
  profiles through `RatePlanAgentAccess`. **A negotiated plan with no linked profile cannot be
  selected by anyone.**
- The links are managed **from the profile** only (its Negotiated Rates section; owner confirmed
  2026-11-13 that no picker is needed on the rate plan).
- On a reservation, a negotiated plan is offered only when the booking's Travel Agent / Company or
  Source is one of the linked profiles.
- **Lock-in (owner, 2026-11-13):** a profile linked to any negotiated plan is restricted to its
  negotiated plans. A booking that carries such a profile (as Travel Agent / Company or as Source)
  may only use the negotiated plans linked to it; any other plan, published ones included, is
  refused on the server and hidden in the booking form. When both parties are linked, their plans
  together are allowed. A profile with no links books as before. Existing bookings keep the plans
  they already carry when edited. This applies to group pickups of a Source's block too.
- **Agent portal (owner, 2026-11-13):** an agent sees and books only their Source's negotiated
  plans. The calendar, prices, quotes and bookings are based on those plans alone; no other
  published rate is shown or offered.

## Travel agent commission (2026-07-20)

- An optional commission % per rate plan per agent (`RatePlanAgentAccess.commissionRate`), set
  beside the negotiated-rate link on the profile.
- **Calculated at check-out, not at Night Audit**, because that is when a City Ledger folio
  becomes the agent's invoice.
- **Base:** posted room revenue (nightly room charge and extra occupancy), attributed to the
  rate plan that earned it through `FolioLineItem.roomAssignmentId`, so a split stay across two
  plans is commissioned correctly (`calculateFolioCommission`, `src/lib/commission.ts`).
- **Posted as a negative line on the same debtor folio**, against the property's Commission
  charge code (a non-revenue code). It reduces what the agent is invoiced. *This was the one
  modelling choice made without an explicit owner answer; the Agent Portal plan (A-18, A-19)
  adds a payable ledger for the other settlement modes.*
- **Eligible only when all three hold:** the link has a commission rate; a Commission charge
  code is configured; the folio is finalising to a debtor account at this check-out. Otherwise
  nothing is posted and nothing errors.

## Price calendar (2026-07-20)

- A price update may cover from 1 day to **10 years** (`MAX_PRICE_CALENDAR_RANGE_DAYS`,
  `src/lib/price-calendar.ts`, shared by both endpoints). The end date cannot be before the
  start date. **No negative price** or extra-occupancy price.
- The Price Calendar page is always opened for one rate plan. Bulk Update writes to a ticked
  list of room types; the room-type buttons above the grid only choose what is previewed.

## Rate plan: Complimentary and House Use (2026-07-20)

- `RatePlan.isComplimentary` and `isHouseUse` are **labels only**. Neither stops Night Audit
  from posting the nightly charge; staff zero the rate by hand. Automatic zero posting needs a
  new owner decision.

## Allocation calculation mode (2026-07-20)

- Per property (`Property.allocationCalculationMode`), set in Revenue setup:
  - **Meal Plan level:** the reservation's meal plan is the only source of automatic
    allocations. A rate plan's own package allocations never post.
  - **Rate Plan level** (default): the rate plan's package allocations attach. The meal plan
    is display only.
- **Exclusive, never both.**
- **Not retroactive:** switching affects only reservations created or edited afterwards. A
  "refresh rate" tool for existing bookings is planned, not built.

## Reservation booking: Look to Book (2026-07-21)

- Flow order: Stay (dates, occupancy, booking source) → Room and Rate grid → Guest and details
  → Allocations and add-ons → total.
- **The grid replaces room-type and rate-plan dropdowns.** Rows are rate plans by priority,
  columns are room types with rooms left. A sold-out cell is struck through. Clicking a cell
  sets the active segment's room type and rate plan together.
- **The quote must never disagree with what Night Audit posts:** the grid prices with the same
  resolution chain (`GET /api/reservations/rate-availability`). One difference: an unpriced
  night shows "No rate" instead of zero. Availability shown is the minimum across the stay's
  nights.
- **A new booking is always RESERVED.** There is no status field on the form; status changes
  only through check-in, check-out, cancel and the other actions.
- **Special requests** are chips from a dropdown list, stored in `ReservationSpecialRequest`
  and validated on the server.

## Booking form pages and the quote (2026-07-21)

- Create and edit are pages (`/reservations/new`, `/reservations/[id]/edit`) sharing
  `BookingForm`, with a sticky Booking Summary beside the form.
- **`computeReservationQuote`** (`src/lib/reservation-quote-server.ts`,
  `POST /api/reservations/quote`) is a dry run of the whole stay through the same chain Night
  Audit posts with: derived-plan adjustment, Base plan fallback, Include-in-Rate carve-out
  before tax, each charge code's own tax, flat Green Tax. It writes nothing. The proforma, fee
  rules and the Booking API all reuse it.
- Taxes are shown once per tax name for the whole stay; Green Tax is listed separately.
- The allocation breakdown is shown night by night in price segments; a qualifying night with
  no price is called out, not hidden in the total.

## Reservation dates and occupancy (2026-07-21)

- **Departure must be after arrival.** The date picker disables invalid days (`minDate`),
  changing arrival past departure clears departure, and submit checks again.
- **Base and maximum occupancy are different things.** Over base occupancy means an
  extra-person charge. Over **maximum** occupancy is a capacity limit: the form shows a warning
  and blocks until the user ticks "I understand and want to book this anyway". The tick resets
  when occupants or room types change.

## Split stays, room moves, accompanying guests, guest picker (2026-07-21)

- **Split-stay segments must be back to back, with no gaps.** Each later segment's start is
  locked to the previous segment's end. Enforced on the server too
  (`assignmentsAreContiguous`).
- **Scheduled room move:** when a split stay's segments use different rooms, the reservation is
  flagged (`Reservation.hasScheduledRoomMove`), shown as a "Room Move" badge and listed under
  "Room moves due today" on Front Desk. It is information only; the rooms are already on the
  reservation. It is separate from the ad-hoc Move Room action.
- **Accompanying guests are capped at adults + children − 1**, on the form and on the server.
- **Guests are chosen in a search window with quick create** (`GuestPickerModal`): search by
  name, email, phone or address; create a profile in place (first name required) without
  leaving the booking.

## Osta platform console (2026-07-21)

- Osta is the enterprise that manages all enterprises; it is not a PMS itself. Its console is a
  separate route tree, `/osta/…`, with its own layout and no property switcher. An Osta user
  who is not in support mode is always sent to `/osta`.
- **Property approval is a hard gate.** A new property is `PENDING` and unusable until Osta
  approves it: `assertPropertyAccess()` rejects any property that is not `ACTIVE`. A rejected
  property can be resubmitted. Osta support inside an approved grant is exempt.
- Approve and reject are written to both activity trails, Osta's and the customer's.
- Module licensing per enterprise was removed on 2026-07-31; see "SaaS licensing model".

## Front Desk, housekeeping and maintenance rulings (2026-07-21)

- **A deposit is a real pre-arrival concept.** It can be collected while the reservation is
  `RESERVED`, shows on the reservation, and is on the folio at check-in. Payments are accepted
  at any time during the stay.
- **Inspected can gate arrivals:** a per-property setting; when on, checking a guest into a room
  that is not Inspected warns or blocks.
- **Out of Order is fields on the room** (`oooReason`, `expectedReturnDate`), with no history of
  past periods. A maintenance ticket can set a room Out of Order and return it to Dirty when
  resolved.
- **The Tape Chart is the one maintained chart** (the drag-and-drop grid).
- **Vacant rooms** on the dashboard = all unoccupied sellable rooms (not Out of Order or Out of
  Service), with a "clean and ready" count beneath.

## Business date and folios (2026-07-22)

- **The business date is per property** (`Property.businessDate`): the operational "today" for
  check-in and check-out, arrivals and departures, and every posting date. It moves forward only
  when Night Audit runs. All date-only comparisons are UTC.
- **Check-out is due or overdue** (business date on or after the departure date). Leaving
  earlier is an explicit Early Check-Out.
- **Charges can be posted only for a checked-in guest.** Deposits before arrival are payments
  and are not affected. Walk-in and outlet folios are always billable.
- **Negative amounts are allowed** on charges and payments (adjustments, refunds); zero is not.
- The folio payee can be the attached travel agent or company, not only a guest.
- A line's description fills from the charge code; `FolioLineItem.reference` is free text and
  prints in the invoice's Reference column.
- **Routing instructions** (`FolioRoutingRule`): standing rules per reservation that send chosen
  charge codes to another folio window or another in-house room's folio. Night Audit and manual
  posting both apply them; creating a rule also moves matching charges already posted. Manual
  Move to Folio allows any open folio at the same property.
- **Proforma = the full projected cost of the stay** (the quote). The Tax Invoice is what was
  actually posted.

## Deposit, cancellation and no-show fees (2026-07-22)

- **Fees are collected through Deposits, typed by purpose** (`Payment.depositPurpose`: deposit,
  pre-arrival fee, cancellation fee, no-show fee). They are never a way to post a charge before
  check-in.
- **Fee rules are per property** (`PropertyFeeRule`), computed from a basis: flat, percent,
  first night or full stay (the last three use the quote). Cancellation and no-show rules carry
  a charge code. Several rules per type are allowed since 2026-07-24.
- **Cancelling:** with an active rule, the fee is posted and the cancellation proceeds whatever
  the balance; the response says the fee, the deposit held, the refund due and the shortfall.
  With no active rule the folio must be at zero to cancel.
- **No-show at Night Audit:** the fee is posted to the no-show's folio. Nothing is refunded
  automatically.

## End of Day (Night Audit) (2026-07-22)

- **End of Day is a resumable step wizard.** One `EodRun` per property and business date. The
  business date is OPEN until its run is COMPLETED; a partial run resumes at the first
  unfinished step (`src/lib/eod.ts`).
- **Steps, in order:**
  1. **Departures:** every in-house guest due out must be checked out or extended before
     anything is posted.
  2. **Cashier:** every open shift of the property's staff is closed.
  3. **Post:** room, tax, packages and Green Tax; no-shows marked; the business date rolls.
     Posting is guarded per business date, so it can never post twice.
  4. **Registration:** Green Tax registration numbers are assigned.
  5. **Reports:** the day's reports are frozen.
  6. **Finalize:** everyone working in that property is signed out; the run is completed.
- **Running End of Day again within 12 hours** of the last successful run needs a confirmation
  and a reason, and is logged.
- **The sign-out at Finalize follows the location**, not the user's scope (see 2026-07-28).
- **Frozen reports** (`EodReport`, one per property, date and type): Trial Balance, Guest
  Ledger, AR Ledger, Deposit Ledger, Cashier Summary, Manager Flash. Flow figures use the line's
  business date; ledger positions are the folio state at close. Occupancy excludes pseudo room
  types. A ledger or flash report for a closed date reads the snapshot; for an open date it is
  computed live.
- **Registration numbers** (`GuestRegistration`) are sequential per property and **reset each
  calendar year**, in order of check-in date then check-in time. Pseudo room types are excluded.
  This number is separate from the reservation's confirmation number.

## Reports engine (2026-07-22)

- A report is one `ReportDef` in `src/lib/reports/`; the engine builds the filter form, runs it
  for the current property and business date, and renders PDF, Excel and CSV. See the Daily
  Reports rework section of [DEV_LOG.md](DEV_LOG.md).
- The tax split comes from stored columns (`serviceChargeAmount`, `taxAmount`, the Green Tax
  line); nothing extra is stored at posting.
- `Reservation.cancelledAt`, `cancellationReason`, `noShowAt` and
  `HousekeepingTask.startedAt` exist for the cancellation and attendant reports.

## Excursions (2026-07-22)

Structure is in the Excursions section of [DEV_LOG.md](DEV_LOG.md). Rules:

- The catalogue (types, rates, schedules) is gated by `CONTROLS`; `EXCURSIONS` means day-to-day
  bookings only.
- **Voiding a booking's charge needs `CASHIERING`.** Anyone who may cancel the booking can
  cancel it; if they lack the cashiering right the charge stays, with a note for cashiering.
- **The cutoff is a per-booking rule.** Cancelling a whole departure is manager-only
  (`EXCURSIONS delete`) however close it is.
- **A closed folio can never be voided or paid into.** A paid-and-closed walk-in booking can be
  cancelled as a record, but its money is refunded by hand, and it cannot be moved to another
  departure.
- **Infants are a priced tier for excursions**, unlike allocations.

## Billing rules (2026-07-24)

- **Billing opens after check-in and freezes after check-out.** A correction after check-out is
  done by reversing the check-out, never by editing a closed folio.
- **Never delete a transaction.** Reversals and negative entries only.
- **Interim Bill:** a read-only print of what is posted so far. Not numbered, no ledger change.
- **Advance Bill:** posts upcoming nights in one go so the guest can settle early. The user
  chooses how many nights, at most the remaining ones. It posts rate, extra occupancy,
  allocations, Green Tax and uncharged transport, **dated the day of posting**.
  `Reservation.advanceBilledThrough` stops Night Audit from posting those nights again.
- **Revenue is recognised on the date a line is posted**, always.
- **Early departure moves the departure date** to the business date. To charge the full stay on
  an early departure, generate an Advance Bill first, then check out.
- **Reverse check-out** is always allowed, with limits: a direct-bill folio only on the same
  date as the check-out; guest payments on other dates too. It returns the reservation to In
  House, reopens folios, restores the room and housekeeping state, and reverses the debtor
  transfer and the commission with reversing entries.
- **Reverse check-in** returns In House to Reserved, guarded so it cannot strand posted money.

## Check-out settlement (2026-07-24)

- **A guest can never check out with an open balance.** There is no write-off and no
  proceed-anyway override.
- **City Ledger needs an AR account.** If the travel agent or company on a City Ledger folio is
  not a credit account, check-out is **blocked** until the account is created or the folio's
  settlement method is changed.
- **A guest-settled folio is settled one way or another.** If the guest will not pay, staff
  post the balance to a **Service Recovery** payment method the property maintains.
- **The settlement document at check-out is the Tax Invoice.**

## Reservation states and fee rules (2026-07-24)

- **Stored statuses:** RESERVED, IN_HOUSE, CHECKED_OUT, NO_SHOW, CANCELLED. **Due In and Due Out
  are derived** from the stay dates and the business date (`src/lib/reservation-state.ts`):
  Reserved (arrival ahead) → cancel only; Due In (arrival today) → check-in; In House → early
  departure; Due Out (departure today) → check-out.
- **Check-in is only on the arrival day.** A past arrival that never checked in is Night Audit's
  no-show.
- **Reinstating is bounded by date:** Cancelled → Reserved only while arrival is still ahead;
  No-Show → Reserved only while the business date is within the stay. *Open:* a reinstated
  no-show with a past arrival is not Due In, so it cannot be checked in; the owner has not
  decided whether to move its arrival to today.
- **Every no-show's charge is posted to a folio**; Night Audit creates one if needed.
- **Fee rules are several per type, one chosen per reservation**
  (`depositFeeRuleId`, `cancellationFeeRuleId`, `noShowFeeRuleId`). No selection means no fee. A
  selected rule still applies if it is later made inactive; inactive only hides it from new
  bookings.

## Check-in wizard and registration card (2026-07-24)

- Check-in is a wizard, opened from every check-in entry point:
  1. **Room:** a room must be assigned (Out of Order and Out of Service are blocked, Dirty
     warns).
  2. **Identification:** per guest; confirms what is on file, flags an expired ID, allows quick
     entry. A warning only, it can be skipped.
  3. **Registration card:** print per guest and tick "signed and collected". Not blocking; shown
     only when the card is enabled.
  4. **Confirm:** summary, warnings and an optional payment.
- The registration card is one per guest, pre-filled with what is known, with blank lines for
  the rest, terms and two signatures.

## Fast Post (2026-07-25)

- "Point of Sale" is called **Fast Post**. Only the label changed: the module key is still `POS`
  and the route `/dashboard/pos`.
- It is a posting terminal with two flows: post an outlet charge to an in-house guest's room,
  or make a walk-in bill.
- **Outlet appointments do not exist.** Spa appointments are a separate system.
- A walk-in bill offers Tax Invoice, Void Bill, Take Payment and Close (no proforma). **Void
  Bill** needs a reason and marks every line void; nothing is deleted.
- A closed walk-in bill can be reopened **only while the business date still equals its close
  date** (`Folio.closedBusinessDate`).

## Availability and stop sale (2026-07-26)

- The Availability page is a grid of date by room type. Each column is the **night** of that
  date, so a closure on a stay's departure date never blocks it.
- **Stop sale blocks new bookings on a closed night**, for one room type or the whole property.
  On edit only the nights a reservation newly sells are blocked. Since 2026-10-10 a user with
  the right can override it: see "Revenue calendar and stop-sale override".
- **Restrictions are Open or Closed only.** `AvailabilityRestriction`: a row means Closed, no
  row means Open; a null room type is the whole property.
- Module `AVAILABILITY`: `view` shows the grid, `update` sets Open or Closed.
- **Group blocks on the grid count only when Definite.** The booking guard still counts
  Tentative and Definite. "Group Blocks" shows outstanding holds (held minus picked up).
- Available = capacity − rooms held by reservations − outstanding Definite block holds, from
  `src/lib/availability.ts`. Oversold shows negative. Empty detail cells show 0.

## Stationery (2026-07-27)

- **Branding comes from the property:** name, logo, tax number, phone, email and address from
  the property's General settings, the accent from `Property.bannerColor`, the font from
  `Property.stationeryFont` (`resolveStationeryBrand`, `src/lib/stationery-brand.ts`). For a
  walk-in bill made for an outlet, the outlet's identity wins.
- Document tabs: Invoices (Proforma and Tax, differing only in the header line), Receipts,
  Confirmation Letter, Registration Card, Account Statement. **Footer and terms are per
  document.**
- **One set of document components** (`src/components/print/stationery/`) renders both the real
  print and the preview, so the preview cannot drift.
- Stationery settings are in the Hub, in the property area.

## Channel manager: inventory and overbooking authority, rule D-7 (2026-07-27)

- **What is published outside the PMS is the actual free inventory. An overbooking allowance is
  never included.** If a manual overbook has made the count negative, publish 0.
- **Overbooking is a manual desk privilege only**, with its confirmation step. No outside
  booking can trigger it, so a channel can never *cause* an overbook.
- **Stop sale closes the room type at the channel**, it is not just availability 0.
- **Group-block rooms not yet picked up are withheld until the block's cutoff date, then
  released.** Pickup is refused after the cutoff, which is what makes releasing safe. **A block
  with no cutoff date holds its rooms for its whole life**: no cutoff never means release now.
- **An inbound OTA booking that no longer fits is accepted and flagged** as a channel overbook
  for the desk. The guest already holds a confirmation; the desk must learn days ahead, not at
  the door. It is an exception to resolve, never treated as a deliberate overbook.

## End of Day sign-out follows the location (2026-07-28)

- **Anyone with a session working in a property that has just rolled its date is signed out**,
  whatever their scope, including the person who ran the audit. The location is
  `AuthContext.sessionPropertyId`: a property-scope user's property, or an enterprise-scope
  user's currently selected property. The same enterprise user with another property selected is
  not affected.
- The sign-out carries a reason (`EOD_ROLL`). `/api/session/eod-status` is the one route allowed
  to answer through the lockout, so the browser can explain it: a banner while End of Day is in
  progress, then a notice and a real sign-out when the date rolls.

## Transaction-code numbering (2026-07-30)

- **Group (AAA) → Subgroup (nnAA) → 4-digit code** whose leading digits match the subgroup
  number. Groups: Accommodation 10RV; F&B 20-28RV and Meal Plans 29RV; Spa 30-39RV; Excursions
  40-49RV; Transport 50RV; Other 60RV; Tax 70SC / 80TX / 85GT; Non-revenue 90NR / 95PY; System
  99SY.
- Payments carry codes too (9500-9510): every posting is linked to a code.

## Spa and Excursions post through one outlet each (2026-07-30)

- **Spa and Excursions each post through one outlet, shared by every property in the
  enterprise** (`EnterpriseSettings.spaOutletId`, `excursionOutletId`). Posting across
  properties is deliberate. Only the outlet link is enterprise-wide; operational Spa settings
  stay per property.
- **No outlet, no posting:** while the link is empty, a charge from that module is refused with
  a clear message. Bookings can still be made.

## Licensing (2026-07-31)

- **No tier pricing.** The licence price is entered by hand per enterprise. Properties, room
  types, rooms and channels are **caps**, not price inputs.
- **Caps are allowances per property** (`PropertyLicenseAllowance`): blank is unlimited, 0 is not
  allowed.
- **Pseudo room types and their rooms never count** toward a cap and cannot be mapped to a
  channel.
- **Expiry is grace, then lockout.** Seven grace days by default: users sign in with a payment
  warning; after grace, or on revoke, sign-in is blocked and live sessions end. Osta and support
  sessions are exempt.
- **Invoicing is in the app with payment marked by hand** (no gateway).
- **There is no module gating per enterprise or per tier** (owner: "this is not controlled by
  us"). Every module is licensed for every enterprise; what a customer's users see is the
  customer's own role matrix. Osta's levers are the licence lifecycle and the caps.

## Add-ons are sold to the enterprise (2026-08-02)

- Sellable add-ons (Spa, Excursions, later Transportation) are enabled **per enterprise**
  (`EnterpriseAddonAccess`) and then apply to every property in it. Only Osta switches them.
- eRegistration must be reachable wherever the registration card is offered.

## PostgreSQL (2026-08-02)

- Development, test and production all run PostgreSQL 17. Local work needs
  `docker compose -f docker-compose.dev.yml up -d`, which creates `ostastay` and
  `ostastay_test`; the tests drop and rebuild `ostastay_test` on every run.
- The migration history starts at one baseline, `prisma/migrations/00000000000000_init`.
- **Hand-written SQL is not in the Prisma schema.** Two partial unique indexes
  (`JobRun_one_running_per_job_enterprise`, `CashierShift_one_open_per_user_property`) are
  concurrency guards written in raw SQL. Anyone squashing migrations again must carry them over.
- **Every text search needs `mode: "insensitive"`**; Postgres `LIKE` is case-sensitive.
- Pages that read the database declare `export const dynamic = "force-dynamic"`, or the build
  tries to prerender them.
- **A job must be safe to run repeatedly.** The job lock prevents overlapping runs, not a second
  run after the first has finished.

## Foreign keys are indexed (2026-08-03)

- Postgres does not index a foreign key by itself. Every foreign key column has an index; add
  one with every new relation.
- **An index on a table that already holds real data must be created by hand with
  `CREATE INDEX CONCURRENTLY`, outside the migration.** Prisma runs a migration in a
  transaction, and a plain `CREATE INDEX` there locks the table.
- Composite and covering indexes are added from real query plans, not guessed.

## Closed reservations (2026-08-03)

- **No strikethrough.** A subtle whole-row tint: red cancelled, yellow no-show, grey checked
  out. The guest name and confirmation number stay legible.
- **Cancelled or no-show: the only actions are Reinstate and Edit** (and viewing). No folio,
  deposit, housekeeping request or confirmation letter.
- **Checked out: "Reinstate" means reverse check-out, only on the day they checked out.** After
  that day the stay is view-only, except that folios can be reprinted.
- **A checked-out reservation can never be edited**, in the UI and in the API. The correction
  path is reverse check-out first.
- The gates are in `src/lib/reservation-state.ts`, shared by the list, the detail page and the
  form.

## Reservation delete is internal only (2026-08-03)

- **There is no delete button anywhere.** A hotel cancels an unwanted booking, which keeps its
  history.
- `DELETE /api/reservations/[id]` exists for internal clean-up behind four gates, all required
  (`src/lib/reservations/hard-delete-gate.ts`): Osta staff only; the server variable
  `ALLOW_RESERVATION_HARD_DELETE=true` (unset in every normal deployment); the caller echoes the
  exact confirmation number; nothing financial was ever posted and the stay is not live or
  departed. The operator and the support grant are written to the activity log.

## Folio: before arrival, documents and settlement (2026-08-03)

- **Nothing is posted by hand before arrival.** Money taken before arrival is a **deposit**
  against the reservation; it is already on the folio the guest will be billed from.
- **Only a proforma exists before arrival.** A tax invoice and an interim bill are hidden and
  refused by the API.
- **A folio row is one day.** Grouping by code or by check compresses repetition inside a day,
  never across days.
- **Charges and payments are one ledger:** payments appear in the detail table on their own
  date as negative figures. The proforma keeps real payments.
- The masthead carries only the document number and date. Confirmation number, folio number,
  room, meal plan and guests are in the Stay Summary block.
- Print page margin is zero, with padding inside the document, so the browser's own header and
  footer have nowhere to print.
- **Settlement follows the payment.** There is no Direct / City Ledger switch. Each folio has a
  **default payment method**. **Paying with a City Ledger payment method is what bills the stay
  to an account.**
- **A City Ledger payment is a transfer, not a receipt.** On the guest's bill it settles, so the
  desk can check out. On the account's invoice it is ignored, because it is what created the
  receivable (`computeReceivableBalance`, `src/lib/debtor-accounts.ts`).

## Uppsolut brand (2026-08-08)

- **The brand kit in `branding-guide/` outranks `DESIGN_PLAN.md`** where they disagree.
- **The product is Uppsolut Stay.** "Uppsolut" alone is right for vendor-level surfaces: licence
  invoices and the `/osta` console.
- **Palette:** Crimson `#8B0000` is `--primary`. Neutrals are cool, never warm. Deep Maroon
  `#580816` is the sidebar in both light and dark.
- **Destructive is not the brand red.** In light mode it is deliberately brighter than Crimson
  (`#C22F2F`); in dark mode it shifts to orange-red (`#FF7043`). Do not "correct" either toward
  Crimson. If they still read alike, make destructive buttons outlined.
- **The per-property accent is limited** to the thin banner bar, printed stationery,
  eRegistration and the switcher's colour dots.
- The logo is rendered as inline SVG (`src/components/brand/uppsolut-logo.tsx`); its odd
  measurements are the kit's, do not tidy them. Favicons are baked from the real Inter Black "U".
- `src/lib/brand.ts` holds the palette for places that cannot read a CSS variable (page
  metadata, PDF and Excel renderers, email). The stationery default accent is Crimson.
- JetBrains Mono is the mono face for labels and readouts. Number columns align with
  `tabular-nums`.

## Email: two senders (2026-08-08, 2026-08-10)

| | Tenant SMTP | Platform SMTP |
| --- | --- | --- |
| Sends | Confirmation letters, eRegistration links, debtor statements | Enterprise handover credentials, channel-manager alerts |
| From | The hotel's own domain | Uppsolut's (`noreply@mail.uppsolut.com`) |
| Configured | By the tenant, in the Hub (enterprise area, Email) | By the operator, `PLATFORM_SMTP_*` variables |

- **Order of precedence:** the tenant's own SMTP, then the platform SMTP if the enterprise has
  the Uppsolut Mail Service add-on, then "SMTP is not configured"
  (`resolveEnterpriseSender`, `src/lib/mail-sender.ts`). **A tenant's own SMTP always wins.**
- **The Uppsolut Mail Service is granted by Osta, never self-served** (`EnterpriseAddonAccess`
  key `PLATFORM_EMAIL`). It is a service, so it is in `SERVICE_ADDONS`, not `MODULES`: no
  sidebar entry and no row in the permission matrix.
- **Never silent:** the tenant's SMTP test says which sender was used.
- **Every send is logged in `EmailLog`, and that log is the billing record.** Nothing outside
  the sender module may send mail directly. The log keeps metadata only, **never the body**.
  Failed sends are logged and are not billable. Uppsolut's own mail (welcome, channel alert) is
  never billable to the tenant.
- **The usage screen counts, it does not price.** Licence invoice amounts are set by hand.
- Platform SMTP is set by environment variables only, with no screen to change it.
- Channel alerts go to Uppsolut ops (`PLATFORM_ALERT_EMAIL`), only on the change from connected
  to failed.

## Operations dashboard (2026-09-06)

- **Few colours, and they are the brand's.** Series separate by lightness within Crimson.
  Status colours (room status, priority, balances) keep red, amber and green, because there the
  colour is the information.
- The title greets the user by name.
- **Each user arranges their own dashboard:** show or hide widgets, set widths, group into
  pages, drag to reorder. **Layouts are stored on the server per user and per property**
  (`UserDashboardLayout`). A property with no arrangement gets the default, never another
  property's.
- **A dashboard starts empty**; the user switches tiles on. Widgets shipped later arrive off.
- Module `DASHBOARD`: `view` = who lands on the dashboard; `update` = configure which widgets
  each role sees.
- **Hiding a widget is not access control.** The gate is the module permission on each section's
  data (`src/lib/dashboard/overview.ts`). A user with several roles loses a widget only when
  every role blocks it.

## Brand website and Booking API (2026-09-06)

The rules are in the Website API section of [DEV_LOG.md](DEV_LOG.md). The owner's rulings:

- Keys are made in the Hub. A key covers one property or all, never a subset.
- **Minimal guest information:** first name and email required. The guest is matched to an
  existing profile by email, or created.
- **The website can never overbook**, and availability follows D-7.
- **A site sells one rate plan chosen in the Hub.** No plan means not bookable; an unpriced
  night is refused.
- The quote is the price. No payment in v1.

## Revenue: Rate Seasons (2026-09-07)

- The tab is **Rate Seasons** and its panel is "Define a Rate Season". The form has a Review
  panel that says how many daily prices the change will overwrite before it is applied.

## Dates, dropdowns and scrollbars (2026-09-23)

- **Date-only values go through `src/lib/date-only.ts`** (`toDateKey`, `parseDateKey`,
  `todayKey`). Never `toISOString().slice(0, 10)` on a local date: at UTC+5 that is the previous
  day.
- **No native `<select>` anywhere.** `OptionSelect` renders a plain styled dropdown for short
  lists and `SearchableSelect` above 8 options.
- One thin themed scrollbar app-wide.
- A report's date filters default to the property's **business date**.
- Report preview and PDF are the same layout (`report-document.tsx`), printed by headless
  Chrome; reports use the paper tokens with a single Crimson accent.

## Green Tax report and registration numbers (2026-09-23)

- **The Green Tax report is MIRA's information sheet**, and its Excel export is submitted as it
  is. Columns in order: Guest Registration No., Name (LAST FIRST MIDDLE, upper case), Category,
  Date of birth, Identification No. (the primary document), Nationality (country name, upper
  case), Booking Method, Check-in date and time, Check-out date and time. No amounts.
- **Category**, checked in this order: 4 = under the exemption age at check-in; 2 = Maldivian; 3
  = work-permit holder (a tick on an identification document); 1 = everyone else.
- **Booking Method** is MIRA's fixed list, set on company and travel agent profiles. A
  reservation reports its travel agent's value; no agent means FIT.
- **Times:** the actual check-in time, else the property's standard time; the actual check-out
  once checked out, else the booked departure at the standard time.
- **Filed monthly by stay date:** every registered guest with at least one night in the month.
- **Who gets a number:** every guest staying **12 hours or more** in a real room, measured from
  the actual check-in time (a setting can measure on standard times instead). Guests in pseudo
  rooms never get one.
- **The sequence** is per property, restarts at 1 each calendar year, follows check-in date and
  time, and **must have no gaps across the year**. No "missing number" check is wanted.
- **Corrections are in the Hub** (module `GREEN_TAX`: view = see, update = correct and file).
  Removing a number moves every later number of the year down by one. A reason is required and
  logged.
- **A filed month is frozen.** Filing is allowed only after the month has passed, in month
  order, with nothing flagged. After that no correction may move a number carried by a guest of
  a filed month ("never allow"). There is no un-file.
- The **Missing Profile Information** report lists what would make the sheet incomplete: High =
  a guest who should have a number has none, or a number is skipped; Medium = no ID number, date
  of birth or nationality; Low = the travel agent has no Booking Method.
- With several identification documents, the primary one is reported.

## Tax-inclusive rounding (2026-09-23)

- A tax-inclusive amount must split into parts that add back to exactly the amount entered.
  **Each tax line keeps its own rounded value; the base takes the remaining cent.** Example:
  215.00 at service charge 10% and GST 17% posts 167.05 + 16.71 + 31.24.
- Tax-exclusive postings are unchanged: the entered amount is the base.

## Setup lives in the Hub, split by Enterprise and Property (2026-09-23)

The structure is in the Hub setup section of [DEV_LOG.md](DEV_LOG.md). The owner's rulings:

- **Enterprise (shared):** users, roles and permissions, integrations, support access, email and
  SFTP. **Everything else is per property**, including tax, charge codes with their groups and
  subgroups, payment methods, dropdowns and stationery.
- **No live sharing between properties.** There is a **copy** option. If an item already exists
  at the target: **warn and skip, never overwrite.**
- **Work location is one property or ALL, never a subset.** The same for Booking API keys.
- **A single-property admin may enter the Hub** but sees only their own property's settings and
  nothing of the enterprise area.
- **Setup is not in the property dashboard at all.**
- **Charge codes vary by property**, with the property's own descriptions.
- **The Hub Overview is for maintenance and configuration:** a banner only when important setup
  is missing (one click to the fix), Green Tax only when there are issues, channel manager
  status, background jobs only when something critical fails. No link cards.
- Green Tax stays in the Hub, separated by property.

## Night Audit settings and the business date (2026-09-23)

- Each property has a Night Audit page in the Hub: the business date, which levies are posted
  each night, and what happens to vacant rooms' status. Rates and amounts stay under Finance.
- **The business date can be changed by hand:** to any date while the property has no data at
  all; otherwise only forward, and only with no in-house guests, no arrivals due before the new
  date, no financial records on the skipped days, no open cashier shift, no Night Audit running,
  and no spa or excursion bookings on the skipped days. Staff are signed out afterwards. Needs
  `CONTROLS` and `NIGHT_AUDIT update` (`src/lib/business-date-change.ts`).
- **No-shows:** marked at the arrival night's audit (default), **held one night** for a late
  arrival, or never automatically. A switch says whether the audit posts the no-show fee. A held
  arrival stays Due In and can be checked in.
- **Scheduled Night Audit:** on or off, and a time in the property's time zone. A time before
  noon runs after midnight for the previous day. It stops at the first step that needs a person
  and never catches up more than one day by itself; both show on the Hub Overview.
- **Check out settled departures automatically** (off by default): guests due out whose folios
  all net to zero are checked out; it stops for anyone who owes money, is owed a refund, or
  settles by City Ledger.

## Charge codes belong to the property; held nights; audit window (2026-09-24)

- **Charge codes are the property's own.** A new property gets the canonical charge groups and
  **only the system codes**: accommodation 1000, cancellation and no-show fees 1050 / 1060, tax
  7000 / 8000 / 8500, commission 9100, deposit 9200, payments 9500-9504, internal adjustment
  9901. Every revenue code and its numbering is created by the property. The fuller chart is
  demo data only.
- **Creating an outlet creates no subgroup or codes.** It posts to the codes picked on its form.
- **Copy from another property is a plain copy.** Codes keep their numbers. A number the target
  already uses is skipped and reported, never linked to the target's existing code.
- **A late arrival's held night is charged at check-in.** Under "hold one night" or "front desk
  decides", a guest checking in after their arrival night's audit is charged each held night at
  the booked rate, dated today, with service charge and GST but **no Green Tax**. The arrival
  date does not change. The desk may **waive** held nights with a reason; that needs
  `CASHIERING delete` and is logged. Check-in without a decision is refused.
- **A scheduled Night Audit runs only between 22:00 and 06:00.** A scheduled audit never closes
  an open cashier drawer: it stops there for a person. An audit run from the screen still
  closes drawers.

## Nationalities and job functions (2026-09-25)

- **Nationality is a master list, not setup.** Every country is ready-made: ISO 3166-1 alpha-2
  is what every nationality and country field stores; alpha-3 is the passport code
  (`src/lib/countries.ts`). An enterprise may rename an entry or add its own
  (`src/lib/nationalities.ts`). One picker, `NationalitySelect`, serves every nationality and
  country field.
- **Job functions are a fixed list** (`src/lib/job-functions.ts`), picked on the People form.
  Housekeeping and Maintenance decide who appears in the assignment pickers.
- The Hub's enterprise lists page is "Guest Lists".

## Documentation portal (2026-09-24)

- `/docs` has areas, each with its own sidebar and PDF: `/docs/api`, `/docs/configuration`,
  `/docs/operations` (and release notes). The old `/docs/api-integration/*` and
  `/docs/guides/*` addresses redirect permanently, because developers already have them.
- The Configuration guide is written for the **client's admin**; it separates Enterprise setup
  from Property setup and walks a new property to its first reservation in dependency order.
- **All docs are public** and covered by `docs:check`.
- **Screenshots show the main content only**, never the app's sidebar, header or footer, and
  come from the fictional Coral Bay Hotels enterprise, never a customer's data.

## Property logo (2026-09-24)

- The logo is **uploaded**, cropped in the browser to a fixed **3:2** frame and saved as a
  900 × 600 **PNG** (not WebP: Outlook cannot show WebP in email).
- Stored under `storage/logos` on the persisted volume and served by `GET /api/logos/[file]`.
  `Property.logoUrl` is set only by the upload route.
- Shown on the app header (on a white tile), every stationery document, every report, emails,
  the Booking API (as an absolute URL) and the guest eRegistration page.

## Phones: the defaults taken (2026-09-25, additions 2026-10-11)

The rules are in the Mobile polish section of [DEV_LOG.md](DEV_LOG.md). Rulings on top:

- **Bottom navigation on phones**, dashboard only: four slots chosen by permissions and job
  function, plus "More".
- Dialogs are bottom sheets that close by button or backdrop; pickers use a swipe-down drawer.
- **Hub on phones:** quick actions are adapted (sessions, support access, key revoke, business
  date, inbound bookings, people status); other setup pages show a "best on a larger screen"
  notice but stay readable.
- **Risky actions** (reverse check-in and check-out, stop sale, deletes) stay available behind
  "More", last and red, with their confirmations.
- Tablets (768-1023px) use the desktop layout with larger touch targets. One dashboard layout
  across devices. The header stays pinned while scrolling on every screen.
- **Dates on the guest eRegistration page** use the standard `DatePicker`.
- **Phone numbers:** every phone field uses `@/components/ui/phone-input` (country code
  dropdown, default Maldives +960). Stored as one string, "+960 7771234". Fields that take
  "phone or email" stay plain text.

## Split stays price per segment (2026-10-11)

- Each segment carries its own room type and rate plan. Every night posts on the segment that
  covers it (`postStayNight`).
- A rate plan's linked allocations apply only to the nights of the segments on that plan
  (`ReservationAllocation.appliesTo`; null means the whole stay).
- Room Move acts on the segment covering the business date and leaves later segments alone.
- A negotiated rate plan is enforced on the server (`negotiated-access.ts`).

## Profiles: delete only when unused, otherwise deactivate (2026-10-11)

- Anything that points at a profile blocks deletion (`src/lib/profile-links.ts`).
  `Profile.isActive = false` hides it from every picker and search and keeps all history.
- A guest with a RESERVED or IN_HOUSE booking cannot be deactivated.

## Group block Posting Master (2026-10-11)

- Each block has a Posting Master reservation (`isPostingMaster`) in a pseudo "PM" room; its
  folio is the block's master folio. It is created when the block becomes Definite (or by
  "Create master folio"), checked in automatically with the first pickup, and **skipped by
  Night Audit**. It is not a pickup (`src/lib/groups/posting-master.ts`).

## Group block profiles and Bill to (2026-11-13)

- **A block carries a Travel Agent or Company and a Source**, like a reservation. Every
  reservation in the block takes them and **cannot change them** while the block sets them (the
  form locks them; the server overwrites them). A profile the block leaves empty stays free on
  the reservation. Changing one on the block carries it to the live pickups (Tentative and
  Reserved), not to in-house or departed ones (`src/lib/groups/block-profiles.ts`).
- **Bill to may be any credit account**: Travel Agent, Company or Source. A profile is billable
  only once "Credit account" is on; the block says so when an attached profile is not.

## Front Desk and list views (2026-10-11)

- Front Desk tabs: Arrivals, In-House, Room moves, Departures. Each row shows two buttons
  (Arrivals: Check in, Register; In-House and Room moves: Traces, Folio; Departures: Check out,
  Folio) and a "…" menu for the rest.
- Client Relations is one card per row with badges for the profile type.
- VIP and "primary" markers are the solid `GoldStar` / `StarToggle`, never the outlined icon.

## Green Tax per guest; every guest gets a registration number (2026-09-25)

- **Every guest on the booking gets a registration number**, the primary and every accompanying
  guest, **including exempt guests**. A guest added to an in-house stay later is numbered at the
  next End of Day.
- **Exempt from Green Tax:** under the exemption age (default 2) at check-in, Maldivian, or a
  work-permit holder (any identification document flagged "Work permit"). The profile's "Green
  Tax Exempt" box ticks itself for these, locked, with the reason. A manual tick exists for any
  other case.
- **The automatic reasons are worked out every time, never stored**
  (`src/lib/green-tax-exemption.ts`). `Profile.greenTaxExempt` is the manual tick only.
- **Posting is per person:** the booking's head counts **less the exempt named guests**
  (`greenTaxPax`). An exempt minor comes off children, anyone else off adults; each falls back
  to the other when used up; never below zero. A named infant comes off only if the booking did
  not already count them as an infant. **Unnamed people pay.**
- Only Green Tax uses the reduced count. Other per-person charges keep the full head count.
- The same basis feeds Night Audit, Advance Bill, the proforma, fee rules and the booking form's
  quote. The Booking API's quote assumes everyone pays, because no profile exists yet.

## Reservations list: business on the books (2026-09-25)

- The list opens on **future active bookings only: status RESERVED** ("On the books").
- **A search looks through every status.** Picking a status narrows it to that status. Results
  list the newest stays first.
- Search is kept cheap: trigram indexes on every searched column, terms under 2 characters are
  ignored, 350 ms debounce, a newer request cancels a stale one.

## Desktop standards (2026-09-25)

The components are in the Desktop polish section of [DEV_LOG.md](DEV_LOG.md). Rulings:

- **Clean over convenient (standing rule).** A screen shows what the job needs now; anything
  secondary goes behind one click. One primary action per screen or section; at most two visible
  secondary actions, the rest in More; destructive actions last, red, confirmed. Empty sections
  are not drawn as cards (show an "Add …" link). No explanatory paragraphs on the page: use
  `InfoHint`.
- **Feedback is a toast**, top right. A modal only for an error that needs a decision, and it
  carries the action.
- **Reservation detail** is two columns from `lg` up: stay, room, guest and requests on the
  left; a sticky rail with status, dates, balance and the one next action on the right. Phones
  keep their own layout.
- **Names stay as they are.** Sidebar labels are not renamed, and a page title equals its
  sidebar label (sidebar = page title = browser tab).
- The folio is a real page (`/folios/[id]`); the dialog stays as a quick view.
- Header: property switcher, an Operations ⇄ Setup toggle, the business date links to Night
  Audit.
- Housekeeping cards are neutral with a status stripe and label, not fully tinted.
- **Hub save model:** save per section with a "Saved" state; auto-save only for single toggles.
- `/dashboard/inventory` redirects to Housekeeping.

## Interface text: sentence case (2026-09-25)

- **Sentence case for all interface text:** buttons, menus, tabs, titles, labels, table headers,
  toasts, empty states. Capitals only on the first word and on proper nouns and codes (Green
  Tax, MIRA, GST, Booking API, Hub, Night Audit as a module name).
- **Exception:** navigation names and the page titles that equal them keep their form ("Front
  Desk", "Tape Chart", "Client Relations", "Fast Post", "Daily Reports").
- **Verbs:** "Add ‹noun›" opens a create dialog, "Create" confirms it, "Save" confirms an edit,
  "Delete" or "Remove" destroy (always confirmed). Pending labels end in "…".
- No "successfully", no "!", no "Please".
- Very wide dialogs become side sheets or pages.

## GST report (2026-09-25)

- One line per invoice: invoice date (= departure date), folio or invoice number, guest, travel
  agent, agent TIN, arrival, departure, total excluding tax, service charge, GST, Green Tax,
  total including tax. Ordered and filtered by invoice date.
- **Rules chosen while building, not yet confirmed by the owner:** an invoice is a folio with
  posted charges, dated on the departure date once checked out (a walk-in folio on its close
  date); a folio whose Tax Invoice was never printed shows its confirmation and folio number;
  the guest is the reservation's primary guest.
- `Profile.tinNumber` is on company and travel agent profiles.

## Folio check numbers (2026-09-26)

- **Every posting gets a check number** (`FolioLineItem.checkNo`), one running number per
  property. A charge and the tax lines it generates share it. At Night Audit a stay-night's
  room rate, extra occupancy, allocations and all their taxes share **one** number.
- **The folio rolls up lines with the same check number in the same folio** into one line that
  expands. Different folios never roll together. Staff can edit a line's check number.
- **Fast Post: each item separately**, rolled up with its own service charge and GST only.
- Printing keeps its layout options; "By check" uses the check number.
- In "Post charge" the charge code is found by typing its code or description.

## Transportation (2026-10-04)

Decisions T-1 to T-14 are in the Transportation section of [DEV_LOG.md](DEV_LOG.md). The
owner's rulings:

- **Enabling needs both:** the enterprise add-on switched on by Osta, and the property's own
  switch in the Hub.
- **The reservation's Transport section is three fields per leg:** flight number, transport
  number and the flight time (landing for the pickup, take-off for the drop-off). With the
  module on, that section is read-only and filled from the module.
- **A drop-off charge posts at the audit of the guest's last night**, dated the departure date.
- Billing is driven by Night Audit, one posting per booking. No-shows and cancellations never
  post automatically. "Needs attention" warnings never block.

## Revenue calendar and stop-sale override (2026-10-10)

- **Revenue's first tab is a view-only calendar**, opening on the Base plan and the first room
  type. A night the plan has no price of its own shows **NA**; the Base fallback is not
  displayed (Night Audit still uses it). From a rate plan the calendar opens locked to that
  plan.
- **All price changes happen in Rate Seasons.** Picking days on the calendar offers "Update
  prices" (opens Rate Seasons pre-filled) and "Stop sale".
- **Rate Seasons is three locked steps:** plan, season and price, room types. A step opens only
  after the previous one is saved.
- **Stop sale is not per rate plan.** It closes a room type or the whole property for every
  plan.
- **Stop sale restricts new sales, never existing bookings.** The Booking API and the channel
  manager always honour it. Setting or lifting one pushes to the channel manager at once.
- **Two separate desk overrides** (`gateBookingConflicts`, `src/lib/restrictions.ts`):
  **Overbook** ignores physical inventory; **Override restriction** ignores a stop sale and
  needs `AVAILABILITY update`. A night that is both closed and sold out needs both. The website
  and channel paths can never override.

## Cashiering (2026-10-12)

- **Closing a shift is not a blind drop.** The window shows payments by method and how the
  expected cash is made up, asks for the counted cash (balanced, short or over) and requires an
  "I confirm there is X in the drawer" tick.
- **A currency exchange or paid-out can be linked to an in-house guest.** It is a link only:
  the name and room show on the shift list and the receipt; nothing is posted to the folio.

## Each enterprise can connect its own Beds24 account (2026-10-14)

- **Self-service is the default.** A property admin with `INTEGRATIONS` rights connects (invite
  code and Beds24 property id), re-authorizes, corrects the id, replaces the webhook URL, runs a
  deep resync and disconnects, from Hub › property › Channel Manager.
- **Managed by Uppsolut is opt-in:** Uppsolut connects the property through its own account from
  the Osta console.
- **One connection per property**, either way. The licence cap and the one-connection rule are
  checked before the single-use invite code is spent.
- The API-credit pool belongs to the Beds24 account, so a self-connected property's pause
  threshold protects the enterprise's own pool.

## Front Desk and Tape Chart polish (2026-11-07)

- A dashboard page showing only the status ribbon shows "Nothing on this dashboard yet" with a
  Customise button.
- **With no room on the first segment the button reads "Assign & check in".**
- The incomplete-profile warning names what is missing (nationality, date of birth, ID).
- Tape Chart cards show the guest name and the full confirmation number; status is the colour.
  The room column stays above the cards; the weekend tint is Saturday and Sunday; today's column
  is tinted and underlined.
- Housekeeping due-out rooms are tinted with a "Due out" tag; the board stays in room order.
- **Page toolbars: one primary and one secondary; with more than two actions, the secondary is
  a "More" menu** (`ActionBar`).

## Keyboard shortcuts (2026-11-07)

- **`src/lib/shortcuts.ts` is the one shortcut list.** The cheat sheet (`?`), the key handlers
  and the Operations guide all read it. A test fails if two shortcuts share a key or if a
  no-show, cancel or void key appears.
- **Additive, never subtractive.** A single letter acts only when nothing is focused or being
  typed into, no dialog is open, and no Ctrl, ⌘ or Alt is held (`canUseSingleKey`). A per-device
  "Quick keys" switch turns the letters off; `?` and Ctrl+K always work.
- In the palette, Tab or → on a booking lists its actions. **Every action is a link into the
  screen that already does it**, with that screen's own checks.
- **Check-out is always confirmed**, from a key and from the palette. **There is no key for
  no-show, cancel or void.**
- `g` then a letter goes to a sidebar page. Front Desk list keys: J/K select, Enter open, C
  check in, O check out, F folio, A assign room, M move room, 1-4 tabs, Esc clears.
- A role-based landing page is not wanted for now.

## Osta console: what Osta may see (2026-11-07, 2026-11-08)

- **A customer's people and activity are not Osta's to browse** ("it's classified"). The
  enterprise workspace has no People tab and no Activity tab, the search does not search a
  customer's users, and the user count is not shown. Osta only checks *whether* a customer has
  any user. **Do not add any of these back without asking the owner.** Support staff see a
  customer's data only inside an approved support session, through the customer's own screens.
- **An enterprise's own channel connection is "Running" or "Not running" only.**
  `ChannelConnection.managedBy` is `OSTA` or `ENTERPRISE`. For an `ENTERPRISE` connection Osta
  gets name, property, enterprise, provider and running; never errors, health times, credits,
  webhook, settings or logs. Every Osta channel route refuses it (`assertOstaManaged`).
- **Monitoring** (`/osta/monitoring`): load history is stored per minute (`DbMetricRollup`),
  kept 8 days. p95 is shown as "≤ N ms" because it is estimated from bands. Statement-level
  views are in memory and for this server only. Channel figures are Uppsolut-run connections
  only.
- **A page never refreshes on a timer** (house rule). It re-fetches when the browser tab comes
  back into view after 30 seconds, or on Refresh.
- **Billing** (`/osta/billing`) is a read-only overview. Issuing an invoice and recording a
  payment stay on the enterprise's Billing tab. There is no Licensing page.
- **Property approvals** happen in Today's inbox and on the enterprise's Properties tab.
- **Support Access** is a simple log: request, live, pending, ended.
- The Osta property page shows setup and health only, never guests or people.

## Phones: nothing scrolls sideways (2026-11-08, 2026-11-09)

- **Nothing scrolls sideways on a phone** (the app is released for phones). Tables become
  cards; tab rows become full-width grids, segmented switches or a dropdown; secondary filters
  go into a bottom sheet (`MobileFilterSheet`). A4 print documents are the only exception.
  Features stay the same; only the layout changes.
- The Osta console has the phone bottom nav (Today, Enterprises, Billing, Channels, More). The
  Hub has none.
- **No create button in the phone header.** Creating goes through search or the page's own
  button.
- The notification bell opens a bottom sheet on phones.
- **Page header on phones:** title left, compact buttons on the same row, main action last. Do
  not stretch header buttons full width; shorten the label ("New"). Built into `PageHeader`.
- **Tab rows on phones always fit, at most four per row** (built into `TabsList`).
- Front Desk on phones has no counts strip (the tabs carry the counts). The folio has a sticky
  header and Post charge / Post payment pinned at the bottom, each opening a bottom sheet.
- **Icons:** light mode is Iconsax Sun 2 Linear; a plain × closes; chevrons are the plain ones
  (the circled ArrowRight2 / ArrowDown2 are not chevrons).
- **A booking always has a room line** (room type and rate); a room *number* is optional.
