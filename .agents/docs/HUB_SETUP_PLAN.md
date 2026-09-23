# Hub Setup — Enterprise vs Property separation (plan)

Status: **DONE** (branch `feat/hub-setup-separation`, release 7.0.0) — Phases 0–6 built
2026-09-23. Open follow-ups: O-1 (richer dropdown fields) and Phase 5b (more copyable
sections) — see TODO.md and "Decisions taken without asking" below.
Owner decisions are recorded in [DECISIONS.md](DECISIONS.md) ("2026-09-23 — Setup moves to
the Hub, separated by Enterprise and Property"). This file is the build plan.

## Why

Setup is scattered and it is not clear which property a change lands on:

- **Stationery leaks across properties.** The Stationaries page previews with the current
  property's logo/font, but every text field (invoice header/footer, bank account,
  receipt/statement terms, confirmation letter, registration card, eRegistration) saves to
  `EnterpriseSettings` — editing "Lagoon's" footer changes every property.
- **Three different "which property" mechanisms** in Controls: the dashboard's ambient
  `useProperty()` (meal plans, fee rules, spa, allocation mode, appearance, session timeout),
  an in-page picker that always opens on the **first** property regardless of the one you
  are in (outlets, sequences, facilities, amenities), and none at all (enterprise-wide).
- **Nothing labels enterprise vs property.** Charge codes (enterprise) and room types
  (property) sit side by side.
- The Hub itself mixes levels: one Beds24 connection per enterprise, API keys covering any
  subset of properties, per-property website settings inside an enterprise page.

## The rule

> **Enterprise** = shared by every property: users, roles & permissions, sessions,
> integrations credentials (Booking API keys), Email/SFTP, support access, the property list.
> **Property** = everything else — including tax, charge codes, payment methods, dropdowns and
> stationery. A property page shows only that property's data. There is **no live sharing**
> between properties; onboarding is eased by **copying** settings from another property.

Controls and Stationery leave the property dashboard **outright** — no redirect, no stub.
The property dashboard becomes purely operational.

## Target structure

```
/e/{slug}/hub                                   Overview (banners, see Phase 6)
/e/{slug}/hub/enterprise/…                      ENTERPRISE — hidden from single-property users
    properties        the property list (create / submit for review / resubmit)
    people            users + roles (UsersRolesManager)
    permissions       permission matrix (print)
    sessions          active sessions
    email             SMTP / SFTP
    booking-api       API keys + webhooks
    support-access
    lists             "Guest & Staff Lists": guest-profile dropdowns (A-1) + Job Functions
/e/{slug}/hub/p/{propertyId}/…                  PROPERTY — one property at a time
    general           profile, appearance (banner colour, stationery font), session timeout
    inventory         buildings, floors, room types, rooms, amenities, room-feature lists
    reservations      booking-number format, reservation + housekeeping lists
    revenue           meal plans, allocation mode
    finance           tax (incl. Green Tax/TGST/SC), payment methods, settlement, fees
    cashiering        charge groups/subgroups/codes, generates, posting defaults
    outlets
    spa, excursions   only when the enterprise holds the add-on
    stationery        this property's documents
    sequences
    channel-manager   status (read-only), mapping, booking defaults, inbound, logs
    online-booking    website settings, Excursions & Spa online settings, online bookings
    green-tax         Reg No corrections + MIRA filing
```

- **The property is in the URL**, never ambient. Refresh, deep links and new tabs cannot
  silently change it. No `PropertyProvider` in the Hub (the Hub layout's load-bearing rule
  stays); property pages receive `propertyId` from the route and pass it explicitly.
- **Property band**: every `/p/{propertyId}` page renders a persistent band in the
  property's own `bannerColor` — "Configuring: Veyo Lagoon Retreat" — with a switcher that
  keeps the current section. Single-property users get the band without a switcher.
- **Sidebar**: `Overview`, then an `Enterprise` group (enterprise users only), then a
  `Property` group headed by the switcher. Enterprise with one property: no switcher.
- **Entering the property area** with no id picks the last-used property (per-viewer
  storage), else the first.
