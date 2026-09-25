<!-- BEGIN:project-docs -->
# Project docs — read this first

This is a team project (multiple contributors, human and agent). Before starting work,
read `.agents/docs/`:
- [`.agents/docs/MASTER_PLAN.md`](.agents/docs/MASTER_PLAN.md) — the multi-tenancy/RBAC
  architecture retrofit: context, architecture decisions, phase-by-phase status
  (Phase 0-4 done, Phase 5-6 not started).
- [`.agents/docs/TODO.md`](.agents/docs/TODO.md) — the actionable remaining-work list:
  what's left, what was deliberately deferred, what was found broken along the way but
  is out of scope to fix without asking first. **Update this file** when you close or
  discover an item — it's how the next session (yours or a teammate's) knows what's
  still open without reading chat history.
- [`.agents/docs/DECISIONS.md`](.agents/docs/DECISIONS.md) — business rules and design
  decisions the app owner has given verbally, dated. Check here before assuming a
  business rule, especially around Room Types, Tax/Charge Codes, Sequence Manager, and
  theming.
- [`.agents/docs/FORM_VALIDATION_STANDARD.md`](.agents/docs/FORM_VALIDATION_STANDARD.md)
  — APP STANDARD 001: every form must use Zod + React Hook Form + shadcn/ui with
  inline, real-time validation.
- [`.agents/docs/ALLOCATIONS_PLAN.md`](.agents/docs/ALLOCATIONS_PLAN.md) — Master Plan
  v2: the Allocations revenue-model extension (per-person priced components linked to
  rate plans/meal plans/reservations, posted at Night Audit). Read before touching
  Revenue, Meal Plans, or Night Audit posting.

- [`.agents/docs/USER_MANAGEMENT_PLAN.md`](.agents/docs/USER_MANAGEMENT_PLAN.md) — the
  planned move of user management to the Hub: multi-role via a join table, a real Session
  table (there is none today — sessions are stateless JWTs), idle timeout, and a job-function
  tag replacing today's role-NAME matching. Read before touching users, roles, `scope.ts`
  or anything that assumes `User.roleId`.

- [`.agents/docs/WEBSITE_API_PLAN.md`](.agents/docs/WEBSITE_API_PLAN.md) — the public
  Website API (a property's own brand website reading availability/prices and creating
  bookings through a Hub-minted key): decisions W-1…W-11, file map, open items. The
  external docs are the public portal at `/docs/api` (`src/app/docs`, one page per module),
  the OpenAPI spec `public/docs/booking-api.openapi.yaml` and the PDF built from the portal
  (`npm run docs:pdf`) — keep them in step with `src/app/api/website/v1/**`, and run
  `npm run docs:check` (published docs must carry no secret, real customer or internal detail).

- [`.agents/docs/BOOKING_API_ADDONS_PLAN.md`](.agents/docs/BOOKING_API_ADDONS_PLAN.md) —
  extending that API so brand websites can sell Excursions and Spa on the same key
  (scopes per key, instant booking, holds, guest self-cancel, webhooks, a public
  `/docs` portal). Phase status and decisions B-1…B-11. Read before touching
  `src/lib/excursion-booking.ts`, `spa-booking.ts`, `spa-lifecycle.ts` or `db-lock.ts`.

- [`.agents/docs/HUB_SETUP_PLAN.md`](.agents/docs/HUB_SETUP_PLAN.md) — all setup lives in
  the Hub, split into an ENTERPRISE area (`/hub/enterprise/…`: people, sessions, Email/SFTP,
  API keys, support access) and a PROPERTY area (`/hub/p/{propertyId}/…`: everything else,
  one property at a time, property always in the URL). Read before adding any setting:
  decide which area it belongs to, and gate its API with `requireEnterpriseHub()` or
  `requirePropertySetup()` from `src/lib/scope.ts`.

- **The public docs portal** (`src/app/docs`, table of contents in `src/app/docs/nav.ts`) has
  three areas: `/docs/api` (Booking API, for developers), `/docs/configuration` (setting up
  an enterprise and its properties in the Hub, for the client's admin and property team) and
  `/docs/operations` (day-to-day staff guides). **When you change a Hub setup screen, update
  its page under `src/app/docs/configuration`**, and re-shoot its screenshot: `npm run
  docs:demo` (the fictional Coral Bay Hotels enterprise) then `npm run docs:shots -- <name>`
  (shot list in `scripts/docs-shots.config.ts`; main content only, never app chrome).
  Rebuild the PDFs with `npm run docs:pdf` and run `npm run docs:check`.

- [`.agents/docs/MOBILE_PLAN.md`](.agents/docs/MOBILE_PLAN.md) — phones: desktop is the source of
  truth, mobile changes live behind `max-sm:`/`max-md:`/`md:hidden` or `pointer-coarse:`. Dialogs are
  bottom sheets on phones (`DialogContent mobile="sheet"|"fullscreen"|"none"`); use the shared
  `@/components/ui/mobile` (`MobileActions`, `MobileActionBar`, `DesktopOnlyNotice`), `MobileCard`/
  `MobileCardList` (phone version of a table), `NumberStepper`, `ContactLink`,
  `@/lib/input-presets` and `PageHeader`. Check a change with `npm run mobile:audit` (captures at
  phone/tablet/desktop widths + a pixel diff against a baseline — desktop must not change).

[`.agents/docs/DESIGN_PLAN.md`](.agents/docs/DESIGN_PLAN.md) is the full design-token/
theming plan (large, kept separate) — `.agents/docs/DECISIONS.md` has a short pointer to
it plus a status correction (its own header is stale — treat it as partially-to-mostly
implemented, not "planning only").
<!-- END:project-docs -->

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:ui-components-standard -->
# App Standard Components

When building forms or pages that require dropdowns or selects, use the standard custom component `SearchableSelect` located in `src/components/ui/searchable-select.tsx` if there are many options that would benefit from search/filtering. 
Do not implement standard `Select` for long lists (e.g., Guests, Rooms). 

Usage Example:
```tsx
import { SearchableSelect } from "@/components/ui/searchable-select"

<SearchableSelect
  value={value}
  onChange={(v) => setValue(v)}
  placeholder="Select Item..."
  options={items.map(item => ({ label: item.name, value: item.id }))}
/>
```
<!-- END:ui-components-standard -->

<!-- BEGIN:date-picker-standard -->
# Date Pickers
- Always use `@/components/ui/date-picker` for single dates. It natively supports year/month dropdowns.
- Always use `@/components/ui/date-range-picker` for date ranges (e.g., check-in and check-out periods).
<!-- END:date-picker-standard -->
