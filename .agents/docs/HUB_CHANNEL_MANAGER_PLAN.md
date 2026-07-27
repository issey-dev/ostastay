# Hub Level + Channel Manager (Beds24) — Plan

> Status: **DRAFT / design only — nothing implemented.** Written 2026-07-27.
> Read [MASTER_PLAN.md](MASTER_PLAN.md) for architecture, [DECISIONS.md](DECISIONS.md) for prior rulings.

Two separable pieces of work, deliberately kept apart:

1. **Hub level** — a new enterprise-level shell with **no PMS functionality**. Ships first, standalone.
2. **Channel manager (Beds24)** — the first thing that *lives inside* the Hub.

The Hub is not "for" the channel manager. The channel manager is simply its first tenant. Other
enterprise-common configuration moves in later.

---

## Part 1 — Hub level

### The problem

Today, logging in lands you in the property-centric PMS shell
(`src/app/e/[slug]/dashboard/**`) with a property switcher in the sidebar. Everything assumes a
selected property. There is no place to stand that is *above* properties and enterprise-wide by
nature — the closest thing is the `CONTROLS` module, which is an ordinary property-shell page.

### The rule

**The Hub contains zero PMS functionality.** No front desk, no reservations, no housekeeping, no
folio — nothing that operates on a property's day-to-day. If a screen needs a `propertyId` to make
sense as an *operation*, it does not belong in the Hub.

The Hub may still *reference* properties as configuration objects (which property maps to which
Beds24 property, which room types are shared). That is configuration, not operation.

### Structural enforcement

The rule is enforced by construction, not by discipline:

```
src/app/e/[slug]/hub/layout.tsx      ← deliberately does NOT mount PropertyProvider
src/app/e/[slug]/hub/**              ← no useProperty() available anywhere in the subtree
```

Without `PropertyProvider`, `useProperty()` throws, `currentProperty` does not exist, and every
property-centric component in the codebase fails to mount. A PMS feature *cannot* be accidentally
added to the Hub — it will not render.

**Precedent:** `src/app/osta/layout.tsx` already does exactly this. Its own comment states it is
"a completely separate shell from the tenant dashboard: no PropertyProvider/property switcher/
banner, since Osta has no operational property of its own." The Hub is the tenant-facing sibling
of that shell. Copy its shape; gate it on a tenant permission instead of `ctx.isInternal`.

### Layout

| | Property shell (`/e/{slug}/dashboard`) | Hub shell (`/e/{slug}/hub`) | Osta shell (`/osta`) |
|---|---|---|---|
| Audience | Property operators | Enterprise admins | Osta staff |
| `PropertyProvider` | yes | **no** | no |
| Property switcher | yes | **no** | no |
| Property banner | yes | **no** | no |
| PMS modules | all | **none** | none |
| Gate | module permissions | new Hub permission | `ctx.isInternal` |

Both tenant shells sit under the same `/e/{slug}` prefix, so the existing slug↔session check and
`requireSession()` apply unchanged.

### Access control — decisions needed

The recon surfaced three gaps. Each needs a ruling before implementation:

**D-1. How is the Hub gated?**
`MODULES` (`src/lib/modules.ts:4-34`) is a flat list of 18 property-operational modules. There is
no enterprise-vs-property distinction in RBAC today; enterprise-wide settings just reuse
`CONTROLS`.

- *Option A (recommended):* add new modules `HUB` + `INTEGRATIONS` to the existing list. Cheapest,
  reuses `RolePermission` CRUD bits verbatim, `backfillMissingRolePermissions()`
  (`src/lib/scope.ts:135-168`) self-heals existing roles. Cost: they appear in the same permission
  matrix as PMS modules, which is slightly incoherent.
- *Option B:* introduce a `scopeLevel` on modules (`PROPERTY` | `ENTERPRISE`) and split the
  permission UI into two sections. Cleaner long-term, more work now, touches the roles UI.