- Every existing Controls manager is converted to take `propertyId` as a prop: drop
  `useProperty()` and delete the in-page property pickers.

## Access

| Who | Hub entry | Enterprise area | Property area |
|---|---|---|---|
| ENTERPRISE-scope user | any Hub-capable permission | yes (per module) | any property |
| PROPERTY-scope user | CONTROLS, INTEGRATIONS or GREEN_TAX | **never** (hidden + 403) | **own property only** (other ids → redirect to own) |

- Replace `hasHubAccess` / `requireHubAccess` with three helpers in `src/lib/scope.ts`:
  `hasHubAccess(ctx)` (entry), `requireEnterpriseHub(ctx)` (enterprise area — rejects PROPERTY
  scope outright, as today), `requirePropertySetup(ctx, propertyId, module, action)` (property
  area — enterprise-ownership check + own-property check + module permission). One helper
  per rule so a rule change is a one-line edit (same reasoning as today's comment).
- Section permission: setup sections = `CONTROLS`; channel manager + online booking =
  `INTEGRATIONS`; green tax = `GREEN_TAX`. `USERS` stays enterprise-only.
- `HUB_MODULES` / `moduleScope()` semantics change: INTEGRATIONS and GREEN_TAX become
  grantable to single-property users; update `MODULE_SCOPE_DESCRIPTIONS` and the role editor.
- Single-property admins need a way into the Hub from the dashboard (user menu entry).

## Data model changes

- **`PropertySettings`** (new, 1:1 with `Property`) receives the per-property half of
  `EnterpriseSettings`. `EnterpriseSettings` keeps only SMTP/SFTP (+ anything genuinely
  enterprise found during the build).
  - Phase 1: stationery/document fields (`invoice*`, `receipt*`, `statement*`,
    `confirmationLetterMessage`, `registrationCard*`, `eRegistration*`, `defaultFolioStyle`),
    booking-number format (`resConfirmPrefix`, `resConfirmLength`).
  - Phase 2: posting defaults (`defaultAccommodationChargeCodeId`,
    `defaultGreenTaxChargeCodeId`, `commissionChargeCodeId`), `cityLedgerPaymentMethodId`,
    `spaOutletId`, `excursionOutletId`, `greenTax*`, `tgst*`, `serviceCharge*`,
    `cashierDefaultFloat`, `exchangeFromCurrency`, `exchangeToCurrency`.
- **Per-property tables** (Phase 2): `ChargeGroup`, `ChargeSubgroup`, `ChargeCode`,
  `TaxProfile` (+`TaxRate` via parent), `PaymentMethod` gain a required `propertyId`;
  uniqueness moves from enterprise to property (e.g. `@@unique([propertyId, code])`).
  `enterpriseId` stays for tenant scoping.
- **`SystemCode`** (Phase 3): nullable `propertyId` — null for guest-profile categories
  (A-1), set for reservation / housekeeping / room-feature categories; plus the extended
  fields (open item O-1).
- **`ChannelConnection`** (Phase 4): required, unique `propertyId` — one connection per
  property. `enterpriseId` stays (inbound attribution by enterprise, 2026-08-02 rule).
- **`WebsiteApiKey`** (Phase 4): `WebsiteApiKeyProperty` join replaced by one-or-ALL —
  nullable `propertyId` (null = all properties, including ones added later; A-3).

## Data migration

The owner confirmed there are **no live enterprises yet**, so risk is low — but migrations
must still be correct for any database, and seeds must produce the new shape.

- Stationery/booking format: copy the enterprise's values into every property's
  `PropertySettings` row.
- Finance split: for each property, clone groups → subgroups → codes → generates, tax
  profiles → rates, payment methods; then re-point every reference **by the owning
  property** — each referencing row already belongs to exactly one property:
  `FolioLineItem`, `Payment` (+`chargeCode`), `FolioRoutingRule` (via folio), `Folio.defaultPaymentMethod`,
  `OutletChargeCode` + `Outlet.taxProfile` (via outlet), `Allocation`, `RatePlan`,
  `ExcursionType`, `SpaTreatment`, `PropertyFeeRule`, `ActivityOnlineSettings`,
  `PaymentMethod.chargeCode`, `ChargeCode.taxProfile`, `ChargeCodeGenerate` (both ends),
  plus the `PropertySettings` pointers. Verify zero cross-property references afterwards.
- Spa/Excursion outlet link: a property keeps the link only if the outlet is its own;
  otherwise it is left unlinked and the Overview flags it.
- Checked: no report consolidates across properties, so divergent charge groups per
  property break no report.

## Phases

Each phase is its own branch/PR with migrations, seed updates and tests.

**Phase 0 — Hub shell and access.** Route groups `enterprise/` and `p/[propertyId]/`,
sidebar groups, property band + switcher, the three access helpers, property-user entry,
dashboard → Hub entry point. Move existing Hub pages into the right group (people,
sessions, permissions → enterprise).

**Phase 1 — Move what is already per-property, and fix stationery.** Every Controls
section whose data is already per property moves to `p/[propertyId]` with explicit
`propertyId`. `PropertySettings` created; stationery + booking-number format split
per property. Properties list, Email/SFTP and Support access → enterprise area. Enterprise-
wide finance sections (charge codes, tax, payment methods, dropdowns) sit **temporarily**
in the enterprise area, labelled as moving, so no page ever claims per-property data it
does not have. **Delete** the dashboard Controls page, Stationaries page and their nav entries.

**Phase 2 — Finance per property.** Charge hierarchy, generates, posting defaults, tax,
payment methods, settlement, cashier float/exchange currencies, Spa/Excursion outlet link.
Migration above. ~100 source files read these today (`chargeCode` 29 files,
`enterpriseSettings` 37, `paymentMethod` 10, `taxProfile` 6, `chargeGroup`/`Subgroup` 9,
generates 3) — every lookup switches to the property. Includes the website/booking API and
channel inbound paths. Onboarding seed variant: see "Charge codes at onboarding" below.

**Phase 3 — Dropdowns per property + richer entries.** The per-property split shipped (see
As built); the richer entry fields wait on O-1.

**Phase 4 — Integrations and Green Tax per property.**
- Channel manager: Osta console creates a connection **for a chosen property** and links
  its Beds24 property id in one step; re-authorize stays Osta-only. Property link creation
  leaves the Hub. Property area: read-only status, room/rate mapping (incl. per-room-type
  "shared" hold-back), booking defaults, availability preview/push, inbound bookings and
  exchange log, all filtered to that property. Property admins cannot connect, disconnect or
  re-authorize — they request it from Uppsolut.
- Booking API: keys one-or-ALL; keys + webhooks in the enterprise area; website settings,
  Excursions & Spa online settings and the online-bookings list move to the property area.
- Green Tax register → property area, `GREEN_TAX` permission, property separation.

**Phase 5 — Copy from another property.** A "Copy from…" action on each copyable section:
pick the source property, then the whole section or chosen items. A preview lists what
will be copied and what will be **skipped because it already exists (matched by code) —
never overwritten, no overwrite option**. Dependencies come along (a charge code brings
its subgroup/group and tax profile; an outlet brings its codes; a meal plan brings its
allocations). Stationery copies field by field: a field that already has a value is
skipped with a warning. Proposed copyable: charge hierarchy, tax, payment methods,
dropdowns, meal plans + allocations, fee rules, outlets, room types (not rooms), spa
catalogue, excursion catalogue, stationery. Not copied: sequences, rooms, therapists,
connections, keys.

**Phase 6 — Overview.** Banners only when something needs attention, each linking
straight to the fix; they disappear when complete. Per property: no tax, no payment
methods, no charge codes / posting defaults, stationery empty, no room types or rooms, no
sequences, Spa/Excursion outlet not linked. Green Tax: only when a Reg No is missing or a
month is unfiled. Channel manager: active/inactive per property; a warning when the token is
near its 30-day expiry or bookings are failing. Background jobs: hidden unless one fails
repeatedly. The current link cards and the job card are removed. Single-property users see
only their property.

### Charge codes at onboarding (owner, "variant")

Properties differ, so the standard chart seeded for a new property should too: only include
Spa / Excursions groups when that property actually offers them, and name outlet codes after
the property's own outlets (e.g. "Veyo Garden Restaurant", "Maaveyo Pool Bar") rather than a
generic "Restaurant". The Phase 2 migration itself copies the full current set to every
property (owner: "fine for now").

## As built

**Phase 0** — `src/lib/scope.ts`: `hasHubAccess` (entry), `hasEnterpriseHubAccess` /
`requireEnterpriseHub` (renamed from `requireHubAccess`), `requirePropertySetup`,
`canSetUpProperty`. `src/lib/modules.ts`: CONTROLS joined `HUB_MODULES`;
`PROPERTY_SETUP_MODULES` / `ENTERPRISE_ONLY_MODULES`. Shell: `hub/enterprise/layout.tsx`,
`hub/p/page.tsx`, `hub/p/[propertyId]/layout.tsx` (+ band `components/hub/hub-property-band.tsx`),
nav config `components/hub/hub-nav.ts`, `components/hub/hub-sidebar-nav.tsx`,
`lib/hub-properties.ts` (last-opened property: `hub_property_id` cookie, never the
dashboard's working-property cookie).

**Phase 1** —
- `PropertySettings` model + migration `20260924090000_property_settings` (copies each
  enterprise's values into every property, then drops `resConfirmPrefix/Length` from
  `EnterpriseSettings`). The enterprise's document-content columns remain ONLY for the
  INTERNAL (Osta) enterprise's license invoices; `/api/tenant-settings` refuses them for
  customers.
- `src/lib/property-settings.ts` (defaults + Zod patch schema), `/api/properties/[id]/settings`
  (GET: anyone at the property; PATCH: `requirePropertySetup(CONTROLS, update)`).
- `src/lib/document-settings.ts`: `loadDocumentSettings()` — the print-data routes now
  return this curated object instead of the raw `EnterpriseSettings` row (which carried the
  SMTP/SFTP password columns to the browser); `loadEmailBranding()` — emailed documents
  now use the property's identity like the printed ones.
- Pages: `hub/p/[propertyId]/{general,inventory,reservations,revenue,finance,outlets,
  excursions,spa,stationery,sequences}`; enterprise `properties`, `email`,
  `support-access`, and interim `finance`, `cashiering`, `lists` (labelled "Shared for
  now"). Guard: `src/lib/hub-page.ts` (`propertyPage` / `enterprisePage`).
- Every moved manager takes `propertyId` (or a server-loaded `property`) explicitly; the
  in-page pickers that opened on the first property are gone.
- Deleted: dashboard `controls` and `stationaries` pages, the dashboard "Setup" nav group,
  `controls-dashboard.tsx`, and the legacy `/dashboard/financials` redirect into Controls.
- Tests: `tests/business-rules/property-settings.test.ts`.

**Phase 2** —
- Migration `20260924100000_finance_per_property`: `propertyId` on ChargeGroup / Subgroup /
  Code / Generate, TaxProfile, PaymentMethod (unique per property); clone-per-property +
  re-point every reference by its owning property + delete originals (the FK safety net).
  An outlet-owned subgroup is cloned only to its outlet's property (plus any property whose
  records already used one of its codes). Posting defaults, City Ledger method, Spa /
  Excursion outlet links, Green Tax / GST / Service Charge, cashier float and exchange pair
  moved from `EnterpriseSettings` to `PropertySettings` (a module outlet link survives only
  on the property that owns the outlet). Rehearsed on a copy of the dev DB: zero
  cross-property references afterwards.
- Code: `ensureChargeTree(client, { propertyId }, modules?)`, `ensureFeeRules(client,
  { propertyId })`, `chartModulesFor()` (a new property only gets Spa / Excursions groups
  when the enterprise holds the add-on and the property offers it — `offersSpa` /
  `offersExcursions` on create), `resolveChargeCode({ propertyId }, role)` — object args on
  purpose so an old enterprise-id caller fails to compile. Outlet provisioning seeds a missing
  Spa / Excursions group on demand.
- APIs: charge-codes, charge-groups, charge-subgroups, generates, payment-methods, taxes and
  module-outlets take `propertyId` (reads: `assertPropertyAccess`; writes:
  `requirePropertySetup`); every "same enterprise" ownership check on these became "same
  property". `/api/tenant-settings` now holds only SMTP/SFTP (+ Osta's own invoice
  stationery) and names where anything else went.
- Pages: property **Finance** (tax, payment methods, settlement, cashier defaults, fees) and
  **Charge Codes** (groups, codes, posting defaults, Spa/Excursion outlet); the interim
  enterprise Finance / Charge Codes pages are gone. Operational pickers (POS, folio,
  deposit, check-in, walk-in, cashiering, revenue) ask for their own property's data.
- Seeds: Veyo seeds finance per property; the Lagoon gets its own "Lagoon Spa" outlet
  (the demo used to bill the Lagoon's spa through the Resort's Serenity Spa).
- Known gap (no live data, so accepted): a migrated property may lack the standard
  band-default outlet codes (e.g. 2001–2004) when another property's outlet had adopted
  that band's default subgroup — `scripts/seed/seed-charge-codes.ts --apply` refills them.
- Behaviour note: a property with no settings row reads the Maldives defaults (GST 17%,
  Service Charge 10%, Green Tax on). An enterprise that never saved its settings used to
  post UNTAXED (no row → no tax); every real enterprise had a row, so this only shows in
  test fixtures, which now say "tax off" explicitly where they mean it.

**Phase 3** —
- Migration `20260924110000_lists_per_property`: nullable `SystemCode.propertyId`. The
  PROPERTY lists — Housekeeping Requests, Special Requests, Transport Type, Bed Type, View,
  Amenities — are copied to every property of their enterprise and the enterprise originals
  deleted; guest-profile lists (A-1) and Job Functions stay the enterprise's (a user is
  enterprise-wide too). Nothing references a list option by id (every record stores the
  code), so no re-pointing was needed. Uniqueness is two PARTIAL unique indexes — (enterprise,
  category, code) where propertyId is null, (property, category, code) where it is set —
  so two properties may use the same code for different labels. Rehearsed on a DB copy.
