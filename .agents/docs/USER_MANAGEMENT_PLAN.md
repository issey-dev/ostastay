# User Management, Roles & Sessions — plan

> Status: **Phases 0-4 shipped 2026-08-04; Phase 5 (matrix report) remains.** Owner decisions taken 2026-08-04 (see the Decisions
> table). Read [MASTER_PLAN.md](MASTER_PLAN.md) for the RBAC foundation this builds on
> and [DECISIONS.md](DECISIONS.md) for the business rules.

## Why

Four problems, one of which is a live bug:

1. **No session management exists at all.** Sessions are stateless JWTs — `{ id: userId }`,
   24h, in an `auth_token` cookie ([src/lib/auth.ts](../../src/lib/auth.ts)). There is no
   `Session` table, no `jti`, no denylist. Nobody can see who is signed in, and the only
   ways to end someone else's session are indirect: deactivate the account, revoke the
   license, or the property-wide EOD watermark (`Property.eodSessionsInvalidAt`).
2. **A user has exactly one role.** `User.roleId` is a required scalar, so access can't be
   composed from overlapping grants.
3. **Job function is inferred from the role NAME string.** `u.role?.name === "Housekeeping"`
   in `dashboard/housekeeping/page.tsx`, `housekeeping/task-sheet/page.tsx` and
   `dashboard/maintenance/page.tsx`. This already conflates "what may you see" with "what
   is your post", and it breaks outright the moment a user has two roles — which is why
   the job tag is a prerequisite for multi-role, not a nice-to-have.
4. **User management sits in Controls**, which is property-facing, while the thing it
   governs (identity) is enterprise-wide.

## Decisions

| # | Decision | Consequence |
|---|---|---|
| 1 | User management moves to the **Hub**; the Hub's existing `scope === "PROPERTY"` block **stays** | Only ENTERPRISE-scoped users manage staff. A single-property GM cannot add users. |
| 2 | **Session table** with a `jti` the JWT references, plus a `lastSeenAt` stamped at most once a minute | True "active now", real uptime, instant remote termination. Costs one indexed read per request. |
| 3 | Session timeout is an **idle timeout**, per property | Needs `lastSeenAt`; enforced server-side in `requireSession`, warned client-side. |
| 4 | Multi-role via a **`UserRole` join table**; `User.roleId` is dropped | Permissions become the OR of every assigned role's CRUD bits. |
| 5 | Job function is a **tenant-defined `JOB_FUNCTION` system code, one per user** | Reuses the existing system-code editor. Replaces role-name matching. |
| 6 | **Work location stays one property per user** | No change to the scope model. |
| 7 | Permission matrix report renders as **print stationery** | Consistent with folios and reg cards. |
| 8 | **`RoomAttendant` is dropped**; `HousekeepingTask.assignedToId` repoints at `User` | One answer to "who is this assigned to". |
| 9 | The **onboarding user is protected**: undeletable, always active, always full-access, always ENTERPRISE scope | Guarantees a tenant can never lock itself out of its own Hub. |

### Why decision 9 locks scope, not just the role

Decision 1 means only ENTERPRISE-scoped users reach the Hub, and decision 4 lets roles be
edited freely. Without a protected account, an admin can remove their own last full-access
role, or switch themselves to PROPERTY scope, and **no one can undo it from inside the
tenant** — it becomes an Osta support ticket every time. The protected user is the floor
that makes the rest of the model safe to hand to a tenant.

---

## Phase 0 — Schema — **DONE (2026-08-04)**

One migration, additive except where noted.

```prisma
model Session {
  id           String   @id @default(uuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  // Matches the JWT's jti. The token is still the credential; this row decides whether
  // it is still honoured.
  jti          String   @unique
  createdAt    DateTime @default(now())
  lastSeenAt   DateTime @default(now())
  expiresAt    DateTime
  revokedAt    DateTime?
  revokedByUserId String?
  // Captured at login for the "whose session is this" column. Never used for auth.
  ipAddress    String?
  userAgent    String?
  // The property in play when the session was minted — lets the list group by location
  // and the idle timeout resolve which property's setting applies.
  propertyId   String?

  @@index([userId])
  @@index([expiresAt])
}

model UserRole {
  userId String
  roleId String
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role   Role @relation(fields: [roleId], references: [id], onDelete: Cascade)
  @@id([userId, roleId])
  @@index([roleId])
}

model User {
  // roleId / role REMOVED — see the backfill below
  roles         UserRole[]
  sessions      Session[]
  // JOB_FUNCTION system code. Nullable: a manager needn't have a post.
  jobFunction   String?
  // The onboarding account. Exactly one per enterprise; enforced in application code
  // (a partial unique index is Postgres-specific and this is cheap to assert).
  isProtected   Boolean @default(false)
}

model Property {
  // 0 = disabled. Minutes of inactivity before a session is dropped.
  sessionIdleMinutes Int @default(0)
}
```

