# Master Plan v3 — Profiles Redesign

> **Status legend**: ✅ done · 🚧 in progress · ⬜ not started
> **Overall**: 🚧 in progress. Plan authored 2026-07-20 from an app-owner field-by-field
> spec given verbally in-session; two forks were confirmed via AskUserQuestion (both the
> recommended option): **Attachments = a URL-reference list**, not real file upload
> (no upload/storage infra exists anywhere in the app today); **STAFF profiles stay
> fully independent of `User`** (the login/RBAC model) — a directory record only.

This document is the implementation plan for reorganizing the Profiles module: replacing
free-text Loyalty Tier with an LOV-driven VIP Level, splitting the old
contact-info-plus-address `ProfileContact` model into focused multi-row Communications
and Address tables, wiring up the previously-dead `ProfileNote` model, adding a real
STAFF profile type, adding a URL-referenced Attachments list, and adding a Stay
History view (future + past reservations with revenue breakdown).

---

## Context — what exists today and why it isn't enough

(Full detail gathered by research pass, 2026-07-20 — summarized here.)

- **`Profile`** (enterprise-scoped, no `propertyId`) has `loyaltyTier` as a free-text
  input — no LOV, no tiering structure. `classification` (VIP/REGULAR/BLACKLISTED) is a
  *different* concept (guest standing/blacklist flag) and stays untouched.
- **`ProfileContact`** conflates contact info (email/mobile/workPhone) *and* address
  (address/city/stateProvince/postalCode/country) in one row, with a `contactType` that
  doesn't map to what the owner wants (`EMAIL`/`MOBILE`/`SOCIAL` for communications,
  `HOME`/`BUSINESS`/`BILLING` for address — two different axes, not one).
- **`ProfileDocument`** already matches the requested Identification shape
  (type/number/issuing country/expiry/isPrimary) but the API only ever replaces-all on
  every `PUT` and effectively supports one document despite the schema allowing many.
- **`ProfileNote`** exists in the schema, complete with `isPinned`, but has **zero**
  API route or UI anywhere — fully dead code.
- **`STAFF`** exists only as an orphaned `<SelectItem>` in the form with no backing in
  the `ProfileType` enum, the list page's tabs, or any API validation — selecting it
  today silently creates an invisible, unfilterable profile.
- **No Stay History / detail view exists** — `[upid]/edit/page.tsx` is the only
  per-profile page; there's no read-only view, and nothing surfaces past/future
  reservations or revenue for a guest.
- **`ProfileForm.tsx` is shared** with the Debtors "New Credit Account" flow via
  `contextMode="debtor"` (forces `isCreditAccount=true`, hides GUEST/STAFF from the
  type list, redirects to `/dashboard/debtors/{upid}`) — every change here must
  preserve that branch.
- **AR fields** (`arNumber`, `creditLimit`, `isCreditAccount`, `iataNumber`,
  `commissionRate`) are explicitly **out of scope** — "AR keep as it is."

## Architecture decisions