- `src/lib/system-code-scope.ts` (`PROPERTY_LIST_CATEGORIES`, `isPropertyListCategory`) is
  the one place that says which list lives where.
- `/api/settings/system-codes`: a property list needs `propertyId` (reads:
  `assertPropertyAccess`; writes: `requirePropertySetup(CONTROLS)`); an enterprise list is
  written only from the enterprise area (`requireEnterpriseHub` + CONTROLS) and always saved
  with `propertyId` null. With no category it returns the enterprise lists plus the given
  property's.
- `SystemCodeSelect` / `SystemCodeMultiSelect` take `propertyId`; their cache is keyed by
  category + property. Operational readers use the property's list: booking form, special
  request validation (`validateSpecialRequestCodes(propertyId, …)`), housekeeping requests,
  transport, room-feature picker, the housekeeping report and the Website API's room
  feature labels.
- Pages: property **Reservations** gains "Reservation & Housekeeping Lists", property
  **Rooms & Inventory** gains "Room Features"; the enterprise page is now **Guest & Staff
  Lists** (profile lists + Job Functions). With that, nothing is "shared for now" any more —
  the interim sidebar group and page-header wording are gone.
- Seeds: Veyo's Beach and Lagoon each seed their own Special Requests (overlapping, not
  identical). Tests: `tests/business-rules/property-lists.test.ts`, plus a sibling-property
  case in `special-requests.test.ts`.
