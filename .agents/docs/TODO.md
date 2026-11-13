# TODO — open work only

> Cleaned 2026/11/12. This file lists **what is still open**. Finished work is not kept here:
> it is in [DEV_LOG.md](DEV_LOG.md), the release notes
> (`src/app/docs/release-notes/releases.ts`) and git history. Business rules are in
> [DECISIONS.md](DECISIONS.md).
>
> **Keep it fresh.** When you close an item, delete it. When you find something broken that is
> out of scope, add it under the right heading with the date. Ask the owner before fixing
> anything marked "owner call".

## 1. Planned or in progress (each has its own plan file)

### Agent Portal and Agent API — Phases 0a to 6 built (9.0.1 to 9.6.0)

Plan: [AGENT_PORTAL_PLAN.md](AGENT_PORTAL_PLAN.md). A clickable mockup of the agent website
exists on the owner's machine only (`agent-portal/`, not in git).

- [ ] Phases 7 to 9 (9.7.0 … 9.9.0): plan §11 (0a to 6 are done). Set AGENT_PORTAL_URL on the server so invite and reset links are full links.
- [ ] Owner questions still open: Q-27 (tune the Tape Chart marker defaults), Q-28 (what moves a
  slot from Tentative to Definite).

### Notifications and phone push — N0 to N3 built (8.10.0)

Plan: [NOTIFICATIONS_PLAN.md](NOTIFICATIONS_PLAN.md).

- [ ] Per-property default settings in the Hub; reminders ("remind me"); quiet hours; email
  digest; SSE (N4, optional).
- [ ] Screenshots for the Announcements docs page (`npm run docs:shots`).
- [ ] Production needs the three `VAPID_*` variables in the VPS `.env`; until then the phone
  toggle is hidden.

### Marketing site migration — not started

Plan: [MARKETING_SITE_MIGRATION_PLAN.md](MARKETING_SITE_MIGRATION_PLAN.md). The four marketing
pages still live in the PMS at `/info` (`src/app/info`); the plan moves them to `uppsolut.com`.
The owner put it on hold on 2026-09-26 because the hosting of uppsolut.com was not known.

### Change stay dates from the Tape Chart — planned 2026-10-11, no plan file yet

Drag the start or end edge of a booking's bar to shorten or extend the stay (whole days). A
preview checks room availability, stop sale, room-type overbooking and group block dates, and
returns the price of the added or removed nights and the new total (same quote as the booking
form); nothing is written until confirmed. Only the outer edges of a multi-segment stay can be
dragged. Open choices: in-house shorten or extend and the folio credit for removed nights,
blocking the arrival edge for in-house guests, a reason, quick buttons on Front Desk and the
reservation page. Reuse the End of Day extend-stay route, the reservation save's availability
checks and the quote.

## 2. Follow-ups by area

### Reservations, Front Desk, Tape Chart

- [ ] Traces "alert on open": a tick on a trace that pops its text every time the reservation is
  opened until the trace is completed. Needs `ReservationTrace.alertOnOpen`.
- [ ] Advance Bill: replace the `window.prompt` nights picker with a proper dialog and give it
  its own printed document. (Agent Portal Phase 8 renames it Advance Folio and adds groups.)
- [ ] The Posting Master's own check-out is the normal reservation check-out; nothing closes it
  when the last pickup checks out.
- [ ] Check-in wizard room step shows "Room ()" when the booking's room type name is missing.
- [ ] Reservation detail body: remaining hand-rolled empty `<p>`s and tone badges.
- [ ] Sub-pixel sliver of a Tape Chart card can show at the room column's left edge at fractional
  scroll positions (cosmetic).
- [ ] Tape Chart fit check only sees the visible window; a clash beyond it is caught by the
  server and shown with the same prompt.
- [ ] List keys (J/K, Enter, action letters) on Reservations, Housekeeping and Tape Chart, using
  the Front Desk pattern (`useQuickKeys`, `canUseSingleKey`, `data-row-id`); add each key to the
  lists in `src/lib/shortcuts.ts` so the cheat sheet and docs follow.
