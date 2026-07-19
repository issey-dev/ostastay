# Master Plan v1 — Enterprise / Property / Support Multi-Tenancy + RBAC

> **Status legend**: ✅ done · 🚧 in progress · ⬜ not started
> **Overall**: Phase 0–6 ✅ done. See [TODO.md](TODO.md) for the actionable breakdown and every loose end discovered along the way.

This document is the canonical, in-repo copy of the retrofit plan originally written during
plan-mode design (previously only saved to a local Claude Code plan file outside the repo,
which other contributors/agents could not see). It is transcribed here verbatim (structure
preserved) specifically so any future agent session or teammate opening this repo has the
full context without needing chat history.

---

## Context

OstaStay currently runs as a single-tenant demo: nearly everything is hardcoded to one
seeded `Tenant`/`Property` pair (literal UUID `00000000-0000-0000-0000-000000000000`
appears in ~20 files), `User.role` is a free-text string with three mutually
inconsistent lists across the codebase, and ~63 of ~70 API routes have **no auth check
at all** — tenant/property scoping is either client-supplied and trusted, hardcoded to
the demo constant, or simply absent (several routes return every row across every
tenant when a filter param is omitted). This is fine for a single-customer proof of
concept but breaks completely the moment a second real customer exists.

The business goal is to turn this into a real multi-tenant SaaS with three actors:
**Enterprise** (the paying customer, one or more guest houses), **Property** (a single
guest house under an Enterprise), and **Support** (Osta's own internal team, who
troubleshoot other enterprises' configuration only after that enterprise's own admin
explicitly grants time-boxed access). Users are either Enterprise-scoped (see every
Property under their Enterprise) or Property-scoped (a single "work location"). RBAC
should be a simple per-module CRUD matrix assigned via a small `Role` entity. Osta
itself becomes just another Enterprise (`type = INTERNAL`) so there is one login/session
system, not two. Licensing today only needs to cap Properties-per-Enterprise and carry
a Standard/Pro/Max tier scaffold for future module gating (the actual tier→module
mapping is not decided yet — build the scaffold, not the enforcement). Finally, the
existing "Settings" tab structure has been renamed "Controls" and extended (not
rebuilt) with Users & Roles, Licensing (Osta-only), and Support Access sections.

Confirmed decisions from the app owner: enterprise login uses a **path-based** URL
(`ostastay.com/e/{slug}/login`), that URL applies **only to login** (the dashboard stays
at `/dashboard/...` internally, redirecting to `/e/{slug}/dashboard/...`; real isolation
is enforced by the session server-side, not by the URL), and the license "Facilities"
limit means **max Properties per Enterprise** plus a **Standard/Pro/Max tier scaffold**
for future module gating.

This plan was validated against the actual codebase (schema, `auth.ts`, `proxy.ts`,
sidebar, settings tabs, ~15 representative API routes) and refined via a design pass
that caught two important corrections folded in below: system roles must belong to the
Osta enterprise (never a nullable `enterpriseId`, which would break SQLite's unique-index
handling of NULLs), and the JWT carries no authorization claims at all — every
request re-fetches the live `User` row instead of trusting a 24h-stale token.

## Architecture decisions

- **Renamed `Tenant` → `Enterprise`** everywhere (model, `tenantId` → `enterpriseId` in
  the schema and API route files, JWT, sidebar, property-provider, seed scripts).
- **`Enterprise` gained** `slug` (unique, for `/e/{slug}/login`) and `type`
  (`STANDARD | INTERNAL` — exactly one `INTERNAL` row, "Osta", holds support users).
- **`EnterpriseLicense`** (1:1 with Enterprise): `tier` (`STANDARD | PRO | MAX`),
  `maxProperties Int`. Enforced at Property-creation time only.
- **`TierModuleAccess` scaffold**: `{tier, module, enabled}` unique on
  `(tier, module)`, seeded so `STANDARD` has every module enabled and `PRO`/`MAX` are
  empty for now. A `requireModuleLicensed()` helper **fails open** (allows) when no row
  matches — this is intentionally inert until the real Standard/Pro/Max feature split is
  supplied later; it must not be mistaken for real enforcement.