**Backfill, in the same migration:** insert one `UserRole` per existing `User.roleId`
before dropping the column, and set `isProtected = true` on each enterprise's oldest
ENTERPRISE-scoped user holding a full-access role. Both are plain SQL — no data is
inferred or guessed.

`RoomAttendant` is dropped and `HousekeepingTask.assignedToId` is repointed at `User`.
Any existing task rows must be remapped via `RoomAttendant.userId` first; if the table is
empty (it has no `src/` references, so it very likely is), the migration is a no-op and
should still assert that rather than assume.

---

## Phase 1 — Multi-role — **DONE (2026-08-04)**

The research flagged 11 call sites that assume one role. In order:

- `requireSession` ([scope.ts](../../src/lib/scope.ts)) — build the permission map by
  OR-ing every assigned role's CRUD bits. **This is the security-critical change**: a bug
  here either over-grants or locks everyone out, so it is the one piece that gets its own
  tests before anything else is written.
- `backfillMissingRolePermissions` — currently keyed off one role's name/`isSystem`. Runs
  per role instead.
- `AuthContext.roleId` → `roleIds: string[]`.
- `/api/settings/users` POST/PATCH — accept `roleIds[]`; `resolveRoleId` becomes plural.
- `/api/roles/[id]` DELETE — the "role still has users" guard reads the join table.
- Controls role matrix + the user dialog's single `<Select>` → multi-select.

