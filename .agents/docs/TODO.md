# Consolidated TODO — as of 2026-07-22

> Read [MASTER_PLAN.md](MASTER_PLAN.md) first for the architecture and full phase history.

## Platform email sender (2026-08-08) — DONE

App-owner requirement: "from Uppsolut Stay we send initial Enterprise credentials / Links
and any Channel Manager related mails", with clients keeping their own SMTP for guest mail
(registration/confirmation etc).

Until now there was exactly ONE sender — the tenant's `EnterpriseSettings.smtp*` — which
cannot serve platform mail at all: the moment we need to email a new enterprise its first
password, that enterprise has no settings row and no domain of its own. So there are now
**two independent senders**, and the split is the whole point of the design:

- **Tenant SMTP** (`sendMail`, unchanged behaviour) — guest mail from the hotel's own
  domain: confirmation letters, eRegistration links, debtor statements.
- **Platform SMTP** (`sendPlatformMail`, new) — mail from Uppsolut Stay itself, configured
  by `PLATFORM_SMTP_*` environment variables and never stored in the database.

There is deliberately **no fallback between them**. A tenant with no SMTP configured must
not quietly start sending guest confirmations as Uppsolut; it still fails with the same
"SMTP is not configured" message, and a test pins that.

What landed:
- **`src/lib/mailer.ts`** reworked around a shared `ResolvedSmtp` + one transport builder.
  Adds `getPlatformSmtpConfig()` (returns null rather than throwing when unset — an
  unconfigured mailer must never be what blocks onboarding), `sendPlatformMail()`,
  `verifySmtp()` (auth-only, no send — powers the Test buttons), `getPlatformAlertRecipients()`,
  and `text`/`replyTo`/`fromName` support. Transports now carry connection/greeting/socket
  timeouts: a wedged SMTP host previously hung the caller forever, which in a cron job
  stops every later job in the same run.
- **`src/lib/email-templates.ts`** (new) — branded platform layouts with escaping and a
  plaintext alternative for every message. `escapeHtml` is not optional here: enterprise
  names and Beds24 error strings both reach these templates from outside.
- **Onboarding now emails the handover credentials** (`initial-user` route). NON-FATAL by
  design: the user exists before the send is attempted, so a mail failure must not become a
  500 that tempts a retry — the retry would be refused, since the endpoint only ever mints
  the FIRST user. The password is still returned and shown on screen, and the dialog now
  says which of the two happened.
- **Channel-manager alerts** in `channelKeepAliveJob`. Fires only on the TRANSITION from
  CONNECTED to failed, not on "currently failing" — the keep-alive runs hourly and fires
  days before expiry, so alerting on state would re-send every sweep for days, which is how
  an alert mailbox becomes one nobody reads. Goes to `PLATFORM_ALERT_EMAIL` (ops), not the
  tenant: the Beds24 account is Uppsolut's, so only we can re-authorize a lapsed connection
  with a fresh invite code. `lastError` is re-redacted on the way out — email leaves the
  system entirely.
- **Test buttons on both sides**: `POST /api/tenant-settings/smtp-test` (Controls → Reports
  → SMTP / SFTP) and `GET`/`POST /api/osta/smtp` + `PlatformMailManager` on the platform
  console's Controls page. Both distinguish "could not connect" from "connected but the
  message was rejected", which is the distinction that actually locates an SES problem.
  Both test the SAVED settings — the stored password never comes back to the browser.
- The platform route is **read-only on purpose**: an endpoint that could rewrite the
  platform's own sending identity would be a standing route to sending mail as Uppsolut.
- Docs: `.env.example`, `.env.production.example`, and a new **Email** section in
  `DEPLOY.md` covering the two senders and the SES specifics.
- Tests: `tests/business-rules/platform-mailer.test.ts` (27) — env parsing, the
  half-configured-environment case, TLS being opt-OUT, no cross-sender fallback, escaping.

**Corrected along the way:** `DEPLOY.md` and `mailer.ts` both said tenant SMTP lives under
"Controls → Stationaries". It is actually **Controls → Reports → SMTP / SFTP**
(`controls-dashboard.tsx`). Fixed in both, and in the error message operators are told to
follow.

**Open — needs the app owner, not a code change:** the SES account
(`email-smtp.eu-north-1.amazonaws.com`, `noreply@mail.uppsolut.com`) is **in the sandbox**.
Credentials authenticate and DNS is correct (SPF, custom MAIL FROM, DMARC all present), but
a send to an unverified address is rejected with `554 Message rejected: Email address is
not verified`. Onboarding mail goes to brand-new customers by definition, so **production
access must be requested in the SES console before this feature does anything useful in
production.** Everything above is wired and will start working the moment it is granted.

## Idle session timeout never actually fired (2026-08-06) — DONE

Reported as "the app doesn't auto-log-out." Root cause: `EodSessionWatch`
(`src/components/providers/eod-session-watch.tsx`) polls `/api/session/eod-status` every
30s from every dashboard tab to watch for an End-of-Day roll. That route calls
`requireSession()`, which unconditionally stamped `Session.lastSeenAt` — so just having a
dashboard tab open kept refreshing the idle clock forever, regardless of real mouse/
keyboard activity. `isIdleExpired()` (`src/lib/session-store.ts`) was correct and tested;
it just never saw a stale enough `lastSeenAt` to trip. USER_MANAGEMENT_PLAN.md decision 3
also called for the idle timeout to be "warned client-side," which was never built —
users had no way to discover a real idle-expiry short of an accidental 401 on their next
click.

What landed:
- **`requireSession()` gained a `touchActivity` option** (`src/lib/scope.ts`), defaulting
  to `true`. `/api/session/eod-status` now passes `touchActivity: false` — the EOD poll
  no longer resets the idle clock it isn't measuring.
- **`IdleSessionWatch`** (`src/components/providers/idle-session-watch.tsx`), mounted in
  the dashboard layout next to `EodSessionWatch`. Deliberately NOT another 30s poll —
  folding idle detection into the EOD poll was the first draft and would have put every
  open tab, at every property, on the database every 30 seconds forever. Instead it's a
  local per-tab activity clock (mousemove/keydown/touchstart/wheel, a 60s local
  `Date.now()` check) that costs nothing when `sessionIdleMinutes` is 0 (the property
  default) and only calls the new `GET /api/session/idle-check` once, at the moment the
  tab actually looks idle — which also correctly resets if another tab of the same
  session was genuinely active in the meantime.
- **`EodSessionWatch`** also now treats a bare 401 from its existing poll as "signed out
  for some other reason" (admin terminated the session from the Hub, account
  deactivated) — no extra request, just no longer silently ignoring a non-EOD failure.
