# OstaStay (Uppsolut Stay) — start here

A multi-tenant hotel PMS: Next.js, React, Prisma, PostgreSQL. This is a team project with
several contributors, human and agent. Read this file first; it tells you what to read next.

## 1. This is NOT the Next.js you know

This version has breaking changes: APIs, conventions and file structure may all differ from
your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any
code. Heed deprecation notices.

## 2. Where the docs are

Everything is in `.agents/docs/`. The only markdown at the repository root is this file,
`CLAUDE.md` (which points here), `README.md` (quick start) and `DEPLOY.md` (server operations).

| File | What it is | Read it |
|---|---|---|
| [`TODO.md`](.agents/docs/TODO.md) | Open work only, by area | Before starting, and update it when you close or find an item |
| [`DECISIONS.md`](.agents/docs/DECISIONS.md) | Business rules the owner has given, dated | Before assuming any business rule |
| [`DEV_LOG.md`](.agents/docs/DEV_LOG.md) | Every finished plan and audit, one dated section each, with the rules that still bind | Before touching an area it covers (table below) |
| [`DESIGN_PLAN.md`](.agents/docs/DESIGN_PLAN.md) | The design system: tokens, theming, components | Before any visual change |
| [`FORM_VALIDATION_STANDARD.md`](.agents/docs/FORM_VALIDATION_STANDARD.md) | APP STANDARD 001: forms | Before building or changing a form |
| [`MOTION_PLAN.md`](.agents/docs/MOTION_PLAN.md) | How animation works and what must stay still | Before adding any animation |

### Plans in progress (one file each)

| Plan | Status | Read it before touching |
|---|---|---|
| [`AGENT_PORTAL_PLAN.md`](.agents/docs/AGENT_PORTAL_PLAN.md) | Plan only. PMS work is versioned from 9.0.1 | Reservation status, Group Blocks, availability, commission, the Tape Chart, roles and permissions, `/api/agent/**` |
| [`NOTIFICATIONS_PLAN.md`](.agents/docs/NOTIFICATIONS_PLAN.md) | N0 to N3 built (8.10.0); N4 open | The header bell, any notification or toast-like feature, the web manifest, the service worker |
| [`MARKETING_SITE_MIGRATION_PLAN.md`](.agents/docs/MARKETING_SITE_MIGRATION_PLAN.md) | Not started, on hold | `src/app/info` |

### Finished work: which dev log section to read

| If you touch | Read this section of `DEV_LOG.md` |
|---|---|
| Users, roles, sessions, `src/lib/scope.ts`, anything multi-tenant | Multi-tenancy and RBAC retrofit; User management, roles and sessions |
| Any setting or setup screen | Hub setup: Enterprise and Property |
| Revenue, meal plans, Night Audit posting | Allocations |
| Charge codes, anything that posts to a folio | Charge code hierarchy and posting service |
| `src/app/api/website/v1/**`, API keys | Website API; Booking API: Excursions and Spa |
| `src/lib/excursion-booking.ts`, `spa-booking.ts`, `spa-lifecycle.ts`, `db-lock.ts` | Excursions booking add-on; Spa booking add-on; Booking API |
| `src/lib/transport/**`, the Night Audit transport pass, `ReservationTransport` | Transportation module |
| `src/lib/channels/**`, availability pushed outside the PMS | Hub level and Channel Manager (rule D-7) |
| Reports | Daily Reports rework |
| Client Relations (profiles) | Profiles redesign |
| Page headers, toasts, list tables, dialogs | Desktop polish |
| Anything a phone shows | Mobile polish |

Code comments across `src/` cite the old plan file names (`HUB_SETUP_PLAN.md`,
`WEBSITE_API_PLAN.md W-5`, and so on). Those files are now sections of the same name in
`DEV_LOG.md`.

## 3. How the docs are kept

- **A plan gets its own file** in `.agents/docs/` while it is being planned or built, and a row
  in the table above.
- **When its work is released, the plan becomes a section of `DEV_LOG.md`** and the file is
  deleted, in the same PR as the release. The section is short: what it was, what shipped, the
  rules that still bind, where the code is. Heading: `## Name — yyyy/mm/dd hh:mm`, newest first,
  plus a row in the dev log's contents table. Move anything still open into `TODO.md`.
- **`TODO.md` holds open items only.** Delete an item when it is done. Add what you find broken
  but out of scope, with the date.