- [ ] The Quick keys setting lives in the browser (localStorage). Move it to the user profile if
  desks share a login across machines.
- [ ] Parked by the owner: verb-first typing in the palette (`in williams`), Ctrl-K as an action
  palette, a role-based landing page (Housekeeping → task sheet, Cashier → open shift).

### Availability and stop sale

- [ ] Group pickup (`api/groups/[id]/pickup`) and the walk-in flow hard-block a stop sale with no
  override, unlike reservation create and edit. Add `overrideStopSale` and the shared prompt
  (`src/lib/conflict-prompt.ts`) if desk users need it.
- [ ] No per-rate-plan stop sale; no closed-to-arrival, closed-to-departure or minimum stay.
- [ ] A channel booking that arrives for a night closed after the OTA sold it stays RECEIVED and
  is retried; someone has to resolve it by hand or lift the stop sale.
- [ ] The stop-sale override is logged before the booking row exists; if a later validation fails
  the log line remains.

### Housekeeping and Maintenance

- [ ] Toolbar rule (one primary, one secondary, "More" for three or more) is done on Reservations
  and Housekeeping only. Remaining: Cashiering, Spa, Excursions, Fast Post, Reports, Group
  Blocks, Maintenance, Availability, Revenue, Debtors, Night Audit, Client Relations, Hub
  screens. Use `ActionBar` (`src/components/ui/action-bar.tsx`).
- [ ] Due-out rooms are tinted but not sorted first; owner call.
- [ ] Housekeeping status changes do not clear `Room.statusBeforeTypeDeactivation`.
- [ ] `/dashboard/inventory` is an orphan route: the landing page for roles without Front Desk
  view, with no sidebar entry. Decide whether those roles should land on Housekeeping.
- [ ] `src/components/housekeeping/work-order-manager.tsx` is unused since the inventory
  redirect; delete.
- [ ] Attendant task sheets (from Alpha v4).

### Cashiering, folios, tax

- [ ] Drop `ChargeCode.category`. It is still written as a mirror of the subgroup's bucket.
  Before the migration, grep `\.category` on `ChargeCode`: only `ensure-charge-tree.ts` and
  `report-bucket.ts` should hit.
- [ ] `postPayment()` (`src/lib/posting/post-payment.ts`) was built to centralise payment
  posting but no route calls it; `deposit`, `folios/[id]/payments`, `payments`,
  `spa/appointments` and `excursions/bookings` each repeat the pattern.
- [ ] Properties created before 2026-09-24 still carry the demo charge codes. Cleanup script
  ready, not applied anywhere: `npm run charges:cleanup-demo` (dry run), then `-- --apply`, per
  environment.
- [ ] Deferred by the owner: a per-transaction tax inclusive/exclusive override (the property
  level toggle exists). Do not build unless asked.
- [ ] Green Tax: the profile form uses exemption age 2 for its automatic tick; posting uses the
  property's `greenTaxExemptAge`. They differ only if a property changes the age.
- [ ] Green Tax: Booking API quotes assume every guest pays; Night Audit posts per person, so the
  folio can be lower than the quote.
- [ ] Green Tax: Hub month counts use the year's own registrations, so January leaves out
  stay-overs numbered in December (the MIRA report includes them). Cosmetic.
- [ ] Agent and company profiles created before the Green Tax report have no Booking Method;
  their rows show blank and are flagged in the report note.

### Reports

- [ ] Owner call: should downloading need its own right apart from viewing? (Agent Portal Phase
  0b proposes an "Export to file" capability.)
- [ ] Native Excel charts on the Summary sheet (numbers only today).
- [ ] Transportation report: link rows to the reservation (needs the reservation id in
  `BookingView`).
- [ ] List sorting and CSV cover the loaded rows only (profiles top 50, activity log paged).

### Transportation

- [ ] Legacy charge fields on `ReservationTransport` can no longer be entered; existing unposted
  charges still post. Drop the columns and code paths once no unposted legacy charge remains
  (data check per environment first).