- Verified: `tests/business-rules/session-idle.test.ts` (pure `isIdleExpired` logic)
  still passes. Could not run the DB-backed `eod-force-logout.test.ts` in this session —
  no live Postgres reachable (`docker` isn't on PATH here); its assertions on
  `forcedLogout`/`eodInProgress` are unaffected by this change and should be re-run
  before merging.

## Closed-reservation presentation + action gating (2026-08-03) — DONE

Owner call (verbal, this session): a cancelled booking shouldn't be rendered with a
strikethrough, and closed bookings were still offering the full live action set (folio,
deposit, housekeeping request, delete) that they have no business exposing.

What landed:
- **No more strikethrough.** Cancelled rows/badges now carry a subtle whole-row tint
  instead: red for cancelled, amber for no-show, grey for checked-out. Text stays fully
  legible. `reservationRowToneClass()` in `src/lib/reservation-state.ts`; returned as
  `bg-* hover:bg-*` so tailwind-merge drops `TableRow`'s default `hover:bg-muted/50`.
  Applied to BOTH the table rows and the card view (the mobile-first list from
  `594d625` renders cards on a phone and on desktop when card view is chosen).
- **One gate module, three surfaces.** `isClosedReservation` / `canEditReservation` /
  `canReinstate` / `canReverseCheckOut` live in `src/lib/reservation-state.ts` and are
  used by the reservations list, the reservation detail page and the booking form so all
  three agree with the API's own guards.
- **Cancelled / no-show** — actions are now exactly: View details, Reinstate (only while
  the dates allow it: cancelled needs arrival still in the future, no-show needs the
  departure not yet passed — matching `PATCH /api/reservations/[id]/status`), Edit.
  No folio, no deposit, no housekeeping request, no confirmation letter, **no delete**.
- **Checked out** — View details + folio reprint always; Reinstate (= reverse check-out)
  only on the business day the guest actually departed (`checkedOutAt`, falling back to
  the departure date for legacy rows). **Never editable.**
- **Edit is now blocked server-side too** — `PUT /api/reservations/[id]` 400s on a
  `CHECKED_OUT` reservation (its folios are closed and any debtor invoice finalized, so
  editing behind the settlement would desync the two). `BookingForm` renders an
  explanatory card instead of the form when deep-linked.
- **Tests** — `tests/business-rules/reservation-closed-actions.test.ts` (19 cases)
  pins every date boundary, including early-checkout (actual departure wins over
  scheduled) and the no-business-date fallback. Pure logic, no DB.

**Delete is now internal-only** (owner follow-up, same day). No delete button remains
anywhere in the UI for any status — the dialog and handlers were removed too. The
endpoint survives for internal cleanup behind four gates in
`src/lib/reservations/hard-delete-gate.ts` (Osta staff → `ALLOW_RESERVATION_HARD_DELETE=true`
→ confirmation-number echo → no financial history / not live or departed), covered by
`tests/business-rules/reservation-hard-delete-gate.test.ts`. The financial-history guard
moved out of the route into that module so it stays unit-tested now that the HTTP path
needs support-mode credentials; `alpha-hardening.test.ts` was updated to assert the
tenant refusal instead of the old success case.

**To actually run one:** set `ALLOW_RESERVATION_HARD_DELETE=true` on the server process,
enter support mode for the enterprise, then
`DELETE /api/reservations/<id>` with body `{"confirm":"<confirmationNo>"}`. Unset the
flag afterwards.

Deliberately **not** done (ask the owner first):
- The same gating has **not** been applied to the Front Office boards, tape chart or
  group screens — only the reservations list + detail + booking form.
- Other delete endpoints (profiles, traces, rate plans, …) were **not** touched — this
  decision was scoped to reservations.

## PostgreSQL migration follow-ups (2026-08-02) — OPEN

The engine moved from SQLite to PostgreSQL 17 (see [DECISIONS.md](DECISIONS.md)). Left
open deliberately, none of it blocking:

- **DB Health storage panel is blank.** `getStorageStats()` in `src/lib/db-health.ts`
  reads SQLite `PRAGMA page_size/page_count/freelist_count` and the `dbstat` virtual
  table. It already degrades to null on a non-SQLite engine, so nothing crashes — but
  the Osta storage breakdown shows nothing until Postgres equivalents are written
  (`pg_database_size()` for the total, `pg_total_relation_size()` per table). The
  migration-drift half of that file needs no change: `_prisma_migrations` exists on
  Postgres too.
- **Dead SQLite dependencies.** `better-sqlite3`, `@prisma/adapter-better-sqlite3`, and
  `@libsql/client` are unused (nothing enables `driverAdapters`). Removing them also
  removes the python3/make/g++ layer from the Docker build, which is the slowest part of
  a cold build on a small VPS.
- **`docker compose exec app ... bootstrap-admin.js` is the only way to create the first
  operator.** Fine for one deployment; if OstaStay is ever self-serve, this needs a real
  onboarding flow.

## Charge Code hierarchy + posting service (2026-07-27) — DONE

Full implementation of [/CHARGE_CODE_PLAN.md](../../CHARGE_CODE_PLAN.md) (all phases; see
its §9 for the deltas decided during the build). Replaces the flat `ChargeCode.category`
string with an Opera-modelled **ChargeGroup → ChargeSubgroup → ChargeCode** hierarchy, adds
a declarative **generates** cascade, and routes every financial write site through one
posting service.

What landed:
- **Schema + migration** `20260727051346_charge_code_hierarchy` — `ChargeGroup`,
  `ChargeSubgroup`, `ChargeCodeGenerate`; `chargeSubgroupId` (nullable), `postingType`,
  `isSystem`, `isActive` on `ChargeCode`; `EnterpriseSettings.defaultGreenTaxChargeCodeId`.
- **`src/lib/posting/`** — `charge-tree.ts` (canonical tree; no Prisma import so client
  components can read it), `ensure-charge-tree.ts` (idempotent seeder),
  `resolve-charge-code.ts` (role lookup), `post-charge.ts` (the one write path),
  `run-generates.ts` (pure cascade + cycle guard), `report-bucket.ts` (the one reader).
- **Magic strings gone.** Every `findFirst({ code: "ROOM" })` / `"GTX"` replaced by
  `resolveChargeCode(enterpriseId, role)`. Night Audit, Advance Bill, the quote engine,
  invoice-data and the folio print page all resolve by role or by `postingType`.
- **Provisioning gap closed** (plan §1.3) — `api/properties` POST seeds the tree, so a
  freshly onboarded enterprise can run Night Audit immediately.
- **Analytics `.code`-labelled-as-`category` bug fixed** (plan §1.7) —
  `revenueByCategory` is now genuinely keyed by reporting bucket.
- **Controls → Cashiering** — new panel: Charge Groups & Subgroups, Charge Codes (with the
  Generates editor), Posting Defaults. Tax and Payment Methods stay in Finance; the old
  "Posting & Settlement Defaults" card was split, with City Ledger settlement staying in
  Finance next to Payment Methods.
- **Backfill** `scripts/dev-tools/backfill-charge-hierarchy.ts` — idempotent, dry-run by
  default, log-don't-guess on unmappable categories. Applied to dev.db.
- **Tests** — 38 new (`charge-generates.test.ts`, `charge-hierarchy.test.ts`, plus 3 new
  Night Audit cases in `green-tax.test.ts`). Suite: 588 passing.

**Second pass (2026-07-27, owner):** tax attached at GROUP level and posted through
generates; full standard chart seeded from a clean slate; advance bills now generate all
defined taxes.
- Each revenue group owns its Service Charge + GST charge codes (`SVCACM`/`GSTACM`,
  `SVCFNB`/`GSTFNB`, …). New `SERVICE_CHARGE` / `GST` generate methods **route** the
  amount `tax-calc.ts` already resolved rather than computing a second one — one rule,
  distinct codes, no drift.
- Tax now posts as its own folio line, keeping its amount in the same column it occupied
  on the parent, so folio totals and every existing tax report are unchanged.
- New `FolioLineItem.generatedFromLineItemId` (migration `20260727141747_...`) links a tax
  line to the revenue that earned it, so reports attribute GST to Room / F&B / Spa instead
  of stranding it under Tax.
- `scripts/seed/seed-charge-codes.ts` — clean-slate chart of accounts. Dry-run by default;
  refuses to drop a code with posted lines unless `--force`, and repoints rate plans,
  allocations, spa treatments and excursion types onto the new chart *before* dropping the
  old codes (Allocation/SpaTreatment/ExcursionType carry a REQUIRED chargeCodeId).
- CXL / NOSHW / DEP codes exist and each property's fee rules are created pre-linked,
  inactive at zero.

**Third pass (2026-07-27, owner):** Rule #1 + folio presentation styles.
- **Every posting path now goes through `postCharge`** — excursion bookings and moves,
  spa appointments, the checkout commission credit, the cancellation fee and Night Audit's
  no-show fee were all hand-building lines. `runGenerates: false` is gone from every call
  site. Guard: `grep -rn "folioLineItem.create" src --include=*.ts | grep -v post-charge`
  must stay empty.
- Only a `CHARGE` posting type is taxable; TAX / CREDIT / NON_REVENUE post at face value.
- **Cancellation / no-show fees are now taxed** (previously posted gross, untaxed) — the
  open question from the last pass is closed: a fee amount follows the property's
  "Prices Include Taxes" convention like every other configured price.
- **`src/lib/folio-presentation.ts`** — 5 folio styles behind a picker shown before any
  Proforma / Tax Invoice / Interim Bill is generated. Unit-tested invariant: every style
  totals identically. The proforma projection emits the same tax split as a real posting.

**Fifth pass (2026-07-28, owner):** payments linked to charge codes, `category` dropped,
`chargeSubgroupId` NOT NULL, and a rebuilt demo seed.
- **chargeSubgroupId is REQUIRED** — every code is properly linked group → subgroup →
  code. `tests/helpers/charge-codes.ts` gives fixtures the real seeded chart, which is
  how ~30 test files were migrated off hand-built stubs.
- **`scripts/seed/seed-demo-data.ts`** — the demo dataset, called from seed-veyo.ts.
  Business date pinned to **2026-08-01** on both properties and EVERY date derived from
  it, so "arrivals today" stays true however long after seeding. Second property
  (VEYO-LAGOON) with its own room types, rooms and outlets; the enterprise-level things
  (chart, tax, payment methods, profiles) are deliberately shared. 20 reservations per
  property across arrivals / in-house / departures / checked-out / cancelled / no-show /
  future, plus a group block with pickups billing to a City Ledger master, housekeeping
  tasks, maintenance tickets and an out-of-order room.
- The seed's parallel numeric chart (10RV / 60RV / 50RV / 40RV) and the legacy RM/FB pair
  are gone — the canonical chart is the only chart now.
- **Analytics was filtering revenue on `createdAt`** (wall clock) while every other report
  used the business `date`. A Night Audit run just after midnight therefore landed on the
  wrong day there. Now agrees with the rest.
- Room revenue reads 0 on a freshly seeded business date **by design** — Night Audit
  hasn't run for it yet. Same-day outlet sales are seeded so the dashboard isn't empty.

**Fourth pass (2026-07-27, owner):** VAT guard, default folio style, grouped pickers.
- **Tax never generates on a non-sale.** `canGenerateTax()` — only `CHARGE` qualifies.
  Refused by the generates API (create + edit, including a `PERCENT` disguised as a
  non-tax method but targeting a tax code), filtered again inside `postCharge`, and not
  offered in the Generates editor.
- **`EnterpriseSettings.defaultFolioStyle`** (migration `20260727..._default_folio_style`)
  set from Stationaries > Invoices; the print picker and a bare print URL both honour it.
- **`src/lib/charge-code-options.ts`** — one filtered/grouped source for every charge-code
  picker. Audit found all nine were showing the full 48-code chart including tax and
  system codes; each now opts in explicitly to anything beyond active revenue codes.
- **Outlet pool picker rebuilt** around Group → Subgroup → Code with tri-state select-all
  at each level, search, and counts. `SearchableSelect` gained optional `group` headers.
- EOD report now labels reporting buckets instead of printing `FOOD_BEVERAGE`.

Follow-ups deliberately left open:
- **Drop `ChargeCode.category`.** Still written as a mirror of the subgroup's bucket, per
  the plan's "keep the column one release longer than the code change". Before the drop
  migration, grep `\.category` on `ChargeCode` — should only hit
  `ensure-charge-tree.ts` (backfill mapping) and `report-bucket.ts` (fallback).
- **Deposit postings** (the Deposit module) were not in scope this pass — `DEP`/`DEPAPP`
  codes exist and are wired to the fee rules, but the deposit collection flow itself still
  records a Payment rather than posting a folio charge. Unchanged behaviour; flagged only
  so the charge codes aren't mistaken for being in use.
- **Fee amounts are now taxed — wants owner sign-off.** Cancellation and no-show fees
  previously posted gross and untaxed; they now go through `postCharge` like everything
  else, so the rule's amount follows the property's "Prices Include Taxes" convention and
  is split into net + GST. Also: both carry GST but NO service charge (no service was
  rendered) — a judgement call, changeable per property in the Generates editor.
- **Backfill on production tenants** has not been run (dev.db only). Run it dry first;
  any code it reports as unmappable needs a Subgroup assigned by hand in Controls →
  Cashiering, then re-run.

## Hub level + Channel Manager (2026-07-27) — shell DONE, channel manager NOT STARTED

Plan: [HUB_CHANNEL_MANAGER_PLAN.md](HUB_CHANNEL_MANAGER_PLAN.md). Two separable pieces; only the
first has shipped, on branch `feature/hub-shell`.

- **DONE — Hub shell.** A new enterprise-level shell at `/e/{slug}/hub` with **zero PMS
  functionality**. `src/app/e/[slug]/hub/layout.tsx` deliberately omits `PropertyProvider`
  (same precedent as `src/app/osta/layout.tsx`), which is what *enforces* the no-PMS rule rather
  than merely stating it: without it `useProperty()` throws, so property-centric components
  cannot mount. **Do not add `PropertyProvider` to that layout.**
- New RBAC module **`INTEGRATIONS`** (added to BOTH `src/lib/modules.ts` and
  `prisma/rbac-seed-data.ts` — the hand-synced pair). Admin/Manager get it automatically (their
  matrices map over `MODULES`); every operational role gets NONE.
- New helpers in `src/lib/scope.ts`: `HUB_MODULES`, `hasHubAccess()`, `requireHubAccess()`,
  `hasAnyPropertyModule()`. **Hub API routes must call `requireHubAccess(ctx)`** — the layout
  check guards the UI shell only. One shared helper deliberately, rather than the inline
  `if (!ctx.isInternal)` pattern the `/api/osta/**` routes repeat (that duplication is the shape
  of audit finding S2).
- PROPERTY-scoped users are hard-blocked from the Hub **regardless of role bits** — verified by
  test and end-to-end in the browser.
- A Hub-only administrator needs **no schema change**: `scope="ENTERPRISE"` + a role granting only
  `INTEGRATIONS`. `src/app/e/[slug]/dashboard/page.tsx` routes such a user to `/hub` so they never
  land on a dashboard page they cannot view.
- Tests: `tests/business-rules/hub-access.test.ts` (7). Includes a guard asserting the two
  `MODULES` lists stay identical — the long-standing hand-sync hazard now fails loudly.
- **Open decisions still to settle** (see plan §"Open decisions"): D-6 is the Beds24 account model
  (one account per enterprise vs per property — decides whether `ChannelConnection` is truly
  enterprise-level), and D-7 is which side is authoritative when ostastay's overbooking/soft-cap
  group blocks disagree with the channel manager's inventory. **D-7 must be answered before
  two-way sync (rollout Phase 3), not discovered in production.**
- **DONE — Connection screen** (branch `feature/hub-connection`, stacked on `feature/hub-shell`).
  `ChannelConnection` model (enterprise-level, **deliberately not unique per enterprise** so
  several accounts are allowed — this is what makes plan decision **D-6 moot**, no schema change
  needed either way). `src/lib/channels/beds24.ts` (auth + the 30-day idle math),
  `src/lib/channels/connection.ts` (service layer owning encryption + honest status),
  `/api/hub/connections` (+ `[id]`, `[id]/test`), and the RHF+Zod UI at
  `src/components/hub/channel-connection-manager.tsx`.
  - Credentials use the existing `secret-crypto.ts` pattern. **There is deliberately no
    "reveal" endpoint** — a channel-manager token can move real inventory and take real
    bookings, so it is write-only from the browser's side. `PublicConnection` has no token
    fields *at all* rather than masked ones.
  - Health is **observed, never assumed** — status only becomes CONNECTED because a real Beds24
    call just succeeded. A reachable-but-rejected connection returns 200 with `lastError`: the
    check succeeded, the health is bad.
  - The connection row is written **only after** the invite-code exchange succeeds; a
    saved-but-unusable connection would report a credential it cannot authenticate with.
  - `POST /api/hub/connections/[id]/test` doubles as the **keep-alive** (a successful refresh
    resets Beds24's idle clock) and is gated on `update`, not `view` — it mutates and makes a
    real outbound call.
  - **Beds24 base URL + `/authentication/setup` are now VERIFIED LIVE** (2026-07-27): a real
    call returned Beds24's own "Token not valid" for a bogus invite code. The invite-code header
    name (`code`) is strongly indicated but not proven with a genuinely valid code.
- **DONE — Exchange Log** (branch `feature/hub-sync-logs`, stacked on `feature/hub-connection`).
  `ChannelSyncLog` model + `src/lib/channels/redact.ts` + `sync-log.ts` (read/prune) +
  `/api/hub/sync-logs` + `src/components/hub/sync-log-viewer.tsx`, at
  `/e/{slug}/hub/channel-manager/logs`. Built BEFORE the sync engine, deliberately, so the
  first sync is debuggable rather than a black box.
  - ⚠️ **`ChannelSyncLog` MUST NEVER CONTAIN A CREDENTIAL.** The table is plaintext and
    readable by anyone with Hub view access, so a token landing in it would defeat the
    encryption-at-rest on `ChannelConnection` entirely. `redact.ts` is **deny-by-default on
    keys**: a value is masked unless its key is explicitly whitelisted, so a field Beds24
    adds tomorrow is redacted automatically rather than leaked by omission. Header values are
    masked unconditionally (no whitelist at all — that is where the credentials live).
    Verified live: a real failed exchange logged `{"code":"[redacted]"}` while keeping the
    diagnostic `{"success":false,"type":"error","code":401,"error":"Token not valid"}`.
  - Logs use `onDelete: SetNull` + a snapshotted `connectionName`, so the entries explaining
    **why** a connection was removed survive its deletion.
  - A rejected invite code is logged even though no connection row is created — otherwise the
    most common setup failure would leave no trace. On success those entries are then linked
    to the connection they produced (a test caught that they were being orphaned).
  - Read-only: no create/edit/delete endpoints. A log an operator can quietly erase is not a
    troubleshooting record.
  - Cursor paging, not offset — the table is written to continuously, so offset paging would
    skip or repeat rows as new entries arrive mid-page.
- **DONE — Sharing / mapping** (branch `feature/hub-sharing`, stacked on
  `feature/hub-job-runner`). `ChannelPropertyLink` / `ChannelRoomTypeMap` /
  `ChannelRatePlanMap` + `src/lib/channels/sharing.ts` + `/api/hub/property-links` + the UI,
  since renamed **Sharing → Mapping** and split into 5 tabs (Property, Room Type, Rate Plan,
  Inventory, Defaults) at `/e/{slug}/hub/channel-manager/mapping`. This is the "control what
  is shared" surface.
  - ⚠️ **`ChannelPropertyLink.propertyId` is UNIQUE ACROSS ALL CONNECTIONS**, not per
    connection. Linking one property through two channel-manager accounts would have both
    pushing availability for the same rooms and both taking bookings — a **double-sell that
    surfaces as an overbooked guest at the desk, never as an error in software**. One
    property, one channel manager.
  - **Readiness gate:** sharing cannot be turned ON while any *active, shared* room type is
    unmapped — a half-mapped push is worse than none because it looks like it worked.
    Inactive and deliberately-unshared room types do not block. A link with nothing shared is
    never "ready". Rate plans are **optional** and deliberately do NOT gate readiness (a
    property can push availability on a default rate long before per-plan mapping exists).
    **Disabling is always allowed** — stopping must never be blocked.
  - New links default `syncEnabled = false`: publishing inventory is an explicit act, never a
    side effect of linking.
  - Mappings are validated to belong to the link's own property, otherwise one property's
    inventory could be published under another property's roof.
  - **External IDs are typed in by hand for now.** A picker that reads the channel manager's
    own property/room list needs a real Beds24 account to design the response parsing
    against — deliberately not guessed. Manual entry is correct regardless and is what an
    operator would do pre-certification.
- **IN PROGRESS — sync engine.** First slice done on branch `feature/sync-availability`:
  the outbound **availability calculation + preview**. It COMPUTES and EXPLAINS; it does not
  push. The HTTP push is the next slice, on top of this.
  - `perNightTypeAvailability()` was added to **`src/lib/availability.ts`, deliberately NOT
    to the channels module** — beside `minTypeAvailability()`, sharing its constants and
    group-hold logic. A separate copy of that arithmetic would eventually disagree with the
    app's own Availability grid, and then OTAs would be told something the PMS contradicts.
    **One definition, two callers — keep it that way.**
  - Most of D-7 turned out to be **already implemented**: `outstandingBlockHolds()` already
    drops holds past `cutoffDate` (the group-block ruling), and `minTypeAvailability()`
    already clamps at 0. The work was per-night output plus the channel-facing filters.
  - `src/lib/channels/sync.ts` adds what is channel-specific: excludes **pseudo** room types
    (no physical rooms behind them — publishing one sells rooms that do not exist),
    inactive, unmapped and held-back types, each with a stated reason; and marks stop-sale
    nights `closed` **as well as** 0 (rule 5).
  - ⚠️ **Group holds use BOTH `TENTATIVE` and `DEFINITE`**, matching the booking overbook
    guard rather than the Availability grid (which shows DEFINITE only). A tentative block
    is still a real claim until its cutoff, and publishing those rooms would let the block
    firming up cause exactly the channel overbook rule 1 forbids. This deliberately
    under-sells while a block is tentative — **owner may want to revisit**.
  - ⚠️ Added `formatLocalDay()` rather than reusing `fmtDay()`: `fmtDay` does
    `toISOString()` on a LOCAL midnight, so any timezone ahead of UTC (Maldives is UTC+5)
    reports the **previous day**. Harmless in its current use (a conflict message) but a
    day-shifted push would move real inventory onto the wrong night. `fmtDay` itself is
    left alone — a separate, low-risk cleanup.
  - Preview at `/api/hub/property-links/[id]/preview` + a dialog on the Mapping screen's
    Inventory/Rate Plan tabs (now with an operator-chosen date range, not just a fixed
    14-night window), available to **view-only** users too. Checking what would be sent is
    a read, and is the last cheap moment to catch a mapping mistake — after sharing is on,
    the next thing to notice a wrong number is an OTA.
- **DONE — outbound push** (branch `feature/sync-push`). `src/lib/channels/payload.ts`
  (pure transform) + `push.ts` (guards + send) + `POST /api/hub/property-links/[id]/push`
  + a **Send now** button in the preview dialog + the `channel-ari-push` scheduled job.
  **This is the first thing in the integration that actually reaches an OTA.**
  - ⚠️ **The calendar payload SHAPE is NOT verified against a live account.** Beds24's
    field names for `/inventory/rooms/calendar` are only in its account-gated Swagger.
    Everything is arranged so being wrong is cheap: the transform is pure and fully tested
    independently of the wire format, **dry-run returns the exact body without sending**,
    and a wrong name is a one-line fix in `payload.ts` with nothing else moving.
    **Confirm during the sandbox spike BEFORE enabling sharing on a real property.**
  - **Guards (checked in the service, not just the UI):** refuses unless `syncEnabled`;
    refuses with no credentials; refuses an empty payload (an empty push looks like success
    while hiding a broken mapping). A job, a retry or any future caller cannot route around
    `syncEnabled` — it is the operator's consent to publish.
  - **Dry-run is allowed while sharing is OFF** — inspecting the body before it reaches an
    OTA is the entire point. Gated on `view`; a real push needs `update`.
  - **Ranges are compacted**: consecutive identical nights collapse into one inclusive
    `from`/`to` entry. Note `to` is INCLUSIVE here, deliberately unlike the half-open
    `[from, to)` used for stay dates everywhere else — conflating them would push one night
    too many. A CLOSED night never merges with an equally-zero OPEN night; they mean
    different things at the channel.
  - **Excluded room types are OMITTED, never sent as 0** — sending 0 would actively close
    inventory the operator only meant to stop managing from here.
  - Push failures are returned, never thrown, so one property cannot abort a sweep.
  - Pushing also refreshes the access token, which resets Beds24's 30-day idle clock — an
    actively-syncing property keeps its own credentials alive without the keep-alive job.
- **DONE — inbound bookings, PHASE 1** (branch `feature/sync-inbound`).
  `ChannelInboundBooking` + `src/lib/channels/inbound/` (parse, ingest, poll) + the webhook
  at `/api/channels/webhook/[token]` + the `channel-booking-poll` job + the Hub screen at
  `/e/{slug}/hub/channel-manager/bookings`.
  - ⚠️ **PHASE 1 RECEIVES AND RECORDS; IT DOES NOT CREATE RESERVATIONS.** Reservation
    creation in this app is **408 lines inline in `POST /api/reservations`**, wiring in
    allocations, special requests, availability and stop-sale conflicts, document sequences
    and activity logging. Reimplementing that in the inbound path would miss something.
    **Converting these rows should go through a properly EXTRACTED reservation service** —
    that extraction is the next slice, and it is a refactor of a heavily-used, recently
    audited path, so it wants its own change rather than being smuggled in here.
  - **Idempotent on `(connectionId, externalBookingId)`.** Webhook delivery is at-least-once
    and the poller deliberately re-reads an overlapping window, so the same booking arrives
    repeatedly; every arrival after the first updates in place. A duplicate row is a
    duplicate guest.
  - **Overbooking is detected and FLAGGED, never refused** (D-7 rule 4). Re-flagging clears
    a previous acknowledgement — acknowledging one state must not silence a later problem.
  - **The RAW payload is always stored, even when parsing fails.** The Beds24 booking shape
    is unverified, so the raw body is the only thing guaranteed correct; with it a mis-parse
    is replayable rather than lost. A half-understood booking is kept with a `problem` note.
  - **Webhook auth is a per-connection URL secret**, not a payload signature: Beds24's
    signing scheme is not publicly documented, and guessing at a security mechanism is the
    least acceptable place to guess. If a documented scheme exists, add it ON TOP.
    Bad token returns a bare 404 — a webhook URL is a credential and must not be probeable.
    **The secret is stored SHA-256-hashed since 2026-08-02** — see the entry below.
  - **The webhook returns 200 even for a payload it cannot read.** A non-2xx makes the
    channel retry, and retrying cannot fix an unmapped room or a malformed body — it would
    redeliver forever while the real problem stays invisible. The booking is stored with its
    problem noted and resolved in the Hub instead.
  - This is the first thing to write **INBOUND** exchange-log entries; until now that filter
    could never match anything.
- **DONE — wire formats VERIFIED** (branch `feature/sync-verified-fields`, 2026-07-28).
  Beds24's **official OpenAPI spec** was obtained by reading the `@lionlai/beds24-v2-sdk`
  npm package, which is generated from it. The account-gated Swagger is no longer a blocker.
  - **Inbound was already correct.** `id`, `roomId`, `propertyId`, `status`, `arrival`,
    `departure`, `numAdult`, `numChild`, `firstName`, `lastName`, `email`, `price`,
    `referer`, `apiSource`, `channel` all confirmed. `status` is a closed enum —
    `confirmed | request | new | cancelled | black | inquiry` — which is why both
    "cancelled" and "black" count as cancellation.
  - **Outbound had THREE errors, now fixed:**
    1. `roomId` is a **number**, not a string. A non-numeric external id is now skipped
       rather than coerced into addressing the wrong room.
    2. A stop-sale is **`override: "blackout"`**, not a `closed` boolean. `override: "none"`
       is sent explicitly on open dates so a previously blacked-out date is actively
       re-opened.
    3. Prices are **sixteen NUMBERED SLOTS** (`price1`..`price16`), not a map keyed by rate
       id. `ChannelRatePlanMap.externalRateId` therefore holds a **slot number 1–16**,
       validated on write; the Sharing UI labels it as such.
  - ⚠️ **From Beds24's spec, worth not rediscovering:** *"If you change override from
    blackout to none without setting numAvail, numAvail will change to the maximum
    possible."* Every range we send carries an explicit `numAvail`, so lifting a blackout
    cannot silently re-open a room type at full capacity. **Do not make `numAvail` optional.**
  - Also noted: `numAvail` may legitimately be negative in Beds24 (an overbooked room), but
    we never send one — D-7 says publish actual availability, clamped at 0.
  - Rate limiting is real: responses carry `X-FiveMinCreditLimit`,
    `X-FiveMinCreditLimit-Remaining` and `-ResetsIn` headers. **Not yet read or respected** —
    worth handling before high-frequency pushing.
  - The spec also exposes `minStay`, `maxStay`, `multiplier` (required, default 1) and
    per-channel `maxBookings` on the calendar. None are used yet.
- **DONE — provider abstraction, reservation-creation service, booking defaults, inbound
  conversion, Sharing → Mapping rebuild** (2026-07-28, stacked on the wire-formats-verified
  work above).
  - **`ChannelProvider` interface** (`src/lib/channels/provider.ts`) — connection.ts, push.ts,
    poll.ts, ingest.ts, the inbound webhook route, sharing.ts's rate-slot validation, and the
    keep-alive job all resolve a provider by `ChannelConnection.provider` and call through
    this interface rather than importing Beds24's client directly. `Beds24Provider`
    (`providers/beds24-provider.ts`) is the only implementation; a second channel manager is
    "implement the interface + register it in `providers/registry.ts`", with **no changes
    needed above that seam**. This is what makes the connection genuinely swappable, per the
    owner's explicit requirement.
  - **`createReservation`** (`src/lib/reservations/create-reservation.ts`) — the ~300-line
    inline body of `POST /api/reservations` extracted verbatim (same validation order, same
    status codes, no behavior change), returning a plain result object rather than a
    `NextResponse` so a non-HTTP caller (the conversion below) can use the exact same rules
    a front-desk booking goes through.
  - **`ChannelBookingDefaults`** model + `src/lib/channels/defaults.ts` — per-link default
    rate plan + meal plan, since a channel booking never names one of ours. No default rate
    plan configured = conversion deliberately blocked, not guessed.
  - **`src/lib/channels/inbound/convert.ts`** — turns a `RECEIVED` `ChannelInboundBooking`
    into a real `Reservation` via `createReservation`, using the defaults above. Cancelled →
    `IGNORED`; missing mapping/dates or no configured default → stays `RECEIVED` with
    `problem` set, retried by the new `channel-booking-convert` scheduled job; only an
    unexpected thrown error → terminal `FAILED`. Forces `acknowledgeOverbook: true` — D-7 rule
    4 says an over-availability channel booking is accepted and flagged, never refused, since
    the channel already confirmed it to the guest.
  - **Sharing UI renamed Mapping, split into 5 tabs** (`src/components/hub/mapping-manager.tsx`
    + `mapping/room-type-tab.tsx` / `rate-plan-tab.tsx` / `inventory-tab.tsx` /
    `defaults-tab.tsx`, route now `/e/{slug}/hub/channel-manager/mapping`): Property (link
    list, sync toggle, link/unlink), Room Type (unchanged mapping table), Rate Plan (mapping
    table + "send prices for a date range"), Inventory ("resync availability" for a date
    range), Defaults (new — the rate plan/meal plan UI above). Rate Plan's "send prices" and
    Inventory's "resync" are the **same underlying push** (`AvailabilityPreview`, now
    date-range-capable via `@/components/ui/date-range-picker` instead of a fixed 14 nights)
    — Beds24 has no separate rates endpoint; availability and prices always travel together
    in one calendar payload.
  - Still open: a live sandbox account to exercise inbound conversion end to end (see the
    Veyo Lagoon Retreat connection already set up for this), and the Beds24 rate-limit
    headers noted above are still unread.
- **D-7 ruling — the rules the sync engine must implement** (full text in
  [DECISIONS.md](DECISIONS.md)):
  1. **Push actual available inventory; never include overbooking allowance.** Clamp to `0`
     if a manual overbook has driven it negative — never a negative, never "0 plus headroom".
     The channel manager must never be able to *cause* an overbook.
  2. **Overbooking stays manual-only** at the desk, via the existing confirmation step.
  3. **Group-block held rooms are withheld until `GroupBlock.cutoffDate`, then released.**
     No schema change needed — `cutoffDate` exists and `api/groups/[id]/pickup` already
     refuses pickup past it, which is precisely what makes releasing safe.
     ⚠️ `cutoffDate` is **nullable**: no cutoff means hold indefinitely, NOT release now.
  4. **Inbound race → accept and flag.** An OTA booking is already confirmed to the guest
     before it reaches us, so refusing is not really available. Accept it and raise a
     visible **"channel overbook"** alert so the desk learns days ahead, not at the door.
     Must NOT be folded in silently as if it were a deliberate manual overbook.
  5. **Stop-sale must CLOSE the room type at the channel**, not merely push availability 0 —
     some OTAs treat 0 as "temporarily sold out" and keep the listing live.
- **DONE — Background job runner** (branch `feature/hub-job-runner`, stacked on
  `feature/hub-sync-logs`). Closes BOTH operational gaps above with one piece of shared
  infrastructure. `JobRun` model, `src/lib/jobs/` (runner + registry + cron auth),
  `POST /api/jobs/run`, and a job-health card on the Hub overview.
  - **Next.js has no scheduler**, so an EXTERNAL cron drives it:
    `curl -X POST https://<host>/api/jobs/run -H "x-cron-secret: $CRON_SECRET"`. Hourly is a
    sensible cadence — both jobs are cheap when nothing is due. An in-process `setInterval`
    would be wrong: it dies with the process, and on >1 instance every job runs >1 time.
  - **`CRON_SECRET` must be set per environment** (see `.env.example`). The endpoint
    **FAILS CLOSED** — unset means it refuses every request (503) rather than running
    unauthenticated. Compared via SHA-256 digests + `timingSafeEqual`, so neither the value
    nor its length leaks through timing.
  - **Mutual exclusion is a PARTIAL UNIQUE INDEX** `JobRun_one_running_per_job_enterprise`
    — UNIQUE (jobName, enterpriseId) WHERE status = 'RUNNING' — created in raw SQL because
    Prisma cannot express it (same approach as `CashierShift_one_open_per_user_property`,
    audit finding A12). An overlapping cron invocation's INSERT fails and is skipped instead
    of double-running. `JobRun.enterpriseId` is deliberately NOT nullable: SQLite treats
    NULLs as distinct in a unique index, so a nullable column would silently allow
    concurrent "global" runs.
  - **Stale-lock recovery:** a RUNNING row older than 30 min is assumed dead and taken over
    (marked FAILED, not deleted — a crash-looping job must stay visible). Without a lease,
    one crash would wedge a job permanently.
  - **Failure isolation:** the runner never throws. One enterprise failing must not stop the
    rest, and a 500 from cron would not tell the operator which of N enterprises broke.
  - Jobs run sequentially across enterprises on purpose — they make outbound channel-manager
    calls, and firing all at once would burst into a provider rate limit.
  - Jobs registered (as of 2026-07-28): `channel-keepalive` (only touches connections
    `needsKeepAlive()` says are due), `channel-log-prune` (retention
    `SYNC_LOG_RETENTION_DAYS = 60`), `channel-ari-push` (availability+rates, now a full
    **365-day** window — see PUSH_WINDOW_DAYS in `push.ts`), `channel-booking-poll` (fallback
    behind the webhook), `channel-booking-convert` (sweeps RECEIVED bookings into
    Reservations).
  - The Hub overview shows last-run status per job and flags a run **older than 24h as
    Stale** — a cron that has quietly stopped firing is worse than no cron, since the
    keep-alive looks fine right up until a credential lapses.
- **Still outstanding for deployment (self-hosted, 2026-07-28):** actually schedule the cron.
  The mechanism exists and is verified (`POST /api/jobs/run`, optional `?job=<name>` to run
  just one job instead of all of them); the schedule itself is environment configuration,
  not code. The owner wants `channel-ari-push` specifically to run **once a day**, separate
  from the rest — a year-long payload is too heavy to repeat hourly alongside the cheap
  jobs. `?job=` only selects ONE job by name (no "all except X"), so the parameterless
  hourly call must be dropped in favor of naming the four light jobs individually:
  ```
  # Hourly — each cheap when nothing is due; channel-ari-push deliberately absent here.
  0 * * * * curl -fsS -X POST "https://<host>/api/jobs/run?job=channel-keepalive"        -H "x-cron-secret: $CRON_SECRET" >> /var/log/ostastay-jobs.log 2>&1
  5 * * * * curl -fsS -X POST "https://<host>/api/jobs/run?job=channel-log-prune"        -H "x-cron-secret: $CRON_SECRET" >> /var/log/ostastay-jobs.log 2>&1
  10 * * * * curl -fsS -X POST "https://<host>/api/jobs/run?job=channel-booking-poll"     -H "x-cron-secret: $CRON_SECRET" >> /var/log/ostastay-jobs.log 2>&1
  15 * * * * curl -fsS -X POST "https://<host>/api/jobs/run?job=channel-booking-convert"  -H "x-cron-secret: $CRON_SECRET" >> /var/log/ostastay-jobs.log 2>&1

  # Daily, off-peak — the heavy 365-day availability+rates push, on its own.
  0 2 * * * curl -fsS -X POST "https://<host>/api/jobs/run?job=channel-ari-push"          -H "x-cron-secret: $CRON_SECRET" >> /var/log/ostastay-jobs.log 2>&1
  ```
  `CRON_SECRET` must be set in this environment (see `.env.example`) before any of these do
  anything — the endpoint fails closed (503) rather than run unauthenticated.
- **Beds24 API facts worth not re-deriving:** access token 24h; refresh token dies if unused for
  **30 days** (needs a keep-alive job — this is what the Hub's health monitor is for);
  `POST /inventory/rooms/calendar` pushes ARI, `GET /bookings` + booking webhooks pull
  reservations. Webhook payload schema, retry behaviour, signature verification and real rate
  limits are **unverified** — Beds24's Swagger is account-gated; confirm in a sandbox spike.

## Release-readiness audit + remediation (2026-07-25) — see [/AUDIT_REPORT.md](../../AUDIT_REPORT.md)

Full-project audit (§1–§8 of AUDIT_REPORT.md) found 1 Critical, 5 High, ~15 Med, ~20 Low.
**Batches 1–4 are DONE** (report §9), owner-approved, committed stage-by-stage on branch
`audit-remediation`. Full test suite **405/405 green**, `tsc` clean. Details:
- **Fixed (Batch 1/2):** A1 night-audit atomic idempotency · A2 advance-bill double-bill ·
  A3/A4 currency-exchange balancing + validation + shift scope · A5 excursion capacity ·
  A6 move-bookings target capacity · S1 move-bookings cross-tenant write · A11 early check-in
  blocked · S2 property scope · S3 spa catalog read perms · S4 profile read perms · S5
  payments shift scope · S6 group-code unique per property.
- **Fixed (Batch 3):** A7 spa shift attribution · A8 move-line closed-source guard · A9
  EOD/night-audit cross-guard · A10 checkout/cancel/reverse status re-assert · A12
  one-open-drawer partial unique index.
- **Fixed (Batch 4):** A15 excursion past-departure guard · A16 group-pickup in-tx recheck ·
  A13 UTC day boundaries on write paths (excursion schedule gen, spa weekday, price-calendar
  single+bulk). Also fixed the date-fragile "cancelling past the cutoff" excursions test.
- **Batch 5 (UX/design) — in progress.** DONE: D-1 error states (`ErrorState` on 22 pages/
  components + activity-log loading state) · C-3 searchable `SystemCodeSelect` (country/
  nationality) · D-3 toast system (`lib/toast.ts` + `ui/toaster.tsx`, base-ui, app-wide) with
  all 41 `alert()` migrated to `toast.*`, plus a promise-based `useConfirm` (`providers/
  confirm-provider.tsx`, AlertDialog-backed) replacing all 8 native `confirm()` deletes.
  C-1 RHF+Zod on the 4 critical forms (deposit, room-move, walk-in fully; check-in-wizard's
  optional payment sub-form) · C-2 check-in wizard DOB/nationality auto-save + payment
  pre-filled with balance due · C-4 remaining raw Select→SearchableSelect + input[date]→
  DatePicker · D-4 activity-log mobile scroll, Skeleton loading, EmptyState · D-5 tests/**
  lint override (tests now clean).
- **Batch 5 remaining — D-2 DEFERRED by judgment:** extract shared CrudManager/
  ResponsiveDataTable is a large refactor of ~12 manager/list files just heavily edited this
  branch; maintainability-only, high regression risk for no functional gain — do it as a
  focused reviewed pass, not an autonomous sweep.
- **src lint cleanup — DONE:** was ~445 pre-existing errors (audit's "src is lint-clean" was
  wrong); `npm run lint` now exits 0 errors. Fixed the mechanical errors + exempted the 3 print
  documents; reclassified ~270 no-explicit-any and ~100 React-Compiler advisories to warnings
  (kept visible). Remaining follow-ups (warnings, not gating): properly type the `any`s and
  make the app React-Compiler-clean — both large staged efforts.
- **A14 money integrity — DONE (targeted).** Owner chose the targeted fix over a full
  Float→Int storage migration (~99 files, polymorphic money/percent fields, disproportionate
  risk). Added `src/lib/money.ts` (cent-based sums) and routed folio balance / drawer cash /
  checkout & cancel balances / deposit reconciliation through exact integer-cent math — kills
  the accumulation error the 0.01 tolerances hid. Storage stays Float. `money.test.ts` added.
- **S8 SMTP/SFTP encryption-at-rest — DONE.** `src/lib/secret-crypto.ts` (AES-256-GCM, key
  from `SECRETS_ENCRYPTION_KEY`, backward-compatible with legacy plaintext, no migration).
  Encrypt on write (tenant-settings), decrypt on read (mailer); no-op without the key.
  `.env.example` added. Set `SECRETS_ENCRYPTION_KEY` in each env to enable.
- **Still open (deferred — non-blocking cleanliness):** D-2 shared-component refactor · lint
  follow-ups (type the `any`s; make React-Compiler-clean) · full Float→Int money storage
  migration (not needed for integrity; A14 targeted fix handled it).
- **Discovered (out of scope, needs a fixture fix):** `tests/business-rules/excursions.test.ts
  > "cancelling past the cutoff…"` fails on clean master — books a `day(-2)` departure for a
  `day(-1)` arrival, which the out-of-stay guard rejects, so the later cancel 500s.
- **Known residual:** the SQLite check-and-set guards protect integrity, but a losing
  concurrent write can surface as a DB-lock 5xx instead of a clean 409 — needs DB
  busy-timeout/retry tuning (infra-level, deferred).

## Property Availability page + Stop Sale (2026-07-26) — DONE, with follow-ups

Shipped a new **Availability** page (`/dashboard/availability`, new `AVAILABILITY` RBAC
module): a Date × Room Type pivot of available rooms, expandable to Arrivals / Occupancy /
Departures / Adults / Children / Infants (House + per type), tape-chart-themed, plus
**Stop Sale** (Open/Closed) restrictions per date at property or room-type level.
`AvailabilityRestriction` model (presence = Closed), `src/lib/restrictions.ts`,
`GET /api/availability`, `POST|DELETE /api/availability/restrictions`. Enforced as a HARD
block in `POST` + `PUT /api/reservations`. See DECISIONS.md (2026-07-26) for the rules.
Tests: `tests/business-rules/availability-restrictions.test.ts` (4). `tsc` clean.

**Deferred / open follow-ups (deliberately out of scope for v1, don't build without a nod):**
- **Stop Sale enforcement is only on the direct reservation create/edit path.** Group
  pickup (`POST /api/groups/[id]/pickup`) and the walk-in booking flow create/hold
  inventory through their own paths and do **not** yet check `findStopSaleConflicts`. If the
  owner wants closures to block those too, wire the same guard in.
- **Restriction types are Open/Closed only.** CTA (Closed-to-Arrival), CTD, and min-stay
  were explicitly deferred — the model/UI would need to grow.
- **No mobile-specific layout** — the grid uses horizontal scroll like the tape chart; a
  dedicated mobile list (as tape chart has) was not built.
- **Availability grid excludes pseudo room types** (no physical rooms) by design.

## Spa + Excursions demo pass (2026-07-25)

Both modules were made functionally identical and demo-ready. Both now share the same
**Book · Schedule · History** tab layout (`Tabs` on each page):
- **Book** = booking only. The old right-hand side-list column (today's schedule /
  upcoming departures + open walk-in bills) was removed — that content moved to the
  Schedule and History tabs. Book is single-column now.
- **Schedule** = day/week/month calendar. Excursions uses `excursion-calendar.tsx`;
  Spa uses the new `src/components/front-office/spa-schedule.tsx`, organized by
  **therapist** (therapist filter + colour-coded chips, same palette as Excursions).
- **History** = shared `src/components/front-office/sales-history.tsx` — date-filterable
  list of all sales, Reprint (tax invoice) on every row, and a "Bill" button on walk-in
  rows that reopens `WalkInFolioPanel` to take payment / close.
- **Stay-period guard**: in-house Spa/Excursion bookings must fall within the guest's
  `checkInDate..checkOutDate` (both POST routes reject `outsideStay: true`); otherwise
  book as a walk-in.
- **Charge & pay now** (✅ 2026-07-25): in-house bookings can optionally settle at
  booking time — the POST route posts the charge to the room folio AND records a
  `Payment` of the same gross (base+tax+service) in the same transaction, so the item
  nets to zero instead of riding to checkout. New shared UI
  `src/components/front-office/in-house-payment-choice.tsx` ("Charge to room" vs
  "Charge & pay now" + payment-method picker). Both routes accept an optional
  `settlement: { paymentMethodId, referenceNumber? }`, honored only for in-house
  (`reservationId`) + `AT_BOOKING` charge timing; walk-ins keep their existing pay panel.
- **Therapist ↔ User link**: `SpaTherapist.employeeId` dropped for `userId` (unique,
  optional) linking a therapist to a PMS user (migration `spa_therapist_user_link`);
  the Controls manager picks a linked user via `SearchableSelect`.

**Deferred (not built — keep for later):**
- **"My Appointments"** — a self-service view for a therapist-linked user to see their
  own booked appointments. Schema/link is in place (`SpaTherapist.userId`); the view is
  not built. Owner said keep as a TODO (2026-07-25).

## Spa Booking — sellable per-property add-on (Phases 0-3 done 2026-07-23, Phase 4 next)

Full plan in [SPA_PLAN.md](SPA_PLAN.md). Front-office/spa-reception scheduling and
selling of spa treatments (therapist + treatment room, in-house and walk-in guests) —
the second feature built on the `PropertyModuleAccess` mechanism after Excursions.
Owner decisions on the plan's open forks confirmed 2026-07-23 (`SPA_PLAN.md` status
header): catalog permissions under `CONTROLS`, and — deviating from the plan's own
Option B recommendation — **full multi-resource couple/group treatment support in v1**
(`SpaAppointment` + `SpaAppointmentParticipant`, each guest independently assigned
their own therapist while sharing one room/time/folio charge).

**Phase 0** (schema + module registration) and **Phase 1** (Controls catalog:
treatments/rates, therapists with skills/schedule/exceptions, rooms with
compatibility/closures, `SpaSettings`) — both complete, same `CONTROLS`-gated /
`assertPropertyModuleAccess`-gated pattern as Excursions throughout.

**Phase 2** (availability engine + in-house booking) — complete:
`src/lib/spa-availability.ts` (qualified/available room and therapist candidates,
deterministic auto-assignment, hard overlap-blocking), `src/lib/spa-resource-lock.ts`
(the in-process mutex `SPA_PLAN.md` §7 settled on after its "SQLite serializes
everything" assumption didn't hold up), `POST/GET /api/spa/appointments` (+ `[id]`,
+ `availability`), and the front-office booking page at `/e/[slug]/dashboard/spa`
(auto-assignment only in this first UI pass — manual therapist/room picking is
supported by the API but not yet exposed in the UI). Two real bugs found and fixed
while building this phase (not by live-testing, by re-reading the plan against the
actually-committed schema): the room "roomType fallback" referenced a
`SpaTreatment.roomType` field that was never added to the schema (fixed by dropping
that fallback tier); and the availability engine only extended the blocked window's
*end* (cleanup buffer), never its *start* (preparation buffer), silently making
`preparationBufferMinutes` block nothing at all (fixed with a derived
`blockedFromTime` used consistently on both sides of every overlap check).
**Phase 3** (walk-in booking) — complete: `POST /api/spa/appointments` now accepts
`folioId` (an already-open walk-in folio from the existing `POST /api/folios/walk-in`)
as participant 1's alternative to `reservationId`, exactly matching Excursions' own
Phase 3 split. Companions on a couple/group treatment (never billed separately) can
be a plain `walkInGuestName` with no folio at all. `GET
/api/spa/appointments?openWalkIns=true` lists still-open walk-in-billed appointments
for "pay later" retrieval. The front-office page gained the Guest/Walk-in mode
toggle, reusing `WalkInFolioPanel` with zero new payment UI, same as Excursions.

`tests/business-rules/spa-booking.test.ts` is now 14 tests: the original 9 from
Phase 2 (pure-helper math, a real end-to-end booking with actual folio/tax posting,
therapist and room double-book rejection, couple-treatment distinct-therapist
assignment, and the concurrency race test) plus 5 new ones for Phase 3 (walk-in
booking + real folio posting, the closed-folio-smuggling guard, a closed-folio
rejection, a walk-in-primary + plain-name-companion couple booking with exactly one
folio line item, and the open-walk-ins listing). `tsc --noEmit` clean, production
build clean, full suite 369/369 passing. Still not live-browser-tested — the dev
environment's every-`/api/*`-route-redirects-to-`/login` issue (see the Phase 1 commit
message) is unrelated to Spa and still needs someone to look at it.

**Addendum completed 2026-07-23, later session** (outside the Phase 0-8 sequence —
see `SPA_PLAN.md`'s own addendum section for the full write-up): therapist requests
(a hard gender filter, or a specific named ask) and preference memory, chosen
BEFORE date/time rather than after; and a fix for a real gap where searching a room
with a couple in it only ever surfaced the primary guest, never their companion.
Two new `SpaAppointmentParticipant` fields plus a new `SpaGuestTherapistPreference`
model; `spa-availability.ts`'s engine generalized to per-participant constraints
instead of a flat party size; the availability route gained a `from`/`to` days-in-
range mode (same mechanism as the Excursions Calendar) — caught and fixed a real
performance issue here live (the first cut scanned every time slot for every day
instead of stopping at the first feasible one, which timed out a real test at the
default 5s). Live-verified successfully against a real dev server this time (login,
booking, and the new endpoints all worked with no server-log errors) — the earlier
Phase 1 login-redirect issue noted above did not reproduce. 5 new tests (20 total in
`spa-booking.test.ts`); full suite **375/375 passing** (48 files).

Still ahead: the tape-chart calendar UI (Phase 4), the rest of the appointment
lifecycle — check-in/start/complete/cancel/no-show (Phase 5),
therapist-absence/room-closure reassignment (Phase 6), reports (Phase 7), and the full
tenant-isolation test suite + seed data (Phase 8).

## Excursions Booking — sellable per-property add-on (ALL 7 PHASES DONE 2026-07-22)

Full plan in [EXCURSIONS_PLAN.md](EXCURSIONS_PLAN.md). Front-office-run scheduling and
selling of hotel-run activities (Snorkelling Trip, Island Hopping, Night Fishing) to
in-house and walk-in guests — the first real feature sold as a **per-property** add-on
rather than per-enterprise.

**Phase 1 completed 2026-07-22** (schema + Controls catalog management, no booking flow
yet): `tsc --noEmit` clean, full production build clean, all new routes verified live
via curl against a real dev server (see below) — no automated test suite yet, that's
Phase 6.
- **New generic mechanism**: `PropertyModuleAccess` (defaults OFF, unlike
  `EnterpriseModuleAccess`'s default-ON) — the property-scoped sibling of the existing
  enterprise-level module gating. `assertPropertyModuleAccess(ctx, propertyId, module)`
  in `src/lib/scope.ts`, Osta-only toggle at `GET`/`PATCH /api/licenses/property-modules`
  and a new `/osta/properties/[id]` detail page (linked from both the enterprise detail
  page's property list and the property-approval queue — `/osta/properties/[id]` didn't
  exist before this). Generic by design — `EXCURSIONS` is the first consumer, not a
  special case.
- **New RBAC module `EXCURSIONS`** (`src/lib/modules.ts` + `prisma/rbac-seed-data.ts`
  defaults — the latter keeps its own duplicate `MODULES` list, see the comment there
  for why and the self-heal fallback). Deliberately split into two permission gates,
  corrected mid-build from the original plan draft: catalog/schedule management
  (`ExcursionType`/`Rate`/`Schedule`) is gated by `CONTROLS` like every other catalog in
  the app (RatePlan/Allocation/Outlet); `EXCURSIONS` itself is reserved for day-to-day
  bookings (not built yet — Phase 2). **Every** Excursions route, catalog included,
  additionally requires `assertPropertyModuleAccess` — verified live that disabling the
  add-on 403s catalog access even for an Admin, and that a Front Desk user (has
  `EXCURSIONS` but not `CONTROLS`) is correctly blocked from catalog routes.
- **Schema** (migration `20260722053902_excursions_module`): `ExcursionType` (property-
  scoped catalog, enterprise-wide `ChargeCode` link), `ExcursionRate` (dated,
  adult/child/infant/flat — infant is a real priced tier here, unlike Allocations),
  `ExcursionSchedule` (recurring template) + `ExcursionDeparture` (generated or hand-
  added instance — the "hybrid" scheduling model), `ExcursionBooking` (schema only, no
  routes yet — billing wired to Folio/FolioLineItem/Payment for Phase 2-3).
- **Controls UI**: new "Excursions" tab (`src/components/controls/excursions-manager.tsx`
  + nested `excursion-schedule-manager.tsx`) — catalog CRUD with dated rate rows (APP
  STANDARD 001: Zod + RHF), a per-type schedule sub-dialog, and a "Generate Departures
  through [date]" action — verified live idempotent (re-running the same generate call
  produces `created: 0, skipped: 14`, never duplicates).
- **Verified live** (real dev server, curl, both an Osta support-admin session and a
  Veyo enterprise-admin session): add-on toggle on/off, catalog list/create/update
  blocked correctly when the add-on is off, RBAC permission split (CONTROLS vs
  EXCURSIONS) enforced correctly, delete-blocked-when-departures-exist guard, schedule
  generation idempotency. Not yet verified: an actual in-browser click-through of the
  Controls dialogs (curl-verified API + page-loads-200 only).

**Phase 2 completed 2026-07-22, same session** (in-house booking flow): `tsc --noEmit`
clean, full production build clean, verified live end to end against a real dev
server — created a real test reservation, searched it by room number via the same
endpoint POS uses, booked 2 adults + 1 child onto a generated departure, confirmed the
price ($125 = 2×$50 + 1×$25), the tax split on the resulting `FolioLineItem`
($97.13 + $18.16 + $9.71 = $125.00, correct for a tax-inclusive property), the live
departure headcount updating immediately (0 → 3), and that both an Admin and a Front
Desk user (has `EXCURSIONS` but not `CONTROLS`) can book. The "Excursions" sidebar item
only appears once the add-on is enabled for the current property — confirmed by
toggling it via the `/osta/properties/[id]` page built in Phase 1.
- New: `src/app/api/excursions/departures/route.ts`,
  `src/app/api/excursions/bookings/route.ts`,
  `src/app/e/[slug]/dashboard/excursions/page.tsx`.
- `src/components/app-sidebar.tsx` — sidebar filtering now additionally checks the
  current property's `PropertyModuleAccess` for any module in a new `ADD_ON_MODULES`
  set (today just `EXCURSIONS`) — must stay in sync with the same list maintained in
  `src/components/osta/property-module-access-manager.tsx` (both have comments pointing
  at each other).

**Phase 3 completed 2026-07-22, same session** (walk-in flow): `tsc --noEmit` clean,
full production build clean, verified live end to end — opened a walk-in folio, booked
2 adults ($100, correctly tax-split), confirmed the booking surfaced in the new
"open walk-in bills" list, took a full payment, closed the folio, confirmed it dropped
off the list afterward. Also verified both misuse guards: passing both `reservationId`
and `folioId` 400s, and passing a reservation's own folio as `folioId` 400s instead of
silently accepting it.
- `POST /api/excursions/bookings` extended to accept `folioId` as an alternative to
  `reservationId` — identity for a walk-in booking is read off `Folio.walkInGuestName`/
  `walkInGuestContact`, never re-entered.
- New `GET /api/excursions/bookings` (open walk-in bookings for a property).
- Pay-now/pay-later needed no new payment UI — the booking page opens the existing
  `src/components/pos/walk-in-folio-panel.tsx` (already used by POS for the same job)
  instead of building a second one.

**Phase 4 completed 2026-07-22, same session** (manifest, cancellation, no-show):
`tsc --noEmit` clean, full production build clean, every branch verified live against a
real dev server — see EXCURSIONS_PLAN.md's Phase 4 entry for the full list (cancel
voids the charge on an open folio, correctly can't touch a closed one; re-cancel and
early no-show both 400; a real PDF generates; the cutoff override chain specifically
tested with two different roles, not just read from code).
- Real correction found mid-build: voiding a charge is gated by `CASHIERING`
  (`/api/folios/[id]/line-items/[id]/void`), not by whichever module posted it —
  cancellation now has two independent gates (cutoff window on `EXCURSIONS`, voiding on
  `CASHIERING`) that degrade gracefully rather than block each other. Also: closed
  folios can't be voided OR paid into (confirmed in both the void and payments routes),
  so the original plan's "post an explicit refund Payment" idea for a paid walk-in
  doesn't actually work in this app — corrected to an honest "handle refund manually"
  message instead.
- New: `GET /api/excursions/departures/[id]`, `GET .../manifest-pdf`,
  `POST /api/excursions/bookings/[id]/cancel`, `POST .../no-show`,
  `src/components/front-office/excursion-manifest-panel.tsx`.

**Phase 5 completed 2026-07-22, same session** (whole-departure cancellation cascade +
auto-suggest-replacement): `tsc --noEmit` clean, full production build clean. Unlike
Phases 1-4, this one surfaced two **real bugs during live verification itself**, not
just design corrections caught by reading code:
1. The replacement-departure suggestion query filtered by date only; on this dev
   environment's timezone it suggested a departure whose own boat had already left
   earlier that same day. Fixed by comparing the real combined date+time
   (`combineDepartureDateTime`) against `now`, not just the date.
2. Nothing stopped the same already-moved booking from being moved a second time —
   would have silently double-booked and double-charged a guest. Fixed with a new
   `ExcursionBooking.movedToBookingId` field (migration
   `20260722094214_excursion_booking_moved_to`), verified live: a repeat
   `move-bookings` call on the same booking is now rejected with a clear reason.
Both were caught only because verification actually drove the real cancel→suggest→move
cycle against live data — worth keeping that standard for Phase 6's automated tests
rather than relaxing to "tsc passes."
- New: `POST /api/excursions/departures/[id]/cancel` (manager-only, `EXCURSIONS
  delete`, no cutoff check — this is an operator decision, not the per-guest cutoff
  rule), `POST .../move-bookings`. Manifest panel gained a "Cancel Departure" action
  and a cascade-result summary card with a one-click "Move All" button.

**Phase 6 completed 2026-07-22, same session** (tests, seed, docs) — the feature is now
**fully built end to end**: `tests/tenant-isolation/excursions.test.ts` (10 tests) +
`tests/business-rules/excursions.test.ts` (14 tests, 4 of them pure-function unit tests
for `src/lib/excursions.ts`). Full suite run afterward: **324/324 passing** across 38
test files, confirming the 24 new tests plus all 300 pre-existing ones are green.
`scripts/seed/seed-veyo.ts` now seeds the add-on enabled + all three excursion types
(Snorkelling Trip, Island Hopping, Night Fishing) with real schedules and ~60 days of
generated departures — verified idempotent (ran twice, no errors) and confirmed live via
the API. `DECISIONS.md` got a dated summary entry.

**Phase 7 completed 2026-07-22, later session** — a day/week/month Calendar view of the
schedule, added after a UI-review discussion. Lives as a second tab ("Calendar", next to
"Book") on the existing front-office Excursions page — `src/components/front-office/
excursion-calendar.tsx` (new), color-coded by excursion type using the app's existing
`--chart-1..5` theme tokens, click opens the same manifest panel the page already had.
`GET /api/excursions/departures` gained optional `from`/`to` params (every status across
an exact range, past included, for the calendar) while its no-params behavior — SCHEDULED
+ upcoming only, for the booking picker — is byte-for-byte unchanged; verified live both
ways against real seed data, including a real leftover CANCELLED departure from earlier
Phase 5 testing. One new regression test added; full suite after: **355/355 passing**
(47 files).

Nothing left in this plan — see [EXCURSIONS_PLAN.md](EXCURSIONS_PLAN.md) for the
complete phase-by-phase record if picking this up again later (e.g. the two explicitly-
deferred v2 ideas noted there: complimentary excursions bundled into a rate plan, and a
guest-facing self-booking flow).

## Alpha v4 — Front Desk / Reservations / Housekeeping hardening (PLANNED 2026-07-21)

Full plan in [ALPHA_V4_PLAN.md](ALPHA_V4_PLAN.md). A three-way audit of the three
untouched operational modules found **11 confirmed bugs** (Phase 0 of that plan),
the worst being: the Front Office page's Check-In/Check-Out buttons call the
status-transition endpoint that the Alpha-3 state machine now rejects (primary
front-desk workflow is dead); the Availability Matrix tape chart fetches without
`propertyId` and always renders empty; the calendar view keys on a nonexistent
`res.roomId` so every booking shows "Unassigned"; group detail links 404 and read
wrong field names; departure-PDF balance math ignores voids/refunds/multi-folio.

**Phase 0 completed 2026-07-21, same session** (see the plan doc's Phase 0 header
for per-fix notes): 10 real bugs fixed, 1 false positive (send-confirmation was
already wired). 271/271 suite passing, `tsc --noEmit` clean, API changes verified
live via curl.

**Phases 1–4 executed 2026-07-21, same day, after the app owner answered all five
design decisions** (recorded in DECISIONS.md "Alpha v4 owner decisions"). Four
commits (one per phase); full suite grew 271 → 291, all passing, `tsc --noEmit`
clean after each. Live verification: every changed page compile-checked 200 via
authenticated curl against a real dev server, new endpoints exercised (shift
history, summary vacant fields, list filters, paid-out guard, detail page +
folios/traces include) — the Browser pane still can't reach localhost (same
sandbox issue as the platform-admin session), so an in-browser click-through of
the new dialogs (check-in, walk-in, deposit, OOO) remains recommended. Summary:
- **P1** — pre-arrival deposit workflow (route + UI + auto-transfer to billing
  window at check-in), Front Office check-in dialog (inline room assignment +
  payment), No-Show action, guest search, walk-in booking dialog, cashiering
  shift history + per-method breakdown + printable reconciliation.
- **P2** — reservation detail page (reservations/[id]), server-side list
  search/filters/pagination, editable group blocks (PUT with guards) + pickup
  rate/meal choice, tape chart quick-book on empty cells + bar actions,
  calendar view retired per owner decision.
- **P3** — housekeeping task↔room-status coupling both directions, status enum
  validation, board filters + refresh-on-focus + error dialogs, Due Out/
  Stayover/Arrival-today priority chips, maintenance priority picker, kanban
  refresh; fixed board GET showing checked-out guests as occupants and never
  including the guest name it rendered.
- **P4 (migration 20260721160000)** — Property.requireInspectionOnCheckIn
  (INSPECTED gate at check-in + Controls toggle), Room.oooReason/
  oooExpectedReturn (board Mark-OOO dialog, maintenance take-out-of-order +
  auto-return-to-DIRTY on resolve), CashierPaidOut (petty cash, subtracted
  from expected drawer cash).

**Follow-up session (2026-07-21, later the same day): all four deliberately-
deferred items closed**, one commit each per app-owner instruction (they will
move these to alpha-version-4 themselves — do not push):
- `eef8fce` — cashiering defaults became EnterpriseSettings (Controls > General
  "Cashiering Defaults"; migration 20260721180000; defaults match old hardcodes).
- `e5b6509` — maintenance API unified onto RESTful /api/maintenance/[id]
  (full-field PATCH with enum validation; collection PATCH/DELETE removed, all
  callers migrated; shared vocabulary in src/lib/maintenance.ts).
- `cd78eb3` — per-attendant task sheet (housekeeping/task-sheet): mobile-first,
  defaults to "me", rooms in cleaning-priority order with one-tap actions.
- `be85283` — BookingForm rebuilt onto Zod + React Hook Form per APP STANDARD
  001 (schema in booking-form-schema.ts, LookToBookGrid + BookingSummary
  extracted, inline real-time errors, identical API payloads). 8 schema unit
  tests; full suite 300/300; new/edit pages smoke-tested 200 live.
Alpha v4's plan is now fully executed with nothing deferred.
> This file is the actionable list: what's left, what was deferred on purpose, and what
> was found broken along the way but is out of scope for whoever finds it next to fix
> without checking first. Keep this file current — when you close an item, move it to
> "Recently completed" with a date, don't just delete it silently, so teammates opening
> the repo mid-stream can see momentum.

## Allocations (Revenue model extension) — BUILT 2026-07-19, pending owner review

Full plan and architecture in [ALLOCATIONS_PLAN.md](ALLOCATIONS_PLAN.md) — **Phases A–E
all implemented and green** (167/167 suite incl. 18 new allocation tests; owner
confirmed every design decision, see DECISIONS.md "Allocations"). Per-person
date-range-priced components (BF/LN/DN, transfers, spa, excursions) under Revenue >
Allocations, linkable to Rate Plans and Meal Plans, materialized onto reservations
(`ReservationAllocation`), posted at Night Audit with Include-in-Rate carve-out /
Add-to-Rate / Sell-Separate semantics. Awaiting app-owner UI review/fine-tuning.
~~Known follow-up flagged, not built: Night Audit still has no double-run guard~~ —
**closed 2026-07-19** by the alpha-hardening pass (see "Recently completed"): one
successful audit per property per business date, whole run transactional.

## Base Rate Plan replaces RoomType.basePrice — BUILT 2026-07-19

See DECISIONS.md "Base Rate Plan replaces RoomType.basePrice" for the full account.
`RoomType.basePrice` is gone; every property now gets one locked Rate Plan (code
`BASE`, `isLocked: true`) at onboarding, priced through the normal Price Calendar like
any other plan, and Night Audit falls back to it when the assigned plan has no entry
for the date. **Note for whoever configures a new property**: unlike the old flat
`basePrice` (worked for every future date automatically), the Base plan only covers
whatever date range its Price Calendar has actually been bulk-priced for — an admin
should set it out at least a year via Revenue > Rate Details right after onboarding.
177/177 suite passing (8 new tests), `tsc --noEmit` clean.

## Phase 4 loose end (money & shift data) — resolved, no action needed

`cashiering/{open,close,status}/route.ts` were named in the original Phase 4 scope but
weren't part of the Phase 4 commit (`9d501d5`) — **checked 2026-07-18: all three already
call `requireSession`/`requirePermission("CASHIERING", ...)` correctly**, so Phase 4 is
in fact fully closed. (Likely retrofitted incidentally during an earlier phase since
cashiering shifts are referenced by folio payments.) No further action here.

## Business logic not yet wired (fields/UI exist, no posting logic anywhere)

_(none currently — see "Recently completed" for Green Tax posting, the base price
fallback audit, and housekeepingEnabled enforcement, all closed 2026-07-18)_

## Deferred by explicit user instruction (do not build unless asked)

- Transaction-level tax inclusive/exclusive override (property-level toggle exists;
  user said "we will think of something" for per-transaction override — not scoped yet).

## Osta platform level — SaaS licensing rework (BUILT 2026-07-31, follow-ups open)

Owner brief: Osta (managing enterprise) invoices client enterprises for licensing.
Tier pricing (STANDARD/PRO/MAX) is dropped. Owner answered the scoping questions
2026-07-31: **price is manual per enterprise** (the counted attributes are caps only),
**caps are per-property allowances**, **expiry = grace period (default 7d) with warning,
then login lockout**. Pseudo (PM) room types/rooms are excluded from counts AND
unsupported for channel mapping.

Built (see prisma migration `20260731142040_saas_licensing_lifecycle`):
- `EnterpriseLicense` + status/validFrom/expiresAt/graceDays/monthlyPrice/priceCurrency
  (`tier` retained ONLY as the module-defaults fallback key); `PropertyLicenseAllowance`
  (maxRoomTypes/maxRooms/maxChannels, null=unlimited, 0=disallowed); `LicenseInvoice`
  (LIC-YYYY-NNNN, ISSUED|PAID|VOID, markPaid stamps paidAt + RCP-YYYY-NNNN receipt).
- `src/lib/license.ts` — pure `computeLicenseState` + capacity asserts. Missing license
  row = UNLICENSED = usable (fail-open, flagged in UI), consistent with module gating.
- Enforcement: login route (403 EXPIRED/REVOKED, `licenseWarning` in GRACE),
  requireSession (live sessions die on next request; internal/support exempt),
  room-type POST, rooms POST, `createPropertyLink`, and `setRoomTypeMapping`
  (PM mapping refused outright).
- Enterprise-level module gating removed entirely 2026-07-31 (owner: "not controlled by us") — see DECISIONS.md; Licensing screen now shows license + allowances + invoices only.
- Osta UI: Licensing page reworked (lifecycle card + revoke/reactivate, per-property
  allowances table with usage, invoice issue/markPaid/void/print); print page at
  `/osta/license-invoices/[id]/print` using Osta's own stationery (see /osta/controls);
  /osta layout got the print:hidden treatment.
- Tests: `tests/business-rules/license-limits.test.ts` (11 tests, green).

Follow-ups NOT built yet:
- Overview page portfolio/revenue dashboard (sum of monthly prices, upcoming expiries,
  unpaid invoices) — owner brief mentions it, needs a design pass.
- Enterprise detail page (/osta/enterprises/[id]) still shows only the property count —
  should surface license state + invoices inline per the brief.
- Client-side: login form does not yet display the GRACE `licenseWarning` payload field.
- Tenant-facing "my license / my invoices" read-only view.
- `tests/business-rules/channel-connection.test.ts` "token expiry days" assertion is
  flaky under a fully loaded suite run (time-boundary math; passes in isolation) —
  unrelated to licensing, worth a clamp fix.

Already built toward this (2026-07-31):
- `/osta/controls` — platform invoicing/receipt stationery (brand identity + invoice
  payment instructions + receipt terms, live preview). Stores on Osta's own
  EnterpriseSettings row via the existing enterprise-scoped `/api/tenant-settings`;
  the deprecated-for-tenants `invoiceBrand*` columns are deliberately repurposed as
  the platform's identity fields.
- `/osta/db-health` reworked into tabs: **Storage** (PRAGMA page accounting + dbstat
  per-table bytes, guarded when unavailable), **Queries** (NEW per-tenant attribution:
  `request-context.ts` AsyncLocalStorage set in requireSession → Prisma `$extends`
  operation recorder in db.ts → enterprise/property filterable stats; raw SQL stats
  remain tenant-blind by nature), **API & Channels** (persisted ChannelSyncLog 7-day
  aggregates by operation/enterprise + JobRun summaries + recent failures).

## Channel webhook token hashed at rest (2026-08-02) — DONE

`ChannelConnection.webhookToken` held a **write-capable bearer credential in plaintext**:
possession of the URL is authority to POST bookings into a tenant's PMS, so anyone with
database read access (a `pg_dump`, a backup, a support query, a leaked snapshot) held a
live, usable webhook URL. The app's own eRegistration tokens already solved this the right
way; the channel webhook was the remaining plaintext holdout that
`src/lib/eregistration/token.ts` used to name as such.

- **`webhookToken` → `webhookTokenHash`** (migration
  `20260802094500_hash_channel_webhook_token`). New `src/lib/channels/webhook-token.ts`
  mirrors `src/lib/eregistration/token.ts` — `generateWebhookToken()` (still 32 random
  bytes, so **the URL shape handed to Beds24 is unchanged**) and `hashWebhookToken()`.
- ⚠️ **EXISTING TOKENS ARE DESTROYED, NOT CONVERTED, AND ANY LIVE CONNECTION MUST
  REGENERATE.** The plaintext *could* have been hashed in place (the existing URL would
  have kept working), but by the premise of the change it must be treated as already
  exposed in every dump taken while the column was readable — hashing a leaked token does
  not un-leak it, rotating it does. **Operator action after deploying: regenerate the
  webhook URL in the Hub for every connection that had one and paste the new URL into the
  channel manager.** Until that is done the old URL 404s; inbound bookings still arrive
  via `channel-booking-poll`, so nothing is permanently lost in the gap. **This includes
  the live Veyo Lagoon Retreat Beds24 test account — coordinate before deploying.**
- **The webhook route now authenticates BY the lookup** —
  `findUnique({ where: { webhookTokenHash: hashWebhookToken(token) } })`. The old
  post-lookup `timingSafeEqual` was **removed, not ported**: once the lookup is by hash, a
  returned row already IS the equality check, so the compare would compare that hash to
  itself. `src/lib/eregistration/token.ts` explains this at length and omits it for the
  same reason.
- **Show-once is now enforced by the storage, not by restraint.** The generate endpoint
  already returned the path once and there was never a reveal endpoint or UI (`hasWebhook`
  is a boolean and `PublicConnection` carries no token field) — but before this, the
  plaintext was still sitting in the row for anything to read. It no longer exists after
  the generate response.
- Tests in `tests/business-rules/channel-inbound.test.ts` — the row holds the hash and the
  plaintext appears nowhere on it; **presenting the STORED value (the dump-holder's
  attack) gets a 404**; generating returns a plaintext that authenticates while the token
  it replaced stops working.

## Osta-console channel administration (2026-08-02) — DONE (branch `feature/beds24-master-account`)

Platform-side channel-manager tooling for the master-account topology (see the DECISIONS.md
entry of the same date): the app owner runs ONE Beds24 account and drives every customer
enterprise's setup/monitoring from the Osta console instead of touring tenant Hubs under
support grants.

- **New Osta console page `/osta/channel-manager`** (sidebar entry "Channel Manager"):
  every enterprise's connection in one place — status, health-check/keep-alive button,
  refresh-token expiry countdown, webhook generate/replace (show-once dialog), rate-limit
  pause threshold, connect-new (enterprise picker + invite code), re-authorize, delete.
  A "Shared API credit pool" card surfaces the most recently observed rate-limit reading,
  because under one master account every tenant drains the same budget.
- **New API `/api/osta/channels/connections`** (+ `[id]`, `[id]/test`, `[id]/webhook`) —
  the cross-tenant counterpart of `/api/hub/connections`. Every handler requires
  `ctx.isInternal` FIRST and then `INTEGRATIONS` bits (not CONTROLS like other /api/osta
  routes — it's channel work and the permission should say so). Deliberately no
  enterprise scoping on lookups: cross-tenant reach is the point, and isInternal is the
  entire access control. Creating a connection on the INTERNAL enterprise itself is
  refused (404, same rule as support-access grants).
- **Every action on a tenant's connection logs into THAT tenant's activity trail**
  (`logActivity targetEnterpriseId`), with the Osta admin's identity snapshotted — the
  enterprise being acted on is the one whose auditors need to see it.
- **`listAllConnections()`** in `src/lib/channels/connection.ts` — the one deliberately
  unscoped connection query; goes through `toPublicConnection` so no token fields can
  ride along. Tenant code keeps using `listConnections()`.
- **Room-type/rate MAPPING deliberately absent** from the Osta page — the owner's call is
  that mapping stays in each enterprise's own Hub.
- The tenant Hub component now exports its `Connection` type + `StatusBadge` +
  `RateLimitPanel` + `formatDateTime` for reuse; `hasWebhook` was added to that type.
- **Fixed in passing: the Osta layout had no `ConfirmProvider`** — any Osta page using
  `useConfirm()` would 500. Found by live browser verification, mounted in
  `src/app/osta/layout.tsx` mirroring the tenant shells.
- Tests: `tests/business-rules/osta-channel-admin.test.ts` — tenant admin refused even
  with full INTEGRATIONS (the block is isInternal, not the permission bit); cross-tenant
  list carries enterprise info and no credential fields; create-for-tenant (stubbed
  Beds24) lands encrypted in the tenant with a tenant-trail entry; INTERNAL-enterprise
  create refused; cross-tenant threshold set; webhook mint is show-once/hash-at-rest and
  authenticates on the public route; delete logs to the tenant trail.

## Reservation.externalRef — channel booking id on the reservation (2026-08-03) — DONE (branch `feature/beds24-master-account`)

App-owner request: an "External confirmation id" on the reservation to match a Beds24
booking id to the Osta system. The id already lived on
`ChannelInboundBooking.externalBookingId` (the idempotency key, with `reservationId`
linkage after conversion) and inside the reservation's remarks text — so channel→
reservation matching worked, but reservation-side search did not.

- **`Reservation.externalRef`** (nullable; migration `20260803060000_reservation_external_ref`
  with a backfill from every already-converted `ChannelInboundBooking`). NOT unique on
  purpose — uniqueness and full provenance stay on ChannelInboundBooking's
  `(connectionId, externalBookingId)`.
- Set only by the conversion path (`convert.ts` → `CreateReservationInput.externalRef`);
  staff-made reservations never carry one. The remarks line ("Booked via ... (ref ...)")
  stays as the human-readable provenance.
- **Reservation search now matches it** (`GET /api/reservations` OR-clause) — the desk
  pastes a Beds24/OTA ref into the ordinary search box and lands on the stay. Shown in
  the reservations list (mobile + table) as `· ch:<ref>` next to the confirmation number.

## Configurable poll window + deep resync (2026-08-03) — DONE (branch `feature/beds24-master-account`)

App-owner request after the outage-recovery discussion: the 48h poll lookback was fixed,
so an outage longer than that had no built-in catch-up.

- **`ChannelConnection.pollLookbackHours`** (nullable; migration
  `20260803070000_poll_lookback_hours`) — per-connection override of the scheduled poll's
  window; null = the built-in 48h default. **Bounded at 720h (30 days)** by
  `setPollLookbackHours` in `src/lib/channels/connection.ts` — a routine poll permanently
  re-reading more than that is a standing bulk export, not a safety net. The constant
  lives there (not poll.ts) because poll.ts imports connection.ts and the setter enforces
  it.
- **`pollConnection(id, { lookbackHours })`** — explicit one-off override with its own
  ceiling (`MAX_RESYNC_LOOKBACK_HOURS`, 8760h/1 year), never persisted. Priority:
  explicit > stored > default.
- **`POST /api/osta/channels/connections/[id]/resync`** `{ hours }` — the deep-resync
  action: polls with the one-off window, then runs the conversion sweep so recovered
  bookings become reservations in the same action. A reachable-but-failing poll returns
  200 with the recorded reason (same philosophy as the health-check route). Logged to the
  tenant's trail.
- **Osta console UI**: "Deep resync" button per connection (dialog with hours input +
  result readout) and a "Booking poll window" panel (blur-to-save, mirrors the rate-limit
  panel). `{ pollLookbackHours }` PATCH added to BOTH the Osta and tenant-Hub connection
  routes; tenant-Hub UI for it deliberately not added yet (the platform admin is the
  operator under the master-account topology).
- Tests in `tests/business-rules/osta-channel-admin.test.ts` capture the stubbed fetch's
  `modifiedSince` URL param to prove the window actually sent to Beds24 matches the
  stored setting / the one-off value, that deep resync persists nothing, and that both
  ceilings reject out-of-range values.

## Osta enterprise exists by default (2026-08-03) — DONE (branch `feature/platform-bootstrap`)

App-owner requirement: the Osta (INTERNAL) enterprise — the platform-admin side that
manages customer enterprises and channel-manager connections — must exist by default on
a deployment, not only after someone remembers the manual bootstrap.

- **`scripts/ensure-platform.ts`** — idempotent upsert of the INTERNAL enterprise + all
  system/support roles; **run by `docker-entrypoint.sh` on every container start**, so a
  fresh deployment has the admin side before any request is served. Concurrency-safe
  (one retry absorbs the P2002 race between replicas booting together); non-fatal on
  failure so the tenant-facing app never crash-loops over platform-admin rows.
- **Creates NO user, deliberately** — a default account would mean a well-known password
  on every deployment. `scripts/bootstrap-admin.ts` (now refactored to reuse
  ensurePlatform) remains the only way to mint the operator account, with its
  per-invocation `ADMIN_PASSWORD` (min 12 chars).
- The entrypoint's migration comment was stale ("single-instance SQLite") — rewritten
  for the Postgres reality (advisory lock serializes concurrent `migrate deploy`).
- DEPLOY.md step 6 + the "No INTERNAL enterprise found" troubleshooting entry updated.
- Test `tests/business-rules/ensure-platform.test.ts` — targets the shared `test-osta`
  slug via the opts override, NOT the default "osta": the test DB must never gain a
  second INTERNAL enterprise or concurrent test files' isInternal resolution becomes
  ambiguous (the override exists solely for this).

## Osta-side onboarding: enterprise / properties / initial user (2026-08-03) — DONE (branch `feature/osta-onboarding`)

App-owner requirement: property onboarding driven entirely from the Osta console —
create the enterprise, its properties, and the INITIAL USER ONLY from the platform side.

- **Enterprise**: `POST /api/enterprises` already existed; the `/osta/enterprises` list
  gained the missing "Create enterprise" dialog (name + license property limit), landing
  on the detail page where the rest of onboarding happens.
- **Properties**: new `POST /api/osta/properties/create` — creates FOR an enterprise,
  **ACTIVE with the reviewer stamped** (the approval queue is for tenant-submitted
  properties; Osta approving its own submission would be a ceremony with no reviewer).
  Same license `maxProperties` gate as the tenant route — being the platform does not
  bypass the plan — plus a friendly 409 on a duplicate property code, and identical
  provisioning (locked Base Rate plan, `ensureChargeTree`, `ensureFeeRules`). Deliberately
  a sibling of `/api/osta/properties` (the approval-queue list), not a POST on it.
- **Initial user, ENFORCED as initial-only**: new
  `POST /api/osta/enterprises/[id]/initial-user` refuses outright once the enterprise has
  ANY user — ongoing user management stays with the tenant's Controls; a platform path
  that could quietly add accounts later would be a standing backdoor. The password is
  GENERATED (12 base64url chars, ~72 bits), returned once, stored only as a bcrypt hash —
  the same show-once posture as webhook URLs. UI shows a handover dialog with a
  "copy sign-in details" block (URL + enterprise code + email + password); the button
  itself disappears once a user exists. Account gets the shared system "Admin" role,
  ENTERPRISE scope.
- All actions log into the TENANT's activity trail with the Osta admin's identity.
- UI: `src/components/osta/enterprise-onboarding-actions.tsx` on the enterprise detail
  page ("Add property" disabled at the license limit) + the create dialog in
  `enterprises-list.tsx`.
- Tests `tests/business-rules/osta-onboarding.test.ts`; live-verified end to end on dev,
  including a real `/api/auth/login` with the generated handover credentials.

## Temporary handover password, enforced (2026-08-03) — DONE (branch `feature/temp-password`)

App-owner requirement following the initial-user feature: the generated handover
password must be TEMPORARY — the client has to set their own at first login.

- **`User.mustChangePassword`** (default false; migration
  `20260803120000_must_change_password`), set by the initial-user endpoint.
- **Enforced at the door, not in the UI**: `/api/auth/login` refuses to mint a session
  while the flag is set (returns `{ mustChangePassword: true }`, no cookie, after the
  password + license checks) — so the temp credential cannot operate the app OR the API;
  it can only replace itself.
- **New `/api/auth/change-password`** (not a session route — by design no session exists
  yet): same per-email throttle AND THE SAME COUNTER as login, so it is not a cheaper
  brute-force surface; generic login error for every failure mode including "account not
  in the temporary state" (the endpoint serves the handover flow only, not general
  password change); new password min 12 chars (matches bootstrap-admin), must differ
  from the temp one. Deliberately does NOT mint a session — the client signs in again
  through the normal login route so the license gate and logging apply in one place.
- Login form gains the "Set your password" step (new + confirm), then auto-signs-in with
  the new password.
- Tests `tests/business-rules/temp-password.test.ts` — flag set on creation; temp login
  yields no cookie; wrong/short/reused rejections; happy path kills the temp password;
  non-flagged accounts get the generic error.

## GitHub → VPS deployment pipeline (2026-08-03) — DONE (branch `feature/deploy-pipeline`)

App-owner workflow decision: develop on feature branches; a push to `master` IS the
production deploy. `.github/workflows/deploy.yml`:

- **test job first**: `npm ci` + `prisma generate` + `tsc --noEmit` + the FULL vitest
  suite against a real PostgreSQL 17 service container (same URL shape as
  docker-compose.dev.yml, so vitest.global-setup.ts works unchanged). A red suite never
  reaches the server.
- **deploy job**: SSH as `ubuntu@vps-9d96501a.vps.ovh.ca`, then exactly the manual
  DEPLOY.md procedure — `git merge --ff-only origin/master` (refuses if the server's
  checkout diverged; that means someone edited files on the server), `docker compose
  build app` (old container serves meanwhile), `up -d`, image prune, then a health check
  polling `https://<host>/login` for a real 200 through the proxy.
- Concurrency group `production-deploy`, `cancel-in-progress: false` — deploys queue,
  newest master lands last.
- **Requires one GitHub Actions secret: `VPS_SSH_KEY`** (the private ostastay deploy
  key). Until set, the deploy job fails on auth and the server is untouched. Deliberately
  no registry — the image builds on the server, keeping the existing deployment model.

## Property onboarding gate (2026-08-03) — DONE (branch `feature/property-onboarding-gate`)

Reported by the app owner after using the handover flow: a freshly onboarded tenant with
no property saw every page stuck in a permanent loading state — pages guard with
`if (!currentProperty) return`, so they wait forever on a property that will never
arrive. The app looked broken rather than unfinished.

- **`decidePropertyGate()`** (`src/lib/properties/onboarding-gate.ts`) — pure rule,
  tested directly: through if ANY property is ACTIVE; otherwise blocked in one of three
  states. NOT a security boundary (assertPropertyAccess already refuses non-ACTIVE
  properties on every route) — it decides what the user SEES instead of a dead page.
- **Gate lives in the dashboard LAYOUT**, so it covers every route at once and cannot be
  bypassed by deep-linking. Verified live: `/dashboard` and `/dashboard/reservations`
  both blocked.
- Three states: `NONE` (nothing created — shows the create form, reusing the existing
  `PropertyForm`), `AWAITING` (submitted/rejected — status list, rejection reason,
  resubmit, "check again"), `NO_RIGHTS` (property-scoped user or no CONTROLS create —
  "contact your administrator", since an "add property" button would 403).
- **App-owner decision: EVERY tenant-created property needs Osta approval, including the
  first** — creating it does not unblock the dashboard; the tenant waits on
  `/osta/properties`. (Osta-created properties are ACTIVE on creation — Osta creating it
  IS the approval.)
- Support sessions are exempt, same carve-out `assertPropertyAccess()` makes.
- The gate replaces the whole shell, so it carries its own **Sign out** button —
  otherwise a blocked user has no way out.
- Controls → Inventory → Properties (existing `PropertiesManager`) already covers adding
  further properties; no change needed there.
- Live-verified end to end on dev: no property → create (lands PENDING, still blocked) →
  Osta approves → dashboard unlocks.

## Hub connection screen is READ-ONLY + DB Health storage fixed (2026-08-03) — DONE (branch `feature/hub-connection-readonly`)

**Hub is downstream-only now.** App-owner decision: establishing the Beds24 link is an
Osta-level act (the invite code belongs to the app owner's master account), so the tenant
Hub must not offer it.
- `POST /api/hub/connections`, `PATCH`/`DELETE /api/hub/connections/[id]`, and
  `POST /api/hub/connections/[id]/webhook` now return **403** with a "contact Osta"
  message. Refused at the API, not merely hidden — a hidden button is not a control.
  Note `PATCH` carried `rateLimitPauseThreshold` and `pollLookbackHours` too; both are
  now Osta-only, deliberately, because the credit pool is shared across every tenant.
- **Kept for the tenant**: `GET /api/hub/connections` (read-only health), the on-demand
  health check (`POST .../test` — diagnostics + keep-alive), mapping, inbound bookings,
  and their own exchange logs.
- New `src/components/hub/channel-connection-status.tsx` replaces the old manager:
  status + last-checked + webhook-installed, and a **"Property mapped"** row per link
  showing the channel-side **Property ID**. Empty state tells them to contact Osta.
- `channel-connection-manager.tsx` was DELETED (its connect/re-authorize/delete dialogs
  had no tenant home left); its shared pieces moved to
  `src/components/hub/connection-shared.tsx`, used by both the Osta admin screen and the
  Hub's read-only one.

**DB Health storage panel now works on both engines.** It had shown N/A for everything
since the Postgres move — the probe only spoke SQLite's PRAGMA/dbstat dialect.
- `detectDbEngine()` reads DATABASE_URL; `getStorageStats()` dispatches to a SQLite or a
  PostgreSQL implementation, each degrading to nulls rather than throwing.
- PostgreSQL: `pg_database_size()`, pages from the `block_size` GUC, "reclaimable" =
  estimated dead-tuple bytes from `pg_stat_user_tables` (the honest analogue of SQLite's
  freelist), per-table `pg_total_relation_size()` with the index-only share broken out.
- Verified against the live dev database: 13.8 MB, 8 KB pages, 30-table breakdown.
- ⚠️ **The app itself is still PostgreSQL-only** — `datasource.provider = "postgresql"`,
  the migrations are Postgres SQL (`TIMESTAMP(3)`, `DOUBLE PRECISION`), and 15 queries
  use `mode: "insensitive"`, which SQLite does not support. The app-owner's stated
  intent is SQLite locally / Postgres in production; the db-health probe now supports
  both, but making the APP run on SQLite again is a separate, much larger piece of work.
  **Flagged, not attempted.**

## Reservations list: one-field search, date modes, mobile (2026-08-03) — DONE (branch `feat/reservations-search-mobile`)

App-owner brief for the Reservations screen, phone-first.

- **One search field over every "vital info"** (`GET /api/reservations`): confirmation
  number, `externalRef` (channel booking ref), guest first/last/company, travel-agent
  company, ROOM NUMBER (through assignments), the guest's phone/email (rows in
  ProfileCommunication, not columns on Profile), and accompanying guests' names — a call
  often comes from the second name on the booking. All case-insensitive.
- **`dateMode` = stay | arrival | departure** (default `stay`, the previous behaviour):
  the desk thinks in "who arrives / who is here / who leaves", so the range switches
  rather than always meaning overlap. Range end is INCLUSIVE.
- **CHECKED_OUT and NO_SHOW hidden unless the status is asked for explicitly.** A desk
  searching "Smith" wants the live booking. `status=CHECKED_OUT` still returns them —
  the exclusion only applies when no status preference was expressed. CANCELLED is NOT
  hidden (the owner named only the two). The dropdown's default label is therefore
  "Active bookings", not "All statuses", which would now be a lie.
- **Mobile**: Auto-Assign and Tape Chart hidden below `sm` (a room grid and a bulk sweep
  are not phone work, and they squeezed the title onto two lines); filters moved into a
  bottom-sheet drawer with an active-filter count badge. New Booking stays.
- **Card / table toggle on desktop** (persisted in localStorage); the phone always gets
  cards. One `filterControls` definition renders both the inline desktop bar and the
  drawer, so the two cannot drift apart.
- Tests: `tests/business-rules/reservation-search.test.ts` — every search field, the
  three date modes, inclusive range end, and the default exclusion both ways.

## Known non-blocking issues / things to flag, not silently fix

- ~~**The z-index token scale is documented but not enforced**~~ — **DONE 2026-08-01
  (v5.7)**, and it was a genuine bug, not just untidiness: `--z-toast` and the primitives'
  hardcoded `z-50` were equal, and since `<Toaster />` mounts with the root layout (early
  `<body>` child) while dialogs portal later, **toasts were reliably drawn behind an open
  dialog** — not "undefined", just losing. Fixed via a new `--z-portal: 50` shared by all
  portaled layers, with `--z-toast` raised to `60`. ⚠️ **This entry's own prescribed fix
  was wrong** — migrating the primitives to distinct `--z-dropdown`(20)/`--z-modal`(40)
  numbers would render a `Select` listbox behind the `Dialog` containing it, which is 20+
  files here. Portaled siblings must share one level so mount order decides. `--z-dropdown`
  removed (zero consumers). See DESIGN_LOG 2026-08-01 and DESIGN_PLAN §2.7.
- **Input borders don't meet WCAG 1.4.11 non-text contrast.** `--border`/`--input` are
  `#E6E2DA` on `#FAF9F6` (1.23:1) and `#4A463D` on `#0F0E0C` (2.05:1); the boundary of a
  form control is supposed to clear 3:1. This predates the warm-cast change (the old cool
  values were 1.18:1 and 1.91:1, i.e. slightly worse) and fixing it means visibly darker
  field borders app-wide — a design call for the app owner, not a silent change. A
  narrower fix is a dedicated `--input-border` token darker than the divider `--border`.
- **SMTP settings are still stored in plaintext (`EnterpriseSettings.smtpPassword`)** —
  the Confirmation Letter feature (2026-07-19) now does real SMTP sending via
  `src/lib/mailer.ts` on top of this, per explicit app-owner instruction ("printable and
  smtp both options"). No encryption-at-rest or GET-response redaction was added — both
  are pre-existing gaps, flagged again here as a real follow-up, not fixed as part of
  this feature (out of scope, needs a key-management decision from the app owner first).
- **SFTP settings are still scaffold-only** — Controls has UI for them but nothing
  actually uses SFTP today.
- **`TierModuleAccess` licensing gate fails open by design** (see MASTER_PLAN
  "Architecture decisions") — this is intentional scaffolding, not a bug, but it means
  Pro/Max tier module restrictions currently enforce nothing. Don't "fix" this without
  an explicit tier→module mapping decision from the app owner first.
- ~~A new RBAC module isn't retroactively granted to existing enterprises' System
  roles~~ — **fixed 2026-07-19**, see "Recently completed" below.
- **Dev-only console error on every page load: "Encountered a script tag while rendering
  React component"** — from the anti-FOUC theme script in `src/app/layout.tsx`. Noise,
  not a bug: the script is emitted into the streamed HTML and does run before first
  paint. `next/script` with `strategy="beforeInteractive"` was tried on 2026-07-23 and
  does **not** silence it. The real fix is to delete the script and drive the theme from
  a cookie read server-side in the root layout (`cookies().get('theme-mode')` →
  `<html className="dark">`), migrating `DarkModeProvider`'s persistence from
  localStorage to a cookie. Not done: it opts every route into dynamic rendering, which
  needs an owner call, and it's cosmetic in dev only.
- **`/dashboard/inventory` is an orphan route** — it's the fallback landing page for any
  role without FRONT_DESK `canView` (see the redirect in
  `src/app/e/[slug]/dashboard/page.tsx`), but it has no sidebar entry, so a Housekeeping
  user lands on a rooms/work-order page they can't navigate back to. Noticed during the
  2026-07-23 sidebar regrouping; left alone because it isn't clear whether the page is
  still wanted or whether those roles should just land on `/dashboard/housekeeping`.
- **~25 files sitting uncommitted in the working tree** as of the Phase 4 commit,
  touched by what looks like a concurrent design-system pass this agent session did not
  make and deliberately did not stage/commit: `src/app/theme.css`,
  `src/components/ui/{switch,checkbox,card,empty-state,status-badge,tooltip}.tsx`,
  `src/components/auth/login-form.tsx`,
  `src/components/controls/property-banner-color-manager.tsx`,
  `src/components/housekeeping/room-status-card.tsx`,
  `src/components/reservations/tape-chart-grid.tsx`,
  `src/components/revenue/flash-report.tsx`,
  `src/components/settings/properties-manager.tsx`, and ~13
  `src/app/e/[slug]/dashboard/*/page.tsx` files. Run `git status` and `git diff` on
  these before your next commit — they may be your own uncommitted work from a prior
  session, or someone else's. Do not assume, and do not discard.

## Recently completed (for momentum visibility — trim entries older than a few weeks)

- **2026-07-27** — **Stationery redesign** (app-owner request + PDF template). Branding for
  every printed document now comes from the **property** (General profile + Appearance), not
  `EnterpriseSettings.invoice*`: added `Property.address` (Property Information) and
  `Property.stationeryFont` (Appearance, new `PropertyStationeryFontManager`), resolved by
  `resolveStationeryBrand()` (`src/lib/stationery-brand.ts`). Old `invoice*` branding columns
  deprecated (kept in DB, unread — remove in a later migration). Stationaries configurator
  tabs are now **Invoices / Receipts / Confirmation Letter / Registration Card / Account
  Statement**; the live preview follows the active tab (the old switch-tab-*and*-dropdown is
  gone) and the Invoices tab has a Proforma⇄Tax toggle. All five documents recreated per the
  template in one shared module (`src/components/print/stationery/`) consumed by both the
  print pages and the preview (via `StationeryPreviewFrame` + sample data) so they can't
  drift. Per-document footer/terms added (`receipt*`/`statement*` on `EnterpriseSettings`).
  Font map de-duplicated into `src/lib/stationery-fonts.ts`; `print-blocks.tsx` deleted; the
  Confirmation Letter folded into the shared `PrintDocumentShell`. Migration
  `20260726224317_stationery_property_branding`; new `stationery-brand.test.ts` (6) green;
  `tsc` clean. **Follow-up:** Account Statement tab is scaffolded (footer/terms + interim
  preview) — redesign its layout when the owner provides the statement template. See
  DECISIONS.md "Stationery redesign" (2026-07-27).
- **2026-07-27** — **Outlets as first-class billing entities + per-outlet sales checks +
  Spa/Excursion outlet linking** (app-owner request). Three phases:
  1. `Outlet` gains `code` (uppercase 2–8, unique per property, doubles as the check
     prefix), `address`/`email`/`phone`/`taxNo`, and a `checkSequence` counter
     (migration `20260726191243_outlet_details_and_check_seq`). Add/Edit modal is now a
     two-panel "book" (Outlet Information | Financial Information); Tax Override relabeled
     "Tax Rule (Default/Custom)"; charge-code pool unchanged, just relocated. Code
     validation lives in `src/lib/outlet-code.ts`. Existing outlets keep `code = null`
     until first edit (API requires one on save; list shows "Set a code").
  2. New `OutletCheck` model + `FolioLineItem.outletCheckId`;
     `allocateOutletCheckNumber()` in `document-sequence.ts` (per-outlet counter →
     `SPA-00001`). `pos/charge` opens a check on the first outlet post and reuses it via
     `outletCheckId` for the session; a walk-in bill is 1:1 with a check and rejects a
     second outlet. Walk-in outlet bills print the **outlet's own header** + Check No but
     still get the legal `TAX_INVOICE` number (owner decision); room-posted outlet
     charges reference the check number on the guest-house invoice.
  3. `SpaSettings.outletId` + `ExcursionSettings` (new model + `api/excursions/settings`
     route + Controls card). When linked, spa/excursion booking posts stamp
     `FolioLineItem.outletId` and route tax through `resolveOutletChargeTax` (outlet Tax
     Rule wins); unlinked = unchanged. Migration `20260726192342_spa_excursion_outlet_link`.
  Tests: `outlet-code`, `outlet-check-numbering`, `outlet-module-link` (18 outlet tests
  pass; 64 touched-path regression tests pass; `tsc --noEmit` clean). **Not** visually
  verified in-browser — Controls/Fast Post are behind the auth wall (no seeded creds),
  so the two-panel modal, Fast Post check flow, and walk-in outlet-header bill were
  verified at the route/logic level only.
  Backfill for pre-existing null codes: `scripts/dev-tools/backfill-outlet-codes.ts`
  (derives from name + dedupes per property, idempotent; dry-run by default, `--apply` to
  write). Run once against dev.db on 2026-07-27 (Veyo Garden→VEY, Maaveyo Spa→MAA).
  Run against other environments as they upgrade.
- **2026-07-24** — **Reservation detail screen redesign + Transport feature.** Reworked
  `src/app/e/[slug]/dashboard/reservations/[id]/page.tsx`: Guest is now the first section
  (lead guest clickable → profile, VIP badge/level, nationality flag+name, pax w/ icon;
  accompanying guests smaller w/ their own VIP star), then Reservation Detail (dates,
  nights, rate plan code(s), projected rate total, room type(s)), Transport, Billing,
  Deposits & Fees at-a-glance (from `Payment.depositPurpose`), Traces (button). Allocations
  card removed. **Daily Details modal** = day-by-day grid (Rate · Room Type · Room · Pax ·
  Room Charge · Allocation · Taxes · Total) via new `GET /api/reservations/[id]/daily-breakdown`,
  which reuses `computeReservationQuote` (now emits a per-night `days[]`) so it can't diverge
  from Night Audit — it's a projection of planned charges, not actual posted rows.
  **Transport** = new `ReservationTransport` table (one PICKUP + one DROPOFF row; migration
  `20260724122730_add_reservation_transport`): transportType (SystemCode `TRANSPORT_TYPE`),
  flightNumber, scheduledAt, reference, chargeAmount + chargeToGuest, chargedLineItemId.
  Upsert via `PUT /api/reservations/[id]/transport`. Editor fields per owner spec: Carrier
  Code (flight no.), Carrier Time, Transport Type, Transport No., Transport Time, Transport
  Remarks; when "booked by hotel" is on, a selectable **charge code** + amount.
  **Revenue realization = Night Audit, not a manual button.** The hotel-booked charge posts
  during `night-audit/run` on the leg's realization date (transportTime → carrierTime →
  check-in for pickup / check-out for dropoff), alongside Room & Tax, catching up if a day
  was missed; `ReservationTransport.chargedLineItemId` guards against double-posting. (The
  earlier on-demand `/transport/[direction]/charge` route was removed.)
  UI: `src/components/front-office/reservation-transport.tsx`.
  **Config prerequisites for the owner:** (1) add Transport Type values in Controls ›
  Reservations › "Transport Type" dropdown (empty by default); (2) hotel-booked charging
  needs a ChargeCode with category `TRANSPORTATION` (Controls › Finance › Charge Codes) — the
  editor's charge-code picker is empty until one exists.
  **Daily Details TZ fix:** the day→assignment match now uses the quote's per-night
  `assignmentIndex` (not a date string), fixing the first night showing a blank room
  type/number in non-UTC timezones. Not visually verified (login wall).
- **2026-07-24 (transport/daily-details refinements)** — (1) transport editor charge-code
  Select now shows the code label, not the raw UUID; (2) **transport time must fall within
  the stay** and carrier time not after check-out — enforced client-side (input min/max +
  save guard) AND server-side in `PUT /transport`; (3) **Daily Details now folds in
  transport charges** on their realization date (new "Other" column; a synthetic row if the
  date has no room night) and gained an **info (ⓘ) drill-down** = categorised summary
  (Room · Allocation · Other · Taxes + grand total) built in the daily-breakdown endpoint;
  added `Info` to the icon adapter.

## Reservation / Billing — requested, NOT yet built (owner 2026-07-24)

- **Traces "alert on open"** — a checkbox on a trace; if set, opening the reservation pops
  the trace text every time until the trace is marked complete (for high-attention tasks).
  Needs: `ReservationTrace.alertOnOpen Boolean` (migration), trace-panel checkbox, and a
  popup on the reservation page for unresolved alert traces.
- **Billing module — building as increments (owner approved "all of them", 2026-07-24).**
  Rules captured in DECISIONS.md "Billing module — owner rules". Sequence:
  1. **Reverse check-in / reverse check-out** — ✅ DONE (2026-07-24).
     - `reverse-check-in/route.ts`: IN_HOUSE → RESERVED, clears `checkedInAt`; blocked once
       any non-void charge is posted (void it first). Pre-arrival deposits don't block.
     - `reverse-check-out/route.ts`: CHECKED_OUT → IN_HOUSE, clears `checkedOutAt`; reopens
       folios, un-finalizes debtor invoices (`isDebtorAccount`/`payeeProfileId`), VOIDs the
       TA commission credit (never deleted), deletes the pending CHECKOUT housekeeping task
       and reverts room DIRTY→CLEAN, writes a FRONT_DESK trace + activity log.
     - Debtor (City-Ledger) reversal gated to the **same business day** as checkout, via the
       new `Reservation.checkedOutAt` field (migration `..._add_reservation_checked_out_at`);
       guest-payable stays reverse on any date. Nothing financial is deleted.
     - UI: "Reverse Check-in" button (IN_HOUSE group) + "Reverse Check-out" button
       (CHECKED_OUT) on the reservation detail page, with confirm/reason prompts.
  2. **Interim bill** — ✅ DONE (2026-07-24). `type=interim` on the folio invoice-data route
     + print page: the actually-posted charges/payments so far, mid-stay, labelled "Interim
     Bill", NOT numbered and NO ledger change (distinct from Proforma's full projection).
     "Interim Bill" print button on the folio panel.
     **Advance bill** — ✅ DONE (2026-07-24). `api/reservations/[id]/advance-bill` posts N
     upcoming nights (user-chosen ≤ remaining) — Rate + Extra Occupancy + Allocations +
     Green Tax + uncharged Transport — computed via `computeReservationQuote` over
     assignments clipped to the night window, posted as folio lines **dated today** (revenue
     on the settlement date). Sets `Reservation.advanceBilledThrough`; Night Audit skips
     room/allocation/green-tax posting for nights ≤ that date (no double-charge); transport
     is double-post-safe via `chargedLineItemId`. Early check-out now auto-moves the checkout
     date to the business date. "Advance Bill" button (nights prompt) on the reservation
     detail page. Covered by `tests/business-rules/advance-bill.test.ts` (incl. the
     no-double-post guard). FOLLOW-UP: replace the window.prompt with a proper nights-picker
     modal + an Advance Bill print doc.
  3. **Checkout settlement enforcement** — ✅ DONE (2026-07-24). Owner reframed "force-settle":
     NO write-off/override — a guest can never check out with an open balance.
     - **City Ledger** now BLOCKS checkout if the settling profile has no AR account
       (`isCreditAccount`), instead of silently falling back to guest-payable
       (`cityLedgerNoAccount: true`). check-out/route.ts + commission.test.ts.
     - **FIT/guest**: zero-balance guard stays; the block message advises settling to a
       **Service Recovery** payment method (staff-managed) — existing payment flow, no new
       mechanism.
     - **Settlement document** = the existing Tax Invoice (no separate doc added; a distinct
       Settlement Receipt is a quick follow-up if wanted).
  4. **Linked-profile folios / charge routing & transfer** — ✅ DONE (2026-07-24). Owner
     scoped this as the existing routing feature + naming + charge transfer (NOT a new
     cross-reservation master-folio model):
     - Folio **routing "Route to"** targets are now labelled by **owner name** (lead guest,
       sharer payee, travel agent) instead of "Folio #N", and the linked **Travel Agent /
       Corporate** is a one-click routing target — picking it opens a City-Ledger folio owned
       by the TA and routes the selected charge codes there (so charges split guest vs TA).
     - **Transfer charges** to a different in-house reservation's folio already existed
       (`/api/folios/line-items/move` + the Move/Transfer dialog); its target picker now uses
       the same owner-named options.
     - `/api/folios` POST now accepts an optional `payeeProfileId` + `settlementMethod` to open
       a bill-to folio (used for the TA folio).
- **(superseded) Billing module (large — needs its own scoping pass).** Owner's stated scope: billing/
  charging opens only after check-in and is frozen after check-out (corrections via a
  future **reverse check-in / reverse check-out**); Generate **Proforma**, **Interim Bill**
  (information invoice), **Advance Bill** (post everything due in one go); post normal
  charges; record payments; multiple folios; **folios for linked profiles** (share / company
  / agent); **Tax Invoice + checkout settlement**; checkout blocks & force-settles a non-zero
  window. Much of the folio/payments/tax-invoice/checkout-settlement path already exists
  (`folio-panel.tsx`, deposit/checkout routes) — needs an audit of what's present vs. the
  gaps (Proforma/Interim/Advance generators, linked-profile folios, reverse check-in/out,
  forced-settlement gate) before building. **Proforma must include projected transport**
  (same as Daily Details) — tie into this pass.

- **2026-07-23 (follow-up)** — **Card-variant consistency pass + auto-open bugfix.** Fixed a
  bug where navigating to Controls > Inventory auto-opened the Create Room Type dialog: the
  addSignal effect used a `firstRun` flag that StrictMode's double-invoke consumed, opening the
  dialog on the second invoke. Now compares the signal value (RoomTypeManager, RoomManager).
  Added an `action` slot to `ControlsCard` (renders top-right via the app's `CardAction`), and
  moved the primary Add button INTO the card header for the four cards that had it orphaned on
  its own row / in a duplicate-title inner card: Properties, Meal Plans, Payment Methods,
  Excursions (each now renders its own ControlsCard; dashboard passes title/description as props
  and no longer double-wraps). Tax/Charge Codes/Outlets already had their Add on a nav/filter row
  (the "Table + Nav + Button" variant) and were left as-is. Sorting also added to the Users &
  Roles users table. Sequence Manager left unsorted (fixed canonical reference list) — see the
  Dropdowns exemption note.
- **2026-07-23** — **Settings card variants + first-column table sorting (Settings.dc.html
  design import).** New reusable `src/components/controls/use-table-sort.tsx` (a
  `useTableSort` hook + `SortableTableHead` cell): two-state asc↔desc sort, first column
  is the sort column, opens sorted ascending, app-token styled + dark-mode-safe. Wired
  into every standard Controls table: Properties, Room Types, Buildings/Floors/Rooms,
  Tax, Charge Codes, Meal Plans, Excursions, Outlets, Payment Methods, Amenities. Also
  adopted the mockup's card-variant interactions (adapted to app tokens, not the
  mockup's sharp-corner/black-button skin — owner chose "adapt to app tokens"):
  hover-reveal row actions (dim to 60%, full on row hover/focus), and for Property
  Architecture the tab-nav + Add button now share one row — the Add lives in
  `FacilitiesManager` and signals the mounted child (`RoomTypeManager`/`RoomManager`)
  to open its own dialog via an `addSignal` counter (firstRun-guarded so tab switches
  never auto-open). Booking Codes (`GeneralSettingsManager`) footer replaced its
  blocking `alert()` with an inline dirty/saved hint (hint left, Save right).
  **Deliberate exceptions:** the Dropdowns options table is NOT sortable — its row order
  IS the data (defines dropdown display order via the reorder arrows), so sorting would
  misrepresent it. Owner chose asc↔desc-only (no "unsorted" third state), so the
  mockup's "clear sort to reorder" gating doesn't apply.
- **2026-07-23** — **Controls > General > Appearance picker redesign (Appearance
  Picker.dc.html):** live banner preview with hover-preview-without-commit, left-aligned
  swatch tiles, hex revealed on hover/select, in `property-banner-color-manager.tsx`.
- **2026-07-23** — **Sidebar + Controls navigation regrouping (v5 fine-tuning).** The
  app sidebar's flat 17-item list is now five workflow groups (Operations / Services /
  Finance / Reports / Setup), rendered by a new client component
  `src/components/app-sidebar-nav.tsx`; `app-sidebar.tsx` stays the server-side
  authority on module visibility and passes down only the allowed modules. Along with
  it: active-route highlighting (longest-prefix match, so `/reservations/tape-chart`
  lights Tape Chart and not Reservations), collapsed-mode tooltips (also added to the
  Osta console sidebar), `next/link` client navigation instead of full-reload `<a>`,
  and unique icons per entry (previously `Users` and `CalendarDays` were each used by
  three items — indistinguishable when collapsed to icons). Controls sections were
  reordered ground-up (General → Inventory → Reservations → Client Relations → Revenue
  → Finance → Outlets → Excursions → Reports → Sequences → Users & Roles → Support
  Access) and the empty "Front Desk" placeholder tab was removed — it was the first
  tab, so Controls used to open on a page that said there was nothing to configure.

- **2026-07-21** — **Osta platform-admin console**, per direct app-owner request. Full
  account in [DECISIONS.md](DECISIONS.md) "Osta platform-admin console". Summary: a
  hard-gated property-approval workflow (`Property.status` PENDING→ACTIVE/REJECTED,
  enforced via `assertPropertyAccess`, resubmittable), a real per-enterprise module
  override (`EnterpriseModuleAccess`, precedes the previously-unenforced
  `TierModuleAccess` scaffold, now actually wired into `requirePermission` via a new
  `AuthContext.licensedModules`), a genuinely separate `/osta/...` console (own
  layout/sidebar/login-routing, Licensing and Support Access moved out of the tenant
  Controls page), and a DB Health dashboard with real per-process query
  instrumentation (in-memory ring buffer, not persisted — explicit v1 limitation).
  271/271 suite passing, `tsc --noEmit` clean. **Live browser verification blocked
  this session by a sandbox networking issue** (Browser pane couldn't reach
  `localhost:3000`, confirmed via curl that the dev server itself was fine) — a
  manual UI pass through the full property-approval and module-toggle flows is
  recommended before considering this closed.
- **2026-07-20** — **Profiles module redesign**, per direct app-owner request (Loyalty→VIP,
  multi-row Communications/Address/Identification, CRM section, consolidated Guest/Staff/
  Company/Corporate table, Stay History). Full design in
  [PROFILES_REDESIGN_PLAN.md](PROFILES_REDESIGN_PLAN.md), decisions in
  [DECISIONS.md](DECISIONS.md) "Profiles redesign". Summary:
  - New child tables `ProfileCommunication`/`ProfileAddress` (real per-row CRUD, at-most-
    one-primary each) replace the old single-row `ProfileContact`; `ProfileDocument`
    (Identification) upgraded off destructive replace-all onto the same pattern.
    `ProfileAttachment` added (URL-referenced list, not real upload). `Profile.vipLevel`
    replaces `loyaltyTier` (new `VIP_LEVEL` Controls LOV); added `middleName`, `nationality`,
    `originPropertyId` (set-once breadcrumb).
  - New `STAFF` profile type, independent of the `User` login/RBAC model (pure directory
    bucket). Company/Corporate profiles use a single Name field and skip Personal
    Information/Identification — all four types share one `Profile` table.
  - New `GET /api/profiles/[upid]/stay-history` — live-computed Future/History stay list +
    per-stay revenue breakdown by charge code + "Visits to Property"/"Visits to Chain"
    counts (never stored columns, since `Profile` has no `propertyId`).
  - `ProfileForm` fully rebuilt around the new section order (Personal Information →
    Communications → Address → Identification → CRM → Attachments → Notes); new multi-row
    manager components under `src/components/profiles/`; new read-only profile detail/view
    page with Overview + Stay History tabs.
  - Two-phase migration (additive → Prisma-Client backfill of all 5 existing `ProfileContact`
    rows → destructive drop), same pattern as the earlier Base Rate Plan work. ~15 files
    outside the Profiles module updated for the `.contacts` → `.communications` rename
    (invoice/receipt/confirmation-letter data routes, group pickup, print pages, seed
    script, 2 test files).
  - Found and fixed a real bug via the new test suite: the documents (Identification) POST
    route defaulted `isPrimary` to `true` when unspecified (inconsistent with Communications/
    Address, which default `false`) — every new ID document silently became primary without
    demoting the previous one. Fixed in both the dedicated route and the profile-create
    nested-create mapping.
  - 12 new tests in `tests/business-rules/profile-communications.test.ts`. Full suite
    210/210 passing, `tsc --noEmit` clean. Seed script (`scripts/seed/seed-veyo.ts`)
    extended with `VIP_LEVEL`/`PREFERENCE`/`DIETARY_REQ`/`CLASSIFICATION` LOV entries, a
    sample Note/Attachment/Preference tag on a VIP guest, and a Staff profile — verified to
    run clean end-to-end.
  - **Not yet done**: live browser click-through (list page STAFF tab, create→edit
    redirect, multi-row managers, new view page, Debtors `contextMode="debtor"` regression
    check) — next step for whoever picks this up.
- **2026-07-20** — **User Activity Log module** (per direct app-owner request: "proper
  audit log added to each action (view excluded), login and all actions"):
  - **Schema**: `UserActivityLog` (migration `20260720120000_user_activity_log`) —
    append-only, snapshot design (userEmail/userName copied at write time, NO FK
    relations, so the trail survives user deletion and nothing cascade-deletes audit
    history). `isSupport` flags actions performed under a SupportAccessGrant; support
    actions land in the TARGET enterprise's trail. `enterpriseId` null only for
    anonymous events (failed login to an unknown email).
  - **Writer**: `src/lib/activity-log.ts` — `logActivity()` (session actions) and
    `logAuthActivity()` (login/logout, no ctx). Awaited but never throws — a logging
    failure can't break the action it describes. The ONLY code that writes rows;
    there is deliberately no write API.
  - **Module**: `ACTIVITY_LOG` added to `MODULES` + `rbac-seed-data.ts` (Admin/
    Manager/Osta Support Admin get it via their all-module matrices; everyone else
    NONE; existing roles picked it up automatically via the requireSession()
    self-heal). Read-only `GET /api/activity-log` (filters: module/action/user/text/
    date + offset pagination), sidebar entry, dashboard page
    (`.../dashboard/activity-log`) with module/action/search filters + load-more.
  - **Wired into every significant mutation** (~35 handlers): login success/failure
    (incl. reason + unknown-email), logout, reservation create/edit/delete/status/
    check-in/check-out/room-move/reassign/auto-assign, group create/pickup, folio
    create/walk-in/update/delete, charge post, VOID, payments/refunds (both routes),
    charge move, POS charge, night-audit RUN, cashier shift open/close, currency
    exchange, profile CUD, user CUD (flags role changes/password/deactivation), role
    CUD, tenant-settings, housekeeping room-status, and the full support-access cycle
    (request/approve/deny/revoke/ENTER — ENTER logs into the target enterprise's
    trail with isSupport=true).
  - **All remaining routes wired (2026-07-20, follow-up session)**: the low-traffic
    config CRUD routes — rooms/room-types/rate-plans/price-calendar(+bulk)/
    charge-codes/taxes/payment-methods/meal-plans/allocations/outlets(+appointments)/
    buildings/floors/facilities/system-codes/sequences/properties/enterprises/
    licenses(+tier-modules)/traces/housekeeping-tasks/housekeeping-maintenance/
    maintenance, plus the send-confirmation (`SEND_CONFIRMATION`) and send-statement
    (`SEND_STATEMENT`) emails. groups/[id] is GET-only — nothing to wire. Every
    mutation handler in `src/app/api` now logs.
  - **Fixed while wiring (auth holes found in passing)**: `payment-methods/[id]`
    (PATCH/DELETE) and `traces/[id]` (PATCH/DELETE) had NO auth at all — no
    requireSession, no tenant scoping; any logged-out caller could mutate any
    enterprise's rows by guessed id. Both now use the standard requireSession +
    requirePermission + ownership-check pattern of their sibling routes (needed a
    ctx to log from anyway).
  - **Fixed while testing**: the new sequential confirmation numbers collided
    *across properties* (confirmationNo is globally unique, sequences are
    per-property — two properties both produce "000001"). No-prefix enterprises now
    default the prefix to the property's globally-unique `code` ("VEYO-000001");
    a configured `resConfirmPrefix` still wins.
  - Tests: 3 new in `alpha-hardening.test.ts` (trail rows exist for every action
    class exercised, auth events incl. anonymous failures, API enterprise-scoping +
    ACTIVITY_LOG permission gate). Full suite 197/197, `tsc --noEmit` clean.

- **2026-07-20** — **Alpha-hardening pass 2 (P1 batch from the pre-alpha audit)**, again
  no schema migrations:
  - **Cancellation/no-show fee workflow** via existing primitives: the CANCELLED guard
    in `reservations/[id]/status` is now **balance-based** (folios must net to ~0)
    instead of blocking on any charge existing — so front desk posts a fee (any
    charge code, e.g. a CXL code) via the Folio Panel, takes payment, then cancels.
    An unrefunded deposit equally blocks until refunded. No new endpoint or config.
  - **Auto-no-show at Night Audit**: RESERVED reservations whose check-in date has
    passed are flipped NO_SHOW inside the audit transaction; response returns
    `noShowsProcessed` + confirmation numbers. Nothing financial is automatic — any
    deposit stays on the still-open folio for front office (refund or fee-forfeit).
  - **Zero-rate warning**: the audit response now lists reservations that posted a $0
    room charge because no Price Calendar rate covered tonight (`zeroRateWarning`) —
    the direct mitigation for the Base-plan coverage cliff flagged at onboarding.
  - **Group pickup guards**: rejects pickups on a CANCELLED block, past `cutoffDate`,
    or beyond `totalRoomsHeld` (counting non-cancelled/non-no-show pickups); pickups
    now also **materialize the rate plan's allocations** (previously a group pickup
    on a package rate silently lost its packages).
  - **Login rate limiting** (`src/lib/login-rate-limit.ts`): 5 failures per email per
    15 min → 15-min lockout (429), in-memory by design (single-node deployment; swap
    point documented in the file). Reset on successful login.
  - **SMTP/SFTP password redaction**: `tenant-settings` GET/PATCH responses replace a
    stored password with `********`; PATCH treats the round-tripped mask as
    "unchanged" so the settings form can't clobber the real secret. The actual value
    still reaches `src/lib/mailer.ts` (reads the DB directly). **Encryption at rest
    remains open** — still needs the key-management decision.
  - Tests: `alpha-hardening.test.ts` grew to 14 (fee workflow end-to-end, pickup
    held-count/cutoff 400s + sequential pickup numbering, lockout at the 6th attempt,
    mask round-trip incl. stored-value integrity, auto-no-show flip + response
    fields). Full suite 194/194 passing, `tsc --noEmit` clean.
  - **Still open from the audit's P1 list**: financial audit-trail table (schema
    migration — deferred while concurrent sessions are active in this repo),
    optimistic concurrency, Litestream backup story, SMTP encryption at rest
    (key-management decision), check-in `roomWarning` toast in the UI.
- **2026-07-19** — **Alpha-hardening pass (P0 blockers from the pre-alpha audit)**, all
  code-level guards, no schema migrations:
  - **Type-level availability / overbooking guard** (`src/lib/availability.ts`):
    per-night sellable-rooms-vs-booked check (pseudo room types exempt), wired into
    reservations POST/PUT, group pickup, and status-reinstate; plus a physical-room
    double-booking check (`hasRoomConflict`) wired into reservations POST/PUT, group
    pickup, room-move (which previously had NO conflict check), and reassign. Bookings
    that don't fit now 409. `rooms/available` and auto-assign now exclude
    `OUT_OF_ORDER` rooms (previously sellable!) and only treat `RESERVED`/`IN_HOUSE`
    as inventory-holding (NO_SHOW/CHECKED_OUT release the room).
  - **Night Audit hardened** (`night-audit/run`): whole posting loop + audit log in one
    `$transaction` (mid-run failure rolls back everything and writes a `FAILED` log
    row); idempotency guard — one `COMPLETED` run per (property, business date), rerun
    → 409; room charges bounded by `checkOutDate` (overstays skipped, surfaced via
    `overstayWarning` in the response instead of accruing forever);
    `EnterpriseSettings.systemDate` now rolls to the next day on success (was never
    advanced by anything).
  - **Reservation lifecycle is a guarded state machine**: `PATCH .../status` enforces a
    transition table (no jumping to `CHECKED_OUT`/`IN_HOUSE` — dedicated routes only;
    cancel blocked while non-void charges/payments exist; reinstate re-checks
    availability; cancel closes clean folios, reinstate reopens them). Reservation PUT
    rejects status changes outright. DELETE blocked once any folio has line
    items/payments (cancel instead) or the stay is in-house/checked-out.
  - **Charge void** (`POST /api/folios/[id]/line-items/[itemId]/void`): sets
    `isVoid=true` (never deletes), requires a reason, blocked on closed folios, writes
    a ReservationTrace audit line; Void button + reason dialog in FolioPanel (voided
    rows show struck-through with a VOID badge).
  - **JWT secret fails closed** (`src/lib/jwt-secret.ts`): production boot now throws
    if `JWT_SECRET` is unset instead of silently using the hardcoded dev fallback
    (was in auth.ts, scope.ts, proxy.ts — all three now import the one resolver).
  - **Sequential confirmation numbers**: reservations POST + group pickup now allocate
    from the Sequence Manager's `REGISTRATION_NO` counter (prefix/pad from
    EnterpriseSettings) instead of `Math.random()`/`randomBytes` — with a skip-ahead
    loop in case a legacy random number occupies a generated value.
  - **Check-in readiness**: OOO/OOS room blocks check-in; DIRTY room checks in but
    returns a `roomWarning` (surfacing it in the check-in UI is a nice-to-have not yet
    wired). **Check-out** now auto-creates a `CHECKOUT` housekeeping task for the
    vacated room (skipped when the room type has housekeeping disabled).
  - **Validation sweep**: `checkOutDate > checkInDate` on create/edit; amount must be
    a positive finite number on folio payments, folio line items, and POS charge.
  - **Tests**: new `tests/business-rules/alpha-hardening.test.ts` (10 tests: overbook
    409, exclusive checkout-day boundary, cancel-releases-inventory, sequential
    confirmation numbers, forbidden transitions incl. the PUT smuggle, cancel-blocked-
    until-void, void semantics incl. double-void, delete protection, amount/date
    validation, audit idempotency + overstay skip). `tests/tenant-isolation/
    booking.test.ts` setup gained a room (a type with zero rooms is now correctly
    unbookable). Full suite 190/190 passing, `tsc --noEmit` clean.
  - **Not done here** (still open from the audit's P1 list at the time — most were
    closed the next day by pass 2 above): ~~no-show/cancellation fees, auto-no-show,
    login rate-limiting, group-block inventory, SMTP redaction~~ ✅; still open:
    financial audit-trail table, SMTP encryption at rest, Litestream backups,
    optimistic concurrency.

- **2026-07-19** — Added **occupancy-based pricing, Derived Rate Plans, and a
  decoupled Meal Plan model**, per direct app-owner request across three asks in one
  session: (1) "that price is default occupancy rate - please also add for extra
  adult, extra child prices", (2) rename Revenue tabs to Manager Flash/Rate
  Plans/Rate Details with the same extra-price fields on bulk pricing, (3) a design
  discussion on Meal Plan being awkwardly tied to Rate Plan ("I have to create
  seperate Rates for seperate Meal Plans") that the app owner then extended with
  their own idea ("derived rate...add/minus a percent or flat amount") and asked to
  build both. Full design in [DECISIONS.md](DECISIONS.md); summary here:
  - **Occupancy pricing**: `RoomType.baseOccupancy` (default 2, editable) + optional
    `PriceCalendar.extraAdultPrice`/`extraChildPrice` per day. Night Audit posts a
    separate "Extra Occupancy Charge" line item when `(adults - baseOccupancy) *
    extraAdultPrice + children * extraChildPrice > 0`. Surfaced on the Price
    Calendar's Bulk Update card and calendar grid, and on Rate Details' bulk form.
  - **Derived Rate Plans**: `RatePlan.parentRatePlanId` (self-relation, no
    chaining) + `derivedAdjustmentType` (PERCENT|FLAT) + `derivedAdjustmentValue`.
    A derived plan has no `PriceCalendar` rows of its own — its price is always
    computed live as `applyRateAdjustment(parent's price, type, value)`, resolved
    identically by the Price Calendar display route and Night Audit
    (`src/lib/derived-rate.ts`), so it can never go stale relative to the parent.
    The Price Calendar page shows a read-only banner instead of the Bulk Update form
    for a derived plan; Rate Details excludes derived plans from its target
    selector (bulk-pushing to one is blocked server-side too).
  - **Meal Plans decoupled from Rate Plans**: new `MealPlan` (property-scoped,
    Controls > new "Revenue" category) and `RoomTypeMealPlanRate` (flat per-night
    surcharge per Room Type × Meal Plan, not date-seasonal — "a set rate").
    `RatePlan.mealPlan` removed entirely (a Rate Plan is now purely about room
    pricing); `Reservation.mealPlan` stays a plain code string but its dropdown now
    sources from the live Meal Plan list instead of 5 hardcoded options. Night Audit
    posts a "Meal Plan Charge" line item via a (propertyId, code) lookup, same
    pattern as `ChargeCode` lookups elsewhere. Migration seeds BB/HB/FB/AI per
    existing property so the Controls list isn't empty after upgrade.
  - **Non-blocking maxOccupancy warning**: `POST /api/reservations` now flags (never
    blocks) when adults+children exceeds a room type's `maxOccupancy`, surfaced in
    the reservation form's save notification — found while building this that
    `maxOccupancy` was previously enforced nowhere at all.
  - **Also**: `BulkPricingTool` (Rate Details) now uses the shared `DateRangePicker`
    component instead of plain `<input type="date">` pairs, matching AGENTS.md's
    component convention.
  - Full suite: 149/149 passing, `tsc --noEmit` clean. **Live-verified end-to-end**:
    created a Derived Rate Plan (BAR-BB, BAR +$20 flat), confirmed its Price
    Calendar shows the computed $170 (not editable directly) when BAR is $150;
    configured a Bed & Breakfast meal plan with a $25 Standard Room rate via the new
    Controls > Revenue matrix (per-cell save-on-blur); booked a reservation on the
    derived plan with that meal plan and 6 occupants (triggering the capacity
    warning), ran Night Audit, and confirmed the folio posted exactly $170.00 room
    charge, $25.00 meal plan charge, and $60.00 Green Tax as three separate,
    correctly-taxed line items.
  - **Correction (same day)**: the `RoomTypeMealPlanRate` matrix was removed a few
    hours later per direct app-owner feedback — the Derived Rate Plan mechanism
    (BAR/BAR-BB/BAR-HB/...) is itself the meal-plan-pricing association, no separate
    per-room-type rate needed. `MealPlan` (the LOV) stays; the matrix, its API route,
    and the Night Audit "Meal Plan Charge" posting were deleted. Full rationale in
    [DECISIONS.md](DECISIONS.md)'s "Correction, same day" addendum.
- **2026-07-19** — Redesigned the **Debtors pipeline to be checkout-triggered**, per
  direct app-owner request ("statement and receipt currently together -- it should
  be two seperate ones, statement should show line per invoice with totals and
  guest name and also summary age of folios (open only)"), which surfaced that "one
  row per invoice" was structurally impossible under the original shared-pooled-
  ledger design — the app owner's clarifying answer ("Debtors will only work once
  guest is checked out - so no active reservations should be there") defined the
  real intended architecture. Full design/rationale in
  [DECISIONS.md](DECISIONS.md) "Debtors: checkout-triggered invoice pipeline
  redesign"; summary here:
  - **A debtor invoice is now a reservation's own `Folio`**, not a shared pooled
    ledger folio — `findOrCreateDebtorFolio` and the old pooled-folio model are
    gone. `settlementMethod` + `payeeProfileId` are set at reservation creation;
    `isDebtorAccount` now flips `true` only **at checkout**, only for a still-
    `CITY_LEDGER` folio with a valid credit-account travel agent — before that it's
    always `false`, which is what keeps in-house reservations out of Debtors
    entirely. No schema migration — every field reused.
  - **Night Audit reverted to settlement-agnostic**: always posts nightly charges to
    the guest's own folio; the City-Ledger routing branch is removed.
  - **Checkout is now the pipeline trigger**: `DIRECT` folios must still net to ~0;
    `CITY_LEDGER` folios are excluded from that check (with a defensive fallback if
    the travel agent isn't a valid credit account) and get finalized into an invoice
    in the same transaction that closes the reservation.
  - **Removed the mid-stay "Bill to Account" feature outright** (real capability
    removal) — the equivalent split-billing case is still covered by existing
    Add Folio + Settlement-toggle + Move-to-Folio primitives.
  - **Aging rewritten**: `computeAgingBuckets` (FIFO over a flat shared ledger) →
    `computeFolioAgingBuckets` (buckets each independent open invoice by its own
    checkout-date age — much simpler, no cross-invoice allocation needed).
  - **Found and fixed a real regression while building the account detail page**:
    `POST /api/folios/[id]/payments` unconditionally rejected payments to closed
    folios, which would have broken Record Payment for every debtor invoice (every
    invoice is closed the moment checkout creates it). Fixed to allow payments on a
    closed folio when `isDebtorAccount` is true.
  - Account list/detail/Statement print page/send-statement email all rebuilt around
    a per-invoice table (via new `buildInvoiceSummary()` in
    `src/lib/debtor-accounts.ts`) instead of a flat charge/payment ledger.
    Stationaries' combined "Receipt / Statement" preview split into two separate
    preview modes to match.
  - **Full test suite rewritten**: `tests/tenant-isolation/debtors.test.ts` (15
    tests) and `tests/business-rules/debtor-aging.test.ts` (9 tests) replaced
    entirely. 149/149 full suite passing, `tsc --noEmit` clean.
  - **Live-verified end-to-end against the real `demo` enterprise dev database**
    (driven via authenticated `fetch` calls from the browser session, plus direct UI
    checks, after the interactive booking-form widgets proved too flaky to drive
    reliably through the browser-automation tool): created a City-Ledger credit
    account ("Verify Travel Co"), booked and checked in a reservation against it,
    confirmed the account showed **0 invoices** while `IN_HOUSE`; ran Night Audit and
    confirmed the nightly Room + Green Tax charges posted onto the *reservation's own*
    folio (`isDebtorAccount` still `false`) — Debtors still showed 0 invoices
    afterward; checked the reservation out despite a nonzero City-Ledger balance
    (succeeded, unlike a `DIRECT` folio which would block) and confirmed the invoice
    then appeared with the correct guest name ("Test Guest"), confirmation number, and
    total ($124), bucketed into the "current" aging bucket; recorded a payment against
    that specific invoice's (closed) folio — succeeded per the payments-route fix
    above — and confirmed balance/aging both dropped to zero and the status flipped to
    "Paid" on both the account detail page and the Statement print page (which
    rendered the invoice table + aging summary correctly, not a flat ledger); cycled
    the Stationaries live preview through all four modes (Invoice/Confirmation
    Letter/Receipt/Statement) and confirmed Statement shows its own dedicated
    invoice-table mockup, distinct from Receipt's flat payment-row mockup. Deleted the
    test reservation/profile afterward to leave the demo enterprise clean.
  - **Side effect, not a bug**: the `demo` enterprise had no `ROOM`/`GTX` charge
    codes or any `PaymentMethod` configured at all (Night Audit and payment recording
    were previously unexercisable there) — created minimal ones as part of this
    verification and left them in place, since they're exactly what any real property
    needs and their absence was a pre-existing seed-data gap, not something this
    change should revert.
  - **Found, not fixed**: deleting a `Profile` that's still referenced by a
    `Folio.payeeProfileId` (e.g. via `DELETE /api/profiles/[id]`) succeeds and leaves
    the folio with a dangling foreign key, which then makes deleting the owning
    reservation 500 with a raw Prisma `P2003` foreign key error instead of a clean
    error message. Hit only via manual test-data cleanup (not a real user flow — there
    is no UI path to delete a credit-account profile that already has invoice
    history), so left as a flagged gap rather than fixed under this task's scope;
    worth a proper fix (block the profile delete, or `onDelete: SetNull` the relation)
    if it ever turns out to be reachable from the UI.
- **2026-07-19** — Added a **Stationaries** page, per direct app-owner request: moved
  the "Invoice Design" settings out of Controls > Reports (which previously mixed it
  with unrelated SMTP/SFTP config) into its own top-level sidebar page covering all 5
  printable/emailable documents (Tax/Proforma Invoice, Confirmation Letter, Payment
  Receipt, Currency Exchange Receipt, Debtor Statement). No schema/API changes — every
  field already existed on `EnterpriseSettings` and was already read correctly by all
  5 documents; this was a pure UI relocation/reorganization.
  - New `src/components/settings/stationaries-manager.tsx` (replaces the deleted
    `invoice-settings-manager.tsx`) groups fields into three tabs matching an audited
    per-document usage matrix, instead of one undifferentiated form: **Branding**
    (shared by all 5 documents), **Financial Documents** (header/footer text, payment
    terms, payment account info — used by Invoice + Receipt + Exchange Receipt +
    Statement), **Confirmation Letter** (its own policy-text field only). A switchable
    live-preview selector flips between three mockups (Invoice, Confirmation Letter,
    generic Receipt/Statement) reading from the same form state.
  - **Sidebar placement changed mid-build per follow-up request**: first shipped as a
    Controls tab (matching Sequences/Tax/Users & Roles precedent), then promoted to
    its own top-level `app-sidebar.tsx` entry when the app owner asked for it there
    directly — reuses the existing `CONTROLS` permission rather than a new RBAC module
    (it's a settings page, not a new operational domain; reusing an already-granted
    permission also meant every existing Admin/Manager saw it immediately, no
    self-heal backfill needed). New standalone page
    `src/app/e/[slug]/dashboard/stationaries/page.tsx`; the Controls tab entry was
    removed once the sidebar entry existed, to avoid two maintained paths to the same
    settings.
  - Full suite: 147/147 passing, `tsc --noEmit` clean. **Live-verified**: all three
    tabs load/save correctly, all three preview modes render, a saved
    `confirmationLetterMessage` change persisted through a full page reload and was
    confirmed directly in the database, then reset back to empty afterward.
  - **Noted, not a bug of this change**: mid-verification, the Controls page (a
    different route, not touched by this work) was found intermittently failing to
    compile due to JSX tag-mismatch syntax errors in `room-manager.tsx` and then
    `tax-manager.tsx` — moving targets consistent with a concurrent session actively
    editing those files. Did not touch either file. If Controls still won't load next
    session, check those two files first before assuming new work broke something.
- **2026-07-19** — Fixed the **reservation status mismatch blocking Check-In** flagged
  above (previously spawned as its own follow-up task): `reservations/route.ts`'s POST
  handler and `groups/[id]/pickup/route.ts`'s pickup-conversion handler both created new
  reservations with the literal status `"CONFIRMED"`, which is **not** a value in the
  `ReservationStatus` enum (`RESERVED | IN_HOUSE | CHECKED_OUT | NO_SHOW | CANCELLED`).
  Check-in gating (reservations page row actions, Front Office arrivals query) filters on
  `status === 'RESERVED'`, so every freshly created reservation had an unreachable
  Check-In button and never surfaced in Front Office arrivals — **confirmed live**: a
  fresh reservation created via `POST /api/reservations` came back with `"CONFIRMED"`
  before the fix. Both creation sites now use `"RESERVED"`. Also fixed
  `analytics/route.ts`'s "Occupied Rooms" query, which filtered on
  `{ in: ["CONFIRMED", "CHECKED_IN"] }` — two more values absent from the enum (the real
  one is `IN_HOUSE`) — that would have gone permanently dead (always 0 occupied rooms)
  once the creation bug was fixed, since it depended on reservations actually landing in
  `"CONFIRMED"`. Now filters on `{ in: ["RESERVED", "IN_HOUSE"] }`, matching the same
  "active reservation" pattern already used by `pos/search/route.ts`. Removed the
  defensive `res.status === 'CONFIRMED'` branch from the reservations page's
  Confirmation Letter button gating (added earlier as a workaround for this exact bug,
  per the note below) since it's no longer reachable. Full suite: 147/147 passing,
  `tsc --noEmit` clean. **Live-verified end-to-end** against a real dev database: created
  a property/room type/rate plan/guest/reservation via the actual API, confirmed the new
  reservation's status was `RESERVED`, confirmed the Check-In button rendered on the
  Reservations page, assigned a room, and clicked Check-In through the real UI —
  reservation correctly transitioned to `IN_HOUSE`.
- **2026-07-19** — Fixed the RBAC gap found while live-verifying Debtors: a module
  added to `MODULES` was never retroactively granted to any enterprise's
  already-seeded roles, and System roles can't be edited via the Controls UI at all
  (no self-service fix existed). `src/lib/scope.ts`'s `requireSession()` now
  self-heals: on every request it diffs the role's actual `RolePermission` rows
  against the current `MODULES` array and backfills any gap — System/Support roles
  get their canonical default from `SYSTEM_ROLE_DEFS`/`SUPPORT_ROLE_DEFS` (keyed by
  role name), custom roles get `NONE` (the same safe default they'd have gotten if
  the module had existed when they were created). Idempotent and race-safe via
  `RolePermission`'s `@@unique([roleId, module])` plus an upsert (SQLite doesn't
  support `createMany`'s `skipDuplicates`, so this backfills per-row via `upsert`
  rather than a batch insert). Cheap on the hot path — a `Set` diff against ~14
  known modules, no-op after the first backfill per role. 2 new tests in
  `tests/scope.test.ts` (System-role default matrix applied, custom-role NONE
  default, idempotency across two requests). **Live-verified against the real dev
  database**: found 8 pre-existing roles genuinely missing the `DEBTORS` row
  (Manager, Front Desk, Housekeeping, Maintenance, Cashier, Reservations, both Osta
  Support roles) — logged in as the `Manager` role and confirmed the row was created
  correctly (matching `SYSTEM_ROLE_DEFS.Manager.DEBTORS`, all `true`) on the very
  first request, and the sidebar's Debtors link appeared immediately with no restart
  or manual intervention needed. Full suite: 147/147 passing, `tsc --noEmit` clean.
  Deliberately did **not** relax the "System roles cannot be edited" UI restriction —
  that's a separate, intentional design choice (editing a role shared across every
  enterprise from one enterprise's Controls page would be a much larger and riskier
  change); this fix addresses the actual reported bug (a legitimate new module not
  reaching existing roles), not the read-only-ness itself.
- **2026-07-19** — Added the **Debtors** module (Accounts Receivable), per direct
  app-owner request: credit accounts for Travel Agents/corporate clients, charge
  transfer/billing to those accounts, Night Audit posting to the correct account, and a
  Folio "Bill to Account" option gated on a City Ledger settlement method. Full design
  in [DECISIONS.md](DECISIONS.md) "Debtors (Accounts Receivable)"; summary here:
  - **Schema** (migration `20260719020000_debtors_module`, no new models): `Profile.
    isCreditAccount` activates the already-existing-but-dormant `arNumber`/
    `creditLimit`/`iataNumber`/`commissionRate` fields as a live account;
    `Folio.settlementMethod` (`DIRECT` default | `CITY_LEDGER`) and
    `Folio.isDebtorAccount` (true only for an account's AR ledger folio). A debtor's AR
    ledger **is** a Folio — `reservationId: null` like a walk-in, `payeeProfileId` set
    to the credit-account Profile (reusing the existing relation), one per
    `(Profile, Property)`, created lazily on first use via
    `src/lib/debtor-accounts.ts`'s `findOrCreateDebtorFolio`.
  - **New `DEBTORS` module/sidebar entry**: `Admin`/`Manager` (full, as always) +
    `Cashier` (`EDIT_NO_DELETE`, plus `PROFILES: EDIT_NO_DELETE` since a credit account
    IS a Profile). All other roles get none by default.
  - **Charge routing**: a new dedicated `POST /api/debtors/accounts/[profileId]/
    bill-charges` — deliberately **not** an extension of the existing
    `/api/folios/line-items/move` route, since that route's walk-in-rejection and
    same-reservation-only guards are load-bearing safety invariants for the ordinary
    "Move to Folio" action and would need weakening in ways that risk that feature.
    Rejects double-transfers (billing a charge already on an AR folio, or billing from
    a group master folio). Credit-limit overage is **warn-only, never blocking**
    (mirrors the Outlet appointment `capWarning` pattern) — returned in the response,
    never persisted.
  - **Automatic + manual routing**: reservation creation defaults a new folio's
    `settlementMethod` to `CITY_LEDGER` when the attached Travel Agent/corporate
    profile is a credit account (not re-evaluated on edit, so a staff override isn't
    clobbered); Night Audit then posts the nightly ROOM/Green-Tax charges straight onto
    the account's AR folio instead of the guest folio when that's set — since the
    charges never land on the guest folio, **checkout's existing zero-balance check
    needed no code changes at all**. Any other charge (POS, incidentals) can be
    manually routed via the new "Bill to Account" Folio Panel action (only enabled
    when `settlementMethod === CITY_LEDGER`).
  - **Full AR suite** (per app-owner's explicit scope choice): account list + detail
    ledger with FIFO aging buckets (`src/lib/debtor-aging.ts`, pure function, unit
    tested standalone), recording payments received (reuses the existing
    `POST /api/folios/[id]/payments` unchanged), and a printable/emailable Account
    Statement following the Confirmation Letter/Invoice pattern exactly (`PrintDocument
    Shell` gained an `extraActions` slot to support the dual Print+Email actions).
  - **14 new tenant-isolation tests** (`tests/tenant-isolation/debtors.test.ts`,
    mailer mocked) + **8 aging-bucket unit tests**
    (`tests/business-rules/debtor-aging.test.ts`). Full suite: 145/145 passing,
    `tsc --noEmit` clean.
- **2026-07-19** — Added the **Confirmation Letter** feature (previously explicitly
  deferred as "the 'Confirmations' branded document/email template feature under
  Reports" — now un-deferred per direct app-owner request, who supplied a reference
  image and asked for both printable and real SMTP-sent delivery: "printable and smtp
  both options"). Sent to a guest once their stay is confirmed — entry to the Maldives
  requires a hotel confirmation, sent by mail.
  - **Schema** (migration `20260719000000_confirmation_letter`): new
    `Reservation.remarks` (free-text front-desk note, e.g. "Honeymoon — high floor
    requested" — deliberately its own field, not sourced from `ReservationTrace`, which
    is an operational task log rather than curated guest-facing text) and
    `EnterpriseSettings.confirmationLetterMessage` (editable generic policy paragraph,
    falls back to sensible default wording referencing the property's own
    check-in/check-out times when null).
  - **`src/lib/mailer.ts`** (new, `nodemailer` installed): the one place that turns
    `EnterpriseSettings.smtp*` into an actual outgoing email —
    `sendMail`/`assertSmtpConfigured`/`SmtpNotConfiguredError`. Any future
    mail-sending feature should go through this rather than its own transport.
  - **`src/lib/confirmation-letter.ts`** (new): pure formatting helpers
    (`formatAllGuestNames`, `nightsCount`, `formatRoomCategories`) shared between the
    print page (Tailwind/JSX) and the email (inline-styled HTML string, since email
    clients don't support modern CSS) so content stays consistent despite the markup
    necessarily differing.
  - **Two new API routes**: `GET /api/reservations/[id]/confirmation-letter-data`
    (fetch, `RESERVATIONS`/`view`) and `POST /api/reservations/[id]/send-confirmation`
    (send, `RESERVATIONS`/`update`) — the latter 400s cleanly with a clear message when
    SMTP isn't configured or the primary guest has no email on file, 502s on an
    unexpected send failure.
  - **New print page** `.../reservations/[id]/confirmation-letter` — reuses the
    existing `EnterpriseSettings.invoice*` branding tokens (logo, brand color, font)
    rather than a parallel branding system; a 3px brand-color left accent strip stands
    in for the reference image's illustrated artwork (no image assets exist for that,
    and recreating it would be disproportionate scope). One page, includes guest
    name(s) incl. accompanying guests, stay period, nights, room category, remarks (if
    present), and the generic policy paragraph. Deliberately does **not**
    auto-`window.print()` on load (unlike the folio print page) since it offers two
    distinct actions — Email and Print — via a control bar.
  - **UI wiring**: reservations page row actions gained a "Confirmation Letter" button
    (gated on `status` being `RESERVED`, `CONFIRMED`, or `IN_HOUSE` — see the status
    mismatch bug noted below), a Remarks textarea on the reservation form, and a new
    "Confirmation Letter — Policy Text" field on the Controls → Invoice Design card.
  - **7 new tests** in `tests/tenant-isolation/confirmation-letter.test.ts` (mailer
    mocked, no real SMTP calls) covering cross-enterprise 403s on both routes, the
    no-email-on-file 400, the SMTP-not-configured 400, a successful send, and the
    unexpected-failure 502. Full suite: 123/123 passing, `tsc --noEmit` clean.
    Live-verified in browser: created a reservation with remarks, opened the letter
    (all fields render correctly), confirmed the Email button 400s cleanly with dev
    SMTP unconfigured, confirmed Print renders a clean one-page layout.
  - **Found and fixed a real, severe pre-existing bug while live-verifying the Remarks
    field**: `PUT /api/reservations/[id]` (the reservation edit endpoint) required
    top-level `roomTypeId`/`ratePlanId` fields that the multi-segment reservation form
    (`reservations/page.tsx`) never sent (it only ever sends a nested `assignments`
    array) — every reservation edit through the UI 400'd, silently, for every
    reservation, regardless of this feature. Fixed by changing `updateSchema` and the
    PUT handler to accept the same `assignments` array shape POST already uses,
    validating each segment individually (room type/rate plan/room existence and
    active/in-service checks now scoped per-segment against the reservation's *existing*
    assignments, not a single `currentAssignment`). Caught live in the browser (a real
    edit 400'd with a Zod validation error on `roomTypeId`/`ratePlanId`), fixed, and
    re-verified live afterward.
  - **Known gap flagged, not fixed** — see "Known non-blocking issues" above: SMTP
    credentials remain plaintext at rest; a pre-existing reservation-status bug was
    found (not caused) while wiring the row action.
- **2026-07-18** — Added the **Outlets** feature (Spa, Restaurant, Bar, etc.) end to end,
  per the app owner's brief: log outlet revenue, let already-booked guests charge
  treatments to their room, and generate standalone bills for passerby guests with no
  booking, with a smooth onboarding flow. Full design/decisions in
  [DECISIONS.md](DECISIONS.md) "Outlets"; summary here:
  - **Schema** (two migrations — `20260718173000_outlets_foundation` additive, then
    `20260718173500_folio_walkin_and_outlet_line_items` for the risky part): new
    `Outlet`/`OutletChargeCode`/`OutletAppointment` models; `Folio.reservationId` is now
    **nullable** with a new required `Folio.propertyId` (backfilled from each existing
    row's Reservation) and `walkInGuestName`/`walkInGuestContact` fields for walk-in
    bills; `FolioLineItem.outletId` for revenue attribution.
  - **Every Folio-touching route retrofitted** to scope off `folio.propertyId` directly
    instead of `folio.reservation.propertyId` (that path is now only ever present for
    reservation-backed folios) — `folios/[id]/*`, `payments`, `pos/charge`,
    `folios/line-items/move` (which now also flatly rejects moving charges to/from a
    walk-in folio, since a null-vs-null reservationId comparison would otherwise wrongly
    permit it), plus every folio-creation site (`folios/route.ts`, `reservations/route.ts`,
    `groups/[id]/pickup`, `reservations/[id]/check-in`, `prisma/seed-operations.ts`,
    `prisma/add-sharers.ts`). New `GET /api/folios/[id]` (didn't exist before — was the
    missing fetch path for a folio with no reservation to key off). Print page now
    handles a null `reservation` with a walk-in fallback.
  - **Outlet CRUD** under Controls → new "Outlets" tab (positioned right after
    Inventory), reusing the `CONTROLS` permission — name, type, active toggle, optional
    top-level tax override, optional appointment capacity, and a curated many-to-many
    charge-code pool (`OutletChargeCodePicker`, mirrors `RoomFeaturePicker`'s dual-panel
    pattern). **Amenities relocated here too** (from Inventory), per the app owner's
    request — same `FacilityAmenitiesManager`, just moved, no code changes to it.
  - **Tax override**: `resolveOutletChargeTax` in `src/lib/tax-calc.ts` — a thin wrapper
    around the existing `resolveChargeTax` (unchanged, still used everywhere with no
    outlet context) that substitutes the outlet's own tax handling when
    `taxOverrideMode` is set, else defers to the charge code's own setting exactly as
    before.
  - **POS integration**: outlet selector filters the charge-code dropdown to that
    outlet's pool and attributes posted revenue to it; a "Walk-in" toggle opens a
    standalone folio via new `POST /api/folios/walk-in`, then reuses the *existing*
    `pos/charge` flow unchanged (it only ever needed a `folioId`) — no separate walk-in
    charge endpoint. New `WalkInFolioPanel` (view charges/payments, take payment, close,
    print) since the existing reservation-coupled `FolioPanel` was intentionally left
    untouched (confirmed it's never reachable for a walk-in folio).
  - **Pre-booking**: `OutletAppointment` is a simple log (no resource-capacity model,
    per the app owner's explicit scope cut — "extended full version" deferred to a
    future tier) — guest is either an in-house reservation or a walk-in name. An
    optional `appointmentCapPerSlot` on the Outlet produces a **non-blocking**
    `capWarning` in the create response when an overlapping slot would exceed it; the
    booking is never rejected. Lives as a second "Appointments" tab on the existing POS
    page rather than a new sidebar item/RBAC module — deliberately avoids opening the
    MODULES-mirrors-sidebar question for a feature this tightly coupled to POS.
  - **RBAC**: no new module — Outlet config rides on `CONTROLS`, Outlet operations
    (charges, walk-ins, appointments) ride on `POS`, both already existed.
  - **34 new tests** across 5 files (`tests/tenant-isolation/outlets.test.ts`,
    `walk-in-folios.test.ts`; `tests/business-rules/outlet-tax-override.test.ts`, plus
    appointment-capacity coverage folded into `outlets.test.ts`). Full suite: 116/116
    passing, `tsc --noEmit` clean. Live-verified in browser end-to-end: created a real
    Outlet with a curated charge code, started a walk-in bill, posted a charge through
    the outlet (correct tax math), printed the resulting invoice (walk-in fallback
    rendered correctly), booked two overlapping appointments and confirmed the second
    correctly returned a non-blocking `capWarning`, and confirmed the outlet DELETE
    guard blocks removal once it has real revenue/appointment history (deactivation is
    the path from there).
- **2026-07-18** — Custom Tax profiles made multi-line and actually wired to charge
  posting (previously the `useDefaultTax`/`taxProfileId` config on a `ChargeCode` was
  fully editable but silently ignored by every posting route). `TaxRate` gained `name`/
  `calculateOn` (`BASE` | `COMPOUND`)/`order` (migration `20260718172500_tax_rate_
  multiline`) so a profile can hold several lines, each either a flat % of the subtotal
  or compounding on the running total — generalizing the existing Service-Charge-then-
  GST relationship. New shared engine `src/lib/tax-calc.ts`
  (`computeDefaultEngineTax`/`computeCustomProfileTax`/`resolveChargeTax`) replaces the
  same calculation that used to be duplicated inline in `pos/charge`,
  `folios/[id]/line-items`, and `night-audit/run`'s room charge — all three now call
  `resolveChargeTax` instead. Tax Manager UI redesigned for multi-line editing. 15 new
  tests (`tests/business-rules/tax-calc.test.ts`,
  `tests/business-rules/custom-tax-posting.test.ts`); live-verified in browser that
  adding a two-line profile through the real UI persists correctly. See
  [DECISIONS.md](DECISIONS.md) "Custom Tax profiles" for the full design.
- **2026-07-18** — Closed out the remaining post-Phase-6 backlog (folio print merge,
  Green Tax posting, base price fallback audit, housekeepingEnabled enforcement,
  reservations hardcoded-UUID cleanup):
  - **Folio print routes merged**: `/print/folios/[id]` deleted; `/e/[slug]/dashboard/
    folios/[id]/print` is now canonical (per app owner's explicit call) and was brought
    to feature parity first — payee-profile display (`payeeProfile || primaryGuest`),
    Green Tax line-item handling/display, and the more robust print CSS were ported
    over from the old page, which had actually been the more complete of the two.
    `FolioPanel`'s print button now opens the canonical route (via `useParams()` for
    the enterprise slug) instead of the deleted one.
  - **Green Tax posting implemented**, nightly, alongside room-charge posting in
    `night-audit/run/route.ts`. **Schema change**: added `Reservation.infants` (new
    migration `20260718171500_reservation_infants`) as its own occupancy bucket,
    separate from `adults`/`children` — the app owner's explicit call after discussion
    revealed `Reservation.children` is a raw headcount with no per-guest birthdate, so
    "children under 2 exempt" couldn't be computed from it. Green Tax = `adults ×
    greenTaxAdultAmount + children × greenTaxChildAmount`; infants are fully exempt and
    excluded from occupancy entirely. Posts against a `GTX` charge code (looked up per
    enterprise, same pattern as the existing `ROOM` code) — if `greenTaxEnabled` is on
    but no `GTX` code exists, the run 400s with a clear message rather than silently
    skipping or guessing. `infants` wired through `reservations` POST/PUT, `groups/[id]/
    pickup`, and the reservation form UI (new "Infants" field). 3 new tests in
    `tests/business-rules/green-tax.test.ts`.
  - **Base price fallback rate — audited, no gap found**: confirmed `night-audit/run/
    route.ts`'s existing `calendarEntry?.price ?? roomType.basePrice` fallback is in
    fact the *only* place a nightly rate is ever resolved or charged anywhere in the
    app — there is no reservation-creation-time rate preview/quote endpoint that would
    also need this fallback. No code change needed; this closes the open question.
  - **`RoomType.housekeepingEnabled` now enforced**: rooms of such a type are excluded
    from the `GET /api/housekeeping` board, and `POST /api/housekeeping/tasks`,
    `POST /api/housekeeping/maintenance`, and `POST /api/maintenance` all 400 when
    targeting one — matches how `isActive` blocks new activity without touching
    history. 4 new tests added to `tests/tenant-isolation/operations.test.ts`.
  - **`reservations/page.tsx` hardcoded-UUID fallback removed** (`?? ""` instead of the
    old demo UUID), matching the `front-office/page.tsx` fix from Phase 6.
  - Full suite: 76/76 passing, `tsc --noEmit` clean. Live-verified in browser: the
    reservation form's Infants field renders and defaults to 0; the canonical print
    page renders real invoice data correctly.
  - **Note for next session**: this work required a schema migration + `prisma
    generate`, which needed the dev-server-held Prisma engine lock released — a
    *different* concurrent chat session's dev server (PID 6504) was stopped with the
    user's explicit confirmation to unblock this. If you hit the same `EPERM` error on
    `prisma generate`, check for other running dev servers before assuming it's yours.
- **2026-07-18** — Phase 6: remaining routes & final hardening (`analytics`,
  `front-office/summary`, `auth/seed`). Replaced raw `new PrismaClient()` in
  `analytics/route.ts` with the shared `@/lib/db` import; both routes retrofitted onto
  `requireSession`/`requirePermission`/`assertPropertyAccess` (REVENUE for analytics,
  FRONT_DESK for front-office/summary). Gated `POST /api/auth/seed` (creates accounts
  with a well-known password, previously reachable with zero auth) behind
  `NODE_ENV !== "production"`, returning 404 in prod; the "[Dev Tool] Seed Initial
  Users" button on `/login` is now hidden the same way. **Found and fixed a real bug
  while adding scoping**: `front-office/page.tsx` had a leftover hardcoded
  `00000000-0000-0000-0000-000000000000` propertyId (the pre-retrofit `DEMO_TENANT_ID`
  pattern) instead of using `useProperty()` like every other dashboard page — before
  this fix the route had zero auth so it silently queried garbage and returned empty
  results; after adding real scoping it 403'd outright, which is how it was caught live
  in the browser. Fixed to resolve `propertyId` from `useProperty()`, guarded
  `fetchSummary` on it being set. 6 new tests in `tests/tenant-isolation/reporting.test.ts`.
  Live-verified via browser (front-office, revenue/analytics, housekeeping dashboards
  all render real scoped data; a foreign/fake propertyId 403s; seed still works in dev).
  The full 7-item manual cross-role/cross-enterprise checklist in MASTER_PLAN was not
  re-run item-by-item by hand — 6 of 7 items (enterprise vs. property scope,
  cross-enterprise 403, support-access grant approve/enter/revoke) are already
  deterministically exercised by `tests/scope.test.ts` and the `tenant-isolation/*`
  suites against the real route/scope code, which is stronger evidence than a manual
  click-through; only the license-limit-enforcement and wrong-slug-login items rely on
  static/code-level verification rather than a fresh end-to-end run. **Phase 0-6 are
  now all closed** — see MASTER_PLAN.md.
- **2026-07-18** — Phase 5: operations scoping (`housekeeping`, `housekeeping/maintenance`,
  `housekeeping/tasks`, `maintenance`, `maintenance/[id]`). Replaced raw `new PrismaClient()`
  in `housekeeping/route.ts` and `housekeeping/maintenance/route.ts` with the shared
  `@/lib/db` import. Fixed the real cross-enterprise leak named in the master plan's
  original bug list: `maintenance` GET's `propertyId` filter was optional, now mandatory +
  `assertPropertyAccess`-checked. Bulk writes (room-status PATCH, maintenance-ticket POST)
  now validate every targeted room's property before touching any of them. Attendant
  assignment 404s on a cross-enterprise user id. 25 new tests in
  `tests/tenant-isolation/operations.test.ts`.
- **2026-07-18** — Phase 4: money & shift data scoping (`folios`, `payments`,
  `pos/charge`, `pos/search`, `night-audit`). Fixed a real cross-property data leak in
  `reports/arrival-pdf`/`departure-pdf` and a real wrong-model bug in
  `night-audit/status`. Removed a `"mock-shift-id"` demo hack in
  `folios/[id]/payments/route.ts`. 9 new tests in `tests/tenant-isolation/money.test.ts`.
- **2026-07-18** — Controls: Room Type feature model (Bed Type/View/Amenity unified into
  one multi-select `RoomTypeFeature`/`RoomFeature`), Inactive room-type cascade, Rooms UI
  (Building→Floor dependent selects, pseudo-room handling, inherited + additional
  features), Sequence Manager, Tax/Charge Code split into two Controls cards with
  category-based charge codes and default/custom tax selection. Discovered and fixed two
  previously-unauthenticated routes (`charge-codes/[id]`, `taxes/[id]`) along the way.
  Full business-rule detail in [DECISIONS.md](DECISIONS.md).
- **2026-07-18** — Phase 3: guest & booking data scoping.
- **2026-07-18** — Design system pass: monochromatic theming, responsive layouts (see
  [`DESIGN_PLAN.md`](DESIGN_PLAN.md) — status: plan says "planning only" in its header, but
  a commit titled "Implement DESIGN_PLAN.md" exists in git log; reconcile that
  discrepancy before treating the plan doc as still purely aspirational).
- **2026-07-18** — Phase 2: core reference/configuration data scoping.
- Phase 0/1: schema foundation, RBAC, Controls UI redesign, enterprise login.