- **`DECISIONS.md` holds rules, not stories.** Add a rule the owner gives you, with the date.
  When a rule is replaced, remove or rewrite the old one.
- Do not add markdown files at the repository root.

## 4. Standing rules for code

**Forms.** Every form uses Zod + React Hook Form + shadcn/ui, with inline, real-time validation
(`FORM_VALIDATION_STANDARD.md`).

**Dropdowns.** For a long list (guests, rooms, profiles) use `SearchableSelect`, never a plain
`Select`:

```tsx
import { SearchableSelect } from "@/components/ui/searchable-select"

<SearchableSelect
  value={value}
  onChange={(v) => setValue(v)}
  placeholder="Select Item..."
  options={items.map(item => ({ label: item.name, value: item.id }))}
/>
```

**Dates.** `@/components/ui/date-picker` for a single date (it has year and month dropdowns);
`@/components/ui/date-range-picker` for a range such as check-in to check-out.

**Icons.** From `@/components/icons` (Iconsax, outline), not from an icon package directly.

**Settings.** All setup lives in the Hub, in one of two areas: ENTERPRISE
(`/hub/enterprise/…`) or PROPERTY (`/hub/p/{propertyId}/…`, the property always in the URL).
Decide which area a new setting belongs to and gate its API with `requireEnterpriseHub()` or
`requirePropertySetup()` from `src/lib/scope.ts`.

**Posting.** Every folio charge goes through `postCharge`; nothing builds a `FolioLineItem` by
hand.

**Desktop.** `PageHeader` on every page, feedback as a toast, tabs and filters in the URL,
`ListTable` for lists, one primary action with the rest behind "More".

**Phones.** Desktop is the source of truth. Phone changes live behind `max-sm:` / `max-md:` /
`md:hidden` or `pointer-coarse:`. No sideways scroll: a table becomes cards (`MobileCard`,
`MobileCardList`). Dialogs are bottom sheets (`DialogContent mobile="sheet"|"fullscreen"|"none"`).
Use `@/components/ui/mobile`, `NumberStepper`, `ContactLink`, `@/lib/input-presets`. Check with
`npm run mobile:audit` (desktop must not change).

**Animation.** Only through `src/components/dashboard/motion-kit.tsx` (`MOTION_PLAN.md`).

**Text.** Sentence case in the interface.

## 5. The public docs portal

`src/app/docs`, table of contents in `src/app/docs/nav.ts`. It has four areas, and it must
never carry a secret, a real customer or an internal detail (`npm run docs:check`).

| Area | For | Keep it in step when you change |
|---|---|---|
| `/docs/api` | Developers using the Booking API | `src/app/api/website/v1/**`; also the OpenAPI file `public/docs/booking-api.openapi.yaml` |
| `/docs/configuration` | The client's admin, setting up in the Hub | Any Hub setup screen: update its page and re-shoot its screenshot |
| `/docs/operations` | Staff, day to day | Any day-to-day screen: update its guide in the same PR |
| `/docs/release-notes` | Everyone | Every release (below) |

- Screenshots: `npm run docs:demo` (the fictional Coral Bay Hotels enterprise), then
  `npm run docs:shots -- <name>` (list in `scripts/docs-shots.config.ts`; main content only,
  never app chrome).
- PDFs: `npm run docs:pdf` (or `npm run docs:pdf -- operations`, `-- release-notes`).
- Operations guides: `desk` (Front Desk, Reservations list and badges, Tape Chart moves, split
  stays), `groups-and-clients` (Group blocks and the Posting Master, Client Relations,
  deactivating a profile, eRegistration), `daily-reports`, `transportation`, `stop-sale`. A new
  guide is added in `nav.ts` and on the operations overview page.

## 6. Releases

- `master` deploys automatically. PRs are squash-merged and always target `master`, never
  another branch.
- Before choosing a version number, look at the open PRs and `origin/release/*` and take a
  number above all of them. Versions only go up.
- **When you bump `package.json` for a release, add that version's entry at the top of
  `src/app/docs/release-notes/releases.ts`** (New / Improved / Fixed, in plain language for hotel
  staff: no file paths, PR numbers or customer names), then `npm run docs:pdf -- release-notes`.
- If the release finishes a plan, fold the plan into `DEV_LOG.md` in the same PR (section 3).