- Not done — O-1: the richer entry fields. The split does not depend on them; they add
  columns to `SystemCode` and inputs to `DropdownsManager` once the owner names them.

**Phase 4** — three commits:
- **4a Green Tax** — the Reg No register is under each property (`hub/p/[id]/green-tax`);
  `/api/hub/green-tax/*` require `requirePropertySetup(GREEN_TAX)` for the named property.
- **4b Booking API** — migration `20260924120000_api_key_one_or_all`: `WebsiteApiKeyProperty`
  → nullable `WebsiteApiKey.propertyId` (null = ALL, resolved live in `resolve-key.ts`, so it
  covers properties added later — A-3). One-property keys keep their property; several-
  property keys became ALL; a key on no property was revoked. Keys + webhooks stay in the
  enterprise area ("Booking API Keys"); the form picks one property or "All properties".
  Each property's website settings, Excursions & Spa online settings and online-bookings
  list moved to **Online Booking** in the property area; their APIs take the property and
  `requirePropertySetup(INTEGRATIONS)`. WEBSITE_API_PLAN W-2 and the public docs updated.
- **4c Channel manager** — migration `20260924130000_channel_connection_per_property`:
  `ChannelConnection.propertyId` (required, unique), `ChannelPropertyLink.connectionId`
  unique, `ChannelSyncLog.propertyId`. A connection linked to several properties was split
  (the split-off rows need a new webhook URL from Osta); an unlinked one was removed.
  Rehearsed on a DB copy with sample rows. The Osta console connects a PROPERTY (invite code
  + Beds24 property id, checked before the single-use code is spent) and can correct the
  Beds24 property id. The Hub's channel pages moved under the property (status/health
  check, Mapping with the sharing switch, Inbound Bookings, Exchange Log); every route
  authorises through `src/lib/channels/hub-access.ts`; link create/delete answer 403
  ("Uppsolut connects/disconnects"). Test helpers: `tests/helpers/channel.ts`.
