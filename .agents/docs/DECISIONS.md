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

- Full audit, token system, and migration plan: see `DESIGN_PLAN.md` at the repo root
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
