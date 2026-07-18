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