Recommend **A now, B later** if the enterprise module list grows past ~3.

> ⚠️ `MODULES` is duplicated by hand in `prisma/rbac-seed-data.ts:8-41` (prisma scripts cannot
> import from `src/`). Both files must be edited together.

**D-2. Can a PROPERTY-scoped user reach the Hub?**
Recommend **no, hard-blocked** regardless of permission bits — a user pinned to one property has
no business configuring enterprise-wide connectivity. Enforce in the Hub layout *and* in every
Hub API route.

**D-3. Is there a "Hub-only" user?**
`User.scope` is a two-value string (`"ENTERPRISE"` | `"PROPERTY"`) — there is no third value, and
no user↔property join table. A Hub-only administrator (enterprise access, but no PMS at all) is
*already* expressible as `scope = "ENTERPRISE"` with a role granting **only** `HUB`/`INTEGRATIONS`
and nothing else. No schema change needed. Recommend that over adding a scope value.

**D-4. Missing helper.** There is no `requireInternal()`; Osta routes use inline
`if (!ctx.isInternal) return 403` in every file. Do not repeat that mistake — add a single
`requireHubAccess(ctx)` helper in `src/lib/scope.ts` alongside the existing
`requirePermission` / `assertPropertyAccess`, and route every Hub endpoint through it. This is
precisely the shape of audit finding **S2** (a local guard that skipped a step).

### Landing / navigation

- Login redirect (`src/components/auth/login-form.tsx:43`) currently branches
  `isInternal ? "/osta" : "/e/{slug}/dashboard"`. Add a third branch: a user with Hub access and
  no PMS modules lands on `/e/{slug}/hub`.
- Users with both get a switcher in the user menu — **Hub ⇄ Property** — not a property switcher.
- `HubSidebar`: a static nav array, same pattern as `src/components/osta-sidebar.tsx:21-28`.

### Hub sections (v1)

Only one section ships in v1; the rest are placeholders proving the shell generalises.

```
Hub
├── Channel Manager        ← Part 2, the whole of v1
│   ├── Connection         (credentials, status, health)
│   ├── Sharing            (which properties/room types/rates are exposed)
│   └── Logs               (inbound + outbound, troubleshooting)
└── (later) Enterprise settings, SMTP/SFTP, licensing, users/roles…
```

Note: SMTP/SFTP (`EnterpriseSettings`, `src/components/controls/smtp-sftp-manager.tsx`) is already
per-enterprise but currently lives oddly inside the Controls **"Reports"** section. It is the
natural second migration into the Hub — but **not in v1**, to keep the first change reviewable.

---

## Part 2 — Channel manager (Beds24)

### Why Beds24

One integration covers all four target OTAs — **Booking.com, Expedia, Airbnb, Agoda** — plus ~100
others. Beds24 holds the OTA certifications; ostastay builds one adapter instead of four
certifications. Not free (per-property subscription), but cheap and API-first with the API
included in all tiers.

### API facts (verified 2026-07-27)

Confirmed from Beds24's own wiki and API docs — see Sources.

**Authentication — API v2**
- Generate an **invite code** in the Beds24 UI with the required scopes selected.
- `GET /authentication/setup` — exchange invite code → **refresh token**.
- `GET /authentication/token` — refresh token → **access token**.
- Auth header on every call: `token: {accessToken}`.
- Access token expires in **24 hours** (`expiresIn` returned in seconds).
- **Refresh tokens do not expire — as long as they are used within the past 30 days.**

> ⚠️ **Operational trap.** A refresh token unused for 30 days dies, silently breaking the
> connection. This is exactly what the Hub's health monitor exists to catch. Implement a
> keep-alive refresh well inside the window (e.g. daily) and surface "token last refreshed" +
> "days until expiry" prominently on the Connection screen.

**Core endpoints**