- **`ProfileContact` is retired**, replaced by two focused models:
  - **`ProfileCommunication`**: `type` (`EMAIL` | `MOBILE` | `SOCIAL`, fixed 3-value
    enum, not an admin LOV — the owner only asked for VIP Level and Preferences to be
    configurable), `value` (validated per type — email format for EMAIL, a loose phone
    pattern for MOBILE, free text for SOCIAL), `isPrimary`.
  - **`ProfileAddress`**: `type` (`HOME` | `BUSINESS` | `BILLING`, same fixed-enum
    convention), `fullAddress` (one free-text block, not street-line-broken, per the
    owner's exact spec), `city`, `stateProvince`, `postalCode`, `country`, `isPrimary`.
  - A one-time backfill (Prisma Client script, same pattern as the Base Rate Plan
    migration) splits each existing `ProfileContact` row into a `ProfileCommunication`
    (email + mobile, if set) and a `ProfileAddress` (if any address field was set)
    before the column-dropping migration runs.
- **`ProfileDocument` (Identification) upgraded to real per-row CRUD** — add/edit/
  delete individual documents instead of destructive replace-all, matching the
  multi-row + "at least one primary" requirement shared by Communications, Address,
  and Identification.
- **`ProfileAttachment`** (new, minimal): `label`, `url`, `createdAt` — a clickable
  reference list, not a file-upload system (owner-confirmed).
- **`ProfileNote` wired up** — real CRUD, surfaced as a running, dated feedback/
  complaints/notable-things log per profile (`isPinned` already in the schema for
  pinning important ones to the top).
- **VIP Level**: new `Profile.vipLevel String?`, driven by a new `SystemCode` category
  `VIP_LEVEL`, configurable via the existing Dropdowns Manager mechanism (append one
  entry to `PROFILE_LOV_CATEGORIES` — no schema change needed for the LOV itself, per
  `SystemCode.category` already being a free string). `loyaltyTier` is dropped.
- **Preferences**: new `SystemCode` category `PREFERENCE` (general guest preferences,
  distinct from the existing room-specific `ROOM_PREF` and `DIETARY_REQ` categories),
  rendered as a genuine multi-select writing multiple `ProfilePreference` rows with
  `category: "PREFERENCE"`. **Dietary Requirements** becomes a real multi-select too
  (currently a single `SystemCodeSelect` mapped to one row) — same `ProfilePreference`
  model, `category: "DIETARY"`, just multiple rows instead of one.
- **Nationality** is split out as its own `Profile.nationality String?` (SystemCode
  `NATIONALITY`-driven) — today the same LOV is reused ambiguously for address country
  *and* document issuing country *and* nationality. After this change: `nationality`
  is a fixed Profile-level fact; `ProfileAddress.country` and
  `ProfileDocument.issuingCountry` are per-row and independent.
- **`Profile.middleName String?`** added (Personal Information: title/first/middle/
  last/gender/lang).
- **STAFF becomes a real `ProfileType`** (`GUEST | COMPANY | TRAVEL_AGENT | STAFF`),
  added to the enum, the list page's tabs, and API validation. STAFF is grouped with
  GUEST as an "individual person" profile (full Personal Information + Identification
  shown) — **not** with COMPANY/TRAVEL_AGENT's single-Name "entity" shape. **No
  relation to `User`** (owner-confirmed) — purely a 4th directory bucket.
- **Consolidated single table, per-type field visibility** (owner-confirmed, matches
  existing `isB2B` derived-flag convention in `ProfileForm.tsx`, just extended):
  - **GUEST / STAFF** ("individual"): Personal Information + Identification sections
    shown in full, `firstName`/`lastName`/`middleName`/`title` all apply.
  - **COMPANY / TRAVEL_AGENT** ("entity"): Personal Information collapses to a single
    Name field (`companyName`, as today); Identification section hidden entirely
    (an entity has no passport/national ID). Communications, Address, CRM,
    Attachments, Notes, AR still apply to entities exactly as they do today.
- **"No of Visits to Property" is a live-computed count**, not a stored column —
  Profile has no `propertyId`, so a per-property visit count can't live on the model
  itself. Computed on read (count of this profile's `CHECKED_OUT` reservations at the
  *current* property context) and shown only when the profile is viewed under an
  active property — this is the natural consequence of Profiles being enterprise-wide
  while Reservations are property-scoped (same pattern Debtors already uses for
  per-property AR balances). **"No of Visits to Property Chain (Enterprise)"** is the
  existing `Profile.totalStays` (already enterprise-wide, just relabeled in the UI).
- **Origin property tracking** (the owner's own forward-looking suggestion): new
  `Profile.originPropertyId String?` (nullable FK, `onDelete: SetNull`), set once at
  creation time from the active property context and never changed afterward — a
  lightweight breadcrumb ("first seen at Property X"), not a scoping mechanism (a
  profile is still fully shared/usable across every property in the enterprise).
- **Stay History**: a new read-only view (Future = `RESERVED`/`IN_HOUSE` reservations
  with a check-in date ≥ today; History = `CHECKED_OUT`) listing stay dates and a
  revenue breakdown per stay (derived from that reservation's folio line items, grouped
  by charge code — reuses the same `FolioLineItem` data every other report already
  reads, no new financial model needed).
- **No dedicated read-only Profile Detail page exists today** — one is added
  (`[upid]/page.tsx`, tabbed: Overview / Stay History), with `[upid]/edit/page.tsx`
  kept as the actual edit form. List page's row action links to the new view page;
  the view page links to Edit.
- **`contextMode="debtor"` preserved exactly**: forces `isCreditAccount=true`, hides
  GUEST/STAFF from the Profile Type selector, redirects to `/dashboard/debtors/{upid}`.
  AR/Finance & Billing card fields and behavior are untouched.

## Schema (net changes)

```prisma
model Profile {
  // ...existing fields, minus loyaltyTier...
  middleName        String?
  nationality        String?
  vipLevel           String?
  originPropertyId   String?
  originProperty     Property? @relation(fields: [originPropertyId], references: [id], onDelete: SetNull)

  communications ProfileCommunication[]
  addresses      ProfileAddress[]
  attachments    ProfileAttachment[]
  // documents, notes, preferences relations unchanged (already existed)
  // contacts ProfileContact[] REMOVED
}

model ProfileCommunication {
  id        String   @id @default(uuid())
  upid      String
  profile   Profile  @relation(fields: [upid], references: [upid], onDelete: Cascade)
  type      String   // EMAIL | MOBILE | SOCIAL
  value     String
  isPrimary Boolean  @default(false)
  createdAt DateTime @default(now())
}

model ProfileAddress {
  id            String   @id @default(uuid())
  upid          String
  profile       Profile  @relation(fields: [upid], references: [upid], onDelete: Cascade)
  type          String   // HOME | BUSINESS | BILLING
  fullAddress   String
  city          String?
  stateProvince String?
  postalCode    String?
  country       String?
  isPrimary     Boolean  @default(false)
  createdAt     DateTime @default(now())
}

model ProfileAttachment {
  id        String   @id @default(uuid())
  upid      String
  profile   Profile  @relation(fields: [upid], references: [upid], onDelete: Cascade)
  label     String
  url       String
  createdAt DateTime @default(now())
}

// ProfileDocument, ProfileNote, ProfilePreference: unchanged shape, upgraded API only.
// ProfileContact: DROPPED (after backfill).
```

## Phases

### Phase A — Schema, migration, backfill ✅
- Add `Profile` fields; add the three new models; keep `ProfileContact` present in an
  *additive* migration first (so the backfill script can read old data with the
  currently-generated client), same 2-migration pattern used for the Base Rate Plan
  rollout — never drop-and-lose in one step.
- Backfill script: for every `ProfileContact` row, emit a `ProfileCommunication`
  (EMAIL if `email` set, MOBILE if `mobile` set) and a `ProfileAddress` (HOME) if any
  address field was set; carry `isPrimary` forward.
- Second migration drops `ProfileContact`.
- `src/lib/enums.ts`: add `STAFF` to `ProfileType`.

### Phase B — Core & child-resource APIs ✅
- `/api/profiles`, `/api/profiles/[upid]`: new field set, STAFF support,
  `originPropertyId` set-once at creation from the active property context.
- New: `/api/profiles/[upid]/communications[/​[id]]`, `/​addresses[/​[id]]`,
  `/​attachments[/​[id]]`, `/​notes[/​[id]]` — real per-row CRUD.
- `/api/profiles/[upid]/documents[/​[id]]` upgraded off replace-all to per-row CRUD.
- New: `/api/profiles/[upid]/stay-history` — future + past reservations with
  per-stay revenue breakdown by charge code.

### Phase C — Controls LOV additions ✅
- `VIP_LEVEL` and `PREFERENCE` appended to `PROFILE_LOV_CATEGORIES` in
  `dropdowns-manager.tsx` — the entire mechanism, no schema change.
- Seed sample VIP levels (Silver/Gold/Platinum) and preferences for Veyo.

### Phase D — ProfileForm rebuild ✅
- New multi-row editor components (Communications, Address, Identification,
  Attachments — same interaction pattern as the Allocations price-range rows: add
  row / remove row / mark primary).
- Notes panel (add + dated list, pin toggle).
- Restructure into the owner's exact section order: Personal Information →
  Communications → Address → Identification (+ Birthdate/Nationality) → CRM
  (Anniversary, Visits-to-Property, Visits-to-Chain, Dietary multi-select,
  Preferences multi-select, VIP Level, Membership Number) → Attachments → Notes →
  Marketing/Compliance (Mail list, Green Tax Exempt, Incognito) → Finance & Billing
  (AR, untouched).
- GUEST/STAFF show Personal Information + Identification in full; COMPANY/
  TRAVEL_AGENT collapse to a single Name field and hide Identification.
- `contextMode="debtor"` branch preserved exactly.

### Phase E — Profile Detail/View page + Stay History ✅
- New `[upid]/page.tsx`: tabbed Overview (read-only rendering of every section) +
  Stay History (Future / History reservation lists with revenue breakdown).
- List page: STAFF tab added; row action links to the new view page, which links to
  Edit.

### Phase F — Tests, seed, docs, verify ✅
- Tests: communication validation per type, multi-row primary handling, backfill
  correctness, stay-history computation, STAFF flows, `contextMode="debtor"`
  regression.
- `scripts/seed/seed-veyo.ts`: VIP levels + preferences LOV, a staff profile, and
  communications/addresses/attachments/notes on a sample guest.
- `DECISIONS.md` + `TODO.md` entries; full suite + `tsc --noEmit`; live verify.
