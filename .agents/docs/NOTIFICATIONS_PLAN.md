# Notifications — plan (drafted 2026-11-07)

> **Status 2026-11-07 (8.10.0, PR #93):** N0, N1 and N2 are BUILT. N0: manifest, push-only service worker,
> install prompt. N1: `Notification`/`NotificationRecipient` tables, `src/lib/notifications/`
> (catalogue, audience by permission, `notify()` with dedupe, producers), `/api/notifications`
> (list, mark read), the bell in both headers, five producers (business date rolled, Night Audit
> failed, channel booking received/failed, channel connection failed). N2 (push): `PushSubscription` table, `src/lib/notifications/push.ts` (VAPID via `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`; off when unset), `/api/notifications/push` (config, register, forget), the bell's phone toggle, `signOutCleanup()` on every sign-out path (incl. idle/EOD forced ones), sent after commit for ACTION/URGENT only. **Deviation from section 6.3:** no outbox/retry job — push is best-effort, a failing device is counted and dropped after 5 failures (410/404 at once); the bell is the source of truth. NOT built yet: the full
> `/notifications` page (the bell has "Show older" instead), preferences, push (N2), the rest of
> section 4's catalogue (N3), quiet hours (N4). **Production needs the three VAPID_* variables added to the VPS `.env`** (`npx web-push generate-vapid-keys`); until then the phone toggle is hidden. Setup/Operations were NOT moved: both were already in the Account menu.

> Owner ask: replace the header's **Setup** button with a **notification bell**; have personal and
> global notifications; and, because staff will install the app as a PWA, deliver them as **phone
> push notifications**. Read `MOBILE_PLAN.md`, `MOTION_PLAN.md`, `DESKTOP_PLAN.md` (toasts) and
> `HUB_SETUP_PLAN.md` before building. This file is the plan; decisions marked **OWNER** need a call.

## 1. What exists today (verified in code)

| Area | State |
|---|---|
| Header | `src/app/e/[slug]/dashboard/layout.tsx` → `CommandPaletteTrigger`, `HeaderBusinessDate`, `HeaderSetupLink` (only for `hasHubAccess`, hidden below `md`), `ThemeToggle`. The bell replaces `HeaderSetupLink` in `src/components/ui/dashboard-header.tsx`. The **Hub** header (`src/app/e/[slug]/hub/layout.tsx`) has the mirror button, **Operations** (the way back to the dashboard). Owner confirmed 2026-11-07: the bell appears in **both** headers, replacing Setup and Operations. |
| Notification model / UI | None. Only transient toasts (`src/lib/toast.ts`) and per-screen "needs attention" (`src/lib/transport/attention.ts`, computed live, never stored). |
| PWA | `public/site.webmanifest` (name, icons, `display: standalone`, theme colour) and apple-touch-icon. **No service worker, no `start_url`/`scope`/`id`, no push.** |
| Background work | No scheduler in-process: an **external cron calls `/api/jobs/run`**; jobs live in `src/lib/jobs/index.ts` (idempotent, locked, at-least-once). |
| Outbox pattern | `ApiWebhookEndpoint` / `ApiWebhookDelivery` + `emitBookingEvent` (`booking-events.ts`) — fire-and-forget after commit, retried with backoff by a job. Notifications copy this shape. |
| Identity | `User` (many roles via `UserRole`, `scope`, `propertyId`, `jobFunction`), real `Session` table (`userAgent`, `lastSeenAt`), permission merge in `role-permissions.ts`, gates in `scope.ts`. |
| Audit | `UserActivityLog` / `logActivity()` — a record of what users did. **Not** the notification source (different purpose: it is an immutable trail, notifications are per-recipient and mutable-read-state). |
| Hosting | Dockerfile (Node server). CSP set in `next.config.ts` — must allow the worker (`worker-src 'self'`) and push endpoints (`connect-src`). |

## 2. Principles

1. **A notification is something a person should act on or know about soon.** If nothing is
   expected of them, it is a log line, not a notification. Noise kills the feature.
2. **Recipients are decided by who may act, not by role name** — use permissions and
   `jobFunction` (`USER_MANAGEMENT_PLAN.md`), never `role.name ===`.
3. **Never the only channel for anything critical.** The bell is a convenience over data that
   exists elsewhere (reservation, Night Audit screen); losing a push loses nothing.
4. **Privacy on the lock screen.** Push text carries no guest names, amounts, card or ID data —
   "Arrival changed: Room 214" with a link, detail only after sign-in. Enterprise-configurable
   later.
5. **No polling** (house rule — see memory "Avoid polling"). Unread count loads once, refreshes on
   window focus, on a service-worker `postMessage` when a push arrives, and after the user's own
   actions. No `setInterval` against the server.
6. **Tenant and property safe.** Every row carries `enterpriseId` (+ `propertyId` when it
   belongs to one); every query is scoped via `scope.ts`. Support-mode sessions never receive or
   mark-read a tenant user's notifications.

## 3. The two kinds

| | **Personal** | **Global (broadcast)** |
|---|---|---|
| Addressed to | One user | A set: everyone / a property / a role / a job function |
| Examples | "Your 3 PM shift handover is due", "Guest note assigned to you", "Your password expires in 3 days" | "Night Audit failed at Coral Bay", "System maintenance Sunday 02:00", "Stop sale applied to Deluxe 12–15 Dec" |
| Read state | Own | **Per user** (each person marks their own) |
| Created by | System events, other users (mention/assign) | System events, or an admin composing an announcement in the Hub |
| Storage | One `Notification` row + one `NotificationRecipient` | One `Notification` row + recipients **resolved at send time** (fan-out), so later role changes do not rewrite history |

Implementation: one model for both. `audience` is resolved to concrete recipients when the
notification is created; there is no "live" audience query on read.

## 4. What can be a notification (the catalogue)

Severity: **INFO** (bell only) · **ACTION** (bell + push) · **URGENT** (bell + push + sticky banner until acknowledged).
Default recipients are by *permission*; every type has a per-user and per-property switch (§7).

### Front desk / reservations
| Event | Default who | Sev |
|---|---|---|
| Online / channel booking received (Booking API, OTA) | users with Reservations: create | ACTION |
| Channel booking stuck RECEIVED (closed night, retry failing) — already a known TODO gap | front office managers | ACTION |
| Arrival or departure date / room type changed on a reservation arriving within 24 h | assigned desk + managers | ACTION |
| Booking cancelled / no-show marked by website | desk | INFO |
| VIP / returning guest arrives today (morning digest) | desk | INFO |
| Group block cut-off date reached, rooming list incomplete | group owner | ACTION |
| Option / hold expiring in 2 h (spa, excursion holds) | booker | ACTION |
| Stop-sale / override applied (who, which dates) | revenue + managers | INFO |

### Rooms, housekeeping, maintenance
| Event | Default who | Sev |
|---|---|---|
| Room status flipped Dirty→Clean ready for an arrival waiting at desk | desk | ACTION |
| Task assigned to a room attendant / technician | that user (`jobFunction` HOUSEKEEPING / MAINTENANCE) | ACTION |
| Out-of-order created or its return date passed | managers | ACTION |
| Guest request logged against a room (extra towels, etc.) | housekeeping on shift | ACTION |

### Money
| Event | Default who | Sev |
|---|---|---|
| City Ledger payment blocked (no AR account) | finance | ACTION |
| Refund posted from a folio (amount hidden on lock screen) | finance + GM | INFO |
| Debtor invoice overdue over N days | finance | INFO |
| Cashier shift left open past closing time | cashier + supervisor | ACTION |
| Departing guest with non-zero balance (morning list) | desk | INFO |

### Night Audit / system
| Event | Default who | Sev |
|---|---|---|
| Night Audit started / completed (with warnings) | managers | INFO |
| **Night Audit failed or blocked** (unposted items, open shifts) | managers + finance | URGENT |
| Business date rolled | everyone at the property | INFO |
| Channel manager connection broke (today emailed by the job — add the bell) | IT / managers | URGENT |
| Scheduled report ready to download | requester | INFO |
| Background job failing repeatedly | platform admins (enterprise: Hub admins) | URGENT |

### Transportation / excursions / spa
| Event | Default who | Sev |
|---|---|---|
| Transport "needs attention" newly raised (flight time moved, boat leaves before landing) — reuse `attentionFor` | transport dispatcher | ACTION |
| Manifest departing in 1 h with unassigned bookings | dispatcher | ACTION |
| New excursion / spa booking from the website | desk or outlet staff | ACTION |
| Guest self-cancelled via website | outlet staff | INFO |

### People, security, account
| Event | Default who | Sev |
|---|---|---|
| New sign-in from a new device (uses `Session.userAgent`) | that user | INFO |
| Password changed / role changed / session revoked by admin | that user | INFO |
| Your session will expire for inactivity in 2 min — **stays an in-page toast**, not a notification | — | — |
| Support (Osta) opened a support session in your enterprise | Hub admins | URGENT |
| Licence / property approval status changed | enterprise owner | ACTION |
| Failed-login burst on an account | account owner + admins | ACTION |

### Announcements (the global admin-authored kind)
Free-text from the Hub: title, body, optional link, audience (enterprise / chosen properties /
roles / job functions), optional expiry, "must acknowledge" for policy notices.
Osta (platform) can also broadcast to every tenant (release notes, maintenance windows).

### Personal-only extras
Assigned / mentioned ("@Maya take a look at this reservation"), reminders the user sets on a
reservation or profile ("call guest tomorrow 10:00"), "your report finished", and shift
reminders.

**Start with a short list, not the whole catalogue (see phases):** Night Audit failed,
channel booking received/stuck, task assigned, transport attention, City Ledger blocked,
announcements, security notices.

## 5. When and where it appears

| Surface | Behaviour |
|---|---|
| **Header bell** (desktop, replaces Setup) | Icon + unread badge (`9+`). Opens a popover (≈ 380 px): tabs **All / Mine / Property / System**, grouped Today / Earlier, each row = icon, one line, relative time, unread dot; click → marks read and deep-links; "Mark all read"; footer links "Notification settings" and "View all". |
| **Bell on phones** | Header is already tight (business date moves under the brand name on phones). Bell stays in the header; opening it is a **bottom sheet** (`DialogContent mobile="sheet"`), per `MOBILE_PLAN.md`. |
| **Full page** `/e/{slug}/dashboard/notifications` | Filter by type / property / read; search; the only place to see old items; mirrors the list-page standards in `DESKTOP_PLAN.md`; filters live in the URL. |
| **Sticky banner** | URGENT items only, under the header (reuse the `SupportSessionNotice` style); stays until acknowledged. |
| **Toast** | Only when the user is on the page that changed and it came from *someone else's* action ("Room 214 is now clean"). Never a toast for what the user just did themself. |
| **Row/entity badges** | Reservation page shows "Notifications about this reservation" only if useful — **not v1**. |
| **Browser tab / app icon** | `navigator.setAppBadge(unread)` in the installed PWA; tab title prefix `(3)` in the browser. |
| **Phone push** | The same notification, delivered by Web Push to every installed device the user opted in on (§6). |
| **Email** | Not a channel in v1. Only URGENT system mails that exist today (channel alerts) stay as they are. **OWNER** may add a digest later. |

**Where do Setup and Operations go?** (Owner confirmed the bell replaces both; the destinations below are my proposal.) Operations (Hub → dashboard) takes the same three places, mirrored: account menu, Ctrl K, bell footer.

**Where does Setup go?** It must not disappear — Hub access is how admins configure everything.
Proposed: (1) an entry in the **account menu / sidebar footer** ("Setup (Hub)"), (2) an action in
the command palette (`Ctrl K`: "Open Setup"), (3) on the bell's popover footer for Hub-access
users only. The bell itself is permission-neutral: every signed-in user gets one. **OWNER:**
confirm that is acceptable; the alternative is keeping a small gear icon beside the bell.

## 6. PWA + push architecture

### 6.1 Install and manifest (prerequisite — small, shippable alone)
- Extend `public/site.webmanifest`: `id`, `start_url` (`/` resolving to the user's last property
  dashboard), `scope: "/"`, `short_name`, `display: "standalone"`, `orientation: "any"`, shortcuts
  (Front Desk, Reservations, Housekeeping). Keep the existing icons (192/512/maskable).
- Add an **install prompt component**: capture `beforeinstallprompt` on Android/desktop Chrome; on
  iOS show instructions ("Share → Add to Home Screen") because iOS has no prompt.
- Add `docs` page: `/docs/operations/install-the-app` (Android, iOS, desktop) per the docs rule in `AGENTS.md`.

### 6.2 Service worker
- `public/sw.js` (plain, hand-written, ~100 lines; no Workbox / `next-pwa` — it conflicts with
  Next 16 and brings caching risk). **Responsibilities: push, notificationclick, and nothing else.**
- **No offline page caching in v1.** A hotel PMS showing stale rooms/rates offline is worse than a
  clear "you are offline" message. (Optionally cache a static offline fallback page only.)
- `push` handler: show the notification (title, body, icon, `tag` = notification id for dedupe,
  `data.url`); also `postMessage` any open window so the bell refreshes without a poll.
- `notificationclick`: focus an existing app window and navigate it, else `clients.openWindow(url)`.
- Register from a client component after load; served with `Cache-Control: no-cache` and
  `Service-Worker-Allowed: /`. CSP: add `worker-src 'self'`.

### 6.3 Web Push (VAPID)
- Package: `web-push` (server side). Generate one VAPID key pair per **environment**
  (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:…`) — platform-level, not
  per-tenant (like the platform SMTP). Public key is exposed to the client.
- Subscribe flow (client, requires a **user gesture** — never on page load): Notification settings →
  "Turn on phone notifications" → `Notification.requestPermission()` →
  `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → `POST
  /api/notifications/push/subscribe`.
- `PushSubscription` model: `userId`, `enterpriseId`, `endpoint` (unique), `p256dh`, `auth`
  (encrypted via `secret-crypto.ts`), `userAgent`, `deviceLabel`, `createdAt`, `lastUsedAt`,
  `lastFailureAt`, `failureCount`, `revokedAt`. Tied to the user, **not** to the `Session` (a
  subscription must survive re-login); deleted on 404/410 from the push service, and on logout of
  that device (unsubscribe call).
- **Sign-out must unsubscribe the device** (shared front-desk PCs and phones: otherwise the next
  person at that device receives the previous user's alerts).
- Send path = the existing **outbox pattern**: creating a notification writes
  `NotificationDelivery` rows (PENDING) per subscription; a job `notification-push` (same cron,
  `src/lib/jobs/index.ts`) sends with retry/backoff exactly like `processDueWebhooks`. A small
  immediate attempt after commit (fire-and-forget, like `notifyBookingChange`) keeps latency to
  seconds; the job is the safety net. Payload ≤ 4 KB, encrypted by the library.
- Platform realities to document and design around:
  - **iOS/iPadOS 16.4+**: push works **only** for a PWA added to the Home Screen, and permission
    must be requested from a tap inside the installed app.
  - **Android / Chrome / Edge desktop**: works in the browser and installed.
  - Delivery is **best-effort**; push services may delay or drop. Hence principle 3.
  - Notification permission is per-device; "denied" cannot be re-prompted — settings page shows the
    state and how to re-enable.
  - Needs **HTTPS** (production is; localhost is exempt for dev).

### 6.4 Realtime in an open window (no polling)
Phase 1: unread count fetched on mount, on `visibilitychange`/focus, after own mutations, and on
SW `postMessage`. That already feels live on an installed PWA because push wakes the worker.
Phase 3 (only if wanted): a single **SSE** stream `/api/notifications/stream` for desktop browsers
without push. Needs a decision on multi-instance fan-out (Postgres `LISTEN/NOTIFY` is available
since we already run Postgres) — do not build until the owner asks.

## 7. Data model (Prisma, additive migration)

```prisma
model Notification {
  id           String   @id @default(uuid())
  enterpriseId String
  propertyId   String?                     // null = enterprise-wide
  type         String                      // NIGHT_AUDIT_FAILED, TASK_ASSIGNED, ANNOUNCEMENT…  (free string, per repo convention)
  severity     String   @default("INFO")   // INFO | ACTION | URGENT
  scope        String   @default("PERSONAL") // PERSONAL | GLOBAL
  title        String
  body         String?
  url          String?                     // deep link, always same-origin relative
  entityType   String?
  entityId     String?
  dedupeKey    String?                     // "NIGHT_AUDIT_FAILED:<propertyId>:<businessDate>" — idempotent under at-least-once jobs
  createdByUserId String?                  // null = system
  requiresAck  Boolean  @default(false)
  expiresAt    DateTime?
  createdAt    DateTime @default(now())
  recipients   NotificationRecipient[]
  @@unique([enterpriseId, dedupeKey])
  @@index([enterpriseId, createdAt])
}

model NotificationRecipient {
  id             String   @id @default(uuid())
  notificationId String
  notification   Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  userId         String
  readAt         DateTime?
  acknowledgedAt DateTime?
  dismissedAt    DateTime?
  @@unique([notificationId, userId])
  @@index([userId, readAt, notificationId])   // the unread-count query
}

model NotificationPreference {            // absence of a row = the type's default
  id        String  @id @default(uuid())
  userId    String
  type      String                         // or "*" for a channel master switch
  inApp     Boolean @default(true)
  push      Boolean @default(true)
  @@unique([userId, type])
}

model PushSubscription { … }              // §6.3
model NotificationDelivery { … }          // outbox: recipientId, subscriptionId, status, attempts, nextAttemptAt, lastError
```

Notes: recipients are **fanned out at creation** (a 40-user property = 40 small rows — fine);
retention job deletes read notifications > 90 days and all > 180 days (add to `jobs/index.ts`,
like `pruneSyncLogs`); `url` validated to be a relative path; `title/body` are plain text, never HTML.

## 8. Code shape

- `src/lib/notifications/`
  - `types.ts` — the **catalogue as code**: `NOTIFICATION_TYPES` (code, label, default severity,
    default audience resolver, privacy-safe push text builder, owning module). Single source of truth,
    like `job-functions.ts`. The settings page is rendered from it.
  - `notify.ts` — `notify({ type, propertyId, entity, data, dedupeKey, to? })`: resolves recipients
    (permission + property scope + `jobFunction`), applies preferences, inserts rows in one
    transaction, then **after commit** hands off to push. **Never throws into the caller** (same
    contract as `logActivity` and `notifyBookingChange`).
  - `audience.ts` — `usersWithPermission(propertyId, module, action)`, `usersWithJobFunction(...)`.
  - `push.ts` — `web-push` wrapper, pruning of dead endpoints.
  - `jobs` — `notification-push` (retry) and `notification-prune`.
- API (`src/app/api/notifications/`): `GET` list (cursor, filters), `GET /unread-count`, `POST
  /read` (ids | all), `POST /ack`, `GET/PUT /preferences`, `POST /push/subscribe`, `DELETE
  /push/subscribe`, Hub-side `POST /api/hub/…/announcements`. All use `scope.ts` helpers.
- UI: `src/components/notifications/` — `notification-bell.tsx` (header), `notification-list.tsx`
  (shared by popover/page/sheet), `notification-item.tsx`, `push-settings-card.tsx`,
  `install-app-prompt.tsx`. Bell uses the `Bell` icon from `@/components/icons` (mx-icons two-tone
  adapter — add `Bell` there if missing), animation via `motion-kit.tsx` per `MOTION_PLAN.md`
  (restrained: badge pops once, list items fade in; nothing loops).
- Preferences screen: `/e/{slug}/dashboard/account/notifications` (personal), plus a Hub
  "Notifications" page for property defaults and the announcement composer
  (`/hub/p/{propertyId}/notifications` for property defaults; announcements and push policy at
  `/hub/enterprise/…`). Docs under `src/app/docs/configuration` (screenshots via `docs:shots`) and
  an operations guide, plus a release-notes entry (version bump per `AGENTS.md`).
- RBAC: new module/permission **Notifications** is *not* needed to receive (everyone gets a bell).
  Announcements need `NOTIFICATIONS:announce` (Hub, enterprise scope). Check that adding it needs a
  migration of default role permissions — follow how `USER_MANAGEMENT_PLAN.md` handles new rights.

## 9. Phases

| # | Ships | Size |
|---|---|---|
| **N0** | PWA foundation: manifest fields, install prompt, install docs page, `sw.js` registered (no-op push handler), CSP `worker-src`. No user-visible notification yet. | S |
| **N1** | In-app notifications: models, `notify()`, bell replaces Setup (Setup moved per §5), popover/sheet, full page, read/unread, retention job, **3 producers**: Night Audit failed, channel booking received/stuck, announcement. Tests (§10). | M |
| **N2** | Web Push: VAPID, subscribe/unsubscribe, device list, outbox job, sign-out unsubscribe, privacy-safe payloads, app badge. Pilot with Night Audit + task-assigned. | M |
| **N3** | More producers from §4 (housekeeping, transport, money, security), per-type preferences UI, Hub property defaults, Hub announcement composer with audiences + acknowledge. | M–L |
| **N4** | Optional: quiet hours / shift-aware delivery, email digest, SSE stream for desktop, reminders ("remind me"), Osta platform broadcasts. | on request |

N0 and N1 have no dependency on each other except that the bell should be merged before N2; N0 can
ship first and independently.

## 10. Test plan
- Unit: audience resolution (permission + property scope + support-mode exclusion), preference
  merge, dedupeKey idempotency (cron firing twice creates one row), `notify()` never throws,
  push payload contains no guest names/amounts.
- API: tenant isolation (user A cannot list/read-mark B's notifications; other enterprise → 404),
  mark-read only own recipient row, announcement needs permission, subscribe stores only for self.
- Job: push retry/backoff, 410 deletes the subscription, locked-run skips.
- E2E (Playwright, existing suite): bell badge count, open popover, click deep-links and clears the
  dot, mark-all-read, mobile sheet at 375 px. Push itself is verified manually on a real Android
  and an iPhone (cannot be automated reliably) — checklist in the PR.
- `npm run mobile:audit` (desktop pixel diff must only change in the header's right side).

## 11. Risks
| Risk | Mitigation |
|---|---|
| Alert fatigue — the bell becomes ignored | Short initial catalogue; severity tiers; per-type opt-out; only ACTION/URGENT push; digest instead of per-event for high-volume types. |
| Guest PII on lock screens | Privacy-safe text by default (principle 4); review every `buildPush` in code review. |
| Shared devices leak alerts | Unsubscribe on sign-out; device list under Account; revoke all on password change. |
| iOS limits confuse users | Install page + in-app instructions; settings shows permission state. |
| Fan-out cost at scale (announcement to thousands) | Insert in batches; push sent via the job, not inline; cap announcement audiences initially. |
| Stale-cache bugs from a service worker | SW does push only, no fetch caching; `no-cache` on `sw.js`; versioned unregister path if ever needed. |
| Support-mode confusion | Support sessions neither see nor mark-read tenant user items; "Support opened a session" notice is itself an URGENT notification. |
| Push service outage | Bell is the source of truth; push is best-effort; failures recorded, never block the action. |

## 12. Open questions for the owner (answer before N1)

**Answered 2026-11-07:** Q1 (Operations is the Hub header's button; bell goes in both headers) and Q2 (see N-6/N-7 below). Q3-Q8 carry a default; building proceeds on the defaults unless the owner objects.
1. **"Setup / Operations"** — the header shows only *Setup*. Is *Operations* a link you expect there
   (or the Operations dashboard)? Is moving Setup into the account menu + command palette fine?
2. Who should receive **Night Audit failed** and **channel booking** alerts by default — a job
   function (Management / Front Office), or anyone with the permission?
3. May a manager see *who has read* an announcement (compliance), or is read-state private?
4. Should push text ever include the **guest's name** (e.g. VIP arrival)? Default: no.
5. Quiet hours / night shift: do we need "do not push between 23:00–06:00 except URGENT" in N2, or N4?
6. Is a free **email digest** wanted as a fallback for staff who never install the app?
7. Platform-level (Osta) broadcasts to all tenants — in scope (N4)?
8. Retention: 90 days read / 180 days all — OK?

## 13. Decisions log (fill as the owner answers)
- N-1 (proposed): one `Notification` model for personal + global; recipients fan out at creation.
- N-2 (proposed): Web Push via VAPID + hand-written service worker; no offline caching; no `next-pwa`.
- N-3 (proposed): outbox + the existing cron job for delivery, same shape as Booking API webhooks.
- N-4 (proposed): no polling — focus refresh + push `postMessage`.
- N-6 (owner, 2026-11-07): **business date rolled** is sent to **all users of that property**.
- N-7 (owner, 2026-11-07): **any failure** (Night Audit, channel, jobs…) goes to users who **have access to that module** — recipients resolved by permission, not by role name or job function.
- N-8 (owner, 2026-11-07): the bell lives in the dashboard header **and** the Hub header (Hub: enterprise- and property-scoped items; same list component).
- N-5 (proposed): lock-screen text is privacy-safe; subscription is removed at sign-out.