- The enterprise area now holds only: Properties, People, Sessions, Email & SFTP, Booking
  API Keys, Support Access, Guest & Staff Lists.

**Phase 5** — "Copy from…" (`src/lib/property-copy.ts`, `/api/properties/[id]/copy`,
`components/hub/copy-from-property.tsx`):
- Sections and their match keys: property dropdown lists (category + code), tax profiles
  (name — they have no code), charge codes (code), payment methods (name), stationery
  wording (field by field, only into EMPTY target fields), meal plans (code), room types
  (code), outlets (name, or code).
- Dependencies pulled along and reported: a charge code brings its subgroup, group, tax
  profile and what it generates (and the generated codes); a payment method its charge
  code; a meal plan its allocations and their charge codes; a room type the room-feature
  options it uses; an outlet its tax profile and charge codes — and its own outlet
  subgroup then points at the NEW outlet. Not copied: rooms, outlet contact details and
  check counters, posting-default pointers, anything with bookings behind it.
- An item the target already has is shown as "Already here" and skipped, never
  overwritten; the whole copy is one transaction. Target needs Property Setup (CONTROLS
  create); the source must be a property the caller may open, so a single-property admin
  is offered no source. Copies are logged in the activity trail.
- Not done: Allocations on their own (they live on the dashboard's Revenue page, not in the
  Hub — a meal plan brings its allocations), fee rules (every property is seeded with its
  own set, so a copy would always skip), and the Spa / Excursion catalogues (therapists,
  treatment rooms and schedules make them their own job) — see TODO.