- **`Role` + `RolePermission`, replacing free-text `User.role`.** `Role`:
  `{enterpriseId, name, isSystem}`, unique on `(enterpriseId, name)` —
  **`enterpriseId` is never nullable.** System/default roles (Admin, Front Desk,
  Housekeeping, etc.) are owned by the Osta enterprise itself (`isSystem = true`);
  "roles visible to enterprise X" = that enterprise's own roles **union** Osta's system
  roles. `RolePermission`: `{roleId, module, canView, canCreate, canUpdate, canDelete}`
  unique on `(roleId, module)`. Module taxonomy (`src/lib/modules.ts`):
  `FRONT_DESK, RESERVATIONS, GROUP_BLOCKS, TAPE_CHART, PROFILES, HOUSEKEEPING,
  MAINTENANCE, CASHIERING, POS, NIGHT_AUDIT, REVENUE, REPORTS, CONTROLS`. A single
  `CONTROLS` module is enough — Licensing/Support Access are gated by
  `enterprise.type === 'INTERNAL'`, not a finer permission; "Users & Roles" being more
  sensitive than "Payment Methods" is handled by an explicit rule (a user can never
  assign a role more privileged than their own), not a second module.
- **`User` gained** `scope` (`ENTERPRISE | PROPERTY`, default `ENTERPRISE`), `propertyId`
  (nullable — the single work-location for a `PROPERTY`-scoped user), `roleId`
  (replaces `role`). One property per property-scoped user is deliberate.
- **`SupportAccessGrant`**: `{enterpriseId (target), requestedByUserId,
  approvedByUserId?, status: PENDING|APPROVED|DENIED|REVOKED|EXPIRED, reason?,
  requestedAt, respondedAt?, expiresAt?, revokedAt?}`. Osta support users are ordinary
  `User` rows under the one `INTERNAL` enterprise — same login, same session, same
  Role/RolePermission mechanism as every other user. No second auth system.
- **"Acting as Enterprise X" mechanism**: a second short-lived httpOnly cookie,
  `support_session` (separate JWT: `{actingUserId, targetEnterpriseId, grantId, exp}`),
  minted only by `POST /api/support-access/enter/[grantId]` (only the grant's own
  requester, only if `APPROVED` and unexpired) and cleared by
  `POST /api/support-access/exit`. The one function every route already calls,
  `requireEnterpriseId()`, is the single choke point: if `support_session` is present it
  re-verifies the grant is still live **from the DB on every request** and returns the
  target enterprise id instead of the user's home one; a revoked/expired grant hard-fails
  the request with 403 and clears the cookie, rather than silently falling back. This means
  none of the retrofitted routes ever need their own support-access logic — they all
  just call `requireEnterpriseId()` / `requireSession()`.
- **JWT is simple**: since authorization always re-fetches the live `User` row (role,
  enterpriseId, propertyId, isActive), the JWT payload carries no authorization claims
  at all — just `{id, exp}`.
- **Schema tooling**: `prisma migrate diff --from-migrations ... --script` +
  `prisma migrate deploy` (never `migrate dev` — no interactive TTY in this environment).
  Prisma CLI resolves relative SQLite paths relative to `prisma/schema.prisma`'s
  directory (real db: `prisma/dev.db`). On Windows, the Next.js dev server holds the
  native Prisma query-engine `.dll.node` open — stop it (`taskkill //PID <pid> //F`,
  found via `netstat -ano | grep ":3000"`) before every `npx prisma generate`.

## Known bugs this retrofit has closed

- `src/app/api/properties/route.ts` — removed the `const isSuperAdmin = true;` dead
  stub and the auto-`upsert` of a "Demo Tenant" from client-supplied `body.tenantId`.
- `DEMO_TENANT_ID` hardcodes removed from `folios/[id]/invoice-data`,
  `folios/[id]/line-items`, `pos/charge`, `reservations/route.ts`,
  `tenant-settings/route.ts` — all resolve enterprise id from the session.