- [ ] Per-departure printable passenger list.
- [ ] Hub Overview banner when Transportation is on but no route or rate exists.
- [ ] Copy-from-property for the transport catalogue.
- [ ] Booking API transport writes are not idempotent (no Idempotency-Key).
- [ ] Phones: bulk selection on the board is desktop only.

### Spa and Excursions

- [ ] "My appointments": a view for a therapist-linked user (`SpaTherapist.userId` exists). Owner
  said keep as a TODO (2026-07-25).
- [ ] Packages and memberships (deferred in the Spa plan).

### Booking API and brand website

- [ ] Room bookings have no cancel or modify endpoint, no webhooks, one room type per booking,
  and add-ons are on or off for the whole party (no quantities).
- [ ] Optional guest confirmation email from the PMS (the site sends it today).
- [ ] `publishToApi` is one mark for the website and the channel manager; a property wanting an
  extra on one but not the other needs a set of destinations.
- [ ] Images are URLs only (no upload).
- [ ] Early hold release, webhook delivery retention, an interactive API reference.

### Channel manager

- [ ] Keep-alive failure emails go only to Uppsolut ops; a self-connected enterprise should get
  them too. Needs a recipient rule.
- [ ] No flag says who set a connection up (self or Uppsolut-managed); add
  `ChannelConnection.managedBy` if Uppsolut-managed ones should hide re-authorize and disconnect.
- [ ] The Beds24 rate-limit headers (`X-FiveMinCreditLimit-Remaining`, `-ResetsIn`) are not read.
- [ ] No live sandbox account to exercise inbound conversion end to end.
- [ ] Guide: add screenshots of Beds24's own screens; verify the listed scopes against a live
  invite-code screen.
- [ ] Renaming or deleting a meal plan is not checked against channel defaults or website
  settings. Deleting a parent rate plan silently makes its derived plans independent.

### Hub and setup

- [ ] Richer dropdown entries (Phase 3b). **Blocked on an owner answer** (O-1): which fields
  (colour, icon, default, sort)?
- [ ] Dashboard widgets: denying a widget hides the card but does not withhold its data; the
  printable permission matrix does not show widget curation; no "copy this arrangement to my
  other properties".
- [ ] The change-password route keeps its own copy of the 12-character rule
  (`src/lib/user-account-rules.ts` has the shared one); `tax-manager.tsx` is still plain state
  (APP STANDARD 001 asks for Zod + React Hook Form).
- [ ] SFTP settings are scaffold only; nothing uses SFTP.
- [ ] Osta's own licence invoices still use `EnterpriseSettings.invoiceLogoUrl` (a URL field);
  move to the logo upload if the owner wants.

### Osta console

- [ ] Directory bulk actions (issue invoices, extend licences for selected rows); needs the
  licence and invoice dialogs first.
- [ ] Licence extend and renew are links to Licensing, not inline dialogs.
- [ ] Enter support mode still goes through the Support Access page; the Channel tab links out;
  no internal-notes field.
- [ ] Owner call: remove the Licensing page's enterprise picker?
- [ ] Channel privacy back-fill: a connection whose activity-log row was deleted falls back to
  ENTERPRISE (private). Check production rows after deploy.
- [ ] Billing "Up next to invoice" assumes monthly periods back to back; it misleads if invoices
  are ever quarterly or irregular. Platform-mail usage is not on the Billing page.
- [ ] Support Access log shows only the signed-in Osta user's own requests; a team-wide log needs
  an API change (ask the owner first).
- [ ] Monitoring: Background jobs and Storage tabs cannot narrow to a property.
- [ ] An Osta user who opens `/login` while signed in is sent to `/e/osta/dashboard` (a 404);
  should go to `/osta`.
- [ ] Split Controls into "Mail & usage" and "Settings"; add an Invoices ledger page under
  Billing; "Send reminder" for an overdue licence invoice (no email path exists).