| Purpose | Endpoint |
|---|---|
| Exchange invite code | `GET /authentication/setup` |
| Refresh access token | `GET /authentication/token` |
| **Push** availability + prices | `POST /inventory/rooms/calendar` |
| **Read** per-day price/availability (bulk; cache locally, e.g. a year at a time) | `GET /inventory/rooms/calendar` |
| Check dates still available | `GET /inventory/rooms/availability` |
| Retrieve bookings | `GET /bookings` |
| Send bookings to Beds24 | `POST /bookings` |

**Booking webhooks**
- Enabled per property: *Settings → Properties → Access → Booking webhooks*.
- Beds24's stated pattern: use `GET /bookings`, **or** webhooks, **or a combination of the two.**
  Take them at their word — webhook as the fast path, polling as the safety net (see below).

**Still to verify against the live Swagger** (JS-rendered, not machine-fetchable; requires an
account): exact webhook payload schema, webhook retry behaviour, signature/verification mechanism,
and real rate limits. A third-party blog claimed "500 req/min" and HMAC signature verification —
**treated as unverified**, since the same source listed endpoint paths that contradict Beds24's
own documentation. Confirm all four during the Phase 0 spike below.

### Adapter architecture

Do **not** couple ostastay to Beds24. One internal interface, one implementation:

```
ostastay PMS  ──►  ChannelProvider (internal iface)  ──►  Beds24Provider  ──►  Beds24  ──►  OTAs
              ◄──                                    ◄──                  ◄──           ◄──
```

```ts
interface ChannelProvider {
  pushCalendar(propertyId, roomTypeId, from, to): Promise<SyncResult>  // availability + rates
  fetchBookings(since: Date): Promise<InboundBooking[]>                // polling fallback
  handleWebhook(payload: unknown): Promise<InboundBooking[]>           // fast path
  healthCheck(): Promise<ConnectionHealth>
}
```

Swapping to another CM later becomes one class, not a rewrite.

### Data model (new Prisma models)

| Model | Key fields | Notes |
|---|---|---|
| `ChannelConnection` | `enterpriseId`, `provider`, `refreshToken` (**encrypted**), `status`, `lastTokenRefreshAt`, `lastHealthCheckAt` | Enterprise-level — this is *why* it belongs in the Hub |
| `ChannelPropertyLink` | `connectionId`, `propertyId`, `beds24PropertyId`, `syncEnabled` | Per-property opt-in = "control what is shared" |
| `ChannelRoomTypeMap` | `linkId`, `roomTypeId`, `beds24RoomId` | The mapping table — where most real work lives |
| `ChannelRatePlanMap` | `linkId`, `ratePlanId`, `beds24PriceId` | |
| `ChannelReservationRef` | `beds24BookingId` **@unique**, `reservationId` | **Idempotency key** for inbound |
| `ChannelSyncLog` | `direction` (IN/OUT), `endpoint`, `request`, `response`, `httpStatus`, `latencyMs`, `correlationId`, `createdAt` | The troubleshooting log |

**Credentials reuse the existing secret-at-rest pattern verbatim** — `encryptSecret()` on write,
`SECRET_MASK` redaction on read, `decryptSecret()` at point of use
(`src/lib/secret-crypto.ts`, AES-256-GCM). Same as SMTP/SFTP. Requires `SECRETS_ENCRYPTION_KEY`.

### Outbound sync (ARI push)

Triggered when ostastay state changes: booking, cancellation, room move, **stop-sale**,
**overbooking**, price-calendar edit. These hooks land directly on the work already merged in
PR #3.

- Debounce/batch — a burst of edits must collapse into one push per room-type × date range, not 50.
- Every attempt writes a `ChannelSyncLog` row (outbound).
- Retry with backoff; surface persistent failure as connection-degraded in the Hub.

### Inbound bookings — the critical path

1. Beds24 webhook fires → Hub endpoint receives it.
2. **Idempotent** on `ChannelReservationRef.beds24BookingId` (unique). Webhooks retry; duplicate
   delivery must be a no-op. Reuse the night-audit idempotency pattern from the audit remediation
   (finding A1).