- `src/app/api/settings/users/route.ts` — was the highest-severity item (no auth check
  on any verb, PATCH let a client set any user's role/enterprise from raw body input) —
  fixed.
- Routes that silently returned every row across every tenant when a filter param was
  omitted (`reservations`, `rooms`, `profiles`, `rate-plans`, `maintenance` GETs) —
  fixed to mandatory session-derived scoping.
- `src/components/providers/property-provider.tsx` — was fully dead/hardcoded, rebuilt
  as a real provider.
- `src/app/dashboard/settings/facilities/page.tsx` and `.../settings/dropdowns/page.tsx`
  — orphaned duplicate pages folded into Controls tabs and deleted.
- **Discovered mid-retrofit, not in the original list** (see [TODO.md](TODO.md) "Fixed along the way" for the fuller log): `charge-codes/[id]/route.ts` and `taxes/[id]/route.ts` had zero auth at all; `night-audit/status/route.ts` was reading the wrong Prisma model entirely (`nightAuditLog` instead of `propertyNightAuditLog`); `reports/arrival-pdf` / `departure-pdf` leaked every property's data across an entire enterprise to property-scoped users; `folios/[id]/payments/route.ts` had a `"mock-shift-id"` demo hack that silently created shifts under a hardcoded fake user id.

## Phased rollout

**Phase 0 — Schema & authorization foundation.** ✅ Done.
Full schema diff (Enterprise rename + `EnterpriseLicense` + `TierModuleAccess` +
`Role`/`RolePermission` + `SupportAccessGrant` + `User` additions). `src/lib/auth.ts`
(`{id, exp}`-only JWT), `src/lib/scope.ts` (`requireSession()`, `requireEnterpriseId()`,
`requirePropertyScope()`, `requirePermission(ctx, module, action)`,
`assertPropertyAccess(ctx, propertyId)`, the support-session choke point). Seed scripts
rewritten to create the Osta `INTERNAL` enterprise + system roles, one demo `Enterprise`
with an `EnterpriseLicense`, users by `roleId`. Vitest added
(`tests/scope.test.ts`).

**Phase 1 — Identity, Controls UI & enterprise login.** ✅ Done.
`properties/route.ts` (+`[id]`) retrofitted, `tenants/route.ts` → `enterprises/route.ts`,
`roles`/`role-permissions`, `licenses`, `support-access` routes added,
`settings/users/route.ts` retrofitted. Controls redesigned:
`src/app/dashboard/settings/` → `src/app/dashboard/controls/`, config-array-driven tabs.
"Users & Roles", "Licensing" (Osta-only), "Support Access" tabs added.
`/e/[slug]/login` added; generic `/login` also resolves by slug/code first with one
identical generic error for wrong-slug/wrong-email/wrong-password (no enumeration).
`property-provider.tsx` rebuilt as a real provider. Sidebar filter in
`app-sidebar.tsx` now checks `RolePermission.canView` per module.

**Phase 2 — Core reference & configuration data.** ✅ Done.
`buildings`, `floors`, `room-types`, `rooms`, `rate-plans` (+`price-calendar`,+`bulk`),
`charge-codes`, `payment-methods`, `taxes`, `facilities`, `settings/system-codes`,
`tenant-settings` → enterprise-settings.

**Phase 3 — Guest & booking data.** ✅ Done.
`profiles` (+`[upid]`), `reservations` (+ its 8 sub-routes), `groups` (+`pickup`),
`rooms/available`, `reservations/tape-chart`, `tape-chart`.

**Phase 4 — Money & shift data.** ✅ Done.
`folios` (+3 sub-routes), `payments`, `pos/charge`, `pos/search`, `night-audit`
(run/status), `reports/arrival-pdf`, `reports/departure-pdf`. See
[DECISIONS.md](DECISIONS.md) for the two real bugs fixed along the way (arrival/departure
PDF cross-property leak, night-audit/status wrong model) and the `tests/tenant-isolation/money.test.ts`
coverage (9 tests, all passing).

> `cashiering` (open/close/status routes) was listed in the original Phase 4 scope and,
> though not part of the Phase 4 commit itself, was confirmed already retrofitted
> (`requireSession`/`requirePermission` present in all three routes) — Phase 4 is fully
> closed.

**Phase 5 — Operations.** ✅ Done.
`housekeeping` (+`maintenance`,+`tasks`), `maintenance` (+`[id]`) retrofitted onto
`requireSession`/`requirePermission`/`assertPropertyAccess`. The raw `new PrismaClient()`
in `housekeeping/route.ts` and `housekeeping/maintenance/route.ts` was replaced with the
shared `@/lib/db` import. `maintenance/route.ts` GET's `propertyId` filter, previously
optional (the specific cross-enterprise leak named in the master plan's original bug
list), is now mandatory + `assertPropertyAccess`-checked. Bulk room-status/maintenance
writes (`housekeeping` PATCH, `housekeeping/maintenance` POST) validate every targeted
room's property before touching any of them, same pattern as `rooms/route.ts`. Attendant
assignment (`assignedAttendantId`/`assignedToId`) now 404s if the referenced user isn't
in the caller's enterprise. `tests/tenant-isolation/operations.test.ts` (25 tests).

**Phase 6 — Remaining routes & final hardening.** ✅ Done.
`analytics` (raw `new PrismaClient()` replaced with shared `@/lib/db`) and
`front-office/summary` retrofitted onto `requireSession`/`requirePermission`/
`assertPropertyAccess` (REVENUE and FRONT_DESK modules respectively). `auth/seed`
gated behind `NODE_ENV !== "production"` (404 in prod) — it creates accounts with a
well-known password and had zero auth of its own; the "[Dev Tool] Seed Initial Users"
button on `/login` is hidden the same way. Fixed a real bug surfaced by adding the
`front-office/summary` scoping check: `front-office/page.tsx` had a leftover hardcoded
`00000000-0000-0000-0000-000000000000` propertyId (the pre-retrofit `DEMO_TENANT_ID`
pattern) instead of `useProperty()` — previously masked because the route had no auth
to reject it, so it just silently returned empty data. `tests/tenant-isolation/
reporting.test.ts` (6 tests). See [TODO.md](TODO.md) "Recently completed" for the full
writeup, including the manual-smoke-pass verification approach taken (automated
`tests/scope.test.ts`/`tenant-isolation/*` coverage for most of the 7-item checklist
below, plus live browser verification of the specific routes changed in Phases 5-6).

Each phase 1-6 follows the same shape: retrofit auth via `src/lib/scope.ts`, standardize
validation onto Zod, add a `tests/tenant-isolation/<domain>.test.ts` file.

## Verification

- **Automated**: `tests/scope.test.ts` (Phase 0) plus one `tests/tenant-isolation/*`
  file per phase 1-4 (existing) — seed two Enterprises with one Property each via the
  real seed helpers, seed a user per enterprise, call the actual route handlers as
  Enterprise A's session, assert Enterprise B's rows never appear and cross-enterprise
  writes 403. Run `npm run test` after every phase. `tests/room-types/inactive.test.ts`
  additionally covers the Room Type inactive-cascade business rule (see
  [DECISIONS.md](DECISIONS.md)).
- **Manual smoke checklist** (run once per phase against the real dev server, not just
  at the end):
  1. Log in as an `ENTERPRISE`-scoped user of Enterprise A — property switcher shows only
     A's properties, sidebar shows only permitted modules.
  2. Log in as a `PROPERTY`-scoped user — no property switcher, data restricted to that
     one property.
  3. As Enterprise A's admin, try to fetch/mutate a known Enterprise B resource id
     (e.g. via devtools) — expect 403/404, never data.
  4. As an Osta user with no grant, hit any Enterprise A route — expect 403.
  5. Request support access as an Osta user, approve as Enterprise A's admin, enter
     support mode, confirm the "Acting as Enterprise A" banner and real data access;
     exit and confirm access reverts; revoke mid-session as the approver and confirm the
     very next request is denied.
  6. Create properties up to `maxProperties`, confirm the next one is rejected with a
     clear licensing error; raise the limit via Licensing as an Osta user, confirm it
     now succeeds.
  7. Log in via `/e/{wrong-slug}/login` with valid credentials for a *different*
     enterprise — confirm the same generic error as a wrong password.

  **Status as of Phase 6 completion (2026-07-18)**: not re-run as a fresh manual
  click-through item-by-item. Items 1-5 (enterprise vs. property scope, cross-enterprise
  403, support-access grant approve/enter/revoke) are deterministically covered by
  `tests/scope.test.ts` and the `tenant-isolation/*` suites, which call the real
  `src/lib/scope.ts` functions and route handlers rather than mocks. Items 6-7
  (license-limit enforcement at the `properties` POST route, wrong-slug login) were
  verified by reading the route code, not by a fresh end-to-end click-through. If a true
  manual pass is wanted, it's the one piece of the original plan's intent not literally
  executed by hand — see [TODO.md](TODO.md).

### Critical files
- `prisma/schema.prisma`
- `src/lib/auth.ts`, `src/lib/scope.ts`
- `src/proxy.ts`
- `src/app/api/settings/users/route.ts`, `src/app/api/properties/route.ts`
- `src/components/providers/property-provider.tsx`, `src/components/app-sidebar.tsx`
- `src/app/dashboard/controls/` (formerly `settings/`)
- `prisma/seed-operations.ts`, `prisma/seed-profiles.ts`, `src/app/api/auth/seed/route.ts`
- `prisma/rbac-seed-data.ts` (`SYSTEM_ROLE_DEFS`, `ensureRoles` — used directly by tests)