- Also fixed here: `GET /api/properties` listed every property of the enterprise to a
  single-property user; it now returns only their own.

**Phase 6** — the Overview (`src/lib/hub-overview.ts`, `hub/page.tsx`) is banners only:
- Per property, only what the user may see (CONTROLS / INTEGRATIONS / GREEN_TAX view):
  no room types or rooms; no accommodation charge code; Green Tax on with no Green Tax
  code; no payment methods; no City Ledger settlement method (warning); invoices with no
  payment details (warning); spa treatments or excursions sold with no module outlet;
  channel connection failing, credential within 7 days of lapsing, unacknowledged channel
  overbookings; a website that takes bookings with no rate plan (warning); Green Tax
  register exceptions or numbering gaps, and past months with guests not marked filed
  (warning).
- Enterprise (enterprise users only): email not set up (warning); a background job whose
  latest run FAILED (no link — contact support).
- Each banner names its property and links to the section that fixes it; critical first;
  "Everything is set up" when there is nothing. A channel-manager strip shows each
  property as Active / Inactive / Error / Not connected.
- Single-property Hub users now get the Overview too, for their own property only. The
  link cards, the job card (`job-status-card.tsx`) and `/api/hub/job-runs` are removed.

## Decisions taken without asking (owner: "complete all phases — do not ask me")