- [ ] Tenant-facing "my licence, my invoices" read-only view; show the GRACE `licenseWarning` on
  the login form.
- [ ] `tests/business-rules/channel-connection.test.ts` "token expiry days" is flaky under a
  full suite run (time-boundary maths).

### Security and platform

- [ ] **Owner call:** `SECRETS_ENCRYPTION_KEY` fails open when unset, so SMTP and SFTP passwords
  can be stored in plain text. Failing closed would stop a production boot if the variable is
  missing; existing rows need a re-encryption pass.
- [ ] **Owner call:** the CSP still allows inline scripts; removing that needs a per-request
  nonce.
- [ ] eRegistration: a replaced ID photo is not deleted; the public write endpoints have no rate
  limit.
- [ ] The staff login throttle is an in-process map, so it is per instance and resets on restart.
  (The Booking API limiter is Postgres-backed; copy that.)
- [ ] Three `GET` handlers write to the database (`tenant-settings`, `folios`, `licenses`).
- [ ] From the 2026-07 audits: a financial audit-trail table, optimistic concurrency, Float to
  Int money storage, a shared CRUD-manager refactor, typing the remaining `any`s.
- [ ] `TierModuleAccess` fails open by design; tier restrictions enforce nothing. Do not "fix"
  without a tier-to-module decision from the owner.
- [ ] Input borders do not meet WCAG 1.4.11 contrast (1.23:1 light, 2.05:1 dark). Fixing it
  means visibly darker field borders app-wide: a design call for the owner.
- [ ] Dev-only console error "Encountered a script tag while rendering React component" from the
  theme script in `src/app/layout.tsx`. The real fix is a cookie-driven theme, which makes every
  route dynamic: owner call.
- [ ] Pre-existing lint error: `src/components/providers/idle-session-watch.tsx:44` calls
  `Date.now()` during render.

### Deployment and tooling

- [ ] The VPS crontab must call the jobs (`POST /api/jobs/run`) every 15 minutes, not hourly; a
  property's scheduled Night Audit starts at the first run after its set time. `DEPLOY.md` §7
  says so; the crontab itself has to be changed by hand.
- [ ] Backups: `storage/logos` is on the `osta-uploads` volume with the eRegistration photos;
  include that volume in VPS backups.
- [ ] Dead SQLite dependencies (`better-sqlite3`, `@prisma/adapter-better-sqlite3`,
  `@libsql/client`); removing them also drops the python/make/g++ layer from the Docker build.
- [ ] Puppeteer/Chromium adds weight to the Docker image; watch cold-build time on the VPS.
- [ ] Browser click-through tests are not in CI (the pipeline would have to build and start the
  app against `ostastay_test` and seed the system roles). Run locally before a release.
- [ ] Stale `.next/dev/types` breaks `tsc` after route moves: delete `.next` locally.
- [ ] Docs: screenshots of the keyboard cheat sheet and palette are not in the guide
  (`scripts/docs-shots.config.ts`).

### Phones

- [ ] Tab strips (enterprise workspace, Monitoring, Enterprises filter) scroll sideways; the
  Monitoring Database tables side-scroll inside their cards. Fine on a real phone, but against
  the "no sideways scroll" rule; redesign when touched.
- [ ] Pages with empty lists in the demo data (Monitoring tables, Cashiering breakdown) were not
  checked with real data.

## 3. Older items carried over, not re-verified

These were open when last written and nobody has confirmed them since. Check the code before
acting on one, and delete it if it is already done.

- Osta Overview: portfolio and revenue dashboard (sum of monthly prices, upcoming expiries,
  unpaid invoices). Likely covered by the Today page (8.12.x).
- Osta enterprise detail page should show licence state and invoices inline. Likely covered by
  the workspace redesign.
- DB Health storage panel needs Postgres equivalents of the SQLite page accounting. Likely fixed
  by "DB Health redesigned" (2026-11-08).
- Check-in `roomWarning` toast in the UI.
- Availability grid has no phone-specific layout. Likely fixed by the phone pass (PR #101).