3. Map → ostastay reservation: guest profile, room type, dates, rate, OTA commission, channel
   attribution (for reporting + City Ledger).
4. Handle modify + cancel, not just create.
5. **Polling fallback** — `GET /bookings` since last-seen timestamp, on a schedule, to catch missed
   webhooks. Beds24 explicitly supports the combination.

**Known tension to design against:** ostastay allows overbooking with confirmation and has
soft-cap group blocks. Beds24 has its own inventory view. These *will* disagree. Decide
explicitly which side is authoritative per scenario before Phase 3 — do not discover it in
production.

### Rollout phases

| Phase | Scope | Risk |
|---|---|---|
| **0. Spike** | Sandbox account. Verify webhook payload, retries, signature, rate limits. Confirm the unverified claims above. | none |
| **1. Read-only** | Pull bookings from one test property into ostastay. Verify mapping + idempotency. **No pushing.** | none — cannot corrupt OTA inventory |
| **2. One-way push** | Push ARI to Beds24 sandbox. Watch for drift. | low |
| **3. Two-way, one OTA** | Booking.com end-to-end on one real property. | real |
| **4. Remaining OTAs** | Expedia, Airbnb, Agoda — mostly config once the pipe works. | low |
| **5. Reconciliation** | Overbooking/stop-sale vs Beds24 inventory; drift detection job. | — |

---

## Recommended build order

1. **Hub shell only** — layout, sidebar, `requireHubAccess()`, RBAC modules, login branch, one
   placeholder page. Small, reviewable, zero channel-manager code. Resolves D-1…D-4.
2. **Connection screen** — Beds24 credentials + token refresh + health. Phase 0 spike alongside.
3. **Logs screen** — before any sync exists, so the first sync is debuggable from day one.
4. **Sharing screen** — property links + room-type/rate mapping.
5. **Sync engine** — inbound first (Phase 1, read-only), then outbound.

Ship 1 as its own PR. Do not let the Hub shell and the channel manager land together — they are
separable, and the Hub is the piece with long-term structural consequences.

---

## Open decisions for the owner

- **D-1** Hub gating: new `HUB`/`INTEGRATIONS` modules (recommended) vs module scope levels?
- **D-2** Confirm PROPERTY-scoped users are hard-blocked from the Hub.
- **D-3** Confirm Hub-only admin = `scope=ENTERPRISE` + Hub-only role (no schema change).
- **D-5** Does the Hub live at `/e/{slug}/hub` (recommended, same enterprise prefix) or top-level `/hub`?
- **D-6** Beds24 account model: one Beds24 account per enterprise, or per property? Drives whether
  `ChannelConnection` is truly enterprise-level or needs a per-property variant.
- **D-7** Authority on inventory conflict: ostastay or Beds24?

## Sources

- [Booking Webhooks — Beds24 Wiki](https://wiki.beds24.com/index.php/Booking_Webhooks)
- [PMSs: How to connect to Beds24 and use Booking.com via API V2](https://wiki.beds24.com/index.php/PMSs:_How_to_connect_to_Beds24_and_use_Booking.com_via_API_V2)
- [PMSs: How to connect to Beds24 and use Airbnb via API V2](https://wiki.beds24.com/index.php/PMSs:_How_to_connect_to_Beds24_and_use_Airbnb_via_API_V2)
- [OTAs: How to connect to Beds24 using API V2](https://wiki.beds24.com/index.php/OTAs:_How_to_connect_to_Beds24_using_API_V2)
- [Category:API V2 — Beds24 Wiki](https://wiki.beds24.com/index.php/Category:API_V2)
- [Beds24 Availability & Calendar API — APIs.io](https://apis.io/apis/beds24/beds24-availability-calendar-api/)
- Beds24 v2 Swagger — https://beds24.com/api/v2/ (JS-rendered; requires an account to read)