**Test first, then migrate.** A pure `mergeRolePermissions(roles[])` in a testable module,
covering: union of disjoint grants (the owner's Role 1 + Role 2 example), overlapping
grants, one role granting nothing, a module absent from every role, and — the case worth
pinning explicitly — that a role granting `view` never silently confers `delete`.

---

## Phase 2 — Sessions — **DONE (2026-08-04)**

- `createSession` mints a `jti`, writes the `Session` row, and puts the `jti` in the JWT.
- `requireSession` loads the session by `jti`: reject if missing, revoked, or expired.
  Stamp `lastSeenAt` when it is older than 60s — a bounded write, not one per request.
- `destroySession` (logout) sets `revokedAt`.
- Idle timeout: if `sessionIdleMinutes > 0` and `now - lastSeenAt` exceeds it, revoke and
  throw the same shape as `EodLockoutError` so the existing client watcher can render it.
- A sweeper deletes rows past `expiresAt` (Night Audit is the natural host — it already
  runs per property, per day).

**Interaction with EOD force-logout:** `Property.eodSessionsInvalidAt` compares against the
JWT's `iat` and still works unchanged. Once sessions are rows, EOD could revoke them
directly instead — cleaner, but it is a behaviour change to a working safety mechanism, so
it stays as-is in this phase and is noted as a follow-up.

---

## Phase 3 — Hub move — **DONE (2026-08-04)**

- New `USERS` module in `MODULES` (and its hand-synced twin in
  [prisma/rbac-seed-data.ts](../../prisma/rbac-seed-data.ts) — the two lists already drift;
  this plan does not fix that, but every edit must touch both).
- Added to `HUB_MODULES`. Admin and Manager get it in `SYSTEM_ROLE_DEFS`; nobody else.
- Hub pages: **People** (roster CRUD, roles, work location, job function), **Sessions**
  (active list, uptime, terminate), **Permission Matrix** (report).
- Controls' "Users & Roles" tab is replaced by a single **Session Timeout** control per
  property.

**The consequence that needs handling, not just noting:** property-scoped users lose all
user management — but the housekeeping and maintenance boards still need to *list* people
to assign work. So `GET /api/settings/users` must survive as an assignment lookup, gated on
`HOUSEKEEPING`/`MAINTENANCE` view, returning a minimal shape (id, name, job function,
isActive) rather than the management payload. Without this, decision 1 silently breaks room
assignment.

---

## Phase 4 — Job function — **DONE (2026-08-04)**

Built first, out of order, because it fixes a live bug on its own and is a prerequisite
for multi-role.

- [`src/lib/job-functions.ts`](../../src/lib/job-functions.ts) — the `JOB_FUNCTION`
  category name, the two codes business logic depends on (`HOUSEKEEPING`, `MAINTENANCE`),
  the seeded default list, `ensureJobFunctions()` in the shape of `ensureChargeTree`, and
  the `housekeepingStaff` / `maintenanceStaff` predicates.
- `User.jobFunction` + migration `20260804120000_user_job_function`, which also seeds the
  category for every existing enterprise and **backfills each user's post from their role
  name**. Without that backfill the boards would come up empty on deploy, since the
  filters switch in the same release.
- The three role-name filters now select on post: `dashboard/housekeeping/page.tsx`,
  `housekeeping/task-sheet/page.tsx`, `dashboard/maintenance/page.tsx`.
- Controls: `JOB_FUNCTION` added to `OPERATIONS_LOV_CATEGORIES` (editable like
  `NATIONALITY`), a Job Function field on the user dialog, and a Post column on the roster.
- `ensureJobFunctions` runs on property creation, so a newly onboarded enterprise has the
  list from day one.
- 10 tests in `tests/business-rules/job-functions.test.ts`, including the case the old
  filter got wrong: a housekeeper also granted Front Desk access.

Left for the Hub move (Phase 3): the field lives on the Controls user dialog for now,
since that is where user CRUD still is.

---

## Phase 5 — Permission matrix report

Roles down, modules across, CRUD ticks per cell, rendered through the print stationery
components. Add a users-per-role appendix so it answers "who actually has this" rather than
only "what does this role grant".

---

## Sequencing and risk

Phases 0-2 are one deployable unit (schema, multi-role, sessions) and the riskiest — they
touch `requireSession`, which every request in the app funnels through. **A bug here locks
every tenant out of production.** Mitigations: the permission merge is pure and tested
before use; the session lookup fails *closed* only for missing/revoked rows and never for a
transient DB error; the migration backfills `UserRole` before dropping `roleId`.

Phases 3-5 are additive UI and can ship separately.

## Deliberately out of scope

- Multi-property work locations (decision 6).
- Reworking EOD force-logout onto the session table.
- Deduplicating the two `MODULES` lists.
- SSO / 2FA / password policy.
- Per-user permission overrides — roles remain the only grant mechanism.


---

## What actually shipped in 0-2 (2026-08-04)

- `src/lib/role-permissions.ts` — the pure merge, written and tested (21 cases) before
  anything called it. Access is the OR of every held role, per module per action.
- `src/lib/session-store.ts` — session lookup, bounded activity stamp, revocation, the
  pure idle rule, and the expiry purge.
- `auth.ts` — the JWT now carries a `jti`; `createSession` writes the row before setting
  the cookie, and `destroySession` revokes it so a copied cookie can't outlive a sign-out.
- `requireSession` — loads the session, refuses it if missing/revoked/expired, merges
  every held role, enforces the idle timeout, then stamps activity. The idle check runs
  BEFORE the stamp, or every request would refresh the clock it is measured against.
- `AuthContext.roleId` → `roleIds: string[]`, plus `sessionId`/`sessionJti`.
- Migration `20260804160000_multi_role_and_sessions` — backfills `UserRole` from every
  user's existing `roleId` before dropping the column, and marks each enterprise's oldest
  active enterprise-scoped full-access admin as `isProtected`.
- 122 `roleId:` create-sites across 77 files rewritten to `roles: { create: ... }`.
- Users API takes `roles[]`, replaces them wholesale on PATCH, refuses to delete /
  deactivate / demote / re-role a protected account, and revokes live sessions on
  deactivation. Onboarding creates its account with `isProtected: true`.
- Controls: roles are a multi-select; the roster shows every role a user holds.
- Property `sessionIdleMinutes` (0 = off, floor of 5), and Night Audit purges expired rows.

**Everyone signed in at deploy time is signed out**: tokens minted before this carry no
`jti`, so there is no row to honour them. That is deliberate — honouring un-revocable
tokens for up to 24h would defeat the point of building revocation.

**Not built here** (Phase 3, the Hub move): the active-sessions list and the terminate
button. The mechanism exists — `revokeSessionById` and `revokeAllForUser` — but nothing
surfaces it yet, so today a session can only be ended by logging out, deactivating the
user, the idle timeout, or EOD.


---

## What shipped in Phase 3 (2026-08-04)

- `USERS` module added to `MODULES` (and its hand-synced twin in `prisma/rbac-seed-data.ts`)
  and to `HUB_MODULES`. Admin and Manager map over `MODULES`, so they receive it
  automatically; `backfillMissingRolePermissions` grants it to existing system roles on
  their next request and denies it to custom roles, which is the intended default.
- Hub gains **People** (`hub/people`) and **Sessions** (`hub/sessions`), both re-asserting
  `requireHubAccess` + `requirePermission(USERS, …)` rather than trusting the layout.
- `GET/DELETE /api/hub/sessions` — the live list with server-computed uptime and idle, and
  termination. Scoped to the caller's enterprise on the way IN, so an id from another
  tenant reads as not-found rather than being revoked.
- Controls' "Users & Roles" tab is now **Session Timeout** only, per property, with a
  5-minute floor matching the server.
- `UsersRolesManager` moved to the Hub unchanged — it took `actorScope` as a prop and never
  used `PropertyProvider`, which the Hub deliberately lacks.

### The bug this uncovered

`/api/settings/users` required `CONTROLS view`, and the housekeeping and maintenance boards
fetched it to populate their assignment pickers. The stock **Housekeeping role has no
CONTROLS at all** — so a housekeeper opening their own board got a 403 and an empty
attendant list. That was live before this phase and independent of it.

Fixed by splitting the two concerns rather than widening the gate: **`GET /api/staff`** is
an operational lookup (id, name, post, active) gated on `HOUSEKEEPING`/`MAINTENANCE`/`USERS`
view, and returns enterprise-wide staff plus the caller's own property. Administration
stays on `/api/settings/users`, now gated on `USERS` — which no property-scoped user can
hold. Without this split, moving user management to the Hub would have broken room
assignment outright.
