# Decisions & Business Rules Log

> A running record of business rules, design decisions, and corrections the app owner
> has given verbally during agent sessions — the kind of thing that lives only in chat
> history otherwise. When you make a judgment call that isn't obvious from reading the
> code, and it came from a direct instruction rather than your own design taste, log it
> here with a date so the next session (yours or a teammate's) doesn't have to
> rediscover or accidentally reverse it. Newest topics at the bottom is fine; keep each
> entry dated.

---

## Room Types (2026-07-18)

- **Pseudo room type** (`RoomType.isPseudo`): marks a room type as a "dummy"/non-physical
  room. Pseudo room types' rooms have **no Building, no Floor, no room features** — the
  Rooms UI hides those fields entirely when the selected room type is pseudo (see
  `src/components/inventory/room-manager.tsx`).
- **Housekeeping toggle** (`RoomType.housekeepingEnabled`): if off, rooms of this type
  should not present housekeeping/maintenance features — **now enforced** (2026-07-18):
  such rooms are excluded from the `GET /api/housekeeping` board, and creating a
  housekeeping task, a bulk maintenance ticket from the board, or a direct maintenance
  ticket against one 400s. Deliberately scoped to *new* housekeeping/maintenance
  activity only (mirrors `isActive`'s never-touch-history pattern) — room `status`
  PATCH (e.g. marking a room `OUT_OF_SERVICE`) is untouched, since that's an
  operational concern independent of whether housekeeping visits are offered.
- **Base price rule** (`RoomType.basePrice`): "the rate that will be charged per night
  if there is no actual rate selected during the reservation process — that amount will
  be charged with/out despite no adults or children on that room per night." I.e. it's a
  flat per-night fallback, independent of occupancy, used only when no rate
  plan/calendar price applies. **Audited 2026-07-18**: `night-audit/run/route.ts`'s
  fallback is confirmed as the *only* place this needs to apply — there is no
  reservation-creation-time rate preview/quote anywhere in the app that would also need
  it.
- **Inactive room type** (`RoomType.isActive`): ticking "Inactive" blocks any *new*
  reservation from being assigned to that room type, and **cascades every one of its
  Room rows to `OUT_OF_SERVICE`** — but never deletes anything (history is preserved).
  Re-activating does **not** auto-restore room status (a deliberate asymmetry — someone
  has to manually bring rooms back into service, since "was this room actually fixed/
  cleaned/ready" isn't knowable automatically). Every code path that assigns a
  room/room-type checks this: reservation create, reservation edit (only when the
  room/room-type is actually *changing*, so editing a booking that already sits in a
  since-deactivated type isn't blocked), room-move, reassign, group pickup, new room
  creation. Covered by `tests/room-types/inactive.test.ts` (4 tests).
- **Room features model**: originally considered separate `bedType`/`view`/`amenities`
  fields — **rejected by the app owner** in favor of one generalized multi-select
  feature system (`RoomTypeFeature` at the room-type level, `RoomFeature` at the
  individual-room level for inheritance + additions), grouped into three categories:
  `BED_TYPE`, `ROOM_VIEW`, `ROOM_AMENITY`. Verbatim: *"in this part just show a two
  parts - selected unselected - user can selected one or more of any features and put
  to selected section -- the selection part needs to be neatly grouped based on the
  feature type/group."* This produced the reusable `RoomFeaturePicker` dual-panel
  component (`src/components/inventory/room-feature-picker.tsx`).
- **Dropdowns Manager for feature codes**: the underlying System Code lists for these
  three categories switched from a `Select` dropdown to `Tabs` (one tab per category)
  and the "current codes" list switched from stacked cards to a real `<Table>`, per
  direct instruction: *"this section make tabs for the feature category and ability to
  switch between them, -- just show a simple table view."*

## Rooms (2026-07-18)

- Renamed "Physical Rooms" → **"Rooms"** everywhere (facilities-manager tab label,
  card title).
- Creating/editing a Room: **Building must be selected first**, which drives a
  dependent Floor dropdown (only floors under the selected building are offered).
  Disabled until a building is chosen.
- Room features are **inherited from the Room Type** (shown as fixed/read-only badges)
  **plus** an option to add additional room-specific features on top, via the same
  `RoomFeaturePicker` with an `excluded` prop hiding the already-inherited codes.
- **Pseudo room types** (see above) skip Building/Floor/Features entirely for their
  rooms — by design, not an oversight.

## Sequence Manager (2026-07-18)

- New Controls feature tracking **pure sequential counters only** — no prefix/format
  logic — for four document types: Registration No, Proforma Folio, Tax Invoice,
  Receipt No. Verbatim: *"this does not manage prefixes -- just the number itself (make
  sure these numbers i mentioned are sequenmtial numbers only) not alphanumerical."*
  Backed by `PropertySequence {propertyId, sequenceType, currentValue}`, one row per
  `(propertyId, sequenceType)`. The API (`api/settings/sequences/route.ts`) validates
  `currentValue` as a non-negative integer — verified live that a non-numeric value is
  rejected with 400.

## Tax & Charge Codes (2026-07-18)

- **Charge Codes are a distinct concept from Tax**, split into two separate Controls
  cards under Finance (previously one combined `FinancialsManager`).
- **Charge Code categories** (for reporting, not tax behavior):
  `ROOM | FOOD_BEVERAGE | TRANSPORTATION | OTHERS | TAX | PAYMENT | SYSTEM`.
- Renamed "Maldives Tax Engine" → **"Maldives Tax"**, "Custom Tax Profiles" →
  **"Custom Tax"**.
- **Maldives tax calculation order** (verbatim example given): base amount $100, SVC
  (service charge) 10% = $10, GST 17% calculated **on Base + SVC** = 17% × $110 =
  $18.70. GST is *not* calculated on the base amount alone.
- **Green Tax**: $12 per adult per night, $6 per child per night, **children under 2
  years exempt**. Modeled as `EnterpriseSettings.greenTaxAdultAmount` (default 12.00),
  `greenTaxChildAmount` (default 6.00), plus an existing exemption-age setting. **Now
  posted** nightly in `night-audit/run/route.ts` — see "Green Tax posting & the
  `infants` bucket" below for how the exemption is actually modeled.

## Custom Tax profiles: multi-line, and actually wired to posting (2026-07-18)

- **Gap found**: `ChargeCode.useDefaultTax`/`taxProfileId` were fully editable in
  Controls but **never read by any charge-posting route** — `pos/charge`,
  `folios/[id]/line-items`, and `night-audit/run`'s room charge all unconditionally
  applied the single enterprise-wide default engine (Service Charge then GST),
  regardless of what a charge code's tax config said. Selecting "Custom" + a profile
  had zero effect on the actual amount charged.
- **App owner's direction**: make Custom Tax profiles hold **multiple lines**, each
  with the option to calculate **on the subtotal** (flat %, independent of other lines)
  or **compounding on the running total** (subtotal + every prior line) — i.e.
  generalize the existing fixed Service-Charge-then-GST relationship to any number of
  named lines, and make sure charge codes actually connect to it. "Keep it versatile
  and simple."
- **`TaxRate`** (a `TaxProfile`'s lines) gained `name` (default `"Tax"`), `calculateOn`
  (`"BASE" | "COMPOUND"`, default `"BASE"`), `order` (default `0`) — migration
  `20260718172500_tax_rate_multiline`. `effectiveFrom`/`effectiveTo` were kept
  (unused by the new UI, which always writes `effectiveFrom: now, effectiveTo: null`
  and treats "editing a profile" as replacing its whole line set — simpler than
  reconciling per-line history — but `resolveChargeTax` still filters to only
  currently-effective lines, so the infrastructure isn't lost if a future UI wants it).
- **`src/lib/tax-calc.ts`** is the one shared engine, and the one connection point every
  posting route calls: `computeDefaultEngineTax` (unchanged Service Charge + GST
  formula, now expressed as the BASE/COMPOUND special case), `computeCustomProfileTax`
  (N lines, summed into one `taxAmount` — a Custom profile has no separate "service
  charge" concept), and `resolveChargeTax(chargeCode, ...)`, which picks between them
  based on `chargeCode.useDefaultTax`. `pos/charge`, `folios/[id]/line-items`, and
  `night-audit/run`'s room charge all now call `resolveChargeTax` instead of each
  duplicating the calculation inline (they used to, independently, in three places).
  Verified numerically identical to the old formula for the default-engine case (91
  tests passing, including `tests/business-rules/tax-calc.test.ts`'s exact-match on the
  documented $100/SVC-10%/GST-17% example) and end-to-end that a Custom-Tax-linked
  charge code now actually posts differently (`tests/business-rules/
  custom-tax-posting.test.ts`).
- **Tax Manager UI** (Controls → Finance → Custom Tax) redesigned: "Add/Edit Custom Tax"
  now edits a dynamic list of named lines (name, rate %, On Subtotal/On Subtotal +
  Prior Lines), not a single rate + historical-effective-date pair. The profile table
  shows every line as a badge instead of one "Current Active Rate" column.

## Green Tax posting & the `infants` bucket (2026-07-18)

- **Problem discovered while implementing posting**: `Reservation.children` is a raw
  headcount with no per-guest birthdate attached, so "children under `greenTaxExemptAge`
  are exempt" couldn't be computed from it — `Profile.dateOfBirth`/`greenTaxExempt`
  exist, but only apply to *named* profiles (primary guest, optional `AccompanyingGuest`
  links), which aren't guaranteed to exist for every child in the headcount.
- **App owner's resolution**: add a third occupancy bucket, `Reservation.infants`
  (schema migration `20260718171500_reservation_infants`), alongside `adults` and
  `children`. Infants are **fully exempt from Green Tax and not counted toward room
  occupancy** — the exemption is structural (which bucket a guest is counted in), not
  computed from an age comparison. Wired through `reservations` POST/PUT,
  `groups/[id]/pickup`, and a new "Infants" field in the reservation form UI.
- **Posting mechanics**: `night-audit/run/route.ts` posts one `FolioLineItem` per
  checked-in reservation per audit run, alongside the existing room charge:
  `amount = adults × greenTaxAdultAmount + children × greenTaxChildAmount` (infants
  contribute nothing), against a `GTX` charge code looked up per enterprise the same way
  `ROOM` already is. Unaffected by `Property.pricesIncludeTaxes` or the SVC/TGST
  calculation — Green Tax is a flat government levy, not part of that chain. Only
  enforced (i.e. the run 400s if the `GTX` code is missing) when
  `EnterpriseSettings.greenTaxEnabled` is actually on for that enterprise — a Standard
  enterprise that's never touched Green Tax settings won't suddenly need a `GTX` code to
  run Night Audit.
- **Inclusive/exclusive tax toggle**: property owner gets a **top-level** setting
  (`Property.pricesIncludeTaxes`, moved off `EnterpriseSettings` — it's per-property,
  not per-enterprise) applied to anything charged. A **transaction-level** override (per
  posting) was explicitly deferred: *"when posting we will think of something"* — do
  not build this without a follow-up decision.
- **Charge code tax assignment**: when adding a Charge Code, the user picks **Default**
  (uses the Maldives Tax engine) or **Custom** (picks a specific Custom Tax profile).
  Modeled as `ChargeCode.useDefaultTax` (default `true`) + nullable `taxProfileId`.

## Folio Printing (2026-07-18)

- The two near-duplicate folio print routes were resolved: **`/e/[slug]/dashboard/
  folios/[id]/print` is canonical** (app owner's explicit call — this was the route
  they said they were migrating *to*, even though at the time it was actually the less
  feature-complete of the two). `/print/folios/[id]` (previously linked from
  `FolioPanel`) has been **deleted** after porting its extra features — payee-profile
  display, Green Tax line-item handling, more robust print CSS — into the canonical
  page first, so nothing regressed. `FolioPanel`'s print button now opens the canonical
  URL directly (resolves the enterprise slug via `useParams()`).

## Outlets (2026-07-18)

- **What an Outlet is**: a revenue-generating point of sale scoped to one Property —
  Spa, Restaurant, Bar, Retail, Transport, Recreation, or Other. Verbatim brief: "log
  revenue generation from outlets... facilitate sales without bookings... a spa can
  allow guests who are already booked to request treatments and have the charges added
  to their room bill... generate separate bills for guests who visit only the outlet
  without staying... creating and onboarding any outlet should be smooth and
  seamless... a top-level tax calculation can be selected, which will be applied to all
  charge codes processed through it... properly linked with the POS... pre-book for
  reservations or passerby."
- **Charge codes are never owned by an Outlet** (app owner's explicit call, offered as
  an alternative to "each code belongs to one outlet"): a `ChargeCode` stays
  enterprise-wide and independent; an Outlet curates a many-to-many pool of which
  existing codes it exposes in its own POS view (`OutletChargeCode`). The same code
  (e.g. a generic "Late Checkout Fee") can be offered by more than one outlet, or none.
- **Walk-in billing** (app owner's explicit call, offered as an alternative to a
  brand-new standalone-bill entity or auto-creating a fake reservation): extend `Folio`
  itself — `reservationId` is now nullable, with `walkInGuestName`/`walkInGuestContact`
  populated only when it's null. Reuses every existing folio/line-item/payment/print code
  path unmodified; the only structural cost was giving `Folio` its own `propertyId`
  (previously only reachable via `reservation.propertyId`) so scoping still works when
  there's no reservation to hop through. See "Session/scope engineering conventions"
  below for the full retrofit list.
- **Outlet tax override** (app owner's explicit call, offered as an alternative to
  "mandatory, every outlet must pick one"): **optional**. `Outlet.taxOverrideMode`
  (`NONE` | `DEFAULT_ENGINE` | `CUSTOM`) — when `NONE` (default), every charge code
  posted through the outlet uses its own tax setting exactly as it would anywhere else
  in the app; when set, it overrides every charge code's own setting, whether that code
  was on the default engine or its own Custom Tax profile. Implemented as a thin
  wrapper (`resolveOutletChargeTax` in `src/lib/tax-calc.ts`) around the existing
  `resolveChargeTax`, not a modification to it.
- **Pre-booking scope** (app owner's explicit call, offered as an alternative to full
  resource/room-capacity booking): a **simple appointment log** only — no bookable
  "resources" (therapists, tables, treatment rooms), no hard conflict rejection.
  Verbatim: *"have a simple appointment log - but able to set a cap to how many
  appointments, I do want users to get notified if they make a double booking, extended
  full version can be managed in a newer version/higher tier of plan."* Modeled as
  `Outlet.appointmentCapPerSlot` (optional Int) — when a new `OutletAppointment` would
  push an overlapping time window's count over that cap, the create still succeeds
  (`201`) but the response carries a `capWarning: {cap, overlappingCount}` for the UI to
  surface as a non-blocking toast. Never a hard block. Full resource-capacity booking is
  explicitly deferred to a future higher-tier feature — don't build it without a fresh
  decision.
- **Where things live in the UI**: Outlet CRUD is a Controls concern (new "Outlets" tab,
  positioned right after Inventory, gated by the existing `CONTROLS` permission like
  every other Controls section). Day-to-day outlet *operations* — posting a charge
  through an outlet, starting a walk-in bill, booking/managing appointments — all live
  on the existing POS page (a new "Appointments" tab alongside the existing charge-
  posting flow), gated by the existing `POS` permission. Deliberately no new sidebar
  item or RBAC module: the whole point of reusing `POS`/`CONTROLS` was to avoid opening
  the "does this need to mirror the sidebar" question for a feature this tightly
  coupled to modules that already exist.
- **Amenities relocated** (explicit request: *"move the 'Amenities' from inventory to
  next to Outlets"*): `FacilityAmenitiesManager` (the `Facility` model — a guest-facing
  Pool/Gym/Spa marketing list, unrelated to Outlets' revenue-tracking purpose despite
  the name overlap) moved from the Inventory tab to sit alongside the new Outlets tab.
  No code changes to the component itself, purely a Controls-tab-tree relocation.
- **Never lose revenue/appointment history**: `DELETE /api/outlets/[id]` follows the
  same pattern as `RoomType.isActive` — blocked (400) if the outlet has any
  `FolioLineItem` or `OutletAppointment` history; deactivation (`PATCH
  {isActive: false}`) is the real path once an outlet has seen any activity.

## Theming & Design System

- Full audit, token system, and migration plan: see [`DESIGN_PLAN.md`](DESIGN_PLAN.md)
  (not duplicated here — it's a large, self-contained document). Status note: its header
  says "planning only — no code in this document has been applied to the repo," but
  `git log` shows a commit `4420587 Implement DESIGN_PLAN.md: monochromatic design
  system + responsive layouts` — **the header is stale**, treat the plan as
  partially-to-mostly implemented and verify against current code rather than trusting
  the "planning only" label at face value.
- **Per-property banner accent, not per-enterprise**: superseded from the plan's
  original wording — `Property.bannerColor` (raw hex, nullable) renders as a thin 4px
  line at the top of the page via `PropertyBannerBar`, scoped to the *property* (an
  enterprise can have multiple properties, each with its own color), not a shared
  enterprise-wide CSS token. `--primary` (buttons, links, focus rings) stays a fixed
  neutral for every property/enterprise — the banner line is the *only* sanctioned
  accent surface. See `DESIGN_PLAN.md` §3.3 for the full "sanctioned surfaces" list.
- **~25 files with uncommitted design-system changes** are sitting in the working tree
  as of the most recent commits — flagged in [TODO.md](TODO.md) rather than here since
  it's an actionable item, not a settled decision.

## Session/scope engineering conventions (for agents working on this repo)

- New `tests/tenant-isolation/*.test.ts` or `tests/room-types/*.test.ts` files must
  `upsert` the INTERNAL Osta enterprise using the **exact same slug `"test-osta"`** as
  `tests/scope.test.ts` — `getOstaEnterpriseId()` caches the first INTERNAL enterprise
  id for the life of the Vitest process (`fileParallelism: false`), so a differently-slugged
  INTERNAL enterprise in a second test file desyncs every `ctx.isInternal` check.
- Windows: the dev server holds the Prisma query-engine `.dll.node` open — stop it
  (`taskkill //PID <pid> //F`, PID via `netstat -ano | grep ":3000"`) before every
  `npx prisma generate`, and restart the dev server after, since a `next dev` process
  already running keeps the *old* client in memory even after `node_modules/@prisma/client`
  changes on disk (Next only watches `src/`).
- Base UI (this app's shadcn preset — **not Radix**) renders `Checkbox`/`Switch` as
  `<span role="checkbox">`, not a native `<button>`/`<input>`. When scripting UI
  interaction for verification, target `[role="checkbox"]`, not `button`.
- **`Folio.reservationId` is nullable** (since 2026-07-18, for walk-in/Outlet billing —
  see "Outlets" above). Any route or component reading `folio.reservation.propertyId`
  (or anything nested under `.reservation`) must switch to `folio.propertyId` directly
  and null-guard reservation-specific display fields (guest name, dates, room
  assignments) — `folio.reservation` is only ever present for a reservation-backed
  folio now. Every `prisma.folio.create` call (direct or nested under a
  `reservation.create`) needs an explicit `propertyId` — Prisma does not auto-inherit a
  sibling scalar from a parent nested-create.
- **A stale/cached compile error in one browser tab's console history is not proof of a
  real bug** — Turbopack's dev-server error overlay can retain an error from an
  intermediate edit state and keep echoing it into `read_console_messages` even after a
  forced navigation on that same tab, while the actual current file compiles and
  renders fine. If a console error's cited line numbers don't match the file you just
  read, open a *brand-new* tab and check there before assuming the code is broken —
  don't trust a single stale tab's console buffer over a fresh `tsc --noEmit` and a
  fresh page load.

## Confirmation Letter (2026-07-19)

- Sent to a guest once their stay is confirmed — entry to the Maldives requires a hotel
  confirmation, and this is the "nice letter" sent to satisfy that, by mail. App owner
  supplied a reference image (a branded "Sunset Hotel & Resort" template with a colored
  side strip, logo, salutation, stay details, policy paragraph, and signature block) and
  asked for both delivery paths: "printable and smtp both options."
- **Required content** (verbatim from the app owner): guest names including any
  accompanying guests, stay period, nights, room category, and reservation remarks —
  plus generic hotel info and policy text, kept to one page.
- **Branding**: reuses `EnterpriseSettings.invoice*` fields rather than inventing a
  parallel branding system for just this one letter. The reference image's illustrated
  geometric/beach artwork is represented only as a 3px brand-color accent strip — no
  image assets exist for the illustration and recreating it was judged disproportionate
  scope for a "make it one page... generic info" request.
- **`Reservation.remarks`** is a plain free-text field on the reservation itself, not
  sourced from `ReservationTrace` — that model is an operational task/message log, a
  different kind of data from curated guest-facing letter text.
- **SMTP sending is real**, via new `src/lib/mailer.ts` (nodemailer), reading
  `EnterpriseSettings.smtp*`. This was built on top of a known pre-existing gap:
  `smtpPassword` is stored in **plaintext**, and `GET /api/tenant-settings` already
  returned it in full to the browser before this feature existed. Encrypting at rest
  and/or redacting the GET response were both judged out of scope for this feature
  (need a key-management decision and a UI rework respectively) — flagged in TODO.md as
  a real follow-up, not silently fixed or silently ignored.

## Invoice redesign, Payment Receipt, Currency Exchange Receipt (2026-07-19)

- **Tax Invoice vs. Proforma Invoice**: app owner clarified these are **two buttons
  producing the same underlying data**, not separate document models — the only
  differences are the title ("Tax Invoice" vs. "Proforma Invoice"), a small "This is not
  a tax invoice." disclaimer on Proforma, and which of two independent document-number
  fields gets stamped. `GET /api/folios/[id]/invoice-data?type=tax|proforma` drives it
  (defaults to `tax` if the param is absent).
- **Document numbering finally wired up**: the Sequence Manager (see "Sequence Manager"
  above) existed but nothing consumed it before this feature. New
  `src/lib/document-sequence.ts` (`allocateSequenceNumber(propertyId, sequenceType)`)
  atomically increments a `PropertySequence` row and returns the new value — called
  **exactly once per document, only when the target field is still null**:
  `Folio.taxInvoiceNumber` (`TAX_INVOICE` sequence, `INV-00001` format),
  `Folio.proformaInvoiceNumber` (`PROFORMA_FOLIO` sequence, `PRO-00001` format),
  `Payment.receiptNumber` and `CurrencyExchange.receiptNumber` (**share the same**
  `RECEIPT_NO` sequence and `RCT-00001` format — a payment receipt and an exchange
  receipt are the same kind of document to the numbering system, verbatim from the
  plan: "Receipts... Payment Receipt, Exchange Receipt"). Reprinting any of these
  documents reuses the stored number rather than allocating a new one — verified live
  (same folio printed twice keeps the same `INV-00001`).
- **Invoice line-item columns simplified** to Date / Description / Reference / Amount
  (explicit override of the initially-offered options — "no need for qty and rate").
  Maldives tax math (Service Charge/TGST/Green Tax) is still computed and shown, just
  rolled into the totals block instead of broken out per line.
- **No QR code** on any of these documents — Payment Information is a **text-only**
  block (Account Name/Number/IBAN/Bank Info, new nullable `EnterpriseSettings` columns)
  shown in a printed footer. The app never moves money itself; this is informational
  only, not a payment-gateway integration.
- **Currency Exchange is a real recorded transaction**, not a stateless print form —
  new `CurrencyExchange` model (`propertyId`, `shiftId`→`CashierShift`, `guestName?`,
  `fromCurrency`, `toCurrency`, `rate`, `amountFrom`, `amountTo`, `receiptNumber?`,
  `createdByUserId`). Posted from Cashiering (Controls-adjacent, not Controls itself)
  against the caller's own open `CashierShift`, auto-opening one at 0 float if they
  don't have one — mirrors the existing pattern in
  `src/app/api/folios/[id]/payments/route.ts`, **not** the older `POST
  /api/payments/route.ts`, which still trusts a client-supplied `shiftId` (a known
  deviation — do not copy that one).
- **Payment Receipt** is scoped **one per existing `Payment` row** (confirmed
  explicitly, not a separate "receipt batch" concept) — printed from a per-row action
  in the Folio Panel's payments table, which previously had no trailing actions column.

## Debtors (Accounts Receivable) (2026-07-19)

App owner requested a new "Debtors" module: credit accounts for Travel Agents and
corporate clients, transferring/managing charges paid by agents, Night Audit posting to
the right billing target, and a Folio "bill to account" option gated on a City Ledger
settlement method (default when a TA/corporate is attached). Clarifying questions and
answers, confirmed before building:

- **Credit accounts extend existing `Profile` rows** (COMPANY/TRAVEL_AGENT), not a
  separate account model — `Profile` already had dormant `arNumber`/`creditLimit`/
  `iataNumber`/`commissionRate` fields nothing read before this. New
  `Profile.isCreditAccount` formally activates them.
- **"Transfer agent charges"** means routing a folio charge from the guest's own folio
  onto the account's AR ledger (the classic bill-to-account/City Ledger transfer) — not
  agent-commission tracking.
- **V1 is the full AR suite**: accounts, charge routing, running balance, recording
  payments received, a FIFO aging report (Current/1-30/31-60/61-90/90+), and a
  printable/emailable Account Statement.
- **Credit limit is warn-only, never blocking** — mirrors the existing Outlet
  appointment-capacity `capWarning` pattern, surfaced in the Night Audit results page
  and the bill-to-account response, never persisted.
- **Module access**: `DEBTORS` was added only to `Cashier` (beyond the always-full
  Admin/Manager) — Front Desk and Reservations were explicitly *not* granted it at
  launch. **Live-verified this exposed a real, general RBAC bug**: a brand-new module
  added to `MODULES` was not retroactively granted to any enterprise's already-seeded
  `RolePermission` rows (`ensureRoles()`'s `upsert` only populates permissions on
  first create), and System roles are read-only in the Controls UI, leaving no
  self-service fix. **Fixed the same day** (see "RBAC self-healing permission
  backfill" below) rather than left as a known gap — every existing role now
  self-heals the first time it's used after a new module ships.
- **A debtor's AR ledger is a `Folio`**, not a new model — `isDebtorAccount: true`,
  `payeeProfileId` set to the credit-account Profile (reusing the existing
  `payeeProfile` relation, which was already used by the ordinary "Change Payee" flow),
  `reservationId: null` like a walk-in folio, one per `(Profile, Property)` created
  lazily on first use — mirrors how `GroupBlock.masterFolios` and walk-in folios are
  already provisioned on demand. No DB-level uniqueness enforces the one-per-pair rule
  (a filtered/partial unique index isn't clean in SQLite/Prisma, and `payeeProfileId`
  is legitimately reused by non-debtor folios); the lazy-creation helper
  (`src/lib/debtor-accounts.ts`'s `findOrCreateDebtorFolio`) does a find-then-create
  and documents this as an accepted, low-risk gap.
- **`POST /api/debtors/accounts/[profileId]/bill-charges` is a new, separate endpoint**
  from `/api/folios/line-items/move` — that route's walk-in-rejection and
  same-reservation-only checks are real safety invariants for the ordinary "Move to
  Folio" action; weakening them to admit an AR folio (`reservationId: null`, accepting
  charges from any reservation at the property) would also loosen what that existing
  action permits. `bill-charges` has its own guards instead: rejects re-billing a
  charge already on a debtor folio, and rejects billing from a group master folio.
- **Settlement routing is automatic where it can be, manual elsewhere**: a new
  reservation's initial folio defaults `settlementMethod` to `CITY_LEDGER` only if its
  `travelAgentId` resolves to an `isCreditAccount` profile (not re-evaluated on later
  edits, so a staff override sticks); Night Audit then posts the nightly ROOM/Green Tax
  charges straight onto that account's AR folio instead of the guest folio whenever
  that's set. Because those charges never land on the guest folio, **checkout's
  existing zero-balance check required no code changes**. Any other charge (POS,
  incidentals, corrections) is routed manually via a new "Bill to Account" action in
  the Folio Panel, enabled only when `settlementMethod === CITY_LEDGER`.
- **`PrintDocumentShell` gained an `extraActions` slot** (rendered before the Print
  button) so the new Account Statement page could offer both Print and Email actions
  without duplicating the shell — the same dual-action need the Confirmation Letter
  page solved with a bespoke header; this generalizes it for future documents that need
  more than one delivery action.

## RBAC self-healing permission backfill (2026-07-19)

App owner asked to address the gap discovered above directly: "adding a new RBAC
module isn't retroactively granted to existing enterprises' System roles, and System
roles can't be edited via the Controls UI at all."

- **Chose self-healing over a one-off migration script**: `requireSession()`
  (`src/lib/scope.ts`) already re-queries the live `User`→`Role`→`RolePermission`
  chain fresh on every request (no JWT/session caching of permissions — confirmed by
  reading the whole function first). A one-time migration script would only fix
  enterprises that exist *today*; a self-healing check fixes every enterprise
  automatically, forever, the first time any of its users makes a request after a new
  module ships — no deploy-time step to remember, no risk of a new enterprise's
  System roles drifting out of sync again the next time `MODULES` grows.
- **What it does**: after loading `user.role.permissions`, diff the module names
  present against the current `MODULES` array. If any are missing, backfill them:
  System/Support roles get the canonical value from `SYSTEM_ROLE_DEFS`/
  `SUPPORT_ROLE_DEFS` (looked up by exact role name — both dicts merged into one
  lookup table), custom (non-system) roles get all-`false` (`NO_ACCESS`) — the same
  default they'd have received had the module existed when an enterprise admin
  created that role via the Controls UI. Cheap on the common path (`missing.length
  === 0` returns immediately) and self-limiting (a no-op forever once a role has been
  backfilled once).
- **SQLite doesn't support `createMany`'s `skipDuplicates`** (Postgres/MySQL/
  CockroachDB only) — the backfill instead does one `upsert` per missing row, keyed
  on `RolePermission`'s `@@unique([roleId, module])` compound key. Still fully
  race-safe if two concurrent requests for the same under-provisioned role both hit
  the gap at once.
- **Deliberately did not touch the "System roles cannot be edited" restriction** in
  the Controls UI (`src/app/api/roles/[id]/route.ts`) or relax it in any way — that
  block exists because System roles are shared *across every enterprise*, and letting
  one enterprise's admin edit a shared row (or silently forking it per-enterprise on
  first edit) is a materially different, riskier feature than what was actually
  asked for. The self-heal fixes the concrete bug (a legitimate new module never
  reaching existing roles); it doesn't change who can edit what.
- **Live-verified against the real dev database, not just the two new
  `tests/scope.test.ts` cases**: found 8 genuinely pre-existing roles missing the
  `DEBTORS` row from before this fix shipped (Manager, Front Desk, Housekeeping,
  Maintenance, Cashier, Reservations, Osta Support, Osta Support Admin) — logged in
  as the `Manager` role and confirmed the row appeared correctly on the very first
  request, matching `SYSTEM_ROLE_DEFS.Manager.DEBTORS` exactly, with no server
  restart or manual step involved.

## Stationaries page (2026-07-19)

App owner: "in Controls > Reports we have option to define invoice some details, i
want to move that to a separate page > Stationaries... a way to properly manage
certain details of the stationaries a simple way" — followed shortly after by "side
bar does not show Stationary option can you add there?" once they saw the first
version (a Controls tab).

- **Audited which `EnterpriseSettings` fields each of the 5 printable/emailable
  documents actually reads** (Tax/Proforma Invoice, Confirmation Letter, Payment
  Receipt, Currency Exchange Receipt, Debtor Statement) before designing anything —
  confirmed brand identity (name/logo/color/font/address/contact) is shared by all
  5, `invoiceHeaderText` is Invoice-only, footer/terms/payment-account fields are
  shared by Invoice + both Receipt types + Statement, and
  `confirmationLetterMessage` is Confirmation-Letter-only. This matrix drove the
  three-tab grouping in the new `StationariesManager` (Branding / Financial
  Documents / Confirmation Letter) instead of guessing a layout.
- **No schema or API changes** — every field already existed and was already read
  correctly by all 5 documents; this was purely a settings-UI relocation and
  reorganization, confirmed via the audit above before writing any code.
- **Chose grouped tabs with a switchable live preview** (3 mockups: Invoice,
  Confirmation Letter, generic Receipt/Statement) over one long undifferentiated
  form — app owner's explicit choice between the two when asked, on the reasoning
  that a field like "Header Text" being invoice-only is invisible in a flat form but
  obvious once it's the only field in its own tab.
- **Sidebar placement**: shipped first as a new Controls tab (matching how
  Sequences/Tax/Users & Roles all live inside Controls, since this looked like pure
  settings/configuration, not a new operational module). The app owner then asked
  for it in the main left sidebar directly, same as Debtors got — promoted to a
  standalone page (`src/app/e/[slug]/dashboard/stationaries/page.tsx`) with its own
  `app-sidebar.tsx` entry, and removed the now-redundant Controls tab so there's one
  canonical path, not two. Deliberately reused the existing `CONTROLS` permission
  rather than minting a new RBAC module for it — it's still fundamentally a settings
  page, and reusing an already-granted permission meant every existing Admin/Manager
  saw the new sidebar item immediately with no backfill needed (unlike `DEBTORS`,
  which genuinely needed its own module since it's a real operational domain with
  its own CRUD permissions).
- **Live-verified end-to-end**: all three tabs load and save correctly, all three
  preview modes render, and a saved `confirmationLetterMessage` change was confirmed
  to persist through a full page reload by reading it back from the database
  directly (then reset to empty afterward, since it was test data).
- **Unrelated discovery during verification, explicitly not touched**: the Controls
  page intermittently failed to compile due to JSX syntax errors in
  `room-manager.tsx` and then `tax-manager.tsx` — different files erroring on
  successive checks, consistent with another session actively editing them at the
  same time. Neither file was touched by this work.

## Debtors: checkout-triggered invoice pipeline redesign (2026-07-19)

App owner: "statement and receipt currently together -- it should be two seperate
ones, statement should show line per invoice with totals and guest name and also
summary age of folios (open only)." Digging into "one row per invoice" surfaced a
real architecture mismatch with the original Debtors design (see "Debtors (Accounts
Receivable)" above): every charge billed to a credit account landed on **one shared
pooled ledger folio per (account, property)**, with no memory of which
guest/reservation it came from — structurally impossible to produce "one row per
invoice" from. Asked to clarify what "open folios" should mean; the app owner's
answer redefined the pipeline outright: **"Debtors will only work once guest is
checked out - so no active reservations should be there. Make sure the debtors
module also follow the same pipeline."**

- **A debtor invoice is now a reservation's own `Folio`** — not a shared pooled
  ledger folio. This supersedes the "one per `(Profile, Property)`,
  `findOrCreateDebtorFolio`" design from the original Debtors entry above, which is
  now fully removed (the function and the pooled-folio model both deleted, no
  successor). Every field reused, no schema migration: `settlementMethod` and
  `payeeProfileId` are now **both** set at reservation creation (previously only
  `settlementMethod` was); `isDebtorAccount` is **repurposed** to mean "this
  specific folio has been finalized into a debtor invoice," flipping `true` only at
  **checkout**, only for a folio still `CITY_LEDGER` at that moment with a still-valid
  `isCreditAccount` travel agent attached. Before checkout it's always `false` — this
  is the literal mechanism that keeps in-house reservations invisible to Debtors.
- **Night Audit reverted to settlement-agnostic**: the City-Ledger routing branch
  added by the original Debtors work is removed entirely. Night Audit always posts
  the nightly Room/Green Tax charges to the reservation's own folio, full stop — no
  credit-limit checks or account routing during the stay. Charges accumulate exactly
  like a normal guest folio throughout the stay; only checkout transfers them.
- **Checkout is now the pipeline trigger**, not Night Audit and not a manual action.
  The balance check is split by settlement method: `DIRECT` folios must still net to
  ~0 (unchanged rule) or checkout is blocked; `CITY_LEDGER` folios are excluded from
  that requirement — but only if `reservation.travelAgentId` still resolves to a
  valid `isCreditAccount` profile at that moment (a defensive fallback mirroring the
  one removed from Night Audit) — otherwise the folio is treated like `DIRECT` for
  the balance check, so a misconfigured folio can't silently write off real revenue.
  Qualifying folios get `isDebtorAccount: true` + `payeeProfileId` set inside the
  same transaction that closes every folio and marks the reservation
  `CHECKED_OUT`. A non-blocking credit-limit check (same `checkCreditLimitWarning`
  helper as before) runs after the transaction and returns in the checkout response.
- **The mid-stay "Bill to Account" feature is removed outright** — a real capability
  removal, not an oversight. `POST /api/debtors/accounts/[profileId]/bill-charges`
  and the Folio Panel's "Bill to Account" button/dialog are both deleted. The old
  feature let staff cherry-pick individual charges onto a shared account ledger *at
  any point* during a stay, which doesn't fit "no active reservations in Debtors,
  ever." The equivalent split-billing scenario (guest pays for the room, one POS
  charge goes to a corporate account) is still fully achievable with existing
  primitives that needed no changes: **Add Folio** (open a second window on the same
  reservation) → toggle that window's **Settlement** to City Ledger → **Move to
  Folio** the specific charge onto it. That window finalizes into its own invoice at
  checkout exactly like the main folio.
- **Aging changed from FIFO-over-flat-line-items to per-invoice bucketing**:
  `computeAgingBuckets` (which applied payments FIFO against the oldest charges
  first, across one shared ledger) is replaced by `computeFolioAgingBuckets`, much
  simpler since each invoice/folio is now independent — bucket each still-open
  invoice's own balance by the age of its own `reservation.checkOutDate`, no
  cross-invoice allocation needed. "Open" means `balance > 0.005`, not
  `Folio.isClosed` (checkout closes every folio regardless of settlement method, so
  `isClosed` can no longer mean "unpaid").
- **A real regression was caught and fixed while building the account detail
  page**: `POST /api/folios/[id]/payments` unconditionally rejected payments to any
  closed folio. Since checkout now closes every folio including finalized
  City-Ledger ones, this would have made "Record Payment" against any debtor invoice
  completely non-functional — every invoice is closed the moment it's born. Fixed to
  allow payments on a closed folio specifically when `isDebtorAccount` is true.
- **Debtors account list/detail/statement now query per-reservation invoice folios
  directly** (`WHERE payeeProfileId = ? AND isDebtorAccount = true`), each result row
  = one invoice via the new shared `buildInvoiceSummary()` helper
  (`src/lib/debtor-accounts.ts`) — guest name from `folio.reservation.primaryGuest`,
  total/balance from the same charge-minus-payment formula as before. The account
  detail page, Statement print page, and send-statement email all rebuilt around this
  invoice-table shape instead of a flat charge/payment ledger.
- **Stationaries preview split accordingly**: the combined "Receipt / Statement"
  preview mode in `StationariesManager` is now two separate modes — `ReceiptPreview`
  (Payment Receipt / Currency Exchange Receipt, unchanged content) and a new
  `StatementPreview` (dummy invoice table + open-folio aging summary strip,
  reflecting the new statement shape). No changes to which settings fields apply to
  which document — same matrix from the original Stationaries entry above still
  holds, Statement just gets its own accurate mockup now.
- **Full suite rewritten**: `tests/tenant-isolation/debtors.test.ts` (15 tests) and
  `tests/business-rules/debtor-aging.test.ts` (9 tests) replaced entirely — the old
  bill-charges and pooled-folio tests no longer apply. New coverage: Night Audit
  posts to the guest's own folio regardless of settlement method; an in-house
  City-Ledger folio does not appear in Debtors until checkout; checkout finalizes a
  qualifying folio into an invoice and succeeds despite nonzero balance; checkout
  still blocks a nonzero `DIRECT` folio and falls back to blocking when the travel
  agent isn't a valid credit account; a post-checkout invoice shows the correct guest
  name/total; recording a payment against one invoice updates only that invoice.
  149/149 full suite passing, `tsc --noEmit` clean.

## Occupancy pricing, Derived Rate Plans, and decoupled Meal Plans (2026-07-19)

Three related app-owner requests in one session: extra adult/child pricing on the
Price Calendar ("that price is default occupancy rate - please also add for extra
adult, extra child prices"); renaming the Revenue tabs (Manager Flash / Rate Plans /
Rate Details) with the same extra pricing on Rate Details' bulk tool; and a design
discussion on Meal Plan being awkwardly coupled to Rate Plan ("I have to create
seperate Rates for seperate Meal Plans... ideally i want the meal plan to be
configurable in the controls as well"). The app owner then proposed their own
mechanism for the same underlying pain — "derived" rate plans that inherit a parent
plan's price plus a percent/flat adjustment — and asked for both designs to be
built, not one instead of the other. They solve different problems: Derived Rate
Plans is a general rate-variant tool (works for meal-plan variants, but also
negotiated/OTA/promo rates); Meal Plans is a dedicated, simpler per-(RoomType,
MealPlan) surcharge that doesn't require minting a whole new Rate Plan per
combination.

- **Occupancy pricing — `RoomType.baseOccupancy`**: no existing concept of "adults
  included in the base rate" existed anywhere (`maxOccupancy` is purely a capacity
  label, confirmed via a full-codebase check to be read in exactly 3 CRUD-only
  places and enforced nowhere). Added `baseOccupancy` (Int, default 2, editable per
  room type) as the threshold: adults beyond it incur `PriceCalendar.extraAdultPrice`
  per night; every child incurs `extraChildPrice` (no "included children" baseline —
  deliberately kept simple, matching how Green Tax already treats children as a flat
  per-child charge with no exemption threshold below the separate infants bucket).
  Both extra-price fields live on `PriceCalendar` (same granularity as `price`, so
  seasonal variation applies to them too) with no `RoomType`-level fallback — unset
  simply means no surcharge for that day, not "use a default."
- **Derived Rate Plans — resolved live, never materialized**: `RatePlan` gains a
  self-relation (`parentRatePlanId`, `onDelete: SetNull` so deleting a parent
  doesn't cascade-delete its derived children) plus `derivedAdjustmentType`
  (PERCENT|FLAT) and `derivedAdjustmentValue` (signed — negative means a discount).
  A derived plan has **no `PriceCalendar` rows of its own**; every lookup (Price
  Calendar display, Night Audit) resolves the parent's entry for that date and
  applies `applyRateAdjustment()` (`src/lib/derived-rate.ts`) — including as the
  final step when falling back to `RoomType.basePrice` if the parent has no
  calendar entry for that day, so a derived plan is always "parent price +
  adjustment" no matter where the parent's price came from. This means a derived
  plan can never drift out of sync with its parent — there's no sync/materialize
  step to forget. **Chaining is explicitly disallowed** (a derived plan's own
  parent must not itself be derived, and a plan that already has children can't
  become derived itself) — enforced in the API on both create and update, not the
  DB, keeping every resolution path a single hop. The Price Calendar page shows a
  read-only explanatory banner instead of the Bulk Update form for a derived plan;
  both `POST /api/price-calendar` and `.../bulk` reject direct price-pushes to one
  server-side too (not just a UI omission).
- **Meal Plans decoupled from Rate Plans**: new property-scoped `MealPlan` model
  (code/name/isActive) and `RoomTypeMealPlanRate` join (one flat per-night
  surcharge per Room Type × Meal Plan — deliberately **not** date-seasonal like
  `PriceCalendar`, since the app owner described it as "a set rate," not something
  needing its own calendar). `RatePlan.mealPlan` is removed entirely — a Rate Plan
  is now purely about the room's own price curve, meal plan is a fully orthogonal
  concern. `Reservation.mealPlan` deliberately stays a plain string (not converted
  to a hard FK) to minimize blast radius — it now sources its dropdown options from
  the live `MealPlan` list instead of 5 hardcoded values baked into two separate
  duplicated `<Select>`s (Rate Plan form + Reservation form), resolved by
  `(propertyId, code)` at Night Audit time, the same lookup pattern already used for
  `ChargeCode`. New Controls category "Revenue" (previously Meal Plans had no home;
  grouping money-adjacent config together — Finance for tax/charge codes/payment
  methods, Revenue for pricing structure) hosts a combined Meal Plans list +
  Room Type × Meal Plan rate matrix (per-cell save-on-blur, not a bulk submit).
  Migration seeds BB/HB/FB/AI per existing property (matching the old hardcoded
  dropdown's 4 non-"Room Only" options) so Controls isn't empty after upgrade —
  "Room Only"/NONE is deliberately never seeded, since no `MealPlan` row for it
  means no surcharge lookup at all, which is exactly correct for a zero-cost plan.
- **Also fixed while in this area**: `POST /api/reservations` now returns a
  non-blocking `capacityWarning` when a booking's adults+children exceeds a room
  type's `maxOccupancy` — surfaced in the reservation form's save notification, the
  first time this field has ever been enforced anywhere (previously a pure label).
  `BulkPricingTool` (Rate Details) switched from two plain `<input type="date">`
  fields to the shared `DateRangePicker` component per the AGENTS.md convention it
  had been quietly violating.
- **Live-verified end-to-end**: created "BAR-BB" derived from "BAR" at +$20 flat;
  confirmed its Price Calendar shows the computed $170 (not directly editable) when
  BAR itself is $150; configured a $25 Bed & Breakfast rate for Standard Room via
  the new Controls > Revenue matrix; booked a reservation on the derived plan with
  that meal plan and 6 occupants (correctly triggering the capacity warning); ran
  Night Audit and confirmed the folio posted exactly three separately-itemized,
  correctly-taxed line items: $170.00 room charge, $25.00 meal plan charge, $60.00
  Green Tax. 149/149 full suite passing, `tsc --noEmit` clean.

**Correction, same day**: the `RoomTypeMealPlanRate` matrix described above was
removed again a few hours later, per explicit app-owner feedback on a screenshot of
it — *"this isn't required as i mentioned the association will be done on rate
detail level... BAR / BAR-BB / BAR-HB / BAR-FB / BAR-AI will create rates
seperately."* The Derived Rate Plan mechanism (already built, above) **is** the
meal-plan-pricing association — a reservation booked on "BAR-BB" already gets the
right total nightly price with no separate charge needed. `MealPlan` (the LOV —
code/name/isActive) stays; `RoomTypeMealPlanRate`, its API route, the Controls rate
matrix, and the Night Audit "Meal Plan Charge" posting block were all deleted.
`Reservation.mealPlan` is now purely an informational tag, not a Night Audit
pricing input. New migration `20260719100019_remove_meal_plan_room_type_rates`
drops the table. 149/149 passing, `tsc --noEmit` clean after the removal too.

## Allocations (2026-07-19)

- **New first-class revenue entity**: an Allocation is a per-person, date-range-priced
  component (BF/LN/DN, transfers, spa, excursions) configured under Revenue >
  Allocations, linkable to Rate Plans (package contents) and Meal Plans (BB → BF),
  attachable manually per reservation, and posted by Night Audit against its own
  ChargeCode. Full architecture and phase history: `ALLOCATIONS_PLAN.md` in this folder.
- **Owner-confirmed rules** (all dated 2026-07-19, given verbally in-session):
  - Prices are **adult/child only — infants are never charged** (consistent with the
    Green Tax infant exemption). No infant price field exists anywhere.
  - Pricing is **controlled by date only** — date ranges that must not overlap
    (API-validated, like rate pricing). Room type and meal plan never affect an
    allocation's price.
  - The Include-in-Rate / Add-to-Rate / Sell-Separate **mode is defined per allocation
    item/code** — one allocation can be include-in-rate while another is add-to-rate,
    but a single allocation is never both.
  - **Include-in-Rate = revenue carve-out**: room line reduced by the allocation amount
    (clamped at zero), folio total unchanged, attribution moves to the allocation's
    charge code.
  - **Departure-night rhythm posts on the stay's last night** (no audit runs for a
    guest on their checkout date).
- **Supersedes (extends) the "price meal plans via Derived Rate Plans" decision
  above**: a derived plan mathematically cannot price per person, so per-pax meal
  pricing now flows through MealPlan → Allocation links. Derived Rate Plans remain
  fully supported for flat/percent room-rate adjustments — the two mechanisms compose
  (a reservation on "BAR-BB" can get BAR+$20 room pricing AND the BB meal plan's BF
  allocation).
- **Attachment is materialized at booking/edit time** into `ReservationAllocation`
  (source RATE_PLAN | MEAL_PLAN | MANUAL, with optional negotiated price overrides) —
  Night Audit reads only those rows, so later edits to a plan's links never silently
  reprice an in-house stay. Derived plans inherit their parent's links unless they
  have their own.
- 167/167 full suite passing (18 new allocation tests: rhythm gating, date-range
  selection, pax math, carve-out clamp, override honouring, link inheritance,
  materialization lifecycle, tenant isolation), `tsc --noEmit` clean.

## Allocations: Sell-Separate is an independent toggle, not a mode (2026-07-19)

**Correction to the Allocations entry above, same day**, from app-owner feedback on the
built UI (verbatim intent): *"sell separate — it is a separate toggle from add to rate /
include in rate. Despite including in rate or not, sell separate allows users to attach
these packages manually to reservation. The purpose of defining allocations like BF, LN,
DN was so revenue allocations are allocated by default and posted during night audit."*

- **`Allocation.mode`** is now strictly 2-way: `INCLUDE_IN_RATE | ADD_TO_RATE` — it only
  governs how the allocation posts *when it is part of a rate plan*.
- **`Allocation.sellSeparate`** (new Boolean, independent of `mode`) — when true, the
  allocation is *additionally* offered as a manual add-on in the reservation form,
  whether or not it's part of any rate/meal plan. It does not change posting behavior.
- **All allocations are linkable** to rate plans and meal plans now (the earlier rule
  that SELL_SEPARATE allocations couldn't be packaged is removed — that concept no
  longer exists). The reservation Add-ons picker shows only `sellSeparate` allocations
  that aren't already auto-attached via a rate/meal plan.
- **UI**: the allocation form's 3-way "Rate Behaviour" radio became a 2-way radio
  (Include in Rate / Add to Rate) plus a separate "Sell Separately" switch. The Rate
  Plan dialog was widened and split into two side-by-side columns — rate definition on
  the left, a chip-style allocation picker grouped by type (selected chips highlighted,
  unselected gray) on the right — to fix an unscrollable single-column dialog.
- Migration `20260719140000_allocation_sell_separate` adds the column and backfills any
  legacy `mode='SELL_SEPARATE'` row to `mode='ADD_TO_RATE', sellSeparate=true`.
- 169/169 suite passing (2 new tests: SELL_SEPARATE rejected as a mode value; a
  sell-separate allocation is still linkable to a rate plan), `tsc --noEmit` clean.

## Base Rate Plan replaces RoomType.basePrice (2026-07-19)

App-owner instruction (verbatim intent): *"Remove the column base price from Room Type
config — by default during onboarding a 'Base' Rate will be created which is locked
and cannot be deleted (lock icon). You cannot edit anything for the rate detail
section — however packages can be added if preferred — this will be default rate for
all room types all rate plans if nothing custom is specified."*

- **`RoomType.basePrice` is gone** (dropped column, migration
  `20260719170000_remove_room_type_base_price`). The Room Type form/table no longer
  shows it.
- **Every property gets exactly one locked Rate Plan** (`RatePlan.isLocked = true`,
  code `"BASE"`, name "Base Rate", priority 999) — created automatically at property
  onboarding (`POST /api/properties`). A migration
  (`20260719160000_rate_plan_locked` + a one-time backfill script,
  `scripts/dev-tools/backfill-base-rate-plans.ts`, now historical/inert since the
  column it read no longer exists) provisioned one for every pre-existing property
  and carried its room types' old `basePrice` values forward into today's
  `PriceCalendar` row, so no configured pricing was silently lost.
- **Clarified interpretation of "cannot edit rate detail"**: this locks the plan's own
  *identity* fields (code, name, priority, negotiated flag, derive-from settings) —
  not its pricing. The Base plan is priced through the **exact same Price Calendar
  mechanism as any other rate plan** (Calendar button / Revenue > Rate Details), so an
  admin can and should bulk-price it (e.g. a year or more out) via the existing
  seasonal/bulk pricing tool. **Package Allocations remain fully editable** on it, per
  the instruction. Enforced both in the UI (disabled inputs, lock icon, hidden delete)
  and independently in the API (`PUT` on a locked plan silently ignores everything
  except `allocationIds`; `DELETE` 400s; `POST` rejects a client-submitted code of
  `"BASE"` as reserved).
- **Night Audit fallback chain**, in order: (1) the reservation's `overrideRate`, (2)
  the assigned rate plan's own Price Calendar entry for tonight (or its parent's, if
  derived), (3) **the property's Base Rate plan's Price Calendar entry for the same
  room type/date** (skipped if the assigned plan already IS the Base plan), (4) `0` if
  even that's missing — same as `RoomType.basePrice`'s old implicit `@default(0.0)`
  when a room type was never explicitly priced. A derived plan's adjustment still
  applies on top of whichever raw price resolves, including a Base-sourced one.
  **Practical consequence worth knowing**: unlike the old `RoomType.basePrice` (a
  single number that worked for literally every future date with zero setup), the
  Base plan's fallback is only as good as its Price Calendar coverage — an
  unconfigured future date has no price at all (posts $0) unless the admin has bulk
  priced that far out.
- Seed (`scripts/seed/seed-veyo.ts`) demonstrates this: creates Veyo's locked Base
  plan and bulk-inserts a full year of Price Calendar rows per room type at the
  former `basePrice` values (250/450), via `createMany` rather than 730 individual
  upserts.
- Also added while in this area: the `GTX` (Green Tax) charge code was missing from
  Veyo's seed entirely — `EnterpriseSettings.greenTaxEnabled` defaults to `true`, so
  Night Audit would have 400'd on "Missing GTX charge code" the moment it was run.
  Also seeded a sample chart of charge codes (Accommodation/F&B/Transport/Spa, `RV`
  suffix) per the app owner's list.
- 177/177 suite passing (8 new Base Rate Plan tests: onboarding auto-creation, lock
  enforcement on PUT/DELETE/POST, and the full Night Audit fallback chain incl. the
  derived-plan-on-top-of-Base-fallback case), `tsc --noEmit` clean.

## Charge codes, payment methods, room-charge posting code (2026-07-19)

App-owner instructions this session, with two design questions the owner answered:

- **PAYMENT category removed from Charge Codes** — payment types are Payment Methods,
  and having both was redundant ("payment method and charge code seems redundant —
  remove payment from charge codes"). `ChargeCode.category` is now
  ROOM | FOOD_BEVERAGE | TRANSPORTATION | OTHERS | TAX | SYSTEM.
- **Payment Methods** gained a **CITY_LEDGER** type (alongside CASH/CARD/TRANSFER/
  CHEQUE/VOUCHER). Veyo seed now provisions Cash, Credit Card, Bank Transfer, City
  Ledger.
- **Tax reporting — owner chose "identify from source charge code"** (not separate tax
  charge codes): taxes stay embedded on each folio line (`taxAmount` +
  `serviceChargeAmount`) tagged by the charge code that produced them, so reports break
  tax down per charge code natively with no decoupling. Green Tax remains its own
  GTX-coded line. (If per-tax-line itemisation of a multi-line custom profile is ever
  needed, add a per-line breakdown child table on top — flagged, not built.)
- **Rate plans can select an accommodation charge code** (`RatePlan.chargeCodeId`,
  nullable FK, onDelete SetNull) — the code its nightly room charge posts against at
  Night Audit. Editable even on the locked Base plan (a posting setting, not identity).
- **Enterprise posting/settlement defaults** (`EnterpriseSettings`
  `defaultAccommodationChargeCodeId` + `cityLedgerPaymentMethodId`, Controls > Finance
  > "Posting & Settlement Defaults"). Night Audit resolves the room charge code as:
  rate plan's own chargeCode → enterprise default accommodation code → legacy "ROOM"
  code; 400 only if none of the three exist.
- **Allocations repointed to dedicated charge codes** in the seed (BF→60RV Package
  Breakfast, LN→61RV Package Lunch, DN→62RV Package Dinner, Airport→50RV, Speedboat→
  51RV) instead of the generic FB, so F&B/transfer revenue breaks down by service.
- **City Ledger settlement — owner chose to LEAVE checkout behavior as-is (2026-07-20).**
  The settlement *code* (which CITY_LEDGER payment method settles debtor folios) is
  definable in Controls > Finance, but **no settlement Payment line is posted at
  checkout, deliberately.** Reason surfaced when the owner and I looked closer: the app
  models a City-Ledger folio AS the debtor invoice itself (checkout flips
  `isDebtorAccount = true` and the folio is excluded from the guest-balance check), so
  the guest already nets to zero and the debtor already carries the full invoice —
  posting a literal settlement Payment onto that same folio would net it to zero and
  *erase the debtor's balance*, which is wrong. A visible auditable settlement line
  would require a two-folio transfer (guest folio gets the payment; a separate invoice
  folio opens on the debtor account) — owner declined that for now ("option 1"). Do NOT
  build a checkout settlement-payment posting without first switching to the two-folio
  model; the current single-folio transfer is the intended behavior. `Payment.shiftId`
  was therefore left required (no nullable-shift migration needed).
- 190/190 suite passing (3 new room-charge-code-resolution tests), `tsc --noEmit`
  clean. Note: a concurrent alpha-hardening pass (availability guard, Night Audit
  transaction/idempotency, reservation state machine, sequence numbers) also landed in
  the working tree this session — the Night Audit room-charge-code change layers on top
  of that pass's refactor of the same route.

## Profiles redesign (2026-07-20)

Full architecture in [PROFILES_REDESIGN_PLAN.md](PROFILES_REDESIGN_PLAN.md). Per direct
app-owner request: replace Loyalty with a configurable VIP tier, split single Communication/
Address/ID fields into real multi-row child tables, add CRM fields, and consolidate all
profile types (Guest/Staff/Company/Corporate) into one table.

- **Loyalty → VIP**: `Profile.loyaltyTier` removed, replaced with `Profile.vipLevel`
  (free-string, sourced from a new `VIP_LEVEL` SystemCode LOV in Controls, not a hardcoded
  enum — matches every other LOV in the app).
- **ProfileContact split into `ProfileCommunication` + `ProfileAddress`**, each a real
  multi-row child table (type + value/fields + `isPrimary`), replacing the old
  one-row-per-profile `ProfileContact`. `ProfileDocument` (Identification) kept its existing
  shape but was upgraded from destructive `deleteMany+create` "replace-all" to real per-row
  CRUD, matching Communications/Address. **Rule: at most one primary per profile per
  resource type** — enforced server-side by demoting all siblings before setting a new
  primary, never client-trusted.
- **Communications value validation is type-aware**: EMAIL and MOBILE each have their own
  regex (`src/lib/profile-communications.ts`), SOCIAL just requires non-empty.
- **Attachments are a URL-referenced list, not real file upload** — owner confirmed this
  scope explicitly (no upload/storage infra exists elsewhere in the app to build on).
- **STAFF is a 4th `ProfileType`, independent of the `User` login/RBAC model** — owner
  confirmed explicitly. A Staff profile is purely a directory bucket (same fields as Guest);
  it has zero relation to who can log in or what they can do.
- **Company/Corporate profiles use a single `Name` field and skip Personal
  Information/Identification entirely** (`companyName` already existed on `Profile`; the
  form conditionally renders based on `profileType`) — per the owner's explicit follow-up
  ("Company and Corporate the personal information and identification is not needed, Name
  also would be just one single field"). All four profile types share one `Profile` table.
- **"Visits to Property" and "Visits to Property Chain" are live-computed, never stored
  columns** — `Profile` has no `propertyId` (shared enterprise-wide, same precedent as
  Debtors' per-property AR balance against a shared Profile), so a per-property visit count
  can't be a simple column. Computed on demand by the new `GET /api/profiles/[upid]/
  stay-history` endpoint from `Reservation` rows, filtered by `propertyId` when the caller
  has an active property in context.
- **`Profile.originPropertyId` is a set-once breadcrumb, not a scoping field** — captured
  from the caller's active property at creation time if it validates against the caller's
  enterprise, and never changed after. Profile itself stays enterprise-wide/unscoped; this
  field only answers "where was this profile first created."
- **Stay History (Future/History tab)** shows past+upcoming reservations with a per-stay
  revenue breakdown by charge code, computed from non-void folio line items
  (`amount + taxAmount + serviceChargeAmount`). Split: `RESERVED`/`IN_HOUSE` with a
  checkout date still in the future → Future; `CHECKED_OUT` → History.
- Migration `20260720140000_profile_communications_addresses` (additive) →
  `scripts/dev-tools/backfill-profile-communications.ts` (one-time, historical, ran
  successfully against all 5 existing `ProfileContact` rows) →
  `20260720150000_drop_profile_contact` (destructive, drops the old table) — same two-phase
  pattern as the earlier Base Rate Plan migration.
- 210/210 suite passing (13 new Profiles tests), `tsc --noEmit` clean.

## Negotiated Rate Plans restricted to specific agent profiles (2026-07-20)

Prompted by the app owner asking what `RatePlan.isNegotiated` (checkbox: "This is a
negotiated rate (Corporate/Wholesale)") actually did — **answer: nothing**, it was a
purely cosmetic flag (badge only) with zero gating anywhere, and no mechanism linked a
Rate Plan to a Profile at all. Per the owner's follow-up request, built the actual
restriction:

- **New join table `RatePlanAgentAccess`** (migration `20260720142424_rate_plan_agent_access`,
  additive, `@@unique([ratePlanId, upid])`) links a `RatePlan` to specific Company/Travel
  Agent `Profile`s. Only meaningful when `RatePlan.isNegotiated` is true; a negotiated plan
  with zero linked profiles is unselectable by anyone (not a bug — it means "negotiated but
  not yet configured," same as any negotiated plan with a non-matching travel agent).
- **Managed from the Profile side**, per the owner's explicit ask: a new "Negotiated Rates"
  section on the Company/Travel Agent `ProfileForm` (`isB2B`-only, mirrors the Guest-only
  CRM section's `isIndividual` gating) — a checkbox list of every negotiated Rate Plan
  across the enterprise's properties (`GET /api/profiles/[upid]/negotiated-rates`), grouped
  by property, saved via whole-set replace on each toggle (`PUT`, same convention as
  Preferences). Matching read-only summary added to the profile View page.
- **Enforced on the reservation form**: `GET /api/rate-plans` now also returns each plan's
  `negotiatedForProfileIds`. The Room Segments' Rate Plan selector filters out a negotiated
  plan unless the booking's own Booking Source/Travel Agent field
  (`Reservation.travelAgentId`) is one of that plan's linked profiles — a non-negotiated
  plan is never filtered, exactly as before. Group Block pickup is untouched (a block
  already carries its own fixed rate plan, no free-form selector to restrict).
  Revenue &gt; Rate Plans' list also gained a "N agents linked" / "No agents linked" badge
  next to "Negotiated" so an admin can see at a glance whether a negotiated plan is
  actually reachable by anyone yet.
- 212/212 suite passing (2 new tests in `tests/business-rules/negotiated-rates.test.ts`:
  linkage validation incl. rejecting a non-negotiated or cross-enterprise plan, and
  `negotiatedForProfileIds` exposure on the rate-plans list), `tsc --noEmit` clean.
  **Live-verified end-to-end**: created a Company profile and a negotiated Rate Plan via
  the real API, linked them via the real checkbox in the profile's Negotiated Rates
  section, opened New Booking and confirmed the plan was absent from the Rate Plan
  dropdown with no Travel Agent selected, then present (labeled "(Negotiated)") the moment
  that Company was selected as the Booking Source. Test data cleaned up afterward.

## Travel Agent commission, calculated and posted at checkout (2026-07-20)

Follow-up to Negotiated Rate Plans, per direct app-owner request: "make sure a
commission % amount can be set per rate plan - optional... once room rate is posted
and settled to city ledger for that account make sure commission is calculated if
eligible (use a commission charge code created under non revenue)."

- **`RatePlanAgentAccess.commissionRate`** (optional Float, 0-100, validated server-side)
  — the per-rate-plan-per-agent commission %, set in the same Negotiated Rates section
  on the Company/Travel Agent profile (checkbox reveals a "%" input). `GET/PUT
  /api/profiles/[upid]/negotiated-rates` restructured from a flat `ratePlanIds[]` to
  `links: [{ratePlanId, commissionRate}]` to carry it.
- **Commission is calculated at *checkout*, not Night Audit** — Night Audit always posts
  nightly charges to the reservation's own folio regardless of settlement method (see
  the "Debtors: checkout-triggered invoice pipeline redesign" entry above); a City-Ledger
  folio only becomes the account's actual debtor invoice (`isDebtorAccount: true`) at
  checkout. That is the moment "room rate is posted and settled to city ledger" the app
  owner meant, and the only correct place to calculate a commission against real, final
  room revenue.
- **`FolioLineItem.roomAssignmentId`** (new nullable FK to `RoomAssignment`, additive) —
  Night Audit now tags the Nightly Room Charge and Extra Occupancy Charge lines with
  which assignment/segment posted them. Needed because a split-stay reservation can span
  more than one Rate Plan; without this tag there'd be no way to attribute posted room
  revenue back to the specific plan (and therefore the specific commission rate) that
  earned it. `src/lib/commission.ts`'s `calculateFolioCommission` is the pure function
  that does this attribution (assignment → rate plan → commission link → this rate
  plan's own room-revenue share × its own %), independently unit-tested.
- **Posted as a *negative* line (a credit) on the same debtor folio**, using the
  enterprise's configured Commission charge code (`EnterpriseSettings.
  commissionChargeCodeId`, new Controls > Finance selector) — reduces the net amount the
  agent's invoice shows, which is the correct real-world treatment (the hotel owes the
  agent the commission; there's no separate Accounts-Payable ledger in this app to record
  it against instead, so crediting the same invoice nets it correctly and is the standard
  small-PMS convention for negotiated/wholesale settlement). **Flagged explicitly to the
  app owner as the one modeling assumption made without an explicit answer** — if the
  intended treatment is actually a separate payable that does *not* reduce what the agent
  is invoiced, this needs revisiting.
- **"If eligible" is enforced at three independent gates**, any one of which silently
  disables commission (no error, since it's meant to be optional): (1) the linked rate
  plan actually has a `commissionRate` set for this specific agent — being merely listed
  in Negotiated Rates isn't enough; (2) `EnterpriseSettings.commissionChargeCodeId` is
  configured at all — leaving it unset disables commission posting enterprise-wide; (3)
  the folio is actually finalizing to a debtor account at this checkout
  (`qualifiesForAccount`) — a DIRECT-settlement or guest-payable stay never triggers it
  regardless of any commission rate on file.
- **New `NON_REVENUE` charge-code category** (Controls > Finance > Charge Codes) so a
  Commission code doesn't inflate room/F&B revenue reporting — added to both the UI
  constant and the **separate server-side allowlist** in `src/app/api/charge-codes/
  route.ts` / `[id]/route.ts` (a real bug caught live: the UI would have offered the
  category but the API rejected it with "Invalid category" until both lists were
  updated).
- 217/217 suite passing (5 new tests in `tests/business-rules/commission.test.ts`: pure
  attribution/eligibility math, and a full checkout-route integration test for the
  posted-credit case, the no-charge-code-configured case, and the no-commission-rate-
  linked case; `negotiated-rates.test.ts` updated for the new `links[]` payload shape).
  `tsc --noEmit` clean.
- **Live-verified end-to-end against the real Veyo dev database**: created a `COMM`
  charge code (category Non-Revenue) via the real Add Charge Code dialog, set it as the
  Commission Charge Code in Controls > Finance, created a Travel Agent profile and a
  negotiated Rate Plan, checked the box and typed `15` into the real commission-%
  input in the profile's Negotiated Rates section (confirmed persisted via a fresh
  fetch), booked a real reservation on that plan with a $250 override rate, checked it
  in, ran a real Night Audit (posted $194.25 base room revenue after Maldives tax
  back-out, tagged with the assignment's id), then checked out and confirmed the
  response returned `commissionsPosted: [{amount: 29.1375, agentName: "Commission Test
  Agency"}]` (194.25 × 15%) and the folio gained a real `-29.1375` line item against
  `COMM`, dropping the Debtors account balance from what it would otherwise have been.
  Cleaned up the test reservation's side effects afterward (Night Audit had flipped an
  unrelated pre-existing reservation, RES435395, to NO_SHOW as an incidental side effect
  of running a real audit in the shared dev database — reinstated it to RESERVED).
  **Left in place, not test pollution**: the `COMM` charge code and the Commission
  Charge Code setting are the actual feature configuration, not throwaway test
  artifacts. **Not fully cleaned up**: the test reservation (VBR0000000003, checked out,
  real charges) couldn't be deleted per the existing checked-out delete-guard, and its
  linked test Travel Agent profile *was* deleted successfully — this is the same
  pre-existing "dangling payeeProfileId" gap already flagged under Debtors above, not a
  new one.

## Price Calendar bulk-update: silent no-op on an inverted date range (2026-07-20)

Reported by the app owner as "cannot update any price now" — first suspected of being a
regression from the earlier From/To date-picker split (splitting the combined range
picker into two independent single-date pickers made an inverted range trivially
reachable: pick a "To" before the "From" already set, which the old combined
range-select picker structurally couldn't produce). Investigation found **two separate
real bugs**, not one:

- **`POST /api/price-calendar/bulk`** (the Rate Details "Bulk Seasonal Pricing Tool",
  `src/components/revenue/bulk-pricing-tool.tsx`) had no guard against `start > end` at
  all. Its date-generation `while` loop simply never executed, `datesToUpdate` stayed
  empty, and an **empty Prisma transaction trivially "succeeds"** — the route returned
  `{success: true, message: "Successfully updated 0 price records."}` with a 201. The
  frontend just alerted `data.message` verbatim, so a distracted read looked exactly
  like "no error, but nothing happened." This is almost certainly what the app owner
  hit. Fixed: explicit `start > end` check (400, clear message) plus the same 2-year
  range ceiling the sibling endpoint already had (no cap previously existed here either
  — a valid-but-huge range risked an oversized transaction).
- **`POST /api/price-calendar`** (the Price Calendar page's own single-room-type Bulk
  Update sidebar, `src/app/e/[slug]/dashboard/revenue/calendar/page.tsx`) already
  rejected an inverted range with a real 400, but the frontend's error handler
  swallowed the reason behind a generic "Failed to update prices." alert (fixed
  earlier the same session) and had no client-side pre-check, so the round-trip was
  needed just to find out what was wrong.
- **Client-side guards added to both forms** (`from > to`, missing From/To) so the
  wrong case is caught before a network round-trip, with a message that actually
  names the problem.
- **New: Price Calendar auto-navigates to the applied range's month on a successful
  bulk update.** Splitting the picker in two makes it easy to set a From/To in a month
  the grid isn't currently showing — previously a successful write left the visible
  grid unchanged (still "No Rate" for whatever month was on screen), which reads
  exactly like "no error, but doesn't update" even when the price was written
  correctly. Not a bug in the write path, but a real, reproducible UX trap worth
  closing.
- **5 new tests** in `tests/business-rules/price-calendar-bulk.test.ts` (inverted-range
  rejection + zero-rows-written assertion for both endpoints, oversized-range rejection
  for the bulk endpoint, and a valid-range row-count sanity check for both). 222/222
  suite passing, `tsc --noEmit` clean. **Live-verified end-to-end** against the real
  Veyo database: reproduced the exact original failure via direct API calls against
  both endpoints (confirmed the bulk endpoint really did return 201/0-rows pre-fix, and
  a clear 400 post-fix); then drove the real Price Calendar UI through the full
  cross-month scenario — set From 05 Aug / To 10 Aug while the grid was showing July,
  submitted, and confirmed the grid auto-jumped to August and displayed the correct
  $88.00 across Aug 5–10.

## Price Calendar range bumped to 10 years + negative-amount hardening (2026-07-20)

Follow-up to the above, per direct app-owner request: "why is it limited to two years?
set the maximum date range to 10 years min 1 day, proper validation as well end date
cannot be less than begin date... no negative rate amounts."

- **Shared `MAX_PRICE_CALENDAR_RANGE_DAYS`/`_YEARS` constant** added
  (`src/lib/price-calendar.ts`, `365 * 10`) and used by both `/api/price-calendar` and
  `/api/price-calendar/bulk` instead of each hardcoding its own `365 * 2` — avoids the
  two endpoints drifting apart again the way the "2 years" cap did.
- **`/api/price-calendar/bulk` gained the negative-price/extra-price check it never
  had** (`price < 0 || extraAdultPrice < 0 || extraChildPrice < 0` → 400) — the
  single-room endpoint already had this via its Zod schema (`z.number().min(0)`), but
  the bulk endpoint parsed with plain `parseFloat` + only a `isNaN` check, silently
  accepting a negative price before now.
- Min-1-day is unchanged (already enforced — `totalDays < 1` / an inverted-range check
  — this session's earlier fix), just re-confirmed with an explicit same-day-range test.
- 9 new tests added to `tests/business-rules/price-calendar-bulk.test.ts` (min-1-day,
  exact-boundary accept-at-10-years / reject-one-day-over for both endpoints via a
  computed boundary date rather than a hardcoded one, negative price/extra-price
  rejection for both endpoints). 228/228 suite passing, `tsc --noEmit` clean.

## Rate Plan: Complimentary / House Use flags (2026-07-20)

Per the same request: "please also set two tickbox on rate plan level to mark them as
complimentary, house use." Added as **pure classification labels, deliberately with no
posting/reporting behavior wired yet** — same starting point `isNegotiated` had before
its Negotiated Rates follow-up (see above). `RatePlan.isComplimentary` /
`RatePlan.isHouseUse` (migration `20260720162039_rate_plan_comp_house_use`), two new
checkboxes in the Rate Plan dialog (disabled on the locked Base plan, like the existing
Negotiated checkbox), and matching badges on the Rate Plan list. 1 new test in
`base-rate-plan.test.ts` (create + update round-trip, defaults to false when omitted).
**Flagged, not fixed** (see the redundancy audit the owner also asked for, same
request): neither flag currently stops Night Audit from posting a real nightly charge —
a "Complimentary" or "House Use" rate plan bills exactly like any other unless staff
also manually zero the room's `overrideRate`. Revisit when/if the owner wants automatic
$0 posting tied to these flags.

## Redundancy audit: Revenue / Rate Plan / Reservation (2026-07-20)

Per the owner's open question in the same request ("anything else that you feel i have
made redundant..."), a full audit turned up:
- **`Profile.commissionRate` is a dead, never-read field** (superseded by
  `RatePlanAgentAccess.commissionRate`) — was still shown as an editable "Commission
  Rate (%)" field on Company/Travel Agent profiles, and read-only on the profile detail
  page. **Fixed 2026-07-20** during the full Revenue/Profiles review pass: removed both
  UI displays (a user filling it in would reasonably assume it affects payouts; it did
  nothing). The schema column and API accept/store it unchanged (harmless, and dropping
  it is a separate migration decision) — only the misleading UI is gone.
- **No mutual-exclusivity guard** between `isComplimentary`/`isHouseUse`/`isLocked`/
  derived — a plan can be ticked as both, or House Use + derived, with no warning.
  Matches point above (not wired yet); flagging so it's not forgotten when it is.
- **`Reservation.mealPlan` and a Derived Rate Plan's own name/composition (e.g.
  "BAR-BB") are two independent, unsynced pickers** — booking on a "BB"-suffixed rate
  plan doesn't pre-select or suggest the matching Meal Plan. By design per the existing
  Meal Plan/Derived Rate Plan decoupling, but worth a UI hint someday.
- **No seed/onboarding path sets up a Commission charge code** — every new enterprise
  has commission posting silently disabled until an admin finds Controls > Finance and
  configures one. Minor onboarding gap, not urgent.
- Checked and found **no drift** between the two Price Calendar endpoints, and **no
  charge-code miscategorization** worth moving to `NON_REVENUE`.

## Price Calendar page: multi-room-type Bulk Update (2026-07-20)

Per direct app-owner request: the Price Calendar page's own Bulk Update sidebar only
ever wrote to whichever single Room Type was selected in the Configuration card,
forcing the whole select-room-type → set-range → set-price → Apply cycle to be
repeated once per room type. Rate Details' "Bulk Seasonal Pricing Tool" already solved
this with a room-type checkbox list backed by `/api/price-calendar/bulk`
(`roomTypeIds[]`) — ported that same pattern into the Price Calendar page instead of
maintaining two different UX patterns for the same underlying action.

- New `bulkRoomTypeIds` state, independent of the Configuration card's single Room Type
  selector (which now only controls what the grid *displays*, not what Apply Prices
  writes to). Defaults to the currently-viewed room type whenever that selector
  changes, with a "Select all" / "Clear all" toggle to expand from there.
- `handleBulkUpdate` now posts to `/api/price-calendar/bulk` (not the single-room
  `/api/price-calendar`) with the checked room type list — same validation, same
  auto-navigate-to-month behavior from the earlier date-range fix, unchanged.
- The Rate Plan pre-selection from the Rate Plans list's "Calendar" link
  (`?ratePlanId=`) was already working correctly before this change — confirmed, not
  touched.
- `tsc --noEmit` clean, full suite 228/228 (no dedicated new tests — this is a pure UI
  wiring change onto an endpoint the Rate Details tool already exercises).
  **Live-verified**: checked both room types via Select All, applied a price to July
  20–31 in one Apply Prices click, got "Successfully updated 24 price records" (12 days
  × 2 room types), and confirmed via a direct API read that the room type *not* being
  viewed in the grid (Overwater Suite) received the identical price.

## Price Calendar page: Configuration panel redesign (2026-07-20)

Direct app-owner correction on the multi-room-type redesign above, from a screenshot
circling the Configuration card: "when i click calender here - it takes me to a generic
price calender page - but it needs to take the rate withi it so i don't have to take the
rate again in config part - make it simple... the select rate should show and be loced
cannot swithc no need to show it twice - the calender view section header part you can
have a toggle switch buttons to switch between different room types."

- **Rate Plan `<Select>` in Configuration is now locked/disabled** (shows the plan the
  page was entered with via a specific Rate Plan's "Calendar" link, no `onValueChange`).
  Reason: the page is always entered scoped to one rate plan, and Bulk Update always
  writes against that same plan — letting staff switch it there would silently desync
  what the grid displays from what Apply Prices actually writes to.
- **Removed the duplicate Room Type `<Select>` from the Configuration card entirely** —
  it was redundant with the Bulk Update sidebar's own room-type checkbox list added in
  the entry above.
- **Room-type switching moved to a toggle-button group in the Calendar Grid's own
  header** (one button per room type, `default`/`outline` variant reflecting selection)
  — controls only what the grid *previews*, fully independent of Bulk Update's
  multi-select checkboxes which control what gets *written*.

## Allocation Calculation mode: Meal Plan vs Rate Plan level (2026-07-20)

Per direct app-owner request, added a top-level per-property toggle in
Controls > Revenue ("Allocation Calculation") deciding which side drives automatic
Allocation attachment on a reservation. Two live examples were walked through with the
owner and confirmed before implementation:

- **Meal Plan level** (`Property.allocationCalculationMode = "MEAL_PLAN"`): the
  reservation's selected Meal Plan is the only source of automatic allocations (e.g. a
  "BB" meal plan linked to the `BF` Breakfast allocation in Controls > Revenue > Meal
  Plans auto-attaches `BF`). A Rate Plan's own Package Allocations (Revenue > Rate Plans)
  are **disabled and never post**, even if configured.
- **Rate Plan level** (`"RATE_PLAN"`, the schema default): the assigned Rate Plan's own
  Package Allocations drive what attaches. The reservation's Meal Plan field becomes
  display-only — it never affects posting.
- **Exclusive, not additive** — this replaced `resolveLinkedAllocationIds`'s prior
  behavior of combining both rate-plan-linked and meal-plan-linked allocations with
  dedup-by-id. Confirmed with the owner this was intentional, not a bug to preserve.
- **Scope confirmed by the owner**: per-property (not enterprise-wide) — different
  properties in the same enterprise can run different modes. **Not retroactive** —
  switching only affects reservations created or edited *after* the change; existing
  bookings keep whatever allocations they already materialized. A "refresh rate" tool to
  re-apply the current mode to an already-booked reservation is planned but explicitly
  **not built in this pass**.
- Implementation: `Property.allocationCalculationMode` (migration
  `20260720172019_allocation_calculation_mode`, default `"RATE_PLAN"`);
  `resolveLinkedAllocationIds` (`src/lib/allocations.ts`) takes a required `mode` param
  and branches exclusively; `materializeReservationAllocations`
  (`src/lib/allocations-server.ts`) fetches the property's mode and passes it through;
  reservation-form client-side allocation preview mirrors the same branch; new
  `AllocationCalculationManager` component in Controls > Revenue.
- 14 tests in `tests/business-rules/allocations.test.ts` (pure-function exclusivity for
  both modes, materialization integration tests for both modes including the
  default-when-unset case). Full suite 230/230 passing.
- **Live-verified against the real Veyo database**: set Veyo to `MEAL_PLAN` mode, linked
  a Package Allocation (`TRF-AIR`) to the `BAR` rate plan (which had none previously) and
  confirmed `BB` meal plan already had `BF` linked from seed data, then created a real
  reservation with `ratePlanId: BAR` and `mealPlan: BB`. Result: only `BF`
  (`source: "MEAL_PLAN"`) attached; `TRF-AIR` did not — matching the mode's contract
  exactly. Test reservation, the `TRF-AIR`→`BAR` link, and the mode override were all
  cleaned up afterward; Veyo is left at the `RATE_PLAN` default.

## Full Revenue/Profiles review pass — bugs found and fixed (2026-07-20)

Per direct app-owner request, once Revenue and Profiles felt feature-complete: "act as a
senior code reviewer to check for bugs and missing links... fix those issues." Went
file-by-file through every Revenue and Profiles change made this session (schema,
migrations, API routes, components, pages). Findings:

- **Missing `/e/{slug}` prefix on client-side navigation — a real, recurring bug
  class.** Two confirmed instances, both fixed:
  - Revenue > Rate Plans' "Calendar" link (`revenue/page.tsx`) built
    `/dashboard/revenue/calendar?ratePlanId=...` with no enterprise-slug prefix. The
    bare `/dashboard/...` path only resolves through a legacy backward-compat redirect
    (`src/app/dashboard/[[...rest]]/page.tsx`) that preserves the sub-path but **drops
    the query string** — so the Price Calendar always silently defaulted to whichever
    rate plan sorts first (`NRF`, priority 0), no matter which plan's Calendar link was
    actually clicked. Root-caused live in the browser (clicking BAR/COMMTEST always
    landed on "Non-Refundable"). Fixed by pulling `slug` via `useParams` and prefixing
    the link; verified BAR and COMMTEST each now show their own plan/pricing.
  - The Profiles dashboard (`profiles/page.tsx`) had the identical bug in **six**
    places — every row-click, Edit button, and the "New {type}" button all pushed bare
    `/dashboard/profiles/...` paths. Path-only navigations (profile view/edit) still
    worked via the same redirect since there's no query string to lose, but the "New
    Company" / "New Travel Agent" / "New Staff" buttons pass `?type=...` — which got
    dropped, so **every "New X" button silently opened a New Guest form instead**
    (`new/page.tsx` defaults `type` to `"GUEST"` when the param is absent). Fixed the
    same way; verified `?type=TRAVEL_AGENT` now survives end to end.
  - Grepped the whole `src/` tree afterward for the same anti-pattern
    (`push(\`/dashboard/`) — no other instances found.
- **`Profile.commissionRate` dead-field UI removed** (see the Redundancy audit entry
  above, which had flagged but not acted on this) — it actively misled Company/Travel
  Agent profile users into thinking it affected payouts.
- Everything else audited clean: all Profiles child-resource routes (communications,
  addresses, documents, notes, attachments, preferences, negotiated-rates,
  stay-history) — consistent tenant scoping, validation, and "at most one primary"
  handling; Rate Plan locked/negotiated/complimentary/house-use logic; Allocation
  Calculation mode's client/server exclusivity; Price Calendar's date-range/negative-
  price guards; the full commission attribution and posting pipeline; charge-code
  `NON_REVENUE` category consistency across all three places it's declared; the
  Preferences/Room Preferences LOV merge (confirmed zero remaining `ROOM_PREF`
  references anywhere).
- Two minor, non-live-bug items intentionally left as-is (unreachable through any
  current UI path, and per this project's "don't validate scenarios that can't
  happen" convention): `RatePlanAgentAccess` bulk-replace could theoretically 500 on a
  duplicate `ratePlanId` in the request body (the checkbox-driven UI can't produce
  one); `SystemCodeMultiSelect`'s fetch-once ref would get stuck if the same instance
  were reused with a changing `category` prop (both current call sites are static).
- Full suite 230/230 passing, `tsc --noEmit` clean after all fixes.

## Reservation booking dialog: Look-to-Book redesign (2026-07-21)

Per direct app-owner request ("review the reservation creation flow... do your research
on Opera Oracle Hospitality App how reservation module works and come up with a
beautiful adjustment"). Modeled on OPERA Cloud's Look to Book Sales Screen (stay
criteria → rate/availability grid → guest & booking details → Book Now), adapted to
what this app already has. Design confirmed by the owner before building: the grid
REPLACES the old room-type/rate-plan dropdowns (not offered alongside them), and
Special Requests use a proper join table (owner chose this over a JSON column).

- **New flow order** in the same single dialog (widened to 920px): "1 · Stay" (arrival/
  departure/occupancy + Booking Source, which moved up because it gates negotiated
  rates), "2 · Room & Rate" (the grid), "3 · Guest & Details", "4 · Allocations &
  Add-ons", and an estimated-total footer (room + extra occupancy + allocations,
  labeled est., excl. taxes).
- **`GET /api/reservations/rate-availability`** powers the grid in one round trip:
  per room type the minimum sellable-room count across every night of the window
  (OPERA's "minimum stay availability"; pseudo types exempt/unlimited; supports
  `excludeReservationId` so an edit doesn't count the reservation's own holds against
  itself) and per rate plan × room type the total/avg-nightly price. Pricing mirrors
  Night Audit's resolution chain EXACTLY (derived plan → parent entry + adjustment;
  missing entry → locked Base plan fallback; extra-occupancy from the assigned/parent
  plan's own entry only) so the quote can never disagree with what posts. One
  deliberate difference: a fully-unpriced night is reported (cell shows "No rate")
  instead of Night Audit's post-$0 behavior. 365-night query cap.
- **Grid behavior**: rows = rate plans by priority, columns = room types with "N left"
  / "Sold out {date}" headers; sold-out cells struck through and disabled; negotiated
  plans appear only when the selected TA unlocks them (same RatePlanAgentAccess gating
  as before, now controlling grid rows); clicking a cell fills the ACTIVE segment's
  room type + rate plan together. Split stay preserved: each segment card is clickable
  to become active, the grid re-quotes for that segment's own date range (OPERA Trip
  Composer, simplified), and per-segment date pickers only appear when there's more
  than one segment. Room number + flat override rate stay per-segment.
- **Status dropdown removed from the dialog entirely** — a new booking is always
  RESERVED and transitions go through Check-In/Check-Out/Cancel actions; the PUT
  route's status field became optional (schema `z.string().optional()`) with the
  change-rejection guard intact, and edit mode shows a read-only StatusBadge in the
  header instead.
- **Special Requests**: `ReservationSpecialRequest` join table (migration
  `20260721084759_reservation_special_requests`; `code` stores the SPECIAL_REQUEST
  SystemCode code string, same convention as Profile.vipLevel — this is the "will be
  later linked with reservations" follow-through from the LOV category created
  2026-07-20). Tappable chips in the dialog; validated server-side against active
  codes (shared `validateSpecialRequestCodes` in src/lib/special-requests.ts); PUT
  replaces the set only when the field is sent. Seeded five starter options.
- Also removed dead `availableRooms` state (fetched via /api/rooms/available but never
  read anywhere).
- 9 new tests (`rate-availability.test.ts`: Base-fallback pricing, derived adjustment,
  extra-occupancy parity with Night Audit, min-availability + excludeReservationId,
  inverted-range rejection; `special-requests.test.ts`: create/dedupe, unknown+inactive
  rejection, PUT replace-vs-omit semantics, status-optional PUT). Full suite 239/239,
  `tsc --noEmit` clean. Live-verified in the browser: grid renders real prices for the
  quoted range with availability counts, negotiated plan hidden without a TA, cell
  click moves the selection and the footer recomputes (4 nights × $175 + HB
  allocations = $860 est.), special requests round-trip via API confirmed (invalid
  code 400s).

## Booking dialog → dedicated pages, allocation calculation breakdown, full tax breakdown (2026-07-21)

Three direct follow-ups on the Look-to-Book redesign above.

- **Dialog → pages**: the create/edit form is no longer a modal — it's now
  `/reservations/new` and `/reservations/[id]/edit`, both rendering a shared
  `<BookingForm>` (`src/components/reservations/booking-form.tsx`). Reason: with more
  room types the rate grid didn't have room to breathe inside a fixed-width dialog.
  Added `GET /api/reservations/[id]` (didn't exist before — edit only had PUT/DELETE)
  so the edit page can fetch its own data instead of relying on the list's in-memory
  copy. The list page (`reservations/page.tsx`) shrank from ~1490 to ~590 lines —
  "New Booking"/"Edit" are now plain links; every piece of form state, the grid effect,
  and the allocation preview moved into `BookingForm`. Delete/Special-Request/Folio/
  Notification stayed as dialogs on the list page — out of scope, still small and
  contextual to a specific row.
- **Layout**: two-column — the 4 numbered sections on the left, a sticky "Booking
  Summary" sidebar on the right (stay recap, room/rate per segment, allocations,
  taxes, grand total). This sidebar is the new home for both asks below.
- **Allocation calculation breakdown** (`allocationStayBreakdown` in
  `src/lib/allocations.ts`): walks the exact same rhythm/rate resolution as
  `allocationAmountForNight`/`allocationStayTotal` night-by-night instead of collapsing
  straight to a total, grouping consecutive nights that share a unit price into
  segments (a mid-stay seasonal rate change produces two segments, not one wrong
  average). Rendered per attached allocation as e.g. "1 adult × $10.00 = $10.00/night
  × 2 nights (every night) = $20.00"; a rhythm-qualifying night with no rate configured
  is called out separately ("N night(s) had no rate configured — not charged") instead
  of silently vanishing into the total.
- **Full tax breakdown**: the old footer only estimated a room+extras+allocations
  total with "excl. taxes" — now backed by a genuine server-side dry-run,
  `computeReservationQuote` (`src/lib/reservation-quote-server.ts`, exposed at
  `POST /api/reservations/quote`), which projects the ENTIRE stay (not just tonight)
  through the identical resolution chain Night Audit posts with: derived-plan
  adjustment, locked Base-plan fallback, INCLUDE_IN_RATE carve-out before tax, each
  charge code's own tax handling (`resolveChargeTax` — default Service Charge/GST
  engine or a Custom Tax profile, per charge code), and flat Green Tax. Every
  `TaxBreakdownLine` from every room/extra-occupancy/allocation charge is aggregated
  by name across the whole stay, so the summary shows one "Service Charge (10%)" line
  and one "GST (17%, compound)" line (or whatever a Custom Tax profile's own named
  lines are) rather than one per charge instance — Green Tax is listed separately
  since it never goes through the tax engine. Nothing is written; this is a pure read,
  debounced off `assignments`/`adults`/`children`/`mealPlan`/`manualAllocationIds`.
- 23 new tests (`allocationStayBreakdown`: single/multi-segment grouping, rhythm
  gating, unpriced-night reporting; `computeReservationQuote`: Service Charge + GST
  math against Night Audit's own formula, a Custom-Tax-profile allocation kept
  separate from the room's default engine, Green Tax flat math, tax-inclusive price
  back-out reconstructing the original gross, override-rate replacing the calendar
  price, unpriced-night warning). Full suite 248/248, `tsc --noEmit` clean.
  Live-verified: `/reservations/new` and `/reservations/[id]/edit` render as real
  pages (no dialog in the DOM); picking BAR × Deluxe Beach Villa for Aug 1-3 showed
  "Service Charge (10%) $18.64 / GST (17%, compound) $34.88 / Green Tax
  (1×$12.00 × 2n) $24.00 / Grand Total $264.00"; switching to Bed & Breakfast showed
  the Breakfast allocation's own line "1 adult × $10.00 = $10.00/night × 2 nights
  (every night) = $20.00" while the grand total stayed $264.00 (the allocation's value
  moved from the room line to its own line via the INCLUDE_IN_RATE carve-out, exactly
  as designed) confirmed via direct API round-trip.

## Reservations — date validation & occupancy override (2026-07-21)

- **Departure cannot precede (or equal) arrival — hard validation, not just a rejection
  after the fact.** Bug report was a screenshot showing Arrival 01 AUG 2026 next to
  Departure 30 JUL 2026 with a "0 Nights" badge. Fixed with three layers in
  `src/components/reservations/booking-form.tsx` and
  `src/components/ui/date-picker.tsx`: (1) `DatePicker` gained a `minDate` prop that
  hard-disables invalid days in the calendar itself via react-day-picker's
  `disabled={{ before: minDate }}` — so an inverted range can't even be picked, not
  merely flagged after selection; every "To"/Departure picker (top-level and per
  split-stay segment) now passes `minDate = dayAfter(startDate)`. (2) Changing an
  Arrival/segment-start date that would make the current end date invalid
  auto-clears that end date rather than leaving a stale invalid value sitting in
  state. (3) `handleSubmit` still guards
  `form.assignments.some(a => a.endDate <= a.startDate)` as a final backstop. All
  three layers live-verified together, including the "moving Arrival past an
  already-set Departure auto-clears Departure" edge case.
- **Occupancy: base vs. max are two different concerns, not one.** App owner's
  verbatim ask: guests over a room type's *base* occupancy should incur an
  extra-person charge (already handled by the existing quote engine — see the
  Allocations entry above), but guests over *max* occupancy needed something new.
  Asked the owner whether a different UX would be easier to understand than a
  charge-based override; proceeded with the simplest option (a checkbox) rather than
  waiting, since it was already the lowest-friction pattern available. Design:
  max-occupancy is a hard physical/legal capacity limit — when `adults + children`
  for a segment exceeds its room type's `maxOccupancy`, a destructive-styled banner
  appears in Room & Rate naming the offending room type(s) and their max, with an "I
  understand and want to book this anyway" checkbox
  (`form.acknowledgeOverCapacity`). `handleSubmit` blocks (no toast side effects
  beyond the validation notification) until it's checked; the ack auto-resets via a
  `useEffect` keyed on total occupants + assigned room-type ids, so it can't be
  checked once and silently carried through an unrelated later change. The Room &
  Rate grid's column header also gained a small "Occ. {base}–{max}" hint per room
  type so limits are visible before picking, and Section 1 (Stay) gained a one-line
  explainer of the base-charge vs. max-override distinction. Live-verified
  end-to-end: submission silently blocked with the checkbox unchecked, then a real
  `POST /api/reservations → 201 Created` after checking it (test reservation
  `VBR0000000006` deleted afterward). Full suite 248/248, `tsc --noEmit` clean.

## Reservations — split-stay contiguity, scheduled room move, pax-capped accompanying guests, guest picker (2026-07-21)

- **Split-stay segments must be back-to-back with no gaps.** App owner's rule,
  verbatim: "segmentation always have to be consecutive dates i.e first segment from
  1-2Aug then second segment must be from 2 onwards - there should not be any
  breaks." Implemented as a hard *lock*, not just validation: in
  `src/components/reservations/booking-form.tsx`, every segment after the first has
  its "From" `DatePicker` rendered `disabled`, with a caption ("Locked to Segment
  N's departure"). A reconciliation `useEffect` cascades forward whenever any
  segment's dates change (edit/add/remove) — forcing `assignments[i].startDate =
  assignments[i-1].endDate`, clearing a now-invalid `endDate` if needed, and
  re-deriving the top-level `checkInDate`/`checkOutDate` from the chain's two
  endpoints. `handleSubmit` keeps a matching backstop guard. Enforced server-side too
  via the new `assignmentsAreContiguous()` helper
  (`src/lib/reservation-assignments.ts`), called from both `POST /api/reservations`
  and `PUT /api/reservations/[id]` — a client bypassing the UI still gets a 400.
- **"Scheduled room move"**: when a split stay's segments assign different physical
  rooms (owner: "if the room is different the reservation must be flagged with
  having a 'scheduled room move'"), this is a *booking-time-planned* mid-stay room
  change — distinct from the existing ad-hoc "Move Room" action
  (`room-move-modal.tsx` / `[id]/room-move/route.ts`), which only ever acts "as of
  today" and is unrelated to a reservation's own segment structure. No execution step
  is needed for the scheduled case — the correct room is already baked into the
  reservation's `RoomAssignment` rows from creation; this is purely a heads-up.
  Design (chosen via `AskUserQuestion`, "badge + worklist" over badge-only or full
  automation): added `Reservation.hasScheduledRoomMove` (migration
  `20260721105555_add_reservation_scheduled_room_move`), computed at create/update
  time via `detectScheduledRoomMove()` (same helper file, compares adjacent
  segments' `roomId` after sorting by `startDate`) and stored so the Front Office
  dashboard doesn't need to recompute it by joining every reservation's segments on
  every load. Surfaced as: (1) a "Room Move" badge next to the status badge on the
  Reservations list (`reservations/page.tsx`); (2) an in-form preview badge on the
  affected segment card in the booking form (client-side mirror of the same
  comparison, before save); (3) a new **"Room Moves Due Today"** tab on the Front
  Office dashboard (`front-office/page.tsx`, sourced from
  `/api/front-office/summary`) — for each in-house reservation with a segment
  starting today, checks whether the immediately-preceding segment (same
  reservation, `endDate === this startDate`) used a different room, and lists
  guest/conf#/from-room/to-room/new-room-type. No "execute" action — informational
  only, so staff can coordinate the physical move (luggage, keys, housekeeping).
- **Accompanying guest cap = adults + children − 1.** Owner's ask: "cannot attach
  accompanying guest more than defined no of pax." Clarified via `AskUserQuestion`
  that "no of pax" means total occupants minus the primary guest's own slot (not
  adults-only, not uncapped). `AccompanyingGuest` already existed
  (`prisma/schema.prisma`) with no cap previously enforced anywhere. Enforced in the
  booking form (hides the add-picker once the cap is hit, shows "X / Y pax" and a
  "Max reached" explainer instead) and, as a hard stop, in both `POST
  /api/reservations` and `PUT /api/reservations/[id]` (400 if
  `accompanyingGuestIds.length` exceeds the cap) — a client bypassing the UI still
  can't exceed it.
- **Guest selection via search-and-quick-create modal, not the 50-row
  `SearchableSelect`.** Owner's ask: "open a modal - user can search based on first
  name, last name, email, address for existing profiles - if existing not there in
  the same screen give option to quick create a profile and select them without
  breaking the reservation creation flow." Built `GuestPickerModal`
  (`src/components/reservations/guest-picker-modal.tsx`), reused for both Primary
  Guest and Accompanying Guest (an open/close mode flag, not two components) —
  debounced server-side search against `GET /api/profiles`, whose `search` `OR`
  clause was extended to also match `ProfileCommunication.value` (email/phone) and
  `ProfileAddress.fullAddress`, not just name fields. Quick-create is an inline
  sub-form (First Name required — matches the Profile API's actual minimum; Last
  Name/Email/Phone optional) that `POST`s `/api/profiles` and immediately selects the
  new profile without navigating away. The Primary Guest's native-`required`-input
  trick from the prior segment was dropped in favor of an explicit `handleSubmit`
  guard (`if (!form.primaryGuestId) ...`) — simpler and avoids relying on
  browser-native validation quirks.
- All four changes live-verified: segment lock (Segment 2's "From" shown disabled
  and captioned, locked to `05 AUG 2026`); guest picker (searched
  "david.williams" by email → filtered to one match → selected → "Primary Guest:
  David Williams"; quick-created "Quicktest Guest" → appeared via `GET
  /api/profiles`, cap correctly prevented auto-attaching it as accompanying since
  cap was 0); pax cap ("0 / 0 pax" + "Max reached" text with 1 adult, 0 children);
  scheduled room move (`POST /api/reservations` with segments in Room 101 then 102
  → `hasScheduledRoomMove: true` → "Room Move" badge rendered on the Reservations
  list next to "RESERVED"). 9 new tests added
  (`tests/business-rules/reservation-segments.test.ts`): pure-function contiguity/
  room-move-detection cases, `POST` rejecting gapped segments, `POST` tagging
  `hasScheduledRoomMove` true/false correctly, `POST` rejecting an over-cap
  accompanying-guest list, and a `PUT` round-trip re-validating contiguity and
  recomputing the flag. Full suite 257/257, `tsc --noEmit` clean. All test
  reservations/profiles created during verification deleted afterward.

## Osta platform-admin console (2026-07-21)

Owner's ask, verbatim: Osta is "a top Enterprise that manages all the Enterprises and
sees the properties registered under them," not a PMS itself. Three concrete
requirements: (1) a tenant can create as many properties as they want, but each one
"has to approve it from admin side" before use; (2) Osta manages "licenses (add-ons)
that can be enabled and disabled for that particular enterprise"; (3) Osta needs its
own completely different UI/UX, plus DB health and performance visibility. A lot of
adjacent plumbing already existed and was reused rather than duplicated:
`Enterprise.type` INTERNAL/STANDARD + `ctx.isInternal`, a full `SupportAccessGrant`
request/approve/deny/revoke/enter workflow, and an `EnterpriseLicense`/
`TierModuleAccess` scaffold that was previously unenforced ("fails open... scaffold
only, not real enforcement" per its own old comment).

Three architecture-defining choices were confirmed via `AskUserQuestion` before any
code was written (recorded here since they're not obvious from reading the code):

- **Property approval is a hard gate**, not just an audit trail. A newly-created
  property is written `status: "PENDING"` (`POST /api/properties`) and is fully
  locked out of real use — `assertPropertyAccess()` in `src/lib/scope.ts` now rejects
  (403) any non-`ACTIVE` property, and since that one function is the chokepoint
  called by ~70+ existing routes (reservations, rooms, rate plans, ...), this single
  edit propagates the gate everywhere with no per-route changes. The property
  switcher (`resolveCurrentPropertyId`, `GET /api/session/current-property`) also
  filters to `status: "ACTIVE"` so a pending property never becomes the "current"
  one. **Existing properties are unaffected** — `status` keeps its `@default("ACTIVE")`,
  so the hard gate only ever applies going forward to new tenant-created properties;
  only `POST /api/properties` was changed to start writing `PENDING` instead of
  relying on the default. Osta support acting inside an approved `SupportAccessGrant`
  is exempted from the gate (`!ctx.isActingAsSupport`), so troubleshooting a still-
  pending property is possible without a separate carve-out mechanism.
  Property gained `reviewedByUserId`/`reviewedAt`/`rejectionReason` fields directly
  (not a `SupportAccessGrant`-style side table) — this is a 1:1 lifecycle state of the
  row itself, read on the same hot path as `status`, so a join table would force a
  second query everywhere `assertPropertyAccess` runs today. A rejected property CAN
  be resubmitted by the tenant (`POST /api/properties/[id]/resubmit`, only legal from
  `REJECTED`, clears the reviewed fields and flips back to `PENDING`) — rejection
  isn't a dead end.
- **Module licensing is a per-enterprise override**, not just tier-based. New
  `EnterpriseModuleAccess` model (`{enterpriseId, module, enabled}` unique on the
  pair) sits ABOVE the existing `TierModuleAccess` in the fallback chain: an
  enterprise's own override row wins if present, else the tier default, else enabled
  by default (same fail-open-as-last-resort behavior as before, now genuinely the
  last resort instead of the only rule). `CONTROLS` and `ACTIVITY_LOG` are
  hardcoded-exempt from this in `computeLicensedModules()` — a locked-out enterprise
  still needs to reach Controls (to understand why) and its own audit trail; the
  Licensing UI doesn't even expose toggles for those two modules. This is now REAL
  enforcement, not a scaffold: `AuthContext` gained a `licensedModules: Set<Module>`
  computed once per request inside `requireSession()` (same place the existing
  `backfillMissingRolePermissions` precomputation already runs), and
  `requirePermission()` — the one function nearly every route already calls, kept
  fully synchronous, no call-site changes anywhere — denies immediately if the
  module isn't in that set, before even checking the role's own permission. The old
  `requireModuleLicensed()` (confirmed unused everywhere) was deleted outright rather
  than kept alongside.
- **A genuinely separate console, not more Controls tabs.** Previously "Osta admin"
  meant logging in and seeing two extra `ostaOnly`-gated tabs (Licensing, Support
  Access) bolted onto the exact same `/e/{slug}/dashboard/controls` page every
  tenant uses. That's now a real, separate route tree at `/osta/...` (sibling to
  `/e/`, not nested under it — Osta's own enterprise `slug` was always an incidental
  schema leftover, never a real design decision) with its own layout
  (`src/app/osta/layout.tsx`, no `PropertyProvider`/property-switcher since Osta has
  no operational property of its own) and sidebar (`OstaSidebar` — a small static
  nav, deliberately NOT module/permission-filtered like the tenant `AppSidebar`,
  since these aren't tenant RBAC modules). Login now returns `isInternal` from
  `POST /api/auth/login` and the client branches straight to `/osta` instead of
  `/e/{slug}/dashboard`; a defensive server-side redirect was also added to the
  tenant dashboard layout (`if (ctx.isInternal && !ctx.isActingAsSupport)
  redirect("/osta")`) so a direct URL visit can't land an Osta user in the tenant
  shell. `LicensingManager` and `SupportAccessManager` moved to dedicated
  `/osta/licensing` and `/osta/support-access` pages; the tenant Controls page kept
  its own (non-Osta) "Support Access" tab, since a tenant admin still needs to
  approve/deny incoming requests from their side — only Osta's duplicate rendering
  of it and the `ostaOnly` bolt-on (`buildSections`'s filter, the "Osta Internal"
  mobile/desktop separators) were removed.
- **Approve/reject actions are logged into both trails.** `logActivity()` gained an
  optional `targetEnterpriseId` — an Osta admin's action lands in Osta's own
  activity trail by default (`ctx.enterpriseId`), which the tenant would never see;
  passing the tenant's enterprise id writes a second copy into their own trail too,
  so "your property was approved/rejected, by whom, why" is visible to the tenant
  admin, not just to Osta internally.
- **DB Health is real instrumentation, not just static counts** (the owner explicitly
  chose "deeper performance metrics" over a basic read-only dashboard, understanding
  the tradeoff). `src/lib/db.ts`'s `PrismaClient` now emits `query`/`error`/`warn`
  log events into a bounded in-memory ring buffer (`src/lib/db-metrics.ts`, last
  ~500 query events, grouped by normalized query text) — deliberately NOT a
  persisted table, to avoid write-amplification from logging every single query.
  This is called out explicitly in the `/osta/db-health` page's own UI copy: the
  metrics reflect *this server instance only*, since its last restart — on a
  multi-instance/serverless deployment it's not a global aggregate, and a real
  historical-trend version (a persisted snapshot table + cron flush) is a deliberate
  future increment, not attempted here. Baseline stats (row counts for a fixed list
  of the heaviest tables, migration-status comparison of `prisma/migrations/` on
  disk against the `_prisma_migrations` table via `$queryRaw` — no shelling out to
  the CLI — and DB file size when `DATABASE_URL` is a local `file:` path, `null`
  otherwise since prod may be a remote libSQL/Turso URL) round out the dashboard.
- Live-verified via 10 new tests across two files
  (`tests/tenant-isolation/property-approval.test.ts`: PENDING-on-create, cross-
  enterprise approval queue gating, approve/reject/resubmit lifecycle, dual
  activity-log writes; `tests/business-rules/module-licensing.test.ts`: override
  GET/PATCH, the `enabled: null` reset-to-tier-default path, Osta-only gating) plus
  the Phase A additions to `tests/scope.test.ts` (a `PENDING` property fails
  `assertPropertyAccess`; an `EnterpriseModuleAccess` override wins over the tier
  default in both directions; `CONTROLS`/`ACTIVITY_LOG` stay accessible even when
  explicitly disabled at either level). Full suite 271/271, `tsc --noEmit` clean
  throughout every phase. **Live browser verification could not be completed this
  session** — the sandboxed Browser pane could not reach `localhost:3000` (external
  sites loaded fine, and a direct `curl` from the same environment confirmed the dev
  server itself was healthy and serving every route correctly), an environment
  limitation distinct from the code itself. Recommend a manual UI pass (create a
  property as a tenant, approve/reject/resubmit it as Osta, toggle a module override
  and confirm the sidebar item disappears, check `/osta/db-health` renders real
  numbers) before considering this fully done.

## Alpha v4 owner decisions (2026-07-21)

The five open decisions listed at the bottom of [ALPHA_V4_PLAN.md](ALPHA_V4_PLAN.md)
were put to the app owner directly and answered as follows. These govern Phases 1-3
of that plan — do not re-ask or reverse without a fresh instruction.

- **Deposits are a real pre-arrival concept, not just a check-in payment step**
  (owner's verbatim intent): *"There is Deposit option and also payment collection
  once the guest is checked in (basically payment can be applied in any time of the
  stay - can be checked out if the balance is zero whether settling to City Ledger
  or Taking actual payment). Deposit collected will show on manage reservation and
  will automatically transfer to the billing window upon check in."* Implications:
  a deposit can be collected while the reservation is still `RESERVED` (which means
  the folio must exist — or be creatable — before check-in), the deposit shows on
  the manage-reservation surface, and at check-in it appears on the folio ("billing
  window") automatically. Payments remain acceptable at any point during the stay;
  the existing checkout rule stands (zero balance required, City Ledger folios
  exempt via the debtor pipeline).
- **INSPECTED gates arrivals via a per-property toggle**: new property setting;
  when enabled, checking a guest into a room that isn't `INSPECTED` warns/blocks.
  INSPECTED stops being cosmetic.
- **Out-of-Order is modelled as fields on `Room`** (nullable `oooReason` +
  `expectedReturnDate`), not a separate dated `RoomStatusBlock` history model.
  Maintenance tickets can set a room OOO at creation and return it to DIRTY on
  resolve. No history of past OOO periods in v1.
- **The Availability Matrix is the one maintained tape chart** (the drag-drop
  grid, `tape-chart-grid.tsx`). The read-only calendar view
  (`reservations/calendar/page.tsx`) is to be retired once the matrix gains the
  Phase 2 additions (click-empty-cell to book, bar context actions).
- **Vacant Rooms KPI semantics confirmed as shipped in Phase 0**: headline number
  = all unoccupied sellable rooms (excluding OOO/OOS), with a "clean & ready"
  (CLEAN/INSPECTED) subcount underneath.

## Business date + folio rework (2026-07-22)

Reservation-detail review feedback, implemented across four commits (business
date → folio posting rules → routing → proforma). Owner decisions captured:

- **Business date is per-property** (`Property.businessDate`), the operational
  "today" for check-in/out gating, arrivals/departures, and every posting/revenue
  date. `EnterpriseSettings.systemDate` stays the real server/wall-clock date.
  Business date rolls forward ONLY when Night Audit (EOD) runs — manual for now;
  a future Auto-EOD will roll it off the server date. Because EOD rolls the date,
  running it twice advances two days (each run = one business day); the
  one-COMPLETED-run-per-business-date guard still prevents same-date double-posts.
  All domain date-only comparisons are UTC (reservation dates + business date are
  UTC midnights) — `src/lib/allocations.ts` was switched from local to UTC to match.
- **Checkout is due-or-overdue** (business date ≥ checkout date); leaving earlier
  is an explicit **Early Check-Out** (`{ early: true }`, server-enforced via
  `earlyCheckoutRequired`). The reservation detail shows Check Out vs Early
  Check-Out from the property business date.
- **Folio charge posting is gated to checked-in** guests. Deposits (payments)
  pre-arrival are unaffected; a deliberate **cancellation/no-show fee** is the one
  exception (`preArrivalFee: true`) — the folio panel exposes the charge form as a
  labelled pre-arrival fee when the guest isn't in-house. Walk-in/outlet folios
  are always billable.
- **Negative amounts** are allowed on charges and payments (adjustments/refunds);
  only zero/non-numeric is rejected.
- **Folio payee** can be the attached travel agent / corporate profile (not just
  guest + sharers).
- **Line Description auto-fills from the charge code**; a new
  `FolioLineItem.reference` free-text field prints in the invoice Reference column
  (was the charge code).
- **Routing Instructions** (`FolioRoutingRule`): standing per-reservation rules —
  charge code(s) → a target folio window or another in-house room's folio. Applied
  by Night Audit and manual posting; creating a rule also moves already-posted
  matching charges (apply-now). Manual "Move to Folio" now allows any open folio at
  the same property (cross-reservation/room), not just the same reservation.
- **Proforma = full projected cost of stay** (reuses `computeReservationQuote`),
  regardless of what's posted; the Tax Invoice remains actually-posted charges.