Recorded so they can be reviewed and reversed:
- **Booking API keys on several properties** were migrated to ALL (the one-or-ALL rule
  leaves no narrower choice that keeps a group portal working); a key on no property was
  revoked. No live enterprise had such a key.
- **Channel connections covering several properties** were split one per property; the
  split-off rows need a new webhook URL from Osta. An unlinked connection was removed. No
  live enterprise had a connection.
- **Property admins keep the sharing on/off switch, mapping, defaults, availability checks
  and pushes** (the owner listed mapping and rate/availability checks); only connect /
  link / unlink / disconnect / re-authorize are Osta-only.
- **Phase 3b (richer dropdown fields)** was not built — O-1 is still unanswered.
- **Copy (Phase 5)** covers lists, tax, charge codes, payment methods, stationery, meal
  plans, room types and outlets; Spa/Excursion catalogues and stand-alone Allocations are
  left for Phase 5b. Fee rules are not copyable (each property is seeded with its own).
- **Overview checks** are the list above; stationery is checked only for invoice payment
  details, and sequences are not checked (they are created on first use).
- **Green Tax "filed" warning** counts past months of the current year that had Green Tax
  guests and are not marked filed — there is no MIRA due date in the system to be stricter.

## Assumptions (not explicitly answered — confirm or correct)

- **A-1** Guest-profile dropdowns (Title, Gender, Nationality, ID Type, VIP Level, Dietary,
  Preference, Classification) stay **enterprise**, because guest profiles are enterprise-wide
  (one guest, chain-wide stay totals). Per-property lists would show values another property
  lacks. Edited under Enterprise → Guest & Staff Lists.
- **A-2** Single-property admins **cannot manage users** (users are enterprise; owner:
  "restrict enterprise related entirely"). Today they can create users at their own property
  — this is removed.
- **A-3** A Booking API key for "ALL" also covers properties added later (mirrors users).
  Minting keys is enterprise-only.

## Open items

- **O-1** Dropdown entries need more than code + label. Which fields? (Candidates: colour,
  description, parent for nested lists, default flag, linked charge code.) The per-property
  split (Phase 3) shipped without them; only the extra fields wait on this.

## File map (starting points)

- Hub shell: `src/app/e/[slug]/hub/layout.tsx`, `src/components/hub-sidebar.tsx`,
  `src/components/hub/hub-property-switcher.tsx` (today: "leave to dashboard", not a config
  selector)
- Access: `src/lib/scope.ts` (`hasHubAccess`, `requireHubAccess`), `src/lib/modules.ts`
  (`HUB_MODULES`, `moduleScope`)
- Controls to dissolve: `src/components/controls/controls-dashboard.tsx`,
  `src/app/e/[slug]/dashboard/controls/page.tsx`,
  `src/app/e/[slug]/dashboard/stationaries/page.tsx`,
  `src/components/settings/stationaries-manager.tsx`, sidebar config
  `src/components/app-sidebar-nav.config.ts`
- Settings APIs: `src/app/api/tenant-settings`, `api/settings/*`, `api/charge-codes`,
  `api/charge-groups`, `api/payment-methods`, `api/taxes`, `api/module-outlets`
- Channel: `src/lib/channels/{connection,sharing}.ts`, `src/app/api/hub/{connections,property-links,sync-logs,inbound-bookings}`,
  `src/app/api/osta/channels/connections`, `src/app/osta/channel-manager`
- Booking API: `src/app/api/hub/website/**`, `src/components/hub/website-*.tsx`,
  `src/lib/website-api/keys.ts`
- Seeds: `scripts/seed/seed-charge-codes.ts`, `seed-osta.ts`, `seed-veyo.ts`
